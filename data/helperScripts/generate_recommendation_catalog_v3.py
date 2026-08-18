#!/usr/bin/env python3
"""Generate the additive recommendation enrichment v3 semantic catalog.

This generator does not change the current runtime skill/passive/unique files.
It joins their retained records back to richer datamined relationships, parses
conservative qualitative facts, and emits one normalized recommendation input.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from lib.recommendation_semantics import (
    candidate_roles,
    fact_matches,
    make_fact,
    mechanics_in,
    merge_facts,
    normalized_phrase,
    parse_evidence,
)
from lib.tag_normalization import normalize_tag_list


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
DEFAULT_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_catalog_v3.json"
DEFAULT_REPORT_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_catalog_v3_report.json"
DEFAULT_ACCESS_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_granted_skill_access_v3.json"
SCHEMA_VERSION = "recommendation-catalog-v3.0.0"
REPORT_SCHEMA_VERSION = "recommendation-catalog-v3-report.0.0"
GRANTED_ACCESS_SCHEMA_VERSION = "recommendation-granted-skill-access-v3.0.0"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def index_by_rid(rows: Iterable[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {
        int(row["_rid"]): row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("_rid"), int)
    }


def unique_sorted(values: Iterable[Any]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value or "").strip()})


GRANTS_SKILL_RE = re.compile(r"^\s*Grants\s+Skill:\s*(?P<name>.+?)\s*$", re.IGNORECASE)


def passive_granted_skill_providers(ctx: "SourceContext") -> dict[str, list[dict[str, Any]]]:
    providers: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for passive in ctx.passives.get("nodes") or []:
        source_id = str(passive.get("id") or "")
        if not source_id:
            continue
        for line in passive.get("lines") or []:
            match = GRANTS_SKILL_RE.match(str(line or ""))
            if not match:
                continue
            skill_name = match.group("name").strip()
            if not skill_name:
                continue
            providers[normalized_phrase(skill_name)].append(
                {
                    "kind": "ascendancy_passive",
                    "passive_name": passive.get("name"),
                    "passive_id": source_id,
                    "ascendancy": passive.get("ascendancy"),
                    "source_kind": "scraped_passive_line" if passive.get("descriptionSource") == "scraped" else "passive_line",
                    "source_value": line,
                }
            )
    return {key: value for key, value in providers.items() if value}


def unique_granted_skill_providers(ctx: "SourceContext") -> dict[str, list[dict[str, Any]]]:
    providers: dict[str, list[dict[str, Any]]] = defaultdict(list)
    items = ctx.uniques.get("items") or {}
    values = items.values() if isinstance(items, dict) else items
    for unique in values:
        if not isinstance(unique, dict) or unique.get("error") or not unique.get("name"):
            continue
        source_id = str(unique.get("key") or unique.get("name"))
        for granted in unique.get("granted_skills") or []:
            skill_name = str(granted.get("name") or "").strip()
            if not skill_name:
                continue
            providers[normalized_phrase(skill_name)].append(
                {
                    "kind": "unique",
                    "unique_name": unique.get("name"),
                    "unique_id": source_id,
                    "slot": unique.get("slot"),
                    "base": unique.get("base"),
                    "requirements": unique.get("requirements") or {},
                    "granted_level": granted.get("level"),
                    "source_value": granted.get("raw") or skill_name,
                }
            )
    return {key: value for key, value in providers.items() if value}


def strict_unique_granted_skill_names(ctx: "SourceContext") -> set[str]:
    rows = (ctx.unique_granted_overrides.get("strictUniqueGrantedSkills") or [])
    return {
        normalized_phrase(row.get("skillName"))
        for row in rows
        if isinstance(row, dict) and row.get("skillName")
    }


def granted_access_for_skill(
    skill: dict[str, Any],
    passive_providers: dict[str, list[dict[str, Any]]],
    unique_providers: dict[str, list[dict[str, Any]]],
    strict_unique_granted_names: set[str],
) -> dict[str, Any]:
    skill_name_key = normalized_phrase(skill.get("name"))
    passive_sources = passive_providers.get(skill_name_key) or []
    unique_sources = unique_providers.get(skill_name_key) or []
    granted_sources: list[dict[str, Any]] = []
    access: dict[str, Any] = {}

    if passive_sources:
        granted_sources.extend(passive_sources)
        ascendancies = unique_sorted(source.get("ascendancy") for source in passive_sources)
        if len(ascendancies) == 1:
            access["ascendancy"] = ascendancies[0]
        elif ascendancies:
            access["ascendancies_any_of"] = ascendancies

    unique_requires_provider = bool(unique_sources) and skill_name_key in strict_unique_granted_names
    if unique_requires_provider:
        granted_sources.extend(unique_sources)
        access["requires_unique_provider"] = True

    if granted_sources:
        access["requires_granted_source"] = True
        access["granted_sources"] = granted_sources

    return access


class Coverage:
    def __init__(self, sample_limit: int = 12):
        self.sample_limit = sample_limit
        self.groups: dict[str, Counter[str]] = defaultdict(Counter)
        self.samples: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))

    def record(
        self,
        group: str,
        *,
        entity_id: str,
        kind: str,
        value: Any,
        facts: list[dict[str, Any]],
    ) -> None:
        counter = self.groups[group]
        counter["evidence_count"] += 1
        counter["fact_count"] += len(facts)
        if facts:
            classification = "structured"
        elif mechanics_in(value):
            classification = "recognized_unstructured"
        else:
            classification = "unparsed"
        counter[f"{classification}_count"] += 1

        bucket = self.samples[group][classification]
        if classification != "structured" and len(bucket) < self.sample_limit:
            bucket.append({"entity_id": entity_id, "kind": kind, "value": value})

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for group in sorted(self.groups):
            counts = dict(self.groups[group])
            total = counts.get("evidence_count", 0)
            counts["structured_rate"] = round(counts.get("structured_count", 0) / total, 4) if total else 0
            out[group] = {
                **counts,
                "samples": {
                    classification: values
                    for classification, values in sorted(self.samples[group].items())
                    if values
                },
            }
        return out


class SourceContext:
    def __init__(self, root: Path):
        data = root / "data"
        tables = data / "datamined" / "skills_tables"

        self.skills = load_json(data / "enriched" / "skills_enriched.json")
        self.passives = load_json(data / "enriched" / "passives_enriched.json")
        self.uniques = load_json(data / "enriched" / "poe2db_uniques_min.json")
        self.offense = load_json(data / "offense-inventory.json")
        self.core = load_json(data / "core-data.json")
        self.ontology = load_json(data / "recommendation_ontology_v3.json")
        self.overrides = load_json(data / "config" / "recommendation_fact_overrides_v3.json")
        self.unique_granted_overrides = load_json(data / "config" / "challenge_unique_granted_skill_overrides.json")

        self.stats_by_rid = index_by_rid(load_json(data / "datamined" / "stats.json"))
        self.statsets_by_rid = index_by_rid(load_json(tables / "grantedeffectstatsets.json"))
        self.granted_by_rid = index_by_rid(load_json(tables / "grantedeffects.json"))
        self.active_by_rid = index_by_rid(load_json(tables / "activeskills.json"))
        self.active_type_by_rid = index_by_rid(load_json(tables / "activeskilltype.json"))

        passive_rows = load_json(data / "datamined" / "passiveskills.json")
        self.passive_by_id = {
            str(row.get("Id")): row
            for row in passive_rows
            if isinstance(row, dict) and row.get("Id")
        }


def _source_stat(
    ctx: SourceContext,
    stat_rid: int,
    *,
    value: Any = None,
    granted_effect_rid: int | None = None,
    statset_rid: int | None = None,
) -> dict[str, Any] | None:
    stat = ctx.stats_by_rid.get(stat_rid)
    if not stat or not stat.get("Id"):
        return None
    result: dict[str, Any] = {
        "rid": stat_rid,
        "id": str(stat.get("Id")),
        "semantic": stat.get("Semantic"),
    }
    if value is not None:
        result["value"] = value
    if granted_effect_rid is not None:
        result["granted_effect_rid"] = granted_effect_rid
    if statset_rid is not None:
        result["statset_rid"] = statset_rid
    return result


def granted_effect_source(
    ctx: SourceContext,
    granted_effect_rids: Iterable[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    granted_effects: list[dict[str, Any]] = []
    stats: list[dict[str, Any]] = []

    for granted_rid in sorted({rid for rid in granted_effect_rids if isinstance(rid, int)}):
        granted = ctx.granted_by_rid.get(granted_rid)
        if not granted:
            continue

        allowed_types = [
            str(ctx.active_type_by_rid[rid].get("Id"))
            for rid in granted.get("AllowedActiveSkillTypes") or []
            if rid in ctx.active_type_by_rid and ctx.active_type_by_rid[rid].get("Id")
        ]
        excluded_types = [
            str(ctx.active_type_by_rid[rid].get("Id"))
            for rid in granted.get("ExcludedActiveSkillTypes") or []
            if rid in ctx.active_type_by_rid and ctx.active_type_by_rid[rid].get("Id")
        ]
        granted_effects.append(
            {
                "rid": granted_rid,
                "id": granted.get("Id"),
                "is_support": bool(granted.get("IsSupport")),
                "active_skill_rid": granted.get("ActiveSkill"),
                "allowed_active_skill_types": unique_sorted(allowed_types),
                "excluded_active_skill_types": unique_sorted(excluded_types),
                "support_weapon_restriction_rids": sorted(
                    rid for rid in (granted.get("SupportWeaponRestrictions") or []) if isinstance(rid, int)
                ),
                "supports_gems_only": bool(granted.get("SupportsGemsOnly")),
                "cannot_be_supported": bool(granted.get("CannotBeSupported")),
            }
        )

        statset_rids = [granted.get("StatSet"), *(granted.get("AdditionalStatSets") or [])]
        for statset_rid in statset_rids:
            if not isinstance(statset_rid, int):
                continue
            statset = ctx.statsets_by_rid.get(statset_rid)
            if not statset:
                continue

            for stat_rid in statset.get("ImplicitStats") or []:
                if isinstance(stat_rid, int):
                    record = _source_stat(
                        ctx,
                        stat_rid,
                        granted_effect_rid=granted_rid,
                        statset_rid=statset_rid,
                    )
                    if record:
                        stats.append(record)

            constant_stats = statset.get("ConstantStats") or []
            constant_values = statset.get("ConstantStatsValues") or []
            for index, stat_rid in enumerate(constant_stats):
                if not isinstance(stat_rid, int):
                    continue
                value = constant_values[index] if index < len(constant_values) else None
                record = _source_stat(
                    ctx,
                    stat_rid,
                    value=value,
                    granted_effect_rid=granted_rid,
                    statset_rid=statset_rid,
                )
                if record:
                    stats.append(record)

    deduped_stats: dict[tuple[Any, ...], dict[str, Any]] = {}
    for stat in stats:
        key = (
            stat.get("rid"),
            stat.get("value"),
            stat.get("granted_effect_rid"),
            stat.get("statset_rid"),
        )
        deduped_stats[key] = stat
    return granted_effects, sorted(deduped_stats.values(), key=lambda row: (row.get("id", ""), row.get("rid", -1)))


def active_skill_types(ctx: SourceContext, active_skill_rids: Iterable[int], granted_effects: Iterable[dict[str, Any]]) -> list[str]:
    type_rids: set[int] = set()
    for active_rid in active_skill_rids:
        active = ctx.active_by_rid.get(active_rid)
        if active:
            type_rids.update(rid for rid in (active.get("ActiveSkillTypes") or []) if isinstance(rid, int))
    for granted in granted_effects:
        raw = ctx.granted_by_rid.get(granted.get("rid"))
        if raw:
            type_rids.update(rid for rid in (raw.get("AddedActiveSkillTypes") or []) if isinstance(rid, int))
    return unique_sorted(
        ctx.active_type_by_rid[rid].get("Id")
        for rid in type_rids
        if rid in ctx.active_type_by_rid
    )


def record_and_parse(
    coverage: Coverage,
    *,
    group: str,
    entity_id: str,
    source_kind: str,
    value: Any,
    subject: str,
) -> list[dict[str, Any]]:
    facts = parse_evidence(source_kind, value, subject)
    coverage.record(group, entity_id=entity_id, kind=source_kind, value=value, facts=facts)
    return facts


def apply_entity_overrides(ctx: SourceContext, entity_id: str, facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    config = (ctx.overrides.get("entities") or {}).get(entity_id) or {}
    suppressions = config.get("suppress_facts") or []
    kept = [fact for fact in facts if not any(fact_matches(fact, suppression) for suppression in suppressions)]

    additions = []
    for raw in config.get("add_facts") or []:
        addition = dict(raw)
        addition.setdefault("confidence", "exact")
        addition.setdefault("evidence", [{"kind": "curated_override", "value": config.get("reason", entity_id)}])
        additions.append(addition)
    return merge_facts([*kept, *additions])


def entity_override(ctx: SourceContext, entity_id: str) -> dict[str, Any]:
    return (ctx.overrides.get("entities") or {}).get(entity_id) or {}


def build_skill_entities(ctx: SourceContext, coverage: Coverage) -> list[dict[str, Any]]:
    entities = []
    for skill in ctx.skills:
        source_id = str(skill.get("id") or "")
        if not source_id:
            continue
        entity_id = f"skill:{source_id}"
        is_support = skill.get("type") == "support"
        content_type = "support_gem" if is_support else "active_skill"
        subject = "supported_skill" if is_support else "skill"
        links = skill.get("links") or {}

        granted_effects, stats = granted_effect_source(ctx, links.get("granted_effect_rids") or [])
        type_names = active_skill_types(ctx, links.get("active_skill_rids") or [], granted_effects)
        taxonomy_damage_types = unique_sorted((skill.get("taxonomy") or {}).get("damage_types") or [])
        facts: list[dict[str, Any]] = []

        for type_name in type_names:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="skill_types",
                    entity_id=entity_id,
                    source_kind="active_skill_type",
                    value=type_name,
                    subject="skill",
                )
            )

        for damage_type in taxonomy_damage_types:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="skill_taxonomy_damage_types",
                    entity_id=entity_id,
                    source_kind="taxonomy_damage_type",
                    value=damage_type,
                    subject=subject,
                )
            )

        for stat in stats:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="skill_stats",
                    entity_id=entity_id,
                    source_kind="stat_id",
                    value=stat["id"],
                    subject=subject,
                )
            )

        description = str(skill.get("description") or "").strip()
        if description:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="skill_descriptions",
                    entity_id=entity_id,
                    source_kind="skill_description",
                    value=description,
                    subject=subject,
                )
            )

        facts = apply_entity_overrides(ctx, entity_id, merge_facts(facts))
        tags = normalize_tag_list(
            [
                *(skill.get("tags") or []),
                *(skill.get("effect_tags") or []),
                *type_names,
            ],
            expand=False,
            match_keys=False,
        )

        support_rules = [entry for entry in granted_effects if entry.get("is_support")]
        target_compatibility = None
        if support_rules:
            target_compatibility = {
                "allowed_skill_types_any_of": unique_sorted(
                    value for entry in support_rules for value in entry.get("allowed_active_skill_types") or []
                ),
                "excluded_skill_types": unique_sorted(
                    value for entry in support_rules for value in entry.get("excluded_active_skill_types") or []
                ),
                "weapon_restriction_rids": sorted(
                    {
                        value
                        for entry in support_rules
                        for value in entry.get("support_weapon_restriction_rids") or []
                    }
                ),
                "supports_gems_only": any(entry.get("supports_gems_only") for entry in support_rules),
            }

        compatibility: dict[str, Any] = {
            "equipment": skill.get("weapon_requirements") or {"is_unrestricted": True},
        }
        if target_compatibility:
            compatibility["target_skill"] = target_compatibility
        override = entity_override(ctx, entity_id)
        compatibility.update(override.get("compatibility") or {})

        roles = candidate_roles(
            content_type=content_type,
            facts=facts,
            active_skill_types=type_names,
        )
        for role in reversed(override.get("add_candidate_roles") or []):
            if role not in roles:
                roles.insert(0, role)

        entities.append(
            {
                "id": entity_id,
                "content_type": content_type,
                "source_id": source_id,
                "name": skill.get("name"),
                "candidate_roles": roles,
                "retrieval_terms": tags,
                "facts": facts,
                "compatibility": compatibility,
                "links": {
                    "recommended_support_ids": skill.get("recommended_supports") or [],
                    "active_skill_ids": links.get("active_skill_ids") or [],
                    "granted_effect_rids": links.get("granted_effect_rids") or [],
                },
                "source_evidence": {
                    "description": description,
                    "active_skill_types": type_names,
                    "taxonomy_damage_types": taxonomy_damage_types,
                    "stats": stats,
                    "granted_effects": granted_effects,
                },
                "provenance": {
                    "dataset": "skills_enriched.json",
                    "schema_version": skill.get("schema_version"),
                    "source_tags": skill.get("source_tags") or [],
                },
            }
        )
    return entities


def build_granted_skill_access_payload(ctx: SourceContext) -> dict[str, Any]:
    passive_providers = passive_granted_skill_providers(ctx)
    unique_providers = unique_granted_skill_providers(ctx)
    strict_unique_names = strict_unique_granted_skill_names(ctx)
    access_by_entity_id = {}

    for skill in ctx.skills:
        if skill.get("type") == "support":
            continue
        source_id = str(skill.get("id") or "")
        if not source_id:
            continue
        access = granted_access_for_skill(skill, passive_providers, unique_providers, strict_unique_names)
        if access:
            access_by_entity_id[f"skill:{source_id}"] = access

    return {
        "schema_version": GRANTED_ACCESS_SCHEMA_VERSION,
        "catalog_schema_version": SCHEMA_VERSION,
        "access_by_entity_id": dict(sorted(access_by_entity_id.items())),
    }


def passive_stat_records(ctx: SourceContext, raw: dict[str, Any]) -> list[dict[str, Any]]:
    records = []
    for index, stat_rid in enumerate(raw.get("Stats") or [], start=1):
        if not isinstance(stat_rid, int):
            continue
        value = raw.get(f"Stat{index}Value") if index <= 5 else None
        record = _source_stat(ctx, stat_rid, value=value)
        if record:
            records.append(record)
    return records


def build_passive_entities(ctx: SourceContext, coverage: Coverage) -> list[dict[str, Any]]:
    entities = []
    for passive in ctx.passives.get("nodes") or []:
        source_id = str(passive.get("id") or "")
        if not source_id:
            continue
        entity_id = f"passive:{source_id}"
        source_type = passive.get("type")
        content_type = {
            "ascendancy": "ascendancy_passive",
            "keystone": "keystone",
            "notable": "passive",
        }.get(source_type, "passive")
        raw = ctx.passive_by_id.get(source_id) or {}
        stats = passive_stat_records(ctx, raw)
        facts: list[dict[str, Any]] = []

        for stat in stats:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="passive_stats",
                    entity_id=entity_id,
                    source_kind="stat_id",
                    value=stat["id"],
                    subject="passive",
                )
            )

        lines = [str(line).strip() for line in (passive.get("lines") or []) if str(line).strip()]
        for line in lines:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="passive_descriptions",
                    entity_id=entity_id,
                    source_kind="scraped_passive_line" if passive.get("descriptionSource") == "scraped" else "passive_line",
                    value=line,
                    subject="passive",
                )
            )
        if len(lines) > 1:
            joined = " ".join(lines)
            joined_facts = parse_evidence(
                "scraped_passive_description" if passive.get("descriptionSource") == "scraped" else "passive_description",
                joined,
                "passive",
            )
            facts.extend(joined_facts)

        ascendancy = passive.get("ascendancy")
        if ascendancy:
            facts.append(
                make_fact(
                    "exclusive_to",
                    subject="passive",
                    source_kind="passive_ascendancy",
                    source_value=ascendancy,
                    mechanic=normalized_phrase(ascendancy),
                    confidence="exact",
                )
            )

        granted_skill_rid = raw.get("GrantedSkill")
        if isinstance(granted_skill_rid, int):
            facts.append(
                make_fact(
                    "provides",
                    subject="passive",
                    source_kind="passive_granted_skill",
                    source_value=granted_skill_rid,
                    mechanic="granted_skill",
                    confidence="exact",
                )
            )

        facts = apply_entity_overrides(ctx, entity_id, merge_facts(facts))
        tags = normalize_tag_list(passive.get("tags") or [], expand=False, match_keys=False)
        access: dict[str, Any] = {"ascendancy": ascendancy} if ascendancy else {}

        entities.append(
            {
                "id": entity_id,
                "content_type": content_type,
                "source_id": source_id,
                "name": passive.get("name"),
                "candidate_roles": candidate_roles(
                    content_type=content_type,
                    facts=facts,
                ),
                "retrieval_terms": tags,
                "facts": facts,
                "compatibility": {"access": access},
                "links": {
                    "ascendancy_id": passive.get("ascendancyId"),
                    "passive_skill_graph_id": raw.get("PassiveSkillGraphId"),
                    "granted_skill_rid": granted_skill_rid,
                },
                "source_evidence": {
                    "lines": lines,
                    "description_source": passive.get("descriptionSource"),
                    "stats": stats,
                },
                "provenance": {
                    "dataset": "passives_enriched.json",
                    "scrape_matched": bool(passive.get("scrapeMatched")),
                    "tag_sources": passive.get("tagSources") or [],
                },
            }
        )
    return entities


def unique_subject(line: str) -> str:
    normalized = normalized_phrase(line)
    if (
        normalized.startswith(("cannot_be_", "cannot_use_", "cannot_have_", "cannot_regenerate_", "cannot_evade_", "cannot_block_", "cannot_inflict_", "cannot_cause_"))
        or normalized.startswith(("you_", "your_", "life_recovery_", "mana_recovery_"))
        or "_you_" in f"_{normalized}_"
    ):
        return "player"
    if normalized.startswith("minion_"):
        return "minion"
    return "item"


def build_unique_entities(ctx: SourceContext, coverage: Coverage) -> list[dict[str, Any]]:
    items = ctx.uniques.get("items") or {}
    values = items.values() if isinstance(items, dict) else items
    entities = []
    for unique in values:
        if not isinstance(unique, dict) or unique.get("error") or not unique.get("name"):
            continue
        source_id = str(unique.get("key") or unique.get("name"))
        entity_id = f"unique:{source_id}"
        implicit_mods = [str(value) for value in (unique.get("implicit_mods") or []) if str(value).strip()]
        explicit_mods = [str(value) for value in (unique.get("explicit_mods") or []) if str(value).strip()]
        facts: list[dict[str, Any]] = []
        for line in [*implicit_mods, *explicit_mods]:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="unique_modifiers",
                    entity_id=entity_id,
                    source_kind="unique_mod",
                    value=line,
                    subject=unique_subject(line),
                )
            )

        slot = str(unique.get("slot") or "").strip()
        if slot:
            facts.append(
                make_fact(
                    "occupies",
                    subject="item",
                    source_kind="unique_slot",
                    source_value=slot,
                    mechanic=normalized_phrase(slot),
                    confidence="exact",
                )
            )

        if unique.get("granted_skills"):
            facts.append(
                make_fact(
                    "provides",
                    subject="item",
                    source_kind="unique_granted_skill",
                    source_value=[entry.get("name") for entry in unique.get("granted_skills") or []],
                    mechanic="granted_skill",
                    confidence="exact",
                )
            )

        facts = apply_entity_overrides(ctx, entity_id, merge_facts(facts))
        tags = normalize_tag_list(
            [*(unique.get("tags") or []), normalized_phrase(slot)],
            expand=False,
            match_keys=False,
        )

        entities.append(
            {
                "id": entity_id,
                "content_type": "unique",
                "source_id": source_id,
                "name": unique.get("name"),
                "candidate_roles": candidate_roles(
                    content_type="unique",
                    facts=facts,
                ),
                "retrieval_terms": tags,
                "facts": facts,
                "compatibility": {
                    "equipment": {
                        "slot": slot or None,
                        "base": unique.get("base"),
                        "requirements": unique.get("requirements") or {},
                    }
                },
                "links": {
                    "granted_skills": unique.get("granted_skills") or [],
                },
                "source_evidence": {
                    "implicit_mods": implicit_mods,
                    "explicit_mods": explicit_mods,
                },
                "provenance": {
                    "dataset": "poe2db_uniques_min.json",
                    "source": unique.get("source") or {},
                },
            }
        )
    return entities


def fate_vocabulary(ctx: SourceContext) -> dict[str, Any]:
    return {
        "offense_version": ctx.offense.get("version"),
        "offense_concepts": [
            {
                "id": element.get("id"),
                "name": element.get("name"),
                "category": element.get("category"),
            }
            for element in ctx.offense.get("elements") or []
        ],
        "primary_defenses": [
            {
                "id": normalized_phrase(entry.get("name")),
                "name": entry.get("name"),
            }
            for entry in ctx.core.get("Defense") or []
        ],
        "secondary_survivability_families": ctx.ontology.get("survivability_families") or [],
    }


def build_catalog(ctx: SourceContext) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    coverage = Coverage()
    skill_entities = build_skill_entities(ctx, coverage)
    passive_entities = build_passive_entities(ctx, coverage)
    unique_entities = build_unique_entities(ctx, coverage)
    granted_access = build_granted_skill_access_payload(ctx)
    entities = sorted(
        [*skill_entities, *passive_entities, *unique_entities],
        key=lambda entity: (entity.get("content_type", ""), str(entity.get("name") or ""), entity["id"]),
    )
    type_counts = Counter(entity["content_type"] for entity in entities)
    fact_counts = Counter(
        fact.get("relation")
        for entity in entities
        for fact in entity.get("facts") or []
        if fact.get("relation")
    )
    role_counts = Counter(role for entity in entities for role in entity.get("candidate_roles") or [])

    meta = {
        "schema_version": SCHEMA_VERSION,
        "ontology_version": ctx.ontology.get("schema_version"),
        "entity_count": len(entities),
        "content_type_counts": dict(sorted(type_counts.items())),
        "fact_count": sum(fact_counts.values()),
        "fact_relation_counts": dict(sorted(fact_counts.items())),
        "candidate_role_counts": dict(sorted(role_counts.items())),
        "source_versions": {
            "core_data": ctx.core.get("Version"),
            "offense_inventory": ctx.offense.get("version"),
            "uniques": (ctx.uniques.get("_meta") or {}).get("schema"),
        },
    }
    catalog = {
        "_meta": meta,
        "fate_vocabulary": fate_vocabulary(ctx),
        "entities": entities,
    }

    coverage_payload = coverage.as_dict()
    report = {
        "schema_version": REPORT_SCHEMA_VERSION,
        "catalog_schema_version": SCHEMA_VERSION,
        "summary": {
            **meta,
            "entities_with_facts": sum(1 for entity in entities if entity.get("facts")),
            "entities_without_facts": sum(1 for entity in entities if not entity.get("facts")),
            "support_entities_with_allowed_types": sum(
                1
                for entity in skill_entities
                if ((entity.get("compatibility") or {}).get("target_skill") or {}).get("allowed_skill_types_any_of")
            ),
            "support_entities_with_excluded_types": sum(
                1
                for entity in skill_entities
                if ((entity.get("compatibility") or {}).get("target_skill") or {}).get("excluded_skill_types")
            ),
            "active_skills_with_granted_access": sum(
                1 for access in (granted_access.get("access_by_entity_id") or {}).values()
                if access.get("requires_granted_source")
            ),
            "active_skills_requiring_unique_provider": sum(
                1 for access in (granted_access.get("access_by_entity_id") or {}).values()
                if access.get("requires_unique_provider")
            ),
            "passives_with_more_than_two_source_stats": sum(
                1 for entity in passive_entities if len((entity.get("source_evidence") or {}).get("stats") or []) > 2
            ),
            "passives_with_granted_skill_links": sum(
                1 for entity in passive_entities if (entity.get("links") or {}).get("granted_skill_rid") is not None
            ),
        },
        "coverage": coverage_payload,
    }
    return catalog, report, granted_access


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the additive recommendation enrichment v3 catalog.")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--report-out", default=str(DEFAULT_REPORT_OUT))
    parser.add_argument("--access-out", default=str(DEFAULT_ACCESS_OUT))
    args = parser.parse_args()

    out_path = Path(args.out)
    report_path = Path(args.report_out)
    access_path = Path(args.access_out)
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path
    if not report_path.is_absolute():
        report_path = REPO_ROOT / report_path
    if not access_path.is_absolute():
        access_path = REPO_ROOT / access_path

    context = SourceContext(REPO_ROOT)
    catalog, report, granted_access = build_catalog(context)
    write_json(out_path, catalog)
    write_json(report_path, report)
    write_json(access_path, granted_access)
    print(f"Wrote {catalog['_meta']['entity_count']} entities to {out_path}")
    print(f"Wrote semantic coverage report to {report_path}")
    print(f"Wrote granted skill access map to {access_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
