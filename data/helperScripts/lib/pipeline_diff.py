from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ARTIFACT_PATHS: dict[str, Path] = {
    "skills_enriched": Path("data/enriched/skills_enriched.json"),
    "passives_enriched": Path("data/enriched/passives_enriched.json"),
    "poe2db_uniques_min": Path("data/enriched/poe2db_uniques_min.json"),
    "keystone_tooltips": Path("data/enriched/keystone_tooltips.json"),
    "passive_scrape_report": Path("data/enriched/passive_scrape_report.json"),
    "challenge_generated_pools": Path("data/enriched/challenge_generated_pools.json"),
    "tag_vocab_audit": Path("data/enriched/tag_vocab_audit.json"),
    "recommendation_catalog_v3": Path("data/enriched/recommendation_catalog_v3.json"),
    "recommendation_catalog_v3_report": Path("data/enriched/recommendation_catalog_v3_report.json"),
    "recommendation_granted_skill_access_v3": Path("data/enriched/recommendation_granted_skill_access_v3.json"),
}


def snapshot_artifacts(repo_root: Path) -> dict[str, Any]:
    return {key: summarize_artifact_key(repo_root, key) for key in ARTIFACT_PATHS}


def summarize_artifact_key(repo_root: Path, key: str) -> dict[str, Any]:
    path = repo_root / ARTIFACT_PATHS[key]
    if not path.exists():
        return {"exists": False}

    data = _load_json(path)
    summary: dict[str, Any] = {
        "exists": True,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
        "semantic_sha256": _semantic_sha256_for_artifact(key, data),
    }

    if key == "skills_enriched":
        rows = data if isinstance(data, list) else data.get("skills", []) if isinstance(data, dict) else []
        row_list = rows if isinstance(rows, list) else []
        tags = set()
        effect_tags = set()
        type_counts: dict[str, int] = {}
        id_values: list[str] = []
        for row in row_list:
            _add_tags(tags, row.get("tags"))
            _add_tags(effect_tags, row.get("effect_tags"))
            typ = str(row.get("type", "")).strip().lower()
            if typ:
                type_counts[typ] = type_counts.get(typ, 0) + 1
            id_values.append(_stable_row_identity(row))
        summary.update(
            {
                "rows": len(row_list),
                "active_count": type_counts.get("active", 0),
                "support_count": type_counts.get("support", 0),
                "distinct_tag_count": len(tags),
                "distinct_effect_tag_count": len(effect_tags),
                "row_identity_set_sha256": _hash_json(sorted(id_values)),
            }
        )
        return summary

    if key == "passives_enriched":
        row_list = data.get("nodes", []) if isinstance(data, dict) else []
        nodes = row_list if isinstance(row_list, list) else []
        tags = set()
        type_counts: dict[str, int] = {}
        scrape_matched = 0
        identities: list[str] = []
        ascendancy_ids = data.get("ascendancies", {}) if isinstance(data, dict) else {}
        for row in nodes:
            _add_tags(tags, row.get("tags"))
            typ = str(row.get("type", "")).strip().lower()
            if typ:
                type_counts[typ] = type_counts.get(typ, 0) + 1
            if row.get("scrapeMatched"):
                scrape_matched += 1
            identities.append(_stable_row_identity(row))
        summary.update(
            {
                "nodes": len(nodes),
                "keystone_count": type_counts.get("keystone", 0),
                "ascendancy_count": type_counts.get("ascendancy", 0),
                "notable_count": type_counts.get("notable", 0),
                "distinct_tag_count": len(tags),
                "scrape_matched_count": scrape_matched,
                "ascendancy_group_count": len(ascendancy_ids) if isinstance(ascendancy_ids, dict) else 0,
                "row_identity_set_sha256": _hash_json(sorted(identities)),
            }
        )
        return summary

    if key == "poe2db_uniques_min":
        items_dict = data.get("items", {}) if isinstance(data, dict) else {}
        items = list(items_dict.values()) if isinstance(items_dict, dict) else []
        tags = set()
        slots = set()
        granted_skills = 0
        identities: list[str] = []
        for item in items:
            _add_tags(tags, item.get("tags"))
            slot = item.get("slot")
            if isinstance(slot, str) and slot.strip():
                slots.add(slot.strip())
            if item.get("granted_skills"):
                granted_skills += 1
            identities.append(_stable_row_identity(item))
        summary.update(
            {
                "items": len(items),
                "slot_count": len(slots),
                "distinct_tag_count": len(tags),
                "items_with_granted_skills": granted_skills,
                "row_identity_set_sha256": _hash_json(sorted(identities)),
            }
        )
        return summary

    if key == "keystone_tooltips":
        entries = data if isinstance(data, dict) else {}
        line_count = 0
        if isinstance(entries, dict):
            for value in entries.values():
                if isinstance(value, dict):
                    line_count += len(value.get("lines") or [])
        summary.update({"entries": len(entries) if isinstance(entries, dict) else 0, "line_count": line_count})
        return summary

    if key == "passive_scrape_report":
        if not isinstance(data, dict):
            return summary
        keep = [
            "totalKeystones",
            "keystonesScrapeMatched",
            "keystonesUnmatched",
            "totalAscendancyNodes",
            "ascendancyScrapeMatched",
            "ascendancyUnmatched",
            "nodesUsingScrapedLines",
            "nodesUsingDataminedFallback",
            "nodesWithTagsEnhancedByScraping",
            "nodesUsingSanitizedScrapedLines",
            "scrapeMatchesRejectedForBadLines",
            "ascendancyBlankLinesAfterMerge",
            "statlessAscendancyNodesUsingSkillFallback",
            "scrapedFragmentRejections",
            "overviewPageFallbackMatches",
        ]
        summary.update({k: data.get(k) for k in keep if k in data})
        network_errors = data.get("networkErrors") or []
        if isinstance(network_errors, list):
            summary["network_error_count"] = len(network_errors)
        return summary

    if key == "challenge_generated_pools":
        payload = data if isinstance(data, dict) else {}
        strict_rows = payload.get("strictUniqueGrantedSkills", [])
        crafting_types = payload.get("craftingTypes", [])
        strict_list = strict_rows if isinstance(strict_rows, list) else []
        crafting_list = crafting_types if isinstance(crafting_types, list) else []
        summary.update(
            {
                "strict_unique_count": len(strict_list),
                "crafting_type_count": len(crafting_list),
                "strict_unique_identity_set_sha256": _hash_json(
                    sorted(_stable_row_identity(row) for row in strict_list)
                ),
                "crafting_type_identity_set_sha256": _hash_json(
                    sorted(_stable_row_identity(row) for row in crafting_list)
                ),
            }
        )
        return summary

    if key == "tag_vocab_audit":
        summary_in = data.get("summary", {}) if isinstance(data, dict) else {}
        summary.update(
            {
                "total_distinct_raw_count": summary_in.get("total_distinct_raw_count"),
                "total_distinct_canonical_count": summary_in.get("total_distinct_canonical_count"),
                "total_rejected_count": summary_in.get("total_rejected_count"),
                "total_collision_count": summary_in.get("total_collision_count"),
            }
        )
        return summary

    if key == "recommendation_catalog_v3":
        payload = data if isinstance(data, dict) else {}
        meta = payload.get("_meta", {}) if isinstance(payload.get("_meta"), dict) else {}
        entities = payload.get("entities", []) if isinstance(payload.get("entities"), list) else []
        identities = [_stable_row_identity(entity) for entity in entities]
        summary.update(
            {
                "entity_count": len(entities),
                "fact_count": sum(len(entity.get("facts") or []) for entity in entities),
                "content_type_counts": meta.get("content_type_counts", {}),
                "fact_relation_counts": meta.get("fact_relation_counts", {}),
                "candidate_role_counts": meta.get("candidate_role_counts", {}),
                "row_identity_set_sha256": _hash_json(sorted(identities)),
            }
        )
        return summary

    if key == "recommendation_catalog_v3_report":
        payload = data if isinstance(data, dict) else {}
        report_summary = payload.get("summary", {}) if isinstance(payload.get("summary"), dict) else {}
        summary.update(
            {
                "entity_count": report_summary.get("entity_count"),
                "fact_count": report_summary.get("fact_count"),
                "entities_with_facts": report_summary.get("entities_with_facts"),
                "entities_without_facts": report_summary.get("entities_without_facts"),
                "support_entities_with_allowed_types": report_summary.get("support_entities_with_allowed_types"),
                "support_entities_with_excluded_types": report_summary.get("support_entities_with_excluded_types"),
                "support_family_count": report_summary.get("support_family_count"),
                "tiered_support_family_count": report_summary.get("tiered_support_family_count"),
                "tiered_support_entity_count": report_summary.get("tiered_support_entity_count"),
                "support_entities_with_bridge_facts": report_summary.get("support_entities_with_bridge_facts"),
                "support_entities_with_conflicts": report_summary.get("support_entities_with_conflicts"),
                "passives_with_more_than_two_source_stats": report_summary.get("passives_with_more_than_two_source_stats"),
                "passives_with_granted_skill_links": report_summary.get("passives_with_granted_skill_links"),
            }
        )
        return summary

    return summary


