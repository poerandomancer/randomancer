#!/usr/bin/env python3
"""
enrich_skills.py

Offline skill-gem enrichment for Randomancer.

Reads datamined PoE2 skill data:

    data/datamined/skills.json
    data/datamined/skill_gems.json

and writes a compact, app-ready file:

    data/enriched/skills_enriched.json

The output is effectively what core-script's `enrichGems(...)`
used to build at runtime, but precomputed so the web app can
just load `skills_enriched.json` directly.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence

# ---------- Tag normalizer (Python port of TagUtils.norm) ----------

RAW_ALIAS = [
    # v0.7 scorer
    ("critical", "crit"),
    ("damage over time", "dot"),
    ("damageovertime", "dot"),
    ("marks", "mark"),
    ("armourbreak", "armourbreak"),

    # uniques engine
    ("armorbreak", "armourbreak"),
    ("heavy stun", "heavystun"),
    ("heavystun", "heavystun"),
    ("life regeneration", "liferegeneration"),
    ("culling strike", "cullingstrike"),
    ("block recovery", "blockrecovery"),
]


def _base_normalize(s: Any) -> str:
    """Lowercase + strip non-alphanumerics."""
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


_ALIAS_MAP: Dict[str, str] = {
    _base_normalize(src): _base_normalize(dst) for src, dst in RAW_ALIAS
}


def normalize_tag(s: Any) -> str:
    """Match TagUtils.norm: base-normalize then apply alias map."""
    t = _base_normalize(s)
    return _ALIAS_MAP.get(t, t)


# ---------- Helpers ported from core-script.js ----------

def extract_bracket_tags(description: Any) -> List[str]:
    """
    Collect normalized tags from bracketed tokens, e.g. "[Flask|Flasks]" -> "flask", "flasks".
    """
    found: List[str] = []
    matches = re.findall(r"\[([^\]]+)\]", str(description or ""))
    for inner in matches:
        parts = [p.strip() for p in inner.split("|") if p.strip()]
        for p in parts:
            norm = normalize_tag(p)
            if norm and norm not in found:
                found.append(norm)
    return found


def flatten_gems(g: Any) -> List[Dict[str, Any]]:
    """
    Mirror flattenGems(...) from JS:

    - If array: return as-is.
    - If { SkillGems: { id: {...} } }: return list of {id, ...}.
    - Otherwise treat object entries as {id: value}.
    """
    if not g:
        return []
    if isinstance(g, list):
        return g
    if isinstance(g, dict) and "SkillGems" in g and isinstance(g["SkillGems"], dict):
        return [dict(id=k, **v) for k, v in g["SkillGems"].items() if isinstance(v, dict)]
    if isinstance(g, dict):
        return [dict(id=k, **v) for k, v in g.items() if isinstance(v, dict)]
    return []


def normalize_gem(g: Mapping[str, Any]) -> Dict[str, Any]:
    """
    Rough port of normalizeGem(...) from core-script.js.
    """
    o: Dict[str, Any] = dict(g)
    base_item = o.get("base_item") or {}
    o.setdefault(
        "id",
        base_item.get("id")
        or base_item.get("display_name")
        or o.get("name")
        or o.get("skill_name")
        or o.get("support_name")
        or "",
    )
    o.setdefault(
        "name",
        o.get("name")
        or base_item.get("display_name")
        or o.get("skill_name")
        or o.get("support_name")
        or None,
    )
    gem_type = (
        o.get("type")
        or o.get("gem_type")
        or ("support" if o.get("support_text") else "active")
        or ""
    )
    o["type"] = str(gem_type).lower()

    tags = o.get("tags")
    o["tags"] = list(tags) if isinstance(tags, list) else []

    crafting_types = g.get("crafting_types")
    o["crafting_types"] = list(crafting_types) if isinstance(crafting_types, list) else []

    return o


def is_dev_placeholder_gem(g: Mapping[str, Any]) -> bool:
    """
    JS: tests name/display_name/id for DNT / UNUSED / "Coming Soon".
    """
    s = str(
        (g.get("name") or g.get("base_item", {}).get("display_name") or g.get("id") or "")
    ).strip()
    return bool(re.search(r"(\bDNT\b|\bUNUSED\b|Coming\s*Soon)", s, flags=re.IGNORECASE))


# ---------- Core enrichment ----------

def enrich_gems(gem_data: Any, skills_data: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """
    Python port of enrichGems(gemData, skillsData) from core-script.js.

    Returns a list of enriched gem dicts – effectively what the app used to
    compute at runtime – ready to be written to skills_enriched.json.
    """
    flat = flatten_gems(gem_data)
    skills = skills_data or {}

    merged: List[Dict[str, Any]] = []

    for g0 in flat:
        g = normalize_gem(g0)

        base_item = g.get("base_item") or {}
        if not base_item.get("display_name"):
            continue
        if is_dev_placeholder_gem(g):
            continue

        crafting = g.get("crafting_types")
        if not isinstance(crafting, list) or not crafting:
            # Skip gems that don't map cleanly to a weapon / archetype
            continue

        # Set required weapon types (lowercased)
        g["required_weapon_types"] = [str(x).lower() for x in crafting]

        # Accumulate info from granted active skills
        grant_name: str | None = None
        grant_desc: str = ""
        grants_arr = g.get("grants_skills")
        if not isinstance(grants_arr, list):
            grants_arr = []
        granted_list: List[Dict[str, str]] = []
        all_grant_bracket_tags: List[str] = []

        for gid in grants_arr:
            sk = skills.get(gid)
            if not isinstance(sk, dict):
                continue
            a = sk.get("active_skill")
            if not a:
                continue

            dn = a.get("display_name") or ""
            dd = a.get("description") or ""

            if not grant_name and dn:
                grant_name = dn
            if not grant_desc and dd:
                grant_desc = dd

            granted_list.append({"id": gid, "display_name": dn, "description": dd})

            for t in extract_bracket_tags(dd):
                if t not in all_grant_bracket_tags:
                    all_grant_bracket_tags.append(t)

        g["granted_skills_full"] = granted_list

        # Compose a richer base description
        gem_desc = g.get("description") or g.get("support_text") or ""
        if gem_desc:
            composed_desc = gem_desc + (" " + grant_desc if grant_desc else "")
        else:
            composed_desc = grant_desc
        g["description"] = composed_desc or gem_desc or grant_desc or ""

        # Friendly requirement line based on required_weapon_types
        req_text = ""
        rwt = g.get("required_weapon_types")
        if isinstance(rwt, list) and rwt:
            cap = [t[:1].upper() + t[1:] for t in rwt]
            req_text = "Requires " + " or ".join(cap)

        # If description is still short / missing, top it up from the first active_skill
        first_skill_id = grants_arr[0] if isinstance(grants_arr, list) and grants_arr else None
        s = skills.get(first_skill_id) if first_skill_id else None
        a = s.get("active_skill") if isinstance(s, dict) else None

        description = g.get("description") or g.get("support_text") or ""
        if (not description or len(description) < 50) and a and a.get("description"):
            ad = a["description"]
            description = (description + " " + ad) if description else ad

        # Merge gem tags + skill types + [bracketed] tokens
        base_tags = [normalize_tag(t) for t in (g.get("tags") or [])]
        skill_types = (
            [normalize_tag(t) for t in (a.get("types") or [])]
            if a and isinstance(a.get("types"), list)
            else []
        )
        bracket_tags = list(all_grant_bracket_tags)

        desc_text = (a.get("description") if a else "" or "") + " " + (
            g.get("description") or g.get("support_text") or ""
        )
        bracket_matches = re.findall(r"\[[^\]]+\]", desc_text)
        desc_tags: List[str] = []
        for b in bracket_matches:
            inner = b[1:-1]
            token = inner.split("|")[0]
            clean = normalize_tag(token)
            if clean and clean not in desc_tags:
                desc_tags.append(clean)

        g["bracket_tags"] = bracket_tags

        merged_tags: List[str] = []
        for t in (*base_tags, *skill_types, *desc_tags, *bracket_tags):
            if t and t not in merged_tags:
                merged_tags.append(t)

        # Attach grant display line if present
        if grant_name:
            g["grant_display"] = grant_name
            g["grant_description"] = grant_desc or ""

        out = dict(g)
        out["description"] = description
        out["req_text"] = req_text
        out["tags"] = merged_tags

        merged.append(out)

    return merged


# ---------- CLI entrypoint ----------

def main(argv: Sequence[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])

    # Paths are derived relative to this script:
    #   data/helperScripts/enrich_skills.py   (this file)
    #   data/datamined/skills.json
    #   data/datamined/skill_gems.json
    #   data/enriched/skills_enriched.json
    here = Path(__file__).resolve().parent
    data_root = here.parent           # data/
    datamined_dir = data_root / "datamined"
    enriched_dir = data_root / "enriched"

    skills_path = datamined_dir / "skills.json"
    gems_path = datamined_dir / "skill_gems.json"
    out_path = enriched_dir / "skills_enriched.json"

    print(f"[enrich_skills] Loading datamined skills from {skills_path}")
    print(f"[enrich_skills] Loading datamined gems from   {gems_path}")

    try:
        with skills_path.open("r", encoding="utf-8") as f:
            skills_data = json.load(f)
    except FileNotFoundError:
        print(f"[enrich_skills] ERROR: skills.json not found at {skills_path}", file=sys.stderr)
        return 1

    try:
        with gems_path.open("r", encoding="utf-8") as f:
            gem_data = json.load(f)
    except FileNotFoundError:
        print(f"[enrich_skills] ERROR: skill_gems.json not found at {gems_path}", file=sys.stderr)
        return 1

    enriched = enrich_gems(gem_data, skills_data)

    enriched_dir.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    # Small summary for sanity
    total = len(enriched)
    actives = sum(1 for g in enriched if g.get("type") == "active")
    supports = sum(1 for g in enriched if g.get("type") == "support")
    print(
        f"[enrich_skills] Wrote {total} enriched gems "
        f"({actives} active, {supports} support) to {out_path}"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
