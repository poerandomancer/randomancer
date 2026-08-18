#!/usr/bin/env python3
"""Validate the recommendation enrichment v3 contract and semantic fixtures."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from lib.recommendation_semantics import fact_matches, parse_evidence


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
DATA = REPO_ROOT / "data"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def iter_keys(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key)
            yield from iter_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_keys(child)


def source_counts() -> dict[str, int]:
    skills = load_json(DATA / "enriched" / "skills_enriched.json")
    passives = load_json(DATA / "enriched" / "passives_enriched.json")
    uniques = load_json(DATA / "enriched" / "poe2db_uniques_min.json")
    unique_values = (uniques.get("items") or {}).values()
    counts = Counter("support_gem" if skill.get("type") == "support" else "active_skill" for skill in skills)
    counts.update(
        {
            "ascendancy_passive": sum(1 for node in passives.get("nodes") or [] if node.get("type") == "ascendancy"),
            "keystone": sum(1 for node in passives.get("nodes") or [] if node.get("type") == "keystone"),
            "passive": sum(1 for node in passives.get("nodes") or [] if node.get("type") == "notable"),
            "unique": sum(1 for item in unique_values if isinstance(item, dict) and not item.get("error") and item.get("name")),
        }
    )
    return dict(counts)


def validate_fixture_parsing(fixtures: dict[str, Any], errors: list[str]) -> None:
    for fixture in fixtures.get("fixtures") or []:
        fixture_id = fixture.get("id") or "unnamed"
        facts = parse_evidence(
            fixture.get("source_kind") or "fixture",
            fixture.get("value"),
            fixture.get("subject") or "player",
        )
        for expected in fixture.get("expected_facts") or []:
            if not any(fact_matches(actual, expected) for actual in facts):
                errors.append(
                    f"fixture {fixture_id!r} missing expected fact {expected}; parsed={facts}"
                )
        for forbidden in fixture.get("forbidden_facts") or []:
            if any(fact_matches(actual, forbidden) for actual in facts):
                errors.append(
                    f"fixture {fixture_id!r} produced forbidden fact {forbidden}; parsed={facts}"
                )


def validate_catalog_assertions(catalog: dict[str, Any], fixtures: dict[str, Any], errors: list[str]) -> None:
    by_name: dict[str, list[dict[str, Any]]] = {}
    for entity in catalog.get("entities") or []:
        by_name.setdefault(str(entity.get("name") or ""), []).append(entity)

    for assertion in fixtures.get("catalog_assertions") or []:
        name = assertion.get("entity_name")
        expected = {key: value for key, value in assertion.items() if key != "entity_name"}
        candidates = by_name.get(str(name), [])
        if not candidates:
            errors.append(f"catalog assertion entity not found: {name!r}")
            continue
        if not any(
            fact_matches(fact, expected)
            for entity in candidates
            for fact in entity.get("facts") or []
        ):
            errors.append(f"catalog assertion failed for {name!r}: {expected}")

    for assertion in fixtures.get("catalog_forbidden_assertions") or []:
        name = assertion.get("entity_name")
        forbidden = {key: value for key, value in assertion.items() if key != "entity_name"}
        candidates = by_name.get(str(name), [])
        if not candidates:
            errors.append(f"catalog forbidden assertion entity not found: {name!r}")
            continue
        if any(
            fact_matches(fact, forbidden)
            for entity in candidates
            for fact in entity.get("facts") or []
        ):
            errors.append(f"catalog forbidden assertion failed for {name!r}: {forbidden}")


def validate_entities(catalog: dict[str, Any], ontology: dict[str, Any], errors: list[str]) -> None:
    valid_relations = {entry.get("id") for entry in ontology.get("relations") or []}
    valid_confidence = {entry.get("id") for entry in ontology.get("confidence_levels") or []}
    valid_roles = {entry.get("id") for entry in ontology.get("candidate_roles") or []}
    valid_subjects = set(ontology.get("subjects") or [])
    entities = catalog.get("entities") or []

    ids = [entity.get("id") for entity in entities]
    duplicate_ids = sorted(entity_id for entity_id, count in Counter(ids).items() if count > 1)
    if duplicate_ids:
        errors.append(f"duplicate entity IDs: {duplicate_ids[:10]}")

    for entity in entities:
        entity_id = entity.get("id") or "<missing-id>"
        if not entity.get("id") or not entity.get("content_type") or not entity.get("name"):
            errors.append(f"entity missing identity fields: {entity_id}")
        invalid_roles = sorted(set(entity.get("candidate_roles") or []) - valid_roles)
        if invalid_roles:
            errors.append(f"{entity_id}: invalid candidate roles {invalid_roles}")

        for fact in entity.get("facts") or []:
            relation = fact.get("relation")
            if relation not in valid_relations:
                errors.append(f"{entity_id}: invalid fact relation {relation!r}")
            if fact.get("confidence") not in valid_confidence:
                errors.append(f"{entity_id}: invalid confidence {fact.get('confidence')!r}")
            if fact.get("subject") not in valid_subjects:
                errors.append(f"{entity_id}: invalid subject {fact.get('subject')!r}")
            if relation in {"converts", "replaces"}:
                if not fact.get("from") or not fact.get("to"):
                    errors.append(f"{entity_id}: {relation} fact requires from/to: {fact}")
            elif not fact.get("mechanic"):
                errors.append(f"{entity_id}: {relation} fact requires mechanic: {fact}")
            if not fact.get("evidence"):
                errors.append(f"{entity_id}: fact has no evidence: {fact}")


def validate_source_parity(catalog: dict[str, Any], errors: list[str]) -> None:
    actual = Counter(entity.get("content_type") for entity in catalog.get("entities") or [])
    expected = source_counts()
    for content_type, expected_count in sorted(expected.items()):
        if actual.get(content_type, 0) != expected_count:
            errors.append(
                f"source parity mismatch for {content_type}: expected {expected_count}, got {actual.get(content_type, 0)}"
            )

    report = load_json(DATA / "enriched" / "recommendation_catalog_v3_report.json")
    summary = report.get("summary") or {}
    if summary.get("support_entities_with_allowed_types", 0) <= 0:
        errors.append("support allowed-skill-type relationships were not preserved")
    if summary.get("support_entities_with_excluded_types", 0) <= 0:
        errors.append("support excluded-skill-type relationships were not preserved")
    if summary.get("passives_with_more_than_two_source_stats", 0) <= 0:
        errors.append("full passive stat lists were not preserved")
    if summary.get("passives_with_granted_skill_links", 0) <= 0:
        errors.append("passive GrantedSkill relationships were not preserved")


def validate_granted_skill_access(catalog: dict[str, Any], errors: list[str]) -> None:
    path = DATA / "enriched" / "recommendation_granted_skill_access_v3.json"
    if not path.exists():
        errors.append("granted skill access sidecar is missing")
        return

    access_payload = load_json(path)
    if access_payload.get("schema_version") != "recommendation-granted-skill-access-v3.0.0":
        errors.append("unexpected or missing granted skill access schema version")
    if access_payload.get("catalog_schema_version") != "recommendation-catalog-v3.0.0":
        errors.append("granted skill access sidecar targets the wrong catalog schema")

    entity_ids = {
        entity.get("id")
        for entity in catalog.get("entities") or []
        if entity.get("content_type") == "active_skill"
    }
    access_by_entity_id = access_payload.get("access_by_entity_id") or {}
    if not isinstance(access_by_entity_id, dict) or not access_by_entity_id:
        errors.append("granted skill access sidecar has no entries")
        return

    unique_required_count = 0
    for entity_id, access in access_by_entity_id.items():
        if entity_id not in entity_ids:
            errors.append(f"granted skill access references unknown active skill: {entity_id}")
            continue
        if not access.get("requires_granted_source"):
            errors.append(f"{entity_id}: granted access entry does not require a granted source")
        sources = access.get("granted_sources") or []
        if not isinstance(sources, list) or not sources:
            errors.append(f"{entity_id}: granted access entry has no provider sources")
            continue
        if access.get("requires_unique_provider"):
            unique_required_count += 1
        for source in sources:
            kind = source.get("kind")
            if kind == "ascendancy_passive" and not source.get("ascendancy"):
                errors.append(f"{entity_id}: ascendancy provider is missing ascendancy")
            elif kind == "unique" and not source.get("unique_name"):
                errors.append(f"{entity_id}: unique provider is missing unique name")
            elif kind not in {"ascendancy_passive", "unique"}:
                errors.append(f"{entity_id}: unknown granted access provider kind {kind!r}")
    if unique_required_count <= 0:
        errors.append("granted skill access sidecar has no unique-provider requirements")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate recommendation enrichment v3 artifacts.")
    parser.add_argument(
        "--catalog",
        default=str(DATA / "enriched" / "recommendation_catalog_v3.json"),
    )
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    if not catalog_path.is_absolute():
        catalog_path = REPO_ROOT / catalog_path

    catalog = load_json(catalog_path)
    ontology = load_json(DATA / "recommendation_ontology_v3.json")
    fixtures = load_json(DATA / "config" / "recommendation_semantic_fixtures_v3.json")
    errors: list[str] = []

    if (catalog.get("_meta") or {}).get("schema_version") != "recommendation-catalog-v3.0.0":
        errors.append("unexpected or missing recommendation catalog schema version")
    if (catalog.get("_meta") or {}).get("ontology_version") != ontology.get("schema_version"):
        errors.append("catalog ontology version does not match recommendation_ontology_v3.json")
    if any("cohesion" in key.lower() for key in iter_keys(catalog)):
        errors.append("recommendation catalog contains a cohesion key; cohesion belongs only to core Fate selection")

    validate_fixture_parsing(fixtures, errors)
    validate_entities(catalog, ontology, errors)
    validate_catalog_assertions(catalog, fixtures, errors)
    validate_source_parity(catalog, errors)
    validate_granted_skill_access(catalog, errors)

    if errors:
        print(f"Recommendation catalog v3 validation failed with {len(errors)} error(s):", file=sys.stderr)
        for error in errors[:50]:
            print(f"- {error}", file=sys.stderr)
        if len(errors) > 50:
            print(f"- ... {len(errors) - 50} more", file=sys.stderr)
        return 1

    meta = catalog.get("_meta") or {}
    print(
        "Recommendation catalog v3 validation passed: "
        f"{meta.get('entity_count')} entities, {meta.get('fact_count')} facts."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
