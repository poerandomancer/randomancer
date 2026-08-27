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
    semantic_completeness_warnings,
)
from lib.tag_normalization import normalize_tag_list


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
DEFAULT_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_catalog_v3.json"
DEFAULT_PROVENANCE_OUT = REPO_ROOT / "data" / "enriched" / "debug" / "recommendation_catalog_v3_provenance.json"
DEFAULT_REPORT_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_catalog_v3_report.json"
DEFAULT_ACCESS_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_granted_skill_access_v3.json"
DEFAULT_CRAFTING_OUT = REPO_ROOT / "data" / "enriched" / "recommendation_skill_crafting_v3.json"
SCHEMA_VERSION = "recommendation-catalog-v3.0.0"
REPORT_SCHEMA_VERSION = "recommendation-catalog-v3-report.0.0"
GRANTED_ACCESS_SCHEMA_VERSION = "recommendation-granted-skill-access-v3.0.0"
SKILL_CRAFTING_SCHEMA_VERSION = "recommendation-skill-crafting-v3.0.0"
MARTIAL_CRAFTING_TYPES = {
    "axe",
    "bow",
    "claw",
    "crossbow",
    "dagger",
    "flail",
    "mace",
    "quarterstaff",
    "spear",
    "sword",
    "talisman",
    "unarmed",
}

# Canonical weapon terms used by datamined stat ids.  These are vocabulary
# aliases, not passive-name assignments; live compatibility is derived from
# core-data's actual roll pool below.
PASSIVE_WEAPON_ALIASES = {
    "axe": "axe", "axes": "axe", "bow": "bow", "bows": "bow",
    "claw": "claw", "claws": "claw", "crossbow": "crossbow", "crossbows": "crossbow",
    "dagger": "dagger", "daggers": "dagger", "flail": "flail", "flails": "flail",
    "mace": "mace", "maces": "mace", "quarterstaff": "quarterstaff", "quarterstaves": "quarterstaff",
    "sceptre": "sceptre", "sceptres": "sceptre", "shield": "shield", "shields": "shield",
    "spear": "spear", "spears": "spear", "staff": "staff", "staves": "staff",
    "sword": "sword", "swords": "sword", "talisman": "talisman", "talismans": "talisman",
    "wand": "wand", "wands": "wand",
}
PASSIVE_WEAPON_CATEGORIES = {"one_handed", "two_handed", "melee", "martial"}


def live_weapon_metadata(core: dict[str, Any]) -> list[dict[str, Any]]:
    """Project the authoritative Randomancer roll pool to normalized identities."""
    result = []
    for handedness, entries in (core.get("Weapons") or {}).items():
        for entry in entries or []:
            raw_name = str(entry.get("name") or "")
            family = re.sub(r"^(?:one|two)[- ]handed_?", "", normalized_phrase(raw_name))
            tags = {normalized_phrase(tag) for tag in entry.get("tags") or []}
            tags.add("two_handed" if normalized_phrase(handedness) == "two_handed" else "one_handed")
            if family in MARTIAL_CRAFTING_TYPES or "melee" in tags:
                tags.add("martial")
            result.append({"id": family, "tags": tags})
    return result


def passive_weapon_compatibility(core: dict[str, Any], stats: list[dict[str, Any]], lines: list[str]) -> dict[str, Any] | None:
    """Extract only explicit weapon applicability from authoritative stat evidence."""
    evidence = [str(stat.get("id") or "") for stat in stats] + lines
    normalized = [normalized_phrase(value) for value in evidence]
    requirements: set[str] = set()
    for value in normalized:
        for alias, family in PASSIVE_WEAPON_ALIASES.items():
            if re.search(rf"(?:^|_){re.escape(alias)}(?:_|$)", value):
                requirements.add(family)
        if re.search(r"(?:^|_)one_handed_weapons?(?:_|$)", value):
            requirements.add("one_handed")
        if re.search(r"(?:^|_)two_handed(?:_melee)?_weapons?(?:_|$)", value):
            requirements.add("two_handed")
        if re.search(r"(?:while_wielding|with)_(?:a_)?melee_weapons?(?:_|$)", value):
            requirements.add("melee")
        if re.search(r"(?:^|_)(?:any_)?martial_weapons?(?:_|$)", value):
            requirements.add("martial")
    if not requirements:
        return None
    live = live_weapon_metadata(core)
    known = set(PASSIVE_WEAPON_ALIASES.values()) | PASSIVE_WEAPON_CATEGORIES
    unresolved = sorted(requirements - known)
    families = requirements - PASSIVE_WEAPON_CATEGORIES
    categories = requirements & PASSIVE_WEAPON_CATEGORIES
    compatible = sorted({weapon["id"] for weapon in live
                         if (not families or weapon["id"] in families)
                         and categories.issubset(weapon["tags"])})
    return {
        "requirements_any_of": sorted(requirements),
        "compatible_weapon_family_ids": compatible,
        "unresolved_requirements": unresolved,
        "fail_closed": bool(unresolved),
    }


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
SUPPORT_TIER_RE = re.compile(r"^(?P<name>.+?)\s+(?P<tier>I|II|III|IV|V)$")
SUPPORT_TIER_VALUES = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}


