#!/usr/bin/env python3
"""
enrich_uniques.py

Offline unique-item enrichment for Randomancer.

NOTE: Legacy/non-runtime dataset generator kept for reference tooling.
This script is intentionally quarantined and is NOT used by the runtime app path.
Runtime uniques source is `data/enriched/poe2db_uniques_min.json`.
`data/enriched/uniques_enriched.json` is legacy/reference output only.

Reads datamined PoE2 unique data from:

    data/datamined/Uniques/*.json     (per-slot files: amulet.json, bow.json, ...)

and writes the compact, app-ready file:

    data/enriched/uniques_enriched.json

Goal (current approach):
- Regenerate tags from scratch each run by parsing each item's `lines`.
- Normalize tags to the project's mechanic vocabulary where possible:
  - Ailments (Freeze/Ignite/Shock/Poison/Bleed)
  - Tactics (e.g. Armour Break, Critical Hit, Curses, Marks, Minions, etc.)
  - Defensive strategies (Block/Deflection/Leech/Recoup/Life Regeneration)
  - Primary defense alignment (Armour/Evasion/Energy Shield; including hybrid)
- Add additional "defensive" tags that should NOT be treated as offensive mechanics:
  - resistances (fire_resistance, cold_resistance, lightning_resistance, chaos_resistance, all_elemental_resistance)
  - mitigation (e.g. fire_mitigation for "reduced fire damage taken")
- Track obvious drawbacks ("anti-tags") separately so selection/scoring can downweight them later.

Output schema matches what core-script.js expects today:

{
  "items": [
    {
      "slot": "amulet",
      "name": "The Anvil",
      "base": "Bloodstone Amulet",
      "tags": {
        "canonical": ["Block"],
        "raw": ["block", ...]
      },
      "lines": [ ... ],
      "meta": {
        "tags_offense": [...],
        "tags_defense": [...],
        "tags_anti": [...],
        "attributes": {"str": 0, "dex": 0, "int": 0, "all": 0},
        "primary_defense": "Armour & Evasion"
      }
    }
  ]
}

NOTE:
- Many tags are derived heuristically from the text lines. If you expand the
  app's mechanic vocabulary, update `data/core-data.json` and the patterns below.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from lib.tag_normalization import canonicalize_tag, normalize_tag_list


# -------------------------
# Load project mechanic vocab (core-data)
# -------------------------

def load_core_data(data_root: Path) -> dict[str, Any]:
    core_path = data_root / "core-data.json"
    try:
        with core_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[enrich_uniques] ERROR: Failed to load {core_path}: {e}", file=sys.stderr)
        raise


def index_by_name(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {e["name"]: e for e in entries if isinstance(e, dict) and e.get("name")}


# -------------------------
# Text normalization helpers
# -------------------------

RE_RANGE = re.compile(r"\((?:\d+[-–]\d+|\d+)\)")  # remove (10-20) style
RE_NUM = re.compile(r"[-+]?(\d+)(?:\.\d+)?")      # first numeric

def norm_line(s: str) -> str:
    s = s.replace("Armour", "Armor").replace("armour", "armor")
    s = RE_RANGE.sub("", s)
    return s.strip()


def is_anti_line(line: str) -> bool:
    """
    Conservative "drawback" detection:
    - leading negative values (e.g. "-12% to Fire Resistance")
    - explicit negation language
    """
    s = line.strip().lower()
    if s.startswith("-"):
        return True
    if "cannot " in s or "can't " in s or "avoid " in s or "no longer " in s:
        return True
    # Reduced/less can be defensive or offensive; treat as anti only if not "damage taken"
    if ("reduced " in s or "less " in s) and "damage taken" not in s and "damage taken" not in s:
        # also common for resist downsides
        if "resistance" in s or "damage" in s:
            return True
    return False


# -------------------------
# Mechanic patterns
# -------------------------

# Armour Break tactic evidence (explicit)
ARMOR_BREAK_PATTERNS = [
    re.compile(r"\bfully\b.*\barmor\b.*\bbroken\b", re.I),
    re.compile(r"\bfully break(?:s)?\b.*\barmor\b", re.I),
    re.compile(r"\bbreak(?:s)?\b.*\barmor\b", re.I),
]

# Resistances (defensive only)
RESIST_PATTERNS = {
    "fire_resistance": re.compile(r"\bfire resistance\b", re.I),
    "cold_resistance": re.compile(r"\bcold resistance\b", re.I),
    "lightning_resistance": re.compile(r"\blightning resistance\b", re.I),
    "chaos_resistance": re.compile(r"\bchaos resistance\b", re.I),
    "all_elemental_resistance": re.compile(r"\ball elemental resistances?\b", re.I),
}

# Damage taken mitigation (defensive)
MITIGATION_PATTERNS = {
    "fire_mitigation": re.compile(r"\bfire\b.*\bdamage taken\b", re.I),
    "cold_mitigation": re.compile(r"\bcold\b.*\bdamage taken\b", re.I),
    "lightning_mitigation": re.compile(r"\blightning\b.*\bdamage taken\b", re.I),
    "chaos_mitigation": re.compile(r"\bchaos\b.*\bdamage taken\b", re.I),
    "physical_mitigation": re.compile(r"\bphysical\b.*\bdamage taken\b", re.I),
}

# Utility (non-mechanic but useful for later selection passes)
UTILITY_PATTERNS = {
    "movement_speed": re.compile(r"\bmovement speed\b", re.I),
    "attack_speed": re.compile(r"\battack speed\b", re.I),
    "cast_speed": re.compile(r"\bcast speed\b", re.I),
    "action_speed": re.compile(r"\baction speed\b", re.I),
    "cooldown_recovery": re.compile(r"\bcooldown recovery\b|\breduced cooldown\b", re.I),
}

# Primary defense stats on armour pieces
DEFENSE_STAT_PATTERNS = {
    "armour": re.compile(r"\barmor\b(?!\s*broken)\b|\bto armor\b|\bincreased armor\b", re.I),
    "evasion": re.compile(r"\bevasion rating\b|\bto evasion\b|\bincreased evasion\b", re.I),
    "energy_shield": re.compile(r"\benergy shield\b|\bto energy shield\b|\bincreased energy shield\b", re.I),
}

# Damage-type evidence (offensive; avoid resistance lines)
DAMAGE_PATTERNS = {
    "fire": re.compile(r"\bfire damage\b|\badds?\b.*\bfire damage\b|\bincreased\b.*\bfire damage\b", re.I),
    "cold": re.compile(r"\bcold damage\b|\badds?\b.*\bcold damage\b|\bincreased\b.*\bcold damage\b", re.I),
    "lightning": re.compile(r"\blightning damage\b|\badds?\b.*\blightning damage\b|\bincreased\b.*\blightning damage\b", re.I),
    "chaos": re.compile(r"\bchaos damage\b|\badds?\b.*\bchaos damage\b|\bincreased\b.*\bchaos damage\b", re.I),
    "physical": re.compile(r"\bphysical damage\b|\badds?\b.*\bphysical damage\b|\bincreased\b.*\bphysical damage\b", re.I),
}

# Ailment keyword evidence (explicit)
AILMENT_KEYWORDS = {
    "Ignite": re.compile(r"\bignite\b|\bignited\b|\bignites\b|\bburning\b", re.I),
    "Freeze": re.compile(r"\bfreeze\b|\bfrozen\b|\bfreezes\b|\bchill\b|\bchilled\b", re.I),
    "Shock": re.compile(r"\bshock\b|\bshocked\b|\bshocks\b|\belectrocute\b|\belectrocuted\b", re.I),
    "Poison": re.compile(r"\bpoison\b|\bpoisoned\b|\bpoisons\b", re.I),
    "Bleed": re.compile(r"\bbleed\b|\bbleeding\b|\bbleeds\b", re.I),
}

# Tactic-ish keyword evidence
TACTIC_KEYWORDS = {
    "Critical Hit": re.compile(r"\bcritical\b|\bcrit\b", re.I),
    "Curses": re.compile(r"\bcurse\b|\bcurses\b|\bhex\b|\bhexes\b", re.I),
    "Marks": re.compile(r"\bmark\b|\bmarks\b", re.I),
    "Minions": re.compile(r"\bminion\b|\bminions\b|\bsummon\b|\bsummoned\b", re.I),
    "Companions": re.compile(r"\bcompanion\b|\bcompanions\b", re.I),
    "Totems": re.compile(r"\btotem\b|\btotems\b", re.I),
    "Warcry": re.compile(r"\bwarcry\b|\bwarcries\b", re.I),
    "Thorns": re.compile(r"\breflects\b.*\bdamage\b|\bthorns\b", re.I),
    "Culling Strike": re.compile(r"\bculling strike\b|\bcull\b|\bculling\b", re.I),
    "Slow/Maim/Hinder": re.compile(
        r"\bmaim\b|\bmaimed\b|\bhinder\b|\bhindered\b|\bslows?\b|\breduced movement speed\b|\bless movement speed\b|\breduced action speed\b|\bless action speed\b",
        re.I
    ),
    "Heavy Stun": re.compile(r"\bstun\b|\bstunned\b|\bstuns\b", re.I),
    # Chaos Damage tactic (no DoT complexity)
    "Chaos Damage": re.compile(r"\bchaos damage\b|\badds?\b.*\bchaos damage\b|\bincreased\b.*\bchaos damage\b", re.I),
}

# Defensive strategy keyword evidence
DEFSTRAT_KEYWORDS = {
    "Block": re.compile(r"\bblock\b|\bchance to block\b", re.I),
    "Deflection": re.compile(r"\bdeflection\b|\bdeflect\b", re.I),
    "Leech": re.compile(r"\bleech\b", re.I),
    "Recoup": re.compile(r"\brecoup\b", re.I),
    "Life Regeneration": re.compile(r"\bregenerate\b.*\blife\b|\blife regeneration\b|\bregeneration\b", re.I),
}


# Attribute extraction (for cohesion tie-breakers later)
ATTR_PATTERNS = {
    "all": re.compile(r"\ball attributes\b", re.I),
    "str": re.compile(r"\bstrength\b", re.I),
    "dex": re.compile(r"\bdexterity\b", re.I),
    "int": re.compile(r"\bintelligence\b", re.I),
}


def extract_attributes(lines: list[str]) -> dict[str, int]:
    attrs = {"str": 0, "dex": 0, "int": 0, "all": 0}
    for line in lines:
        s = norm_line(line)
        low = s.lower()
        if "to " not in low:
            continue
        if not any(k.search(s) for k in ATTR_PATTERNS.values()):
            continue
        m = RE_NUM.search(s)
        if not m:
            continue
        val = int(m.group(1))
        if ATTR_PATTERNS["all"].search(s):
            attrs["all"] = max(attrs["all"], val)
            continue
        if ATTR_PATTERNS["str"].search(s):
            attrs["str"] = max(attrs["str"], val)
        if ATTR_PATTERNS["dex"].search(s):
            attrs["dex"] = max(attrs["dex"], val)
        if ATTR_PATTERNS["int"].search(s):
            attrs["int"] = max(attrs["int"], val)
    return attrs


def primary_defense_from_lines(lines: list[str]) -> Optional[str]:
    """
    Identify which of Armour/Evasion/Energy Shield stats appear on the item.
    Returns one of the core-data Defense names (including hybrids), or None.
    """
    has_armour = False
    has_evasion = False
    has_es = False

    for line in lines:
        s = norm_line(line)
        # Ignore "Breaks Armor" lines
        if any(p.search(s) for p in ARMOR_BREAK_PATTERNS):
            continue
        if DEFENSE_STAT_PATTERNS["armour"].search(s):
            has_armour = True
        if DEFENSE_STAT_PATTERNS["evasion"].search(s):
            has_evasion = True
        if DEFENSE_STAT_PATTERNS["energy_shield"].search(s):
            has_es = True

    if has_armour and has_evasion and has_es:
        # no tri-mode in core-data; choose none and keep raw tags instead
        return None
    if has_armour and has_evasion:
        return "Armour & Evasion"
    if has_armour and has_es:
        return "Armour & Energy Shield"
    if has_evasion and has_es:
        return "Evasion & Energy Shield"
    if has_armour:
        return "Armour"
    if has_evasion:
        return "Evasion"
    if has_es:
        return "Energy Shield"
    return None


def add_tags_for_mechanic(canon_set: set[str], raw_set: set[str], entry: Mapping[str, Any], include_canonical: bool = True) -> None:
    if include_canonical and entry.get("name"):
        canon_set.add(str(entry["name"]))
    for t in (entry.get("tags") or []):
        if isinstance(t, str) and t.strip():
            raw_set.add(t.strip().lower())


def extract_tags(lines: list[str], core: dict[str, Any]) -> dict[str, Any]:
    """
    Parse unique lines into:
      - offense tags (mechanic-aligned)
      - defense tags (resistances, mitigation, primary defense)
      - anti tags (drawbacks)
    Returns dict containing tags + meta.
    """
    ailments = index_by_name(core["Ailments"])
    tactics = index_by_name(core["Tactics"])
    defstrats = index_by_name(core["DefensiveStrategies"])

    canon: set[str] = set()
    raw: set[str] = set()

    offense: set[str] = set()
    defense: set[str] = set()
    utility: set[str] = set()
    anti: set[str] = set()

    # Primary defense alignment (armour/evasion/ES)
    prim = primary_defense_from_lines(lines)
    if prim:
        canon.add(prim)
        # Keep raw markers too for later scoring
        if "Armour" in prim:
            defense.add("armour")
        if "Evasion" in prim:
            defense.add("evasion")
        if "Energy Shield" in prim:
            defense.add("energy shield")

    for line in lines:
        s = norm_line(line)
        low = s.lower()
        anti_line = is_anti_line(s)

        # Armour Break (tactic)
        if any(p.search(s) for p in ARMOR_BREAK_PATTERNS):
            if anti_line:
                anti.add("armourbreak")
            else:
                add_tags_for_mechanic(canon, offense, tactics.get("Armour Break", {}), include_canonical=True)
            continue

        # Resistances (defense-only)
        if "resistance" in low:
            for tag, pat in RESIST_PATTERNS.items():
                if pat.search(s):
                    (anti if anti_line else defense).add(tag)
            continue

        # Damage taken mitigation (defense-only)
        if "damage taken" in low:
            for tag, pat in MITIGATION_PATTERNS.items():
                if pat.search(s):
                    (anti if anti_line else defense).add(tag)
            # don't continue; line might also reference other mechanics, but typically it's defensive


        # Utility tags (do not affect mechanic matching today, but useful later)
        for tag, pat in UTILITY_PATTERNS.items():
            if pat.search(s):
                (anti if anti_line else utility).add(tag)
        # Ailments (explicit keywords)
        for canon_name, pat in AILMENT_KEYWORDS.items():
            if pat.search(s):
                entry = ailments.get(canon_name, {})
                if anti_line:
                    # anti for explicit ailment lines is rare; flag the core tag
                    for t in (entry.get("tags") or []):
                        anti.add(t.lower())
                else:
                    add_tags_for_mechanic(canon, offense, entry, include_canonical=True)

        # Tactics (keywords)
        for canon_name, pat in TACTIC_KEYWORDS.items():
            if pat.search(s):
                entry = tactics.get(canon_name, {})
                if anti_line:
                    # store canonical primary tag as anti
                    for t in (entry.get("tags") or []):
                        anti.add(t.lower())
                else:
                    add_tags_for_mechanic(canon, offense, entry, include_canonical=True)

        # Defensive Strategies (keywords)
        for canon_name, pat in DEFSTRAT_KEYWORDS.items():
            if pat.search(s):
                entry = defstrats.get(canon_name, {})
                if anti_line:
                    for t in (entry.get("tags") or []):
                        anti.add(t.lower())
                else:
                    add_tags_for_mechanic(canon, defense, entry, include_canonical=True)

        # Damage-type evidence (offense, but avoid tagging resist lines)
        for elem, pat in DAMAGE_PATTERNS.items():
            if pat.search(s):
                # avoid treating "reduced fire damage taken" as offense
                if "damage taken" in low:
                    continue
                # Avoid adding "fire" from defensive resistance (already continued above)
                if anti_line:
                    anti.add(elem)
                    anti.add(f"{elem} damage")
                else:
                    offense.add(elem)
                    offense.add(f"{elem} damage")

    # Merge raw tags: core mechanic raw tags should be lower-case already;
    # keep spaces where core-data uses them (e.g., "culling strike", "chaos damage")
    raw = set([t.lower() for t in offense | defense | utility])
    # Remove legacy complexity
    raw.discard("damage over time")
    raw.discard("chaos damage over time")

    # Canonical: remove any legacy value
    canon.discard("Chaos Damage Over Time")

    canonical_tags = normalize_tag_list(sorted(canon), expand=False, match_keys=False)
    raw_tags = normalize_tag_list(sorted(raw), expand=False, match_keys=False)

    return {
        "tags": {
            "canonical": canonical_tags,
            "raw": raw_tags,
        },
        "meta": {
            "tags_offense": sorted(offense),
            "tags_defense": sorted(defense),
            "tags_utility": sorted(utility),
            "tags_anti": sorted(anti),
            "attributes": extract_attributes(lines),
            "primary_defense": prim,
        }
    }


# -------------------------
# Datamined reader
# -------------------------

def iter_datamined_items(uniques_root: Path) -> Iterable[Dict[str, Any]]:
    """
    Iterate over per-slot JSON files in data/datamined/Uniques.

    Each file is a list of newline-joined strings. We convert each into:
      { "slot": <slot>, "name": <line0>, "base": <line1>, "lines": [all lines...] }
    """
    if not uniques_root.exists():
        print(f"[enrich_uniques] ERROR: {uniques_root} does not exist", file=sys.stderr)
        return

    for path in sorted(uniques_root.glob("*.json")):
        slot = path.stem

        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"[enrich_uniques] WARNING: Failed to load {path}: {e}", file=sys.stderr)
            continue

        if not isinstance(data, list):
            continue

        for text in data:
            if not isinstance(text, str):
                continue
            lines = text.splitlines()
            if len(lines) < 2:
                continue
            name = lines[0].strip()
            base = lines[1].strip()
            if not name and not base:
                continue

            yield {
                "slot": slot,
                "name": name,
                "base": base,
                "lines": lines,
            }


# -------------------------
# Main pipeline
# -------------------------

def main(argv: Sequence[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])

    here = Path(__file__).resolve().parent
    data_root = here.parent  # data/
    uniques_root = data_root / "datamined" / "Uniques"
    out_dir = data_root / "enriched"
    out_path = out_dir / "uniques_enriched.json"

    core = load_core_data(data_root)

    items_out: List[Dict[str, Any]] = []
    for item in iter_datamined_items(uniques_root):
        extracted = extract_tags(item["lines"], core)
        items_out.append({
            "slot": item["slot"],
            "name": item["name"],
            "base": item["base"],
            "tags": extracted["tags"],
            "lines": item["lines"],
            "meta": extracted["meta"],
        })

    out_dir.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"items": items_out}, f, ensure_ascii=False, indent=2)

    print(f"[enrich_uniques] Wrote {len(items_out)} unique items to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
