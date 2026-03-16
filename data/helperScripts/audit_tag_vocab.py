#!/usr/bin/env python3
"""Audit tag vocabulary consistency across enriched/config datasets."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

from lib.tag_normalization import canonicalize_tag, sanitize_raw_tag


def load_json(path: Path):
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def iter_tags_from_skills(data) -> Iterable[str]:
    for s in data or []:
        for t in s.get("tags") or []:
            yield t
        for t in s.get("effect_tags") or []:
            yield t


def iter_tags_from_passives(data) -> Iterable[str]:
    for n in (data or {}).get("nodes", []):
        for t in n.get("tags") or []:
            yield t


def iter_tags_from_uniques_min(data) -> Iterable[str]:
    items = (data or {}).get("items", {})
    values = items.values() if isinstance(items, dict) else items
    for it in values or []:
        for t in it.get("tags") or []:
            yield t


def iter_tags_from_skill_families(data) -> Iterable[str]:
    fams = (data or {}).get("families", [])
    for f in fams:
        q = f.get("query", {})
        for key in ("all", "any", "not"):
            for t in q.get(key, []) or []:
                yield t
        for grp in q.get("any_groups", []) or []:
            for t in grp:
                yield t


def audit_source(name: str, tags: list[str]):
    distinct = sorted(set(str(t) for t in tags if t))
    canon_map = defaultdict(list)
    rejected = []
    suspicious = []
    for t in distinct:
        c = canonicalize_tag(t)
        if not c:
            rejected.append(t)
            continue
        canon_map[c].append(t)
        s = str(t)
        if s != s.lower() or " " in s or "-" in s:
            suspicious.append(s)

    print(f"\n## {name}")
    print(f"distinct tags: {len(distinct)}")
    print(f"distinct canonical: {len(canon_map)}")
    if rejected:
        print(f"rejected/noise: {len(rejected)} (sample: {', '.join(rejected[:10])})")
    if suspicious:
        print(f"mixed-format tags: {len(suspicious)} (sample: {', '.join(sorted(suspicious)[:10])})")

    collisions = {k: v for k, v in canon_map.items() if len(v) > 1}
    if collisions:
        print("collisions (raw -> same canonical), top 10:")
        for k, vals in list(sorted(collisions.items(), key=lambda kv: (-len(kv[1]), kv[0])))[:10]:
            print(f"  - {k}: {', '.join(sorted(vals)[:8])}")

    top = Counter(canonicalize_tag(t) for t in tags if canonicalize_tag(t))
    if top:
        print("top canonical tags:")
        for k, n in top.most_common(10):
            print(f"  - {k}: {n}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-out", default="", help="Optional path to write machine-readable audit JSON")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    paths = {
        "skills_enriched": root / "enriched" / "skills_enriched.json",
        "passives_enriched": root / "enriched" / "passives_enriched.json",
        "poe2db_uniques_min": root / "enriched" / "poe2db_uniques_min.json",
        "skill_families": root / "skill_families.json",
    }

    report = {}

    skills = load_json(paths["skills_enriched"])
    skill_tags = list(iter_tags_from_skills(skills))
    audit_source("skills_enriched", skill_tags)
    report["skills_enriched"] = {"count": len(set(skill_tags))}

    passives = load_json(paths["passives_enriched"])
    passive_tags = list(iter_tags_from_passives(passives))
    audit_source("passives_enriched", passive_tags)
    report["passives_enriched"] = {"count": len(set(passive_tags))}

    uniques = load_json(paths["poe2db_uniques_min"])
    unique_tags = list(iter_tags_from_uniques_min(uniques))
    audit_source("poe2db_uniques_min", unique_tags)
    report["poe2db_uniques_min"] = {"count": len(set(unique_tags))}

    families = load_json(paths["skill_families"])
    fam_tags = list(iter_tags_from_skill_families(families))
    audit_source("skill_families_queries", fam_tags)
    report["skill_families"] = {"count": len(set(fam_tags))}

    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"\nWrote JSON report to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