def support_family_metadata(skill: dict[str, Any]) -> dict[str, Any]:
    """Return the stable family identity used to prevent tier stacking."""
    display_name = str(skill.get("name") or "").strip()
    match = SUPPORT_TIER_RE.match(display_name)
    family_name = (match.group("name") if match else display_name).strip()
    family_key = normalized_phrase(family_name or skill.get("id"))
    return {
        "id": f"support-family:{family_key}",
        "name": family_name or display_name,
        "tier": SUPPORT_TIER_VALUES.get(match.group("tier")) if match else None,
    }


def normalize_support_family_tiers(entities: list[dict[str, Any]]) -> None:
    """Treat an unnumbered base gem as tier one when numbered siblings exist."""
    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entity in entities:
        family = entity.get("support_family") or {}
        if entity.get("content_type") == "support_gem" and family.get("id"):
            by_family[str(family["id"])].append(entity)

    for members in by_family.values():
        if not any((member.get("support_family") or {}).get("tier") is not None for member in members):
            continue
        for member in members:
            family = member.get("support_family") or {}
            if family.get("tier") is None:
                family["tier"] = 1


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
    component: str | None = None,
) -> list[dict[str, Any]]:
    facts = parse_evidence(source_kind, value, subject)
    for fact in facts:
        for evidence in fact.get("evidence") or []:
            evidence["parent_entity_id"] = entity_id
            if component:
                evidence["component"] = component
            evidence["pattern_category"] = "structured_stat" if source_kind == "stat_id" else "semantic_text"
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
        semantic_sources: list[dict[str, Any]] = []

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
            component = f"statset:{stat.get('statset_rid')}" if stat.get("statset_rid") is not None else "structured_stats"
            # Only application-like structured identifiers participate in the
            # completeness audit. All stats are still parsed; excluding broad
            # scaling identifiers here keeps this diagnostic conservative.
            if re.search(r"(?:on_hit|without_hit|damage_can_(?:ignite|bleed|poison|chill|freeze|shock|electrocute)|electrocutes_as_though)", stat["id"]):
                semantic_sources.append({"kind": "stat_id", "value": stat["id"], "component": component})
            facts.extend(
                record_and_parse(
                    coverage,
                    group="skill_stats",
                    entity_id=entity_id,
                    source_kind="stat_id",
                    value=stat["id"],
                    subject=subject,
                    component=component,
                )
            )

        description = str(skill.get("description") or "").strip()
        text_sources: list[dict[str, str]] = []
        if description:
            text_sources.append({"kind": "skill_description", "value": description, "component": "base"})
        for active in skill.get("active_skills") or []:
            component = str(active.get("display_name") or active.get("name") or active.get("id") or "active_skill")
            for field in ("description", "short_description", "website_description"):
                value = str(active.get(field) or "").strip()
                if value:
                    text_sources.append({"kind": f"active_skill_{field}", "value": value, "component": component})
        for active_rid in links.get("active_skill_rids") or []:
            active = ctx.active_by_rid.get(active_rid) or {}
            component = str(active.get("DisplayedName") or active.get("Id") or f"active_skill:{active_rid}")
            for field, source_kind in (("Description", "active_skill_description"), ("ShortDescription", "active_skill_short_description"), ("WebsiteDescription", "active_skill_website_description")):
                value = str(active.get(field) or "").strip()
                if value:
                    text_sources.append({"kind": source_kind, "value": value, "component": component})
        deduped_text_sources = []
        seen_text = set()
        for source in text_sources:
            key = (source["component"], source["value"])
            if key not in seen_text:
                seen_text.add(key)
                deduped_text_sources.append(source)
        semantic_sources.extend(deduped_text_sources)
        for source in deduped_text_sources:
            facts.extend(
                record_and_parse(
                    coverage,
                    group="skill_descriptions",
                    entity_id=entity_id,
                    source_kind=source["kind"],
                    value=source["value"],
                    subject=subject,
                    component=source["component"],
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

        completeness_warnings = semantic_completeness_warnings(entity_id=entity_id, sources=semantic_sources, facts=facts)
        entities.append(
            {
                "id": entity_id,
                "content_type": content_type,
                "source_id": source_id,
                "name": skill.get("name"),
                "candidate_roles": roles,
                **({"support_family": support_family_metadata(skill)} if is_support else {}),
                "retrieval_terms": tags,
                "facts": facts,
                "compatibility": compatibility,
                **({"structured_weapon_requirements": skill.get("weapon_requirements") or {"is_unrestricted": True}}
                   if content_type == "active_skill" else {}),
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
                **({"semantic_completeness_warnings": completeness_warnings} if completeness_warnings else {}),
            }
        )
    normalize_support_family_tiers(entities)
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


def build_skill_crafting_payload(ctx: SourceContext) -> dict[str, Any]:
    crafting_by_entity_id: dict[str, dict[str, Any]] = {}
    for skill in ctx.skills:
        if skill.get("type") == "support":
            continue
        source_id = str(skill.get("id") or "")
        if not source_id:
            continue
        crafting = skill.get("crafting") if isinstance(skill.get("crafting"), dict) else {}
        types_raw = unique_sorted(crafting.get("types_raw") or [])
        weapon_requirements = (
            skill.get("weapon_requirements")
            if isinstance(skill.get("weapon_requirements"), dict)
            else {}
        )
        base_weapon_affinities = unique_sorted(crafting.get("weapon_affinities") or [])
        required_weapon_affinities = unique_sorted(
            weapon_requirements.get("allowed_weapon_tags_any_of")
            or weapon_requirements.get("mainhand_tags_any_of")
            or []
        )
        has_martial_crafting_type = any(
            str(type_name).strip().lower() in MARTIAL_CRAFTING_TYPES
            for type_name in types_raw
        )
        fallback_weapon_affinities = (
            required_weapon_affinities
            if (
                types_raw
                and not base_weapon_affinities
                and not has_martial_crafting_type
                and len(required_weapon_affinities) <= 2
            )
            else []
        )
        crafting_by_entity_id[f"skill:{source_id}"] = {
            "types_raw": types_raw,
            "schools": unique_sorted(crafting.get("schools") or []),
            "weapon_affinities": unique_sorted([
                *base_weapon_affinities,
                *fallback_weapon_affinities,
            ]),
        }

    craftable_count = sum(
        1 for crafting in crafting_by_entity_id.values()
        if crafting.get("types_raw")
    )
    return {
        "schema_version": SKILL_CRAFTING_SCHEMA_VERSION,
        "catalog_schema_version": SCHEMA_VERSION,
        "active_skill_count": len(crafting_by_entity_id),
        "craftable_active_skill_count": craftable_count,
        "crafting_by_entity_id": dict(sorted(crafting_by_entity_id.items())),
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


PASSIVE_NON_OFFENSIVE_EVIDENCE_RE = re.compile(
    r"(?:^|_)(?:resistance|damage_taken|taking_damage|recover|recovery|recoup|"
    r"regenerat|immun|avoid|prevent|reduced_damage_taken)(?:_|$)", re.I
)
PASSIVE_OFFENSIVE_EVIDENCE_RE = re.compile(
    r"(?:(?:^|_)(?:[a-z0-9]+_)*damage(?:_|$)|additional_.+_damage|damage_as_|_damage_.*_to_gain_as_|"
    r"penetrat|enemies_.+_resistance|chance_to_(?:inflict|poison|bleed|ignite|shock)|"
    r"(?:poison|bleed|ignite|shock|chill|freeze).*(?:chance|damage|duration|magnitude|effect)|"
    r"skill_gem_level)", re.I
)


def passive_fact_offense_role(fact: dict[str, Any]) -> str | None:
    """Classify a passive fact's direction without treating mechanic mention as offense."""
    relation = fact.get("relation")
    if fact.get("scope") == "incoming" or relation in {"prevents", "cannot", "removes"}:
        return None
    if relation in {"inflicts", "creates", "generates"}:
        return "setup_control"
    if relation == "consumes":
        return "payoff"
    if relation in {"converts", "provides", "modifies", "has_property"}:
        evidence_parts = [
            normalized_phrase(row.get("value"))
            for row in fact.get("evidence") or []
            if row.get("value")
        ]
        # Enemy resistance reduction is offensive; player/minion resistance is not.
        if any(
            PASSIVE_OFFENSIVE_EVIDENCE_RE.search(part)
            and (not PASSIVE_NON_OFFENSIVE_EVIDENCE_RE.search(part) or "enemies_" in part)
            for part in evidence_parts
        ):
            return "enabler"
    return None


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
        for fact in facts:
            offense_role = passive_fact_offense_role(fact)
            if offense_role:
                fact["offense_role"] = offense_role
        tags = normalize_tag_list(passive.get("tags") or [], expand=False, match_keys=False)
        required_ascendancy = passive.get("requiredAscendancy") or ascendancy
        access: dict[str, Any] = {"ascendancy": required_ascendancy} if required_ascendancy else {}
        class_override = passive.get("classOverride")
        if class_override:
            access["passive_tree_character_id"] = class_override.get("characterId")
            access["class_name"] = class_override.get("className")
            access["override_of"] = class_override.get("overrideOf")
        overridden_for_ids = passive.get("overriddenForClassIds") or []
        overridden_for_classes = passive.get("overriddenForClasses") or []
        if overridden_for_ids:
            access["overridden_for_passive_tree_character_ids"] = overridden_for_ids
            access["overridden_for_classes"] = overridden_for_classes

        weapon_compatibility = passive_weapon_compatibility(ctx.core, stats, lines)
        compatibility = {"access": access}
        if weapon_compatibility:
            compatibility["passive_weapon"] = weapon_compatibility

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
                "compatibility": compatibility,
                **({"passive_tree_starts": passive["passiveTreeStarts"]} if passive.get("passiveTreeStarts") else {}),
                **({"required_ascendancy": required_ascendancy} if required_ascendancy else {}),
                **({"class_override": class_override} if class_override else {}),
                **({"overridden_for_class_ids": overridden_for_ids,
                    "overridden_for_classes": overridden_for_classes} if overridden_for_ids else {}),
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
        "global_offense_rules": [
            rule for rule in ctx.ontology.get("offense_semantics") or []
            if rule.get("fulfills_source_from_target")
        ],
    }


def build_catalog(ctx: SourceContext) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    coverage = Coverage()
    skill_entities = build_skill_entities(ctx, coverage)
    passive_entities = build_passive_entities(ctx, coverage)
    unique_entities = build_unique_entities(ctx, coverage)
    granted_access = build_granted_skill_access_payload(ctx)
    skill_crafting = build_skill_crafting_payload(ctx)
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
    support_entities = [entity for entity in skill_entities if entity.get("content_type") == "support_gem"]
    support_family_ids = {
        (entity.get("support_family") or {}).get("id")
        for entity in support_entities
        if (entity.get("support_family") or {}).get("id")
    }
    tiered_support_family_ids = {
        (entity.get("support_family") or {}).get("id")
        for entity in support_entities
        if (entity.get("support_family") or {}).get("tier") is not None
    }
    weapon_restricted_passives = [entity for entity in passive_entities
                                  if entity.get("content_type") == "passive"
                                  and ((entity.get("compatibility") or {}).get("passive_weapon"))]
    passive_weapon_requirements = sorted({requirement for entity in weapon_restricted_passives
        for requirement in ((entity.get("compatibility") or {}).get("passive_weapon") or {}).get("requirements_any_of", [])})
    unresolved_passive_weapon_requirements = sorted({requirement for entity in weapon_restricted_passives
        for requirement in ((entity.get("compatibility") or {}).get("passive_weapon") or {}).get("unresolved_requirements", [])})

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
            "semantic_completeness_warning_count": sum(
                len(entity.get("semantic_completeness_warnings") or []) for entity in entities
            ),
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
            "support_family_count": len(support_family_ids),
            "tiered_support_family_count": len(tiered_support_family_ids),
            "tiered_support_entity_count": sum(
                1
                for entity in support_entities
                if (entity.get("support_family") or {}).get("tier") is not None
            ),
            "support_entities_with_bridge_facts": sum(
                1
                for entity in support_entities
                if any(
                    fact.get("subject") == "supported_skill"
                    and fact.get("relation") in {"creates", "inflicts", "provides", "converts"}
                    for fact in entity.get("facts") or []
                )
            ),
            "support_entities_with_conflicts": sum(
                1
                for entity in support_entities
                if any(
                    fact.get("subject") == "supported_skill" and fact.get("relation") == "prevents"
                    for fact in entity.get("facts") or []
                )
            ),
            "active_skills_with_granted_access": sum(
                1 for access in (granted_access.get("access_by_entity_id") or {}).values()
                if access.get("requires_granted_source")
            ),
            "active_skills_with_crafting_metadata": skill_crafting.get("craftable_active_skill_count"),
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
            "ordinary_notables_with_weapon_requirements": len(weapon_restricted_passives),
            "passive_weapon_requirements_represented": passive_weapon_requirements,
            "unresolved_passive_weapon_requirements": unresolved_passive_weapon_requirements,
        },
        "coverage": coverage_payload,
    }
    return catalog, report, granted_access, skill_crafting


