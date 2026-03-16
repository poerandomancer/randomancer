#!/usr/bin/env python3
"""Lightweight validation checks for tag normalization drift."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from generate_tag_rules_js import OUTPUT_PATH as GENERATED_JS_PATH
from generate_tag_rules_js import RULES_JSON_PATH, build_js_module
from lib.tag_normalization import canonicalize_tag, expand_match_keys, load_rules


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]


def fail(msg: str) -> None:
    raise AssertionError(msg)


def check_js_generated_sync() -> None:
    source_rules = json.loads(RULES_JSON_PATH.read_text(encoding="utf-8"))
    expected = build_js_module(source_rules)
    actual = GENERATED_JS_PATH.read_text(encoding="utf-8") if GENERATED_JS_PATH.exists() else ""
    if expected != actual:
        fail(
            "Generated JS rules are out of sync. Run: python data/helperScripts/generate_tag_rules_js.py"
        )


def check_sanity_cases() -> None:
    checks = [
        ("Energy Shield", "energy_shield"),
        ("Bleeding", "bleed"),
        ("chance to block", "chance_to_block"),
        ("block chance", "chance_to_block"),
    ]
    for raw, expected in checks:
        got = canonicalize_tag(raw)
        if got != expected:
            fail(f"canonicalize_tag({raw!r}) -> {got!r}, expected {expected!r}")

    expansion = set(expand_match_keys("critical weakness"))
    if "crit" not in expansion or "criticalhit" not in expansion:
        fail("critical weakness expansion no longer includes crit/critical_hit semantics")

    if canonicalize_tag("grants:Fireball") is not None:
        fail("grants:* canonicalization should be rejected")


def _iter_primary_tags() -> Iterable[str]:
    skills_path = REPO_ROOT / "data" / "enriched" / "skills_enriched.json"
    passives_path = REPO_ROOT / "data" / "enriched" / "passives_enriched.json"
    uniques_path = REPO_ROOT / "data" / "enriched" / "poe2db_uniques_min.json"

    skills = json.loads(skills_path.read_text(encoding="utf-8"))
    for row in skills:
        for tag in row.get("tags") or []:
            yield str(tag)

    passives = json.loads(passives_path.read_text(encoding="utf-8"))
    for node in passives.get("nodes", []):
        for tag in node.get("tags") or []:
            yield str(tag)

    uniques = json.loads(uniques_path.read_text(encoding="utf-8"))
    items = uniques.get("items", {})
    values = items.values() if isinstance(items, dict) else items
    for item in values:
        for tag in item.get("tags") or []:
            yield str(tag)


def check_dataset_tags() -> None:
    bad = []
    mixed = []
    for tag in _iter_primary_tags():
        if canonicalize_tag(tag) is None:
            bad.append(tag)
        if tag != tag.lower() or " " in tag or "-" in tag:
            mixed.append(tag)

    if bad:
        sample = ", ".join(sorted(set(bad))[:10])
        fail(f"Primary dataset tags contain rejected/non-canonical entries (sample: {sample})")
    if mixed:
        sample = ", ".join(sorted(set(mixed))[:10])
        fail(f"Primary dataset tags contain mixed-format entries (sample: {sample})")


def main() -> int:
    print("[validate_tag_normalization] Running checks...")
    _ = load_rules()
    check_js_generated_sync()
    check_sanity_cases()
    check_dataset_tags()
    print("[validate_tag_normalization] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
