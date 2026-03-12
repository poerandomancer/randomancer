#!/usr/bin/env python3
"""
scrape_poe2db_uniques_min.py

Scrape PoE2DB uniques into a minimal, app-focused dataset.

Fields per unique:
- Name
- Base + Slot (Item class)
- Requirements (level/str/dex/int)
- Implicit Mods
- Explicit Mods
- Flavour Text
- Granted skills
- Tags:
    - Bracket tags extracted from mod lines: [Label|Tag] -> "tag"
    - Normalized + de-duplicated bracket tags only

Output: poe2db_uniques_min.json

Usage:
  pip install requests beautifulsoup4
  python3 scrape_poe2db_uniques_min.py --lang us --out data/enriched/poe2db_uniques_min.json --resume --verbose

Notes:
- Run this as a dev/build step. Commit the JSON; do NOT fetch PoE2DB at runtime.
- If you previously ran an older version with --resume, delete the output JSON and re-run to rebuild with the updated fields.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup  # pip install beautifulsoup4

POE2DB_HOST = "https://poe2db.tw"
LISTING_PATH = "Unique_item"

# Embedded JSON starts like {"realm":"poe2", ...}
JSON_START_PAT = re.compile(r'\{\s*"realm"\s*:\s*"poe2"\s*,', re.I)

# Bracket tokens inside many lines: [Label|Tag]
BRACKET_PAT = re.compile(r"\[([^\]|]+)\|([^\]]+)\]")

# Slot extraction: ignore common property names (weapon stats etc.)
COMMON_PROPERTY_NAMES = {
    "Quality",
    "Armour",
    "Evasion Rating",
    "Energy Shield",
    "Ward",
    "Physical Damage",
    "Elemental Damage",
    "Chaos Damage",
    "Critical Strike Chance",
    "Attacks per Second",
    "Weapon Range",
    "Block Chance",
    "Chance to Block",
    "Requires",
    "Sockets",
}

def fetch_html(url: str, timeout: float = 25.0) -> str:
    r = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": "Randomancer/poe2db-uniques-min (https://therandomancer.com)"},
    )
    r.raise_for_status()
    return r.text

def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def strip_square_brackets_chars(s: str) -> str:
    """Remove literal '[' and ']' characters (defensive cleanup)."""
    return (s or "").replace("[", "").replace("]", "")

TAG_VARIANTS = {
    # existing / obvious single-word tense-plural cleanup
    "minions": "minion",
    "charges": "charge",
    "bleeding": "bleed",
    "bled": "bleed",
    "shocked": "shock",
    "shocks": "shock",
    "shocking": "shock",
    "ignited": "ignite",
    "ignites": "ignite",
    "igniting": "ignite",
    "poisoned": "poison",
    "poisons": "poison",
    "poisoning": "poison",
    "recouped": "recoup",
    "recouping": "recoup",

    # high-value generic plurals / inflections
    "attacks": "attack",
    "hits": "hit",
    "hitting": "hit",
    "blocked": "block",
    "blocking": "block",
    "spells": "spell",
    "projectiles": "projectile",
    "leeches": "leech",
    "leeched": "leech",
    "chilled": "chill",
    "frozen": "freeze",
    "stunned": "stun",

    # phrase-level variants that are clearly the same mechanic
    "critical_hits": "critical_hit",
    "critically_hit": "critical_hit",

    # charge families
    "power_charges": "power_charge",
    "frenzy_charges": "frenzy_charge",

    # stun families
    "heavy_stuns": "heavy_stun",
    "heavy_stunned": "heavy_stun",
    "light_stunned": "light_stun",

    # common nouns that are showing up in plural form
    "curses": "curse",
    "warcries": "warcry",
    "totems": "totem",
    "weapons": "weapon",
    "allies": "ally",
    "corpses": "corpse",
    "attributes": "attribute",
    "flasks": "flask",
    "charms": "charm",
    
    # semantic variants
    "breaks_armour": "armour_break",
    "fully_armour_broken": "armour_break",

    "leeched_as_life": "life_leech",
    "leeching_life": "life_leech",

    # optional, depending on how broad you want Build Mode matching to be
    "aggravating_any_bleeding": "bleed",
    "aggravates_all_ignites": "ignite",
}

def normalize_tag(tag: Any) -> Optional[str]:
    raw = str(tag or "").lower()
    raw = strip_square_brackets_chars(raw)

    if raw.startswith("grants:") or raw.startswith("grants "):
        return None

    raw = raw.replace("'", "")
    raw = raw.replace("-", "_")
    raw = raw.replace(" ", "_")
    raw = re.sub(r"[^a-z0-9_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")

    if not raw:
        return None

    if raw == "shrine" or raw.endswith("_shrine"):
        return None

    return TAG_VARIANTS.get(raw, raw)

def safe_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        if isinstance(x, (int, float)):
            return int(x)
        s = str(x).strip()
        if not s:
            return None
        m = re.match(r"^(-?\d+)", s)
        return int(m.group(1)) if m else None
    except Exception:
        return None

def extract_embedded_item_json(html: str) -> Optional[dict]:
    """Extract a balanced JSON object starting at {"realm":"poe2", ...}."""
    m = JSON_START_PAT.search(html)
    if not m:
        return None
    start = m.start()

    depth = 0
    in_str = False
    esc = False
    end = None

    for idx in range(start, len(html)):
        ch = html[idx]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        else:
            if ch == '"':
                in_str = True
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = idx + 1
                    break

    if end is None:
        return None

    blob = html[start:end]
    try:
        return json.loads(blob)
    except Exception:
        return None

def values_to_text(values: Any) -> Optional[str]:
    # PoE style: [["12", 0]]
    if values is None:
        return None
    if isinstance(values, str):
        return norm_ws(values)
    if isinstance(values, list) and values:
        first = values[0]
        if isinstance(first, list) and first:
            return norm_ws(str(first[0]))
        return norm_ws(str(first))
    return None

def extract_bracket_tags(s: str) -> List[str]:
    tags = []
    for _label, tag in BRACKET_PAT.findall(s or ""):
        t = normalize_tag(tag)
        if t:
            tags.append(t)
    # de-dupe preserve order
    seen = set()
    out = []
    for t in tags:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out

def strip_brackets_for_display(s: str) -> str:
    # [Label|Tag] -> Label
    return BRACKET_PAT.sub(lambda m: m.group(1), s or "")

def normalize_mod_lines(arr: Any) -> List[str]:
    if not isinstance(arr, list):
        return []
    out: List[str] = []
    for x in arr:
        s = norm_ws(str(x))
        if s:
            out.append(s)
    return out

def parse_requirements_from_display(text_lines: List[str]) -> Optional[Dict[str, Optional[int]]]:
    """Parse visible 'Requires:' line (preferred)."""
    for ln in text_lines[:250]:
        s = norm_ws(ln)
        if not s.lower().startswith("requires:"):
            continue

        s2 = strip_square_brackets_chars(strip_brackets_for_display(s))

        lvl_m = re.search(r"\bLevel\s*(\d+)", s2, re.I)
        str_m = re.search(r"\b(\d+)\s*(?:Str|Strength)\b", s2, re.I)
        dex_m = re.search(r"\b(\d+)\s*(?:Dex|Dexterity)\b", s2, re.I)
        int_m = re.search(r"\b(\d+)\s*(?:Int|Intelligence)\b", s2, re.I)

        lvl = safe_int(lvl_m.group(1)) if lvl_m else None
        st = safe_int(str_m.group(1)) if str_m else None
        dx = safe_int(dex_m.group(1)) if dex_m else None
        it = safe_int(int_m.group(1)) if int_m else None

        if any(v is not None for v in (lvl, st, dx, it)):
            return {"level": lvl, "str": st, "dex": dx, "int": it}

    return None

def parse_requirements_from_item_json(item_json: dict) -> Dict[str, Optional[int]]:
    """
    Parse requirements[] where name may be bracketed like:
      "[Dexterity|Dex]", "[Strength|Str]", "[Intelligence|Int]".
    """
    reqs = item_json.get("requirements")
    if not isinstance(reqs, list):
        return {"level": None, "str": None, "dex": None, "int": None}

    out = {"level": None, "str": None, "dex": None, "int": None}
    for e in reqs:
        if not isinstance(e, dict):
            continue
        nm = norm_ws(str(e.get("name") or ""))
        val = safe_int(values_to_text(e.get("values")))
        if val is None or not nm:
            continue

        nml = nm.lower()

        if nml == "level" or ("|level" in nml):
            out["level"] = val
            continue

        if ("|str" in nml) or ("strength" in nml):
            out["str"] = val
        elif ("|dex" in nml) or ("dexterity" in nml):
            out["dex"] = val
        elif ("|int" in nml) or ("intelligence" in nml):
            out["int"] = val

    return out

def parse_slot_from_item_json_properties(item_json: dict) -> Optional[str]:
    """
    Prefer properties[].name where values is empty and name isn't a common stat property.
    Many PoE2DB embedded JSON blobs include the item class here.
    """
    props = item_json.get("properties")
    if not isinstance(props, list):
        return None

    for p in props:
        if not isinstance(p, dict):
            continue
        nm = norm_ws(str(p.get("name") or ""))
        if not nm or nm in COMMON_PROPERTY_NAMES:
            continue
        vals = p.get("values")
        if vals is None or (isinstance(vals, list) and len(vals) == 0):
            return strip_square_brackets_chars(strip_brackets_for_display(nm)).strip()

    return None

def parse_slot_from_page_text(text_lines: List[str]) -> Optional[str]:
    for ln in text_lines[:350]:
        s = norm_ws(ln)
        if s.lower().startswith("item class:"):
            return strip_square_brackets_chars(strip_brackets_for_display(norm_ws(s.split(":", 1)[1]))).strip()
    return None

def normalize_granted_skills(gs: Any) -> List[dict]:
    """
    Normalize item_json.grantedSkills entries.

    PoE2DB commonly encodes:
      {"name":"Grants Skill","values":[["Level 15 Power Siphon", 25]], "icon": ...}

    Output:
      [{"name":"Power Siphon","level":15,"icon":...,"raw":"Level 15 Power Siphon"}]
    """
    if not isinstance(gs, list):
        return []
    out: List[dict] = []
    lvl_name_pat = re.compile(r"^Level\s+(\d+)\s+(.+)$", re.I)

    for e in gs:
        if not isinstance(e, dict):
            continue

        raw_name = norm_ws(str(e.get("name") or ""))
        raw_val = None

        vals = e.get("values")
        if isinstance(vals, list) and vals:
            first = vals[0]
            if isinstance(first, list) and first:
                raw_val = norm_ws(str(first[0]))

        icon = e.get("icon")
        icon = icon.strip() if isinstance(icon, str) else None

        parsed_name = ""
        parsed_level: Optional[int] = None

        if raw_val:
            v = strip_square_brackets_chars(strip_brackets_for_display(raw_val)).strip()
            m = lvl_name_pat.match(v)
            if m:
                parsed_level = safe_int(m.group(1))
                parsed_name = norm_ws(m.group(2))
            else:
                parsed_name = norm_ws(v)

        if not parsed_name:
            parsed_name = strip_square_brackets_chars(strip_brackets_for_display(raw_name)).strip()

        if parsed_name.lower() in {"grants skill", "grants"} and not raw_val:
            continue

        rec: Dict[str, Any] = {"name": parsed_name}
        if parsed_level is not None:
            rec["level"] = parsed_level
        if raw_val:
            rec["raw"] = raw_val
        if icon:
            rec["icon"] = icon

        out.append(rec)

    return out

@dataclass(frozen=True)
class UniqueRef:
    label: str
    href: str

@dataclass(frozen=True)
class UniqueRef:
    label: str
    href: str

def href_slug_to_label(href: str) -> str:
    slug = (href or "").rstrip("/").rsplit("/", 1)[-1]
    slug = slug.replace("_", " ")
    return norm_ws(slug)

def discover_unique_refs(listing_html: str, lang: str) -> List[UniqueRef]:
    """
    Discover candidate unique item pages from the Unique_item listing.

    More flexible than the old image-art heuristic:
    - accepts any in-site /{lang}/... link from the listing
    - prefers visible text labels
    - falls back to img alt/title or slug-derived label
    - final item validation happens after fetch
    """
    soup = BeautifulSoup(listing_html, "html.parser")
    refs: List[UniqueRef] = []
    seen = set()

    href_pat = re.compile(rf"^/{re.escape(lang)}/[^#?]+$")

    for a in soup.find_all("a", href=href_pat):
        href = (a.get("href") or "").strip()
        if not href:
            continue

        href_norm = href.rstrip("/")
        if href_norm.lower() == f"/{lang}/unique_item":
            continue

        # Best-effort label extraction
        label = norm_ws(a.get_text(" ", strip=True))

        if not label:
            img = a.find("img")
            if img:
                label = norm_ws(
                    str(img.get("alt") or img.get("title") or "")
                )

        if not label:
            label = href_slug_to_label(href)

        if not label:
            continue

        if href_norm in seen:
            continue
        seen.add(href_norm)

        refs.append(UniqueRef(label=label, href=href_norm))

    return refs

def looks_like_item_page(item_json: dict, text_lines: List[str]) -> bool:
    if isinstance(item_json, dict):
        if norm_ws(str(item_json.get("name") or "")):
            return True
        if norm_ws(str(item_json.get("typeLine") or "")):
            return True
        if parse_slot_from_item_json_properties(item_json):
            return True

    if parse_slot_from_page_text(text_lines):
        return True

    return False

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="us")
    ap.add_argument("--out", default="data/enriched/poe2db_uniques_min.json")
    ap.add_argument("--timeout", type=float, default=25.0)
    ap.add_argument("--sleep", type=float, default=0.25)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    existing = {}
    if args.resume and out_path.exists():
        try:
            existing = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    items: Dict[str, Any] = existing.get("items", {}) if isinstance(existing.get("items"), dict) else {}
    by_key: Dict[str, str] = existing.get("by_key", {}) if isinstance(existing.get("by_key"), dict) else {}

    listing_url = f"{POE2DB_HOST}/{args.lang}/{LISTING_PATH}"
    if args.verbose:
        print(f"[info] listing: {listing_url}")

    listing_html = fetch_html(listing_url, timeout=args.timeout)
    refs = discover_unique_refs(listing_html, args.lang)

    if args.verbose:
        print(f"[info] discovered {len(refs)} unique pages")

    for idx, ref in enumerate(refs, start=1):
        page_id = ref.href  # stable id like "/us/Lifesprig"
        if page_id in items:
            if args.verbose:
                print(f"[skip] {idx}/{len(refs)} {ref.label}")
            continue

        url = urljoin(POE2DB_HOST, ref.href)
        if args.verbose:
            print(f"[fetch] {idx}/{len(refs)} {ref.label} -> {url}")

        try:
            html = fetch_html(url, timeout=args.timeout)
            soup = BeautifulSoup(html, "html.parser")
            text_lines = soup.get_text("\n").splitlines()

            item_json = extract_embedded_item_json(html) or {}
            
            if not looks_like_item_page(item_json, text_lines):
            	if args.verbose:
            		print(f"[skip-nonitem] {ref.label} -> {url}")
            	continue

            name = norm_ws(str(item_json.get("name") or "")) or ref.label.split(" ")[0]
            base = norm_ws(str(item_json.get("typeLine") or ""))
            name = strip_square_brackets_chars(strip_brackets_for_display(name)).strip()
            base = strip_square_brackets_chars(strip_brackets_for_display(base)).strip()

            # Slot (item class)
            slot = parse_slot_from_item_json_properties(item_json) or parse_slot_from_page_text(text_lines) or None
            slot = strip_square_brackets_chars(strip_brackets_for_display(slot)).strip() if slot else None

            # Requirements
            req = parse_requirements_from_display(text_lines) or parse_requirements_from_item_json(item_json)

            # Mods (collect bracket tags and strip to display labels)
            bracket_tags = set()

            implicit_mods_raw = normalize_mod_lines(item_json.get("implicitMods"))
            explicit_mods_raw = normalize_mod_lines(item_json.get("explicitMods"))

            implicit_mods: List[str] = []
            explicit_mods: List[str] = []

            for ln in implicit_mods_raw:
                for t in extract_bracket_tags(ln):
                    bracket_tags.add(strip_square_brackets_chars(t))
                implicit_mods.append(norm_ws(strip_square_brackets_chars(strip_brackets_for_display(ln))))

            for ln in explicit_mods_raw:
                for t in extract_bracket_tags(ln):
                    bracket_tags.add(strip_square_brackets_chars(t))
                explicit_mods.append(norm_ws(strip_square_brackets_chars(strip_brackets_for_display(ln))))

            # Flavour text
            flavour_text = [
                norm_ws(strip_square_brackets_chars(strip_brackets_for_display(x)))
                for x in normalize_mod_lines(item_json.get("flavourText"))
            ]

            # Granted skills (minimized, parsed from values)
            granted_skills = normalize_granted_skills(item_json.get("grantedSkills"))

						# Tags: bracket-derived only
            normalized_tags: List[str] = []
            seen_tags = set()
            for t in sorted(bracket_tags):
                nt = normalize_tag(t)
                if not nt or nt in seen_tags:
                    continue
                seen_tags.add(nt)
                normalized_tags.append(nt)

            key = f"{strip_square_brackets_chars(name)}||{strip_square_brackets_chars(base)}" if base else strip_square_brackets_chars(name)

            rec = {
                "key": key,
                "name": name,
                "base": base,
                "slot": slot,
                "requirements": req,
                "implicit_mods": implicit_mods,
                "explicit_mods": explicit_mods,
                "flavour_text": flavour_text,
                "granted_skills": granted_skills,
                "tags": sorted(normalized_tags),
                "source": {"id": page_id, "url": url, "label": ref.label},
            }

            items[page_id] = rec
            by_key[key] = page_id

        except Exception as e:
            items[page_id] = {"source": {"id": page_id, "url": url, "label": ref.label}, "error": str(e)}
            if args.verbose:
                print(f"[err] {ref.label}: {e}", file=sys.stderr)

        out_obj = {
            "_meta": {
                "schema": "poe2db_uniques_min_v4",
                "locale": args.lang,
                "listing_url": listing_url,
                "count": len(items),
                "generated_epoch": int(time.time()),
            },
            "by_key": by_key,
            "items": items,
        }
        out_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        time.sleep(max(0.0, args.sleep))

    if args.verbose:
        print(f"[done] wrote {len(items)} records -> {out_path}")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