RUNTIME_SUPPORT_ACTION_RELATIONS = {
    "fulfills", "inflicts", "creates", "provides", "generates", "converts",
}
RUNTIME_RELEVANT_SOURCE_TAGS = {"kalguuran", "derived_template", "lineage"}
RUNTIME_NON_SKILL_RETRIEVAL_TERMS = {
    "kalguuran", "prototype", "inaccessible", "dnt", "dnt_unused",
    "coming_soon", "derived_template",
}
RUNTIME_DESCRIPTION_EXCLUSION_RE = re.compile(
    r"^\s*\[?(?:DNT(?:-UNUSED)?|UNUSED|Coming\s+Soon)\]?", re.IGNORECASE
)
RUNTIME_SUPPORT_ENABLE_RE = re.compile(
    r"(?:causing|allowing) it to inflict|giving it a chance to|base_chance_to_(?:inflict_bleeding|poison_on_hit)",
    re.IGNORECASE,
)
RUNTIME_SUPPORT_FALSE_POSITIVE_RE = re.compile(
    r"skills? (?:which|that) can|inflicted (?:by|with)|shocking an enemy|chance_to_(?:shock|ignite)_\+%_final",
    re.IGNORECASE,
)
RUNTIME_SUPPORT_POTENCY_RE = re.compile(
    r"causing it to .*inflict more (?:potent|powerful)", re.IGNORECASE
)
RUNTIME_UNIQUE_PAYOFF_RE = re.compile(
    r"(?:against|affected by|all\s+\w+\s+enemies|while\s+\w+ed|if\s+\w+ed)", re.IGNORECASE
)
RUNTIME_COMPONENT_RE = re.compile(r"explod|cloud|ground|burst|projectile", re.IGNORECASE)


