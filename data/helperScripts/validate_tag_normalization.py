#!/usr/bin/env python3
"""Lightweight validation checks for tag normalization drift."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

from generate_tag_rules_js import OUTPUT_PATH as GENERATED_JS_PATH
from generate_tag_rules_js import RULES_JSON_PATH, build_js_module
from lib.tag_normalization import canonicalize_tag, expand_match_keys, load_rules, to_match_key


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
SKILL_FAMILIES_PATH = REPO_ROOT / "data" / "skill_families.json"

MODE_PROFILES = {
    "default": {
        "enforce_mixed_format": True,
        "enforce_rejected_tags": True,
    },
    "strict": {
        "enforce_mixed_format": True,
        "enforce_rejected_tags": True,
    },
    "relaxed": {
        "enforce_mixed_format": False,
        "enforce_rejected_tags": True,
    },
}

CODEX_UI_TAG_STOPLIST = {
    "helmet",
    "body armour",
    "body armor",
    "gloves",
    "boots",
    "belt",
    "ring",
    "amulet",
    "wand",
    "bow",
    "staff",
    "mace",
    "sword",
    "axe",
    "dagger",
    "spear",
    "crossbow",
    "quarterstaff",
    "flail",
    "focus",
    "shield",
    "buckler",
    "quiver",
    "sceptre",
    "claw",
    "javelin",
    "trap",
    "flask",
}


def fail(msg: str) -> None:
    raise AssertionError(msg)


def check_js_generated_sync() -> None:
    source_rules = json.loads(RULES_JSON_PATH.read_text(encoding="utf-8"))
    expected = build_js_module(source_rules)
    actual = GENERATED_JS_PATH.read_text(encoding="utf-8") if GENERATED_JS_PATH.exists() else ""
    if expected != actual:
        fail("Generated JS rules are out of sync. Run: python data/helperScripts/generate_tag_rules_js.py")


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


def _normalize_family_overlay_key(raw_tag: str, strip_chars_regex: str) -> str:
    base_key = to_match_key(raw_tag)
    return re.sub(strip_chars_regex, "", base_key)


def _normalize_family_tag(raw_tag: str, family_lib: dict) -> str:
    shared_canonical = canonicalize_tag(raw_tag)
    strip_re = family_lib.get("tag_normalization", {}).get("strip_chars_regex", "[^a-z0-9]+")
    shared_key = _normalize_family_overlay_key(shared_canonical or raw_tag, strip_re)

    local_aliases = family_lib.get("tag_normalization", {}).get("alias_to_canonical", {})
    local_target = local_aliases.get(shared_key)
    if not local_target:
        return shared_key

    return _normalize_family_overlay_key(canonicalize_tag(local_target) or local_target, strip_re)


def _to_codex_display_tag(raw_tag: str) -> str | None:
    raw = str(raw_tag or "").strip()
    if not raw:
        return None

    lowered = raw.lower().replace("[", "").replace("]", "").replace("_", " ").replace("-", " ").strip()
    if lowered.startswith("family:"):
        suffix = lowered[len("family:") :].strip()
        return f"family:{suffix}" if suffix else None

    canonical = canonicalize_tag(raw)
    if not canonical:
        return None

    display = canonical.replace("_", " ")
    if display in CODEX_UI_TAG_STOPLIST:
        return None
    return display


def check_normalization_boundary_regressions() -> None:
    family_lib = json.loads(SKILL_FAMILIES_PATH.read_text(encoding="utf-8"))

    # Codex URL/query hydration boundary checks.
    codex_checks = [
        ("block chance", "chance to block"),
        ("family:minions", "family:minions"),
    ]
    for raw, expected in codex_checks:
        got = _to_codex_display_tag(raw)
        if got != expected:
            fail(f"Codex URL hydration regression for {raw!r}: got {got!r}, expected {expected!r}")

    if _to_codex_display_tag("ring") is not None:
        fail("Codex URL hydration regression: stoplisted tag 'ring' should be filtered")

    # Family query alias normalization boundary checks.
    family_alias_checks = [
        ("companions", "companion", "companion"),
        ("freezable", "freeze", "freeze"),
    ]
    for alias, canonical, expected_key in family_alias_checks:
        alias_key = _normalize_family_tag(alias, family_lib)
        canonical_key = _normalize_family_tag(canonical, family_lib)
        if alias_key != canonical_key or alias_key != expected_key:
            fail(
                "Family query alias regression: "
                f"alias={alias!r}->{alias_key!r}, canonical={canonical!r}->{canonical_key!r}, expected={expected_key!r}"
            )


def check_family_local_alias_overlap(mode: str) -> list[str]:
    family_lib = json.loads(SKILL_FAMILIES_PATH.read_text(encoding="utf-8"))
    tag_norm = family_lib.get("tag_normalization", {})
    aliases = tag_norm.get("alias_to_canonical", {})
    strip_re = tag_norm.get("strip_chars_regex", "[^a-z0-9]+")

    overlaps = []
    for local_alias, local_target in sorted(aliases.items()):
        global_canonical = canonicalize_tag(local_alias, reject_grants=False)
        global_outcome = _normalize_family_overlay_key(global_canonical or local_alias, strip_re)
        local_outcome = _normalize_family_overlay_key(canonicalize_tag(local_target, reject_grants=False) or local_target, strip_re)
        if global_outcome != local_outcome:
            continue
        overlaps.append(
            {
                "family": "__library_overlay__",
                "alias": local_alias,
                "global_canonical": global_canonical or local_alias,
                "local_target": local_target,
                "redundant": True,
            }
        )

    warnings: list[str] = []
    if overlaps:
        header = f"Family-local aliases likely redundant with shared/global normalization: {len(overlaps)}"
        if mode == "strict":
            warnings.append(f"[STRICT NOTICE] {header}")
        else:
            warnings.append(header)
        for row in overlaps[:10]:
            warnings.append(
                "  - family={family} alias={alias} global={global_canonical} local={local_target} redundant={redundant}".format(
                    **row
                )
            )
    return warnings


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


def check_dataset_tags(mode: str) -> list[str]:
    profile = MODE_PROFILES[mode]
    bad = []
    mixed = []
    for tag in _iter_primary_tags():
        if canonicalize_tag(tag) is None:
            bad.append(tag)
        if tag != tag.lower() or " " in tag or "-" in tag:
            mixed.append(tag)

    warnings: list[str] = []
    if bad and profile["enforce_rejected_tags"]:
        sample = ", ".join(sorted(set(bad))[:10])
        fail(f"Primary dataset tags contain rejected/non-canonical entries (sample: {sample})")

    if mixed:
        sample = ", ".join(sorted(set(mixed))[:10])
        if profile["enforce_mixed_format"]:
            fail(f"Primary dataset tags contain mixed-format entries (sample: {sample})")
        warnings.append(f"Mixed-format tags tolerated in relaxed mode (sample: {sample})")

    return warnings


def parse_mode(args: argparse.Namespace) -> str:
    if args.strict and args.relaxed:
        fail("Use only one mode flag: --strict or --relaxed")
    if args.strict:
        return "strict"
    if args.relaxed:
        return "relaxed"
    return "default"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="Enable strict dataset hygiene checks")
    parser.add_argument("--relaxed", action="store_true", help="Allow mixed-format dataset tags as warnings")
    args = parser.parse_args()

    mode = parse_mode(args)
    print(f"[validate_tag_normalization] Running checks (mode={mode})...")

    _ = load_rules()
    check_js_generated_sync()
    check_sanity_cases()
    check_normalization_boundary_regressions()
    warnings = check_dataset_tags(mode)
    warnings.extend(check_family_local_alias_overlap(mode))
    for warning in warnings:
        print(f"[validate_tag_normalization] WARN: {warning}")

    print("[validate_tag_normalization] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
