#!/usr/bin/env python3
"""Build the active-skill critical-hit profile overlay from PoE2DB.

The datamined tables used by ``enrich_skills.py`` do not expose a named base
critical-hit field.  PoE2DB renders that value in each skill's header, so this
small overlay keeps the externally sourced value separate and auditable.

Only spells and attacks that do not inherit the main-hand weapon critical
chance are requested.  Ordinary attacks remain ``weapon`` sourced in the
enricher and therefore do not need one web request per gem.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple


POE2DB_ROOT = "https://poe2db.tw/us"
CRIT_RE = re.compile(
    r"Critical Hit</a> Chance:\s*<span[^>]*>([0-9]+(?:\.[0-9]+)?)%",
    re.IGNORECASE,
)
SPECIAL_ATTACK_TAGS = {
    "unarmed",
    "unarmed_attack",
    "nonweaponattack",
    "requiresshield",
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def is_placeholder(gem: Dict[str, Any]) -> bool:
    name = str(gem.get("name") or "")
    source_tags = {str(tag).lower() for tag in gem.get("source_tags") or []}
    return (
        "derived_template" in source_tags
        or "kalguuran" in source_tags
        or bool(re.search(r"\b(?:DNT|UNUSED|Coming Soon)\b|\{\d+\}", name, re.I))
    )


def profile_candidates(gems: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Return one representative record per public skill name."""
    out: Dict[str, Dict[str, Any]] = {}
    for gem in gems:
        if gem.get("type") != "active" or is_placeholder(gem):
            continue
        skill_types = {
            str(value).lower()
            for value in (gem.get("taxonomy") or {}).get("skill_types") or []
        }
        tags = {str(value).lower() for value in gem.get("tags") or []}
        if "spell" not in skill_types and not tags.intersection(SPECIAL_ATTACK_TAGS):
            continue
        name = str(gem.get("name") or "").strip()
        if name:
            out.setdefault(name, gem)
    return out


def skill_url(name: str) -> str:
    slug = urllib.parse.quote(name.replace(" ", "_"), safe="_'-")
    return f"{POE2DB_ROOT}/{slug}"


def fetch_profile(name: str, timeout: float) -> Tuple[str, str, Optional[float], str]:
    url = skill_url(name)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Randomancer data maintenance/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            html = response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return name, url, None, f"request_failed: {exc}"

    match = CRIT_RE.search(html)
    if not match:
        return name, url, None, "no_skill_crit_header"
    return name, url, float(match.group(1)), "ok"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--patch", default="0.8.5")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    data_root = here.parent
    skills_path = data_root / "enriched" / "skills_enriched.json"
    output_path = data_root / "config" / "recommendation_critical_profiles_v3.json"

    candidates = profile_candidates(load_json(skills_path))
    fetched: Dict[str, Tuple[str, Optional[float], str]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {
            pool.submit(fetch_profile, name, args.timeout): name
            for name in sorted(candidates)
        }
        for future in concurrent.futures.as_completed(futures):
            name, url, chance, status = future.result()
            fetched[name] = (url, chance, status)

    profiles: Dict[str, Dict[str, Any]] = {}
    failures: Dict[str, str] = {}
    for name, gem in sorted(candidates.items()):
        url, chance, status = fetched[name]
        if chance is None:
            failures[name] = status
            continue
        profiles[str(gem["id"])] = {
            "name": name,
            "base_crit_chance": chance,
            "source_url": url,
        }

    crit_values = [profile["base_crit_chance"] for profile in profiles.values()]
    payload = {
        "_meta": {
            "schema_version": "recommendation-critical-profiles-v3.0.0",
            "profile_count": len(profiles),
            "minimum_base_crit_chance": min(crit_values) if crit_values else None,
            "median_base_crit_chance": statistics.median(crit_values) if crit_values else None,
            "maximum_base_crit_chance": max(crit_values) if crit_values else None,
        },
        "schema_version": 1,
        "patch": args.patch,
        "generated_at": date.today().isoformat(),
        "source": f"{POE2DB_ROOT}/Skill_Gems",
        "method": "PoE2DB skill-header Critical Hit Chance (v3 selector overlay)",
        "profiles": profiles,
        "summary": {
            "candidates": len(candidates),
            "profiles": len(profiles),
            "without_skill_crit_header": sum(
                status == "no_skill_crit_header" for status in failures.values()
            ),
            "request_failures": sum(
                status.startswith("request_failed") for status in failures.values()
            ),
        },
        "failures": failures,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")

    print(
        f"[critical_profiles] wrote {len(profiles)}/{len(candidates)} profiles "
        f"to {output_path}"
    )
    if payload["summary"]["request_failures"]:
        print(
            f"[critical_profiles] WARN: {payload['summary']['request_failures']} requests failed",
            file=sys.stderr,
        )
    return 0 if not payload["summary"]["request_failures"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