def _runtime_fact_evidence(fact: dict[str, Any], content_type: str) -> list[dict[str, str]]:
    """Compile verbose proof text to only the semantic markers still consumed after generation."""
    proofs = [
        proof for proof in fact.get("evidence") or []
        if str(proof.get("value") or "").strip()
    ]
    if not proofs:
        return []
    values = [str(proof.get("value") or "").lower() for proof in proofs]

    if content_type == "support_gem" and fact.get("subject") == "supported_skill" \
            and fact.get("relation") in RUNTIME_SUPPORT_ACTION_RELATIONS:
        if fact.get("relation") != "inflicts":
            return [{"value": "runtime"}]
        enabled = any(
            RUNTIME_SUPPORT_ENABLE_RE.search(value)
            and not RUNTIME_SUPPORT_FALSE_POSITIVE_RE.search(value)
            and not RUNTIME_SUPPORT_POTENCY_RE.search(value)
            for value in values
        )
        return [{"value": "allowing it to inflict" if enabled else "reference only"}]

    if content_type in {"active_skill", "unique"}:
        first = proofs[0]
        marker_parts = ["against"] if any(RUNTIME_UNIQUE_PAYOFF_RE.search(value) for value in values) else ["runtime"]
        component = RUNTIME_COMPONENT_RE.search(str(first.get("value") or ""))
        if component:
            marker_parts.append(component.group(0).lower())
        marker = {"value": " ".join(marker_parts)}
        if first.get("kind"):
            marker["kind"] = str(first["kind"])
        return [marker]
    return []


