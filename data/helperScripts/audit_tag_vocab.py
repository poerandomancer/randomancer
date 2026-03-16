#!/usr/bin/env python3
"""Audit tag vocabulary consistency across enriched/config datasets."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from lib.tag_normalization import canonicalize_tag


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
DEFAULT_JSON_OUT = REPO_ROOT / "data" / "enriched" / "tag_vocab_audit.json"
TOP_N = 10
SAMPLE_N = 12
SCHEMA_VERSION = "phase3.v1"


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


def _is_suspicious_mixed_format(raw: str) -> bool:
    return raw != raw.lower() or " " in raw or "-" in raw


def audit_source(name: str, tags: list[str]) -> dict[str, Any]:
    raw_tags = [str(t) for t in tags if str(t).strip()]
    distinct_raw = sorted(set(raw_tags))

    rejected: list[str] = []
    suspicious: list[str] = []
    canon_map: dict[str, set[str]] = defaultdict(set)
    canonical_counter: Counter[str] = Counter()

    for raw in distinct_raw:
        canonical = canonicalize_tag(raw)
        if not canonical:
            rejected.append(raw)
            continue

        canon_map[canonical].add(raw)
        if _is_suspicious_mixed_format(raw):
            suspicious.append(raw)

    for raw in raw_tags:
        canonical = canonicalize_tag(raw)
        if canonical:
            canonical_counter[canonical] += 1

    collisions = {
        canonical: sorted(values)
        for canonical, values in sorted(canon_map.items())
        if len(values) > 1
    }

    print(f"\n## {name}")
    print(f"distinct raw tags: {len(distinct_raw)}")
    print(f"distinct canonical tags: {len(canon_map)}")
    if rejected:
        print(f"rejected/noise: {len(rejected)} (sample: {', '.join(sorted(rejected)[:SAMPLE_N])})")
    if suspicious:
        print(f"mixed-format tags: {len(suspicious)} (sample: {', '.join(sorted(suspicious)[:SAMPLE_N])})")
    if collisions:
        print("collisions (raw -> same canonical), top 10:")
        for canonical, vals in list(sorted(collisions.items(), key=lambda kv: (-len(kv[1]), kv[0])))[:TOP_N]:
            print(f"  - {canonical}: {', '.join(vals[:8])}")

    top = canonical_counter.most_common(TOP_N)
    if top:
        print("top canonical tags:")
        for canonical, count in top:
            print(f"  - {canonical}: {count}")

    return {
        "distinct_raw_count": len(distinct_raw),
        "distinct_canonical_count": len(canon_map),
        "rejected_count": len(rejected),
        "suspicious_mixed_format_count": len(suspicious),
        "collision_count": len(collisions),
        "top_canonical_tags": [{"tag": tag, "count": count} for tag, count in top],
        "sample_rejected": sorted(rejected)[:SAMPLE_N],
        "sample_mixed_format": sorted(suspicious)[:SAMPLE_N],
        "sample_collisions": [
            {"canonical": canonical, "raw_variants": vals[:SAMPLE_N]}
            for canonical, vals in list(sorted(collisions.items(), key=lambda kv: (-len(kv[1]), kv[0])))[:TOP_N]
        ],
    }


def _resolve_input(relpath: str) -> Path:
    return REPO_ROOT / "data" / relpath


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-out", default="", help="Optional path to write machine-readable audit JSON")
    args = ap.parse_args()

    paths = {
        "skills_enriched": _resolve_input("enriched/skills_enriched.json"),
        "passives_enriched": _resolve_input("enriched/passives_enriched.json"),
        "poe2db_uniques_min": _resolve_input("enriched/poe2db_uniques_min.json"),
        "skill_families_queries": _resolve_input("skill_families.json"),
    }

    report_sources: dict[str, Any] = {}

    skills = load_json(paths["skills_enriched"])
    report_sources["skills_enriched"] = audit_source("skills_enriched", list(iter_tags_from_skills(skills)))

    passives = load_json(paths["passives_enriched"])
    report_sources["passives_enriched"] = audit_source("passives_enriched", list(iter_tags_from_passives(passives)))

    uniques = load_json(paths["poe2db_uniques_min"])
    report_sources["poe2db_uniques_min"] = audit_source("poe2db_uniques_min", list(iter_tags_from_uniques_min(uniques)))

    families = load_json(paths["skill_families_queries"])
    report_sources["skill_families_queries"] = audit_source(
        "skill_families_queries", list(iter_tags_from_skill_families(families))
    )

    summary = {
        "sources": len(report_sources),
        "total_distinct_raw_count": sum(v["distinct_raw_count"] for v in report_sources.values()),
        "total_distinct_canonical_count": sum(v["distinct_canonical_count"] for v in report_sources.values()),
        "total_rejected_count": sum(v["rejected_count"] for v in report_sources.values()),
        "total_collision_count": sum(v["collision_count"] for v in report_sources.values()),
    }

    report = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "sources": report_sources,
    }

    json_out = Path(args.json_out).resolve() if args.json_out else DEFAULT_JSON_OUT
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote JSON report to {json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