def compute_diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    diff: dict[str, Any] = {}
    for key in ARTIFACT_PATHS:
        old = before.get(key, {})
        new = after.get(key, {})
        key_diff: dict[str, Any] = {}

        old_keys = set(old.keys())
        new_keys = set(new.keys())
        for field in sorted((old_keys | new_keys) - {"exists"}):
            ov = old.get(field)
            nv = new.get(field)
            if ov == nv:
                continue
            entry: dict[str, Any] = {"before": ov, "after": nv}
            if isinstance(ov, (int, float)) and isinstance(nv, (int, float)):
                entry["delta"] = nv - ov
            key_diff[field] = entry

        if old.get("exists") != new.get("exists"):
            key_diff["exists"] = {"before": old.get("exists"), "after": new.get("exists")}

        if key_diff:
            diff[key] = key_diff
    return diff


def analyze_semantic_stability(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    analysis: dict[str, Any] = {}
    for key in ARTIFACT_PATHS:
        old = before.get(key, {})
        new = after.get(key, {})
        old_exists = bool(old.get("exists"))
        new_exists = bool(new.get("exists"))
        old_raw = old.get("sha256")
        new_raw = new.get("sha256")
        old_sem = old.get("semantic_sha256")
        new_sem = new.get("semantic_sha256")

        entry: dict[str, Any] = {
            "before_exists": old_exists,
            "after_exists": new_exists,
            "raw_hash_changed": old_raw != new_raw,
            "semantic_hash_changed": old_sem != new_sem,
            "classification": "unchanged",
        }

        if old_exists != new_exists:
            entry["classification"] = "artifact_presence_changed"
        elif old_raw == new_raw:
            entry["classification"] = "unchanged"
        elif old_sem == new_sem:
            entry["classification"] = "byte_changed_semantically_same"
        else:
            entry["classification"] = "semantic_changed"

        count_fields = [
            field
            for field in (
                "rows",
                "nodes",
                "items",
                "entries",
                "active_count",
                "support_count",
                "distinct_tag_count",
                "distinct_effect_tag_count",
                "keystone_count",
                "ascendancy_count",
                "notable_count",
                "scrape_matched_count",
                "ascendancy_group_count",
                "slot_count",
                "items_with_granted_skills",
                "line_count",
                "total_distinct_raw_count",
                "total_distinct_canonical_count",
                "total_rejected_count",
                "total_collision_count",
                "strict_unique_count",
                "crafting_type_count",
                "entity_count",
                "fact_count",
                "entities_with_facts",
                "entities_without_facts",
                "support_entities_with_allowed_types",
                "support_entities_with_excluded_types",
                "support_family_count",
                "tiered_support_family_count",
                "tiered_support_entity_count",
                "support_entities_with_bridge_facts",
                "support_entities_with_conflicts",
                "passives_with_more_than_two_source_stats",
                "passives_with_granted_skill_links",
            )
            if old.get(field) != new.get(field)
        ]
        if count_fields:
            entry["changed_count_fields"] = count_fields

        if entry["classification"] != "unchanged":
            analysis[key] = entry
    return analysis


def summarize_semantic_stability(analysis: dict[str, Any]) -> dict[str, int]:
    summary = {
        "unchanged": 0,
        "byte_changed_semantically_same": 0,
        "semantic_changed": 0,
        "artifact_presence_changed": 0,
    }
    for entry in analysis.values():
        classification = entry.get("classification", "unchanged")
        summary[classification] = summary.get(classification, 0) + 1
    return summary


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _semantic_sha256_for_artifact(key: str, data: Any) -> str:
    if key == "skills_enriched":
        rows = data if isinstance(data, list) else data.get("skills", []) if isinstance(data, dict) else []
        return _hash_json(_normalize_record_list(rows if isinstance(rows, list) else []))
    if key == "passives_enriched":
        payload = data if isinstance(data, dict) else {}
        normalized = {
            "nodes": _normalize_record_list(payload.get("nodes") if isinstance(payload.get("nodes"), list) else []),
            "ascendancies": _normalize_value(payload.get("ascendancies", {})),
        }
        return _hash_json(normalized)
    if key == "poe2db_uniques_min":
        payload = data if isinstance(data, dict) else {}
        items = payload.get("items", {}) if isinstance(payload.get("items"), dict) else {}
        normalized = {
            "items": {name: _normalize_record(value) for name, value in sorted(items.items())},
        }
        for passthrough_key in sorted(k for k in payload.keys() if k != "items"):
            normalized[passthrough_key] = _normalize_value(payload[passthrough_key])
        return _hash_json(normalized)
    if key in {
        "keystone_tooltips",
        "passive_scrape_report",
        "challenge_generated_pools",
        "tag_vocab_audit",
        "recommendation_catalog_v3_report",
        "recommendation_granted_skill_access_v3",
    }:
        return _hash_json(_normalize_value(data))
    if key == "recommendation_catalog_v3":
        payload = data if isinstance(data, dict) else {}
        normalized = {
            "_meta": _normalize_value(payload.get("_meta", {})),
            "fate_vocabulary": _normalize_value(payload.get("fate_vocabulary", {})),
            "entities": _normalize_record_list(payload.get("entities") if isinstance(payload.get("entities"), list) else []),
        }
        return _hash_json(normalized)
    return _hash_json(_normalize_value(data))


def _normalize_record_list(records: list[Any]) -> list[Any]:
    normalized = [_normalize_record(record) for record in records]
    normalized.sort(key=_record_sort_key)
    return normalized


def _normalize_record(record: Any) -> Any:
    return _normalize_value(record)


def _normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _normalize_value(value[key]) for key in sorted(value.keys())}
    if isinstance(value, list):
        normalized_items = [_normalize_value(item) for item in value]
        if all(not isinstance(item, (dict, list)) for item in normalized_items):
            return sorted(normalized_items, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
        return normalized_items
    return value


def _record_sort_key(record: Any) -> str:
    if isinstance(record, dict):
        for key in ("id", "skill_id", "passiveId", "name", "display_name", "title", "key"):
            value = record.get(key)
            if value not in (None, ""):
                return f"{key}:{value}"
    return _hash_json(record)


def _stable_row_identity(record: Any) -> str:
    if isinstance(record, dict):
        for key in ("id", "skill_id", "passiveId", "name", "display_name", "title", "key"):
            value = record.get(key)
            if value not in (None, ""):
                return f"{key}:{value}"
    return _hash_json(record)


def _hash_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _add_tags(target: set[str], maybe_tags: Any) -> None:
    if not isinstance(maybe_tags, list):
        return
    for tag in maybe_tags:
        if isinstance(tag, str) and tag.strip():
            target.add(tag.strip())