def compact_fact(fact: dict[str, Any], content_type: str) -> dict[str, Any]:
    """Project a fully evidenced generation fact onto the browser contract."""
    projected = {key: value for key, value in fact.items() if key != "evidence"}
    runtime_evidence = _runtime_fact_evidence(fact, content_type)
    if runtime_evidence:
        projected["evidence"] = runtime_evidence
    return projected


def _runtime_retrieval_terms(entity: dict[str, Any]) -> list[str]:
    terms = entity.get("retrieval_terms") or []
    if entity.get("content_type") in {"active_skill", "support_gem"}:
        return terms
    return [
        term for term in terms
        if normalized_phrase(term) in RUNTIME_NON_SKILL_RETRIEVAL_TERMS
    ]


def compact_entity(entity: dict[str, Any]) -> dict[str, Any]:
    content_type = entity.get("content_type")
    projected = {
        key: entity[key]
        for key in ("id", "content_type", "source_id", "name", "compatibility", "passive_tree_starts", "required_ascendancy")
        if key in entity
    }

    if content_type == "active_skill":
        projected["candidate_roles"] = entity.get("candidate_roles") or []
    if content_type == "support_gem" and "support_family" in entity:
        projected["support_family"] = entity["support_family"]

    retrieval_terms = _runtime_retrieval_terms(entity)
    if retrieval_terms:
        projected["retrieval_terms"] = retrieval_terms

    projected["facts"] = [compact_fact(fact, content_type) for fact in entity.get("facts") or []]

    if content_type == "active_skill":
        structured = entity.get("structured_weapon_requirements")
        equipment = (entity.get("compatibility") or {}).get("equipment")
        if structured is not None and structured != equipment:
            projected["structured_weapon_requirements"] = structured

    source = entity.get("source_evidence") or {}
    runtime_source: dict[str, Any] = {}
    description = str(source.get("description") or "")
    if description and RUNTIME_DESCRIPTION_EXCLUSION_RE.search(description):
        runtime_source["description"] = "DNT"
    if content_type == "active_skill" and "active_skill_types" in source:
        runtime_source["active_skill_types"] = source["active_skill_types"]
        effects = [
            {"cannot_be_supported": True}
            for effect in source.get("granted_effects") or []
            if effect.get("cannot_be_supported") is True
        ]
        if effects:
            runtime_source["granted_effects"] = effects
    if runtime_source:
        projected["source_evidence"] = runtime_source

    source_tags = [
        tag for tag in (entity.get("provenance") or {}).get("source_tags") or []
        if normalized_phrase(tag) in RUNTIME_RELEVANT_SOURCE_TAGS
    ]
    if source_tags:
        projected["provenance"] = {"source_tags": source_tags}
    return projected


def compact_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    """Return the deterministic, readable browser-facing projection."""
    return {
        "_meta": catalog["_meta"],
        "fate_vocabulary": catalog["fate_vocabulary"],
        "entities": [compact_entity(entity) for entity in catalog["entities"]],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the additive recommendation enrichment v3 catalog.")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--report-out", default=str(DEFAULT_REPORT_OUT))
    parser.add_argument("--access-out", default=str(DEFAULT_ACCESS_OUT))
    parser.add_argument("--crafting-out", default=str(DEFAULT_CRAFTING_OUT))
    parser.add_argument("--provenance-out", help="Optional developer-only full catalog output")
    args = parser.parse_args()

    out_path = Path(args.out)
    report_path = Path(args.report_out)
    access_path = Path(args.access_out)
    crafting_path = Path(args.crafting_out)
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path
    if not report_path.is_absolute():
        report_path = REPO_ROOT / report_path
    if not access_path.is_absolute():
        access_path = REPO_ROOT / access_path
    if not crafting_path.is_absolute():
        crafting_path = REPO_ROOT / crafting_path

    context = SourceContext(REPO_ROOT)
    catalog, report, granted_access, skill_crafting = build_catalog(context)
    if args.provenance_out:
        provenance_path = Path(args.provenance_out)
        if not provenance_path.is_absolute():
            provenance_path = REPO_ROOT / provenance_path
        write_json(provenance_path, catalog)
        print(f"Wrote full provenance catalog to {provenance_path}")
    write_json(out_path, compact_catalog(catalog))
    write_json(report_path, report)
    write_json(access_path, granted_access)
    write_json(crafting_path, skill_crafting)
    print(f"Wrote {catalog['_meta']['entity_count']} entities to {out_path}")
    print(f"Wrote semantic coverage report to {report_path}")
    print(f"Wrote granted skill access map to {access_path}")
    print(f"Wrote skill crafting map to {crafting_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
