from __future__ import annotations

import re
from typing import Any, Iterable


CONFIDENCE_ORDER = {"inferred": 0, "strong": 1, "exact": 2}

ROLE_ORDER = [
    "primary_damage",
    "setup_control",
    "payoff",
    "enabler",
    "defense",
    "recovery",
    "utility",
]

OFFENSE_MECHANICS = {
    "physical",
    "fire",
    "cold",
    "lightning",
    "chaos",
    "ignite",
    "bleed",
    "poison",
    "chill",
    "freeze",
    "shock",
    "electrocute",
    "critical_hits",
    "minion",
    "companion",
    "totem",
    "thorns",
    "damage_over_time",
}

DEFENSE_MECHANICS = {
    "armour",
    "evasion",
    "energy_shield",
    "block",
    "deflection",
    "guard",
    "runic_ward",
    "damage_reduction",
    "damage_taken_as",
    "protective_pool",
    "ailment_avoidance",
    "stun_avoidance",
    "resistance",
    "maximum_resistance",
    "elemental_resistance",
}

RECOVERY_MECHANICS = {
    "life_leech",
    "energy_shield_leech",
    "mana_leech",
    "life_regeneration",
    "mana_regeneration",
    "energy_shield_recharge",
    "life_recovery",
    "mana_recovery",
    "recoup",
    "recharge",
    "recovery_on_hit",
    "recovery_on_kill",
    "flask_recovery",
    "low_life_recovery",
    "damage_triggered_recovery",
}


# Long and compound phrases must be checked before their component words.
MECHANIC_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("non_fire_damage", ("non fire damage", "non_fire_damage")),
    ("elemental_ailments", ("elemental ailments", "elemental_ailments")),
    ("energy_shield_leech", ("energy shield leech", "energy_shield_leech")),
    ("life_regeneration", ("life regeneration", "life regen", "regenerate life", "life_regeneration", "life_regen")),
    ("mana_regeneration", ("mana regeneration", "mana regen", "mana_regeneration", "mana_regen")),
    ("energy_shield_recharge", ("energy shield recharge", "recharge energy shield", "energy_shield_recharge")),
    ("critical_hits", ("critical hits", "critical hit", "critically hit", "critical strike", "critical_strike", "critical_hits", "crit")),
    ("critical_damage", ("critical damage", "critical_damage", "criticaldamagebonus")),
    ("projectile_attack", ("projectile attack", "projectile_attack")),
    ("fully_broken_armour", ("fully broken armour", "fully_broken_armour")),
    ("armour_break", ("armour break", "broken armour", "armour_break")),
    ("runic_ward", ("runic ward", "runic_ward", "rune ward", "rune_ward")),
    ("energy_shield", ("energy shield", "energy_shield")),
    ("elemental_damage", ("elemental damage", "elemental_damage")),
    ("damage_over_time", ("damage over time", "damage_over_time", "dot damage", "dot_damage")),
    ("physical", ("physical damage", "physical_damage", "physical")),
    ("fire", ("fire damage", "fire_damage", "fire")),
    ("cold", ("cold damage", "cold_damage", "cold")),
    ("lightning", ("lightning damage", "lightning_damage", "lightning")),
    ("chaos", ("chaos damage", "chaos_damage", "chaos")),
    ("damage", ("damage",)),
    ("life_leech", ("life leech", "lifeleech", "life_leech")),
    ("mana_leech", ("mana leech", "manaleech", "mana_leech")),
    ("life_recovery", ("life recovery", "recover life", "life_recovery")),
    ("mana_recovery", ("mana recovery", "recover mana", "mana_recovery")),
    ("recoup", ("recoup",)),
    ("recharge", ("recharge",)),
    ("block", ("block",)),
    ("deflection", ("deflection", "deflect")),
    ("evasion", ("evasion", "evaded", "evade")),
    ("armour", ("armour", "armor")),
    ("guard", ("guard",)),
    ("maximum_resistance", ("maximum resistance", "maximum_resistance")),
    ("elemental_resistance", ("elemental resistances", "elemental resistance", "elemental damage resistances", "elementaldamage resistances", "elemental_resistance")),
    ("resistance", ("resistances", "resistance")),
    ("ignite", ("ignite", "ignites", "ignited", "burning")),
    ("bleed", ("bleeding", "bleed", "bleeds")),
    ("poison", ("poison", "poisons", "poisoned")),
    ("chill", ("chilled", "chill", "chills")),
    ("freeze", ("frozen", "freeze", "freezes")),
    ("shock", ("shocked", "shock", "shocks")),
    ("electrocute", ("electrocute", "electrocution", "electrocuted")),
    ("ailment", ("ailments", "ailment")),
    ("stun", ("heavy stun", "heavy_stun", "stunned", "stun")),
    ("warcry", ("warcries", "warcry")),
    ("curse", ("curses", "curse")),
    ("mark", ("marks", "mark")),
    ("maim", ("maimed", "maim")),
    ("blind", ("blinded", "blind")),
    ("pin", ("pinned", "pin")),
    ("daze", ("dazed", "daze")),
    ("hit", ("hitdamage", "hits", "hit")),
    ("attack", ("attacks", "attack")),
    ("spell", ("spells", "spell")),
    ("projectile", ("projectiles", "projectile")),
    ("melee", ("melee",)),
    ("minion", ("minions", "minion")),
    ("companion", ("companions", "companion")),
    ("totem", ("totems", "totem")),
    ("thorns", ("thorns",)),
    ("corpse", ("corpses", "corpse")),
    ("rage", ("rage",)),
    ("power_charge", ("power charges", "power_charge", "power_charges")),
    ("frenzy_charge", ("frenzy charges", "frenzy_charge", "frenzy_charges")),
    ("endurance_charge", ("endurance charges", "endurance_charge", "endurance_charges")),
    ("charge", ("charges", "charge")),
    ("elemental_infusion", ("elemental infusion", "elementalinfusion", "elemental_infusion")),
    ("infusion", ("infusions", "infusion")),
    ("remnant", ("remnants", "remnant")),
    ("spirit", ("spirit",)),
    ("mana", ("mana",)),
    ("life", ("life",)),
    ("ammunition", ("ammunition", "ammo")),
    ("dual_wield", ("dual wield", "dual_wield")),
    ("shield", ("shields", "shield")),
    ("buckler", ("bucklers", "buckler")),
    ("body_armour", ("body armour", "body armor", "body_armour")),
    ("life_flask", ("life flask", "life_flask")),
    ("minion_death", ("minion death", "minion_death")),
    ("critical_reroll", ("rerollcrit", "critical reroll", "critical_reroll")),
    ("damage_absorption", ("damage absorption", "damageabsorption", "damage_absorption")),
    ("movement_speed", ("movement speed", "movement_speed")),
    ("infernal_flame", ("infernal flame", "infernal_flame")),
]

COMPOUND_SUPPRESSIONS: dict[str, set[str]] = {
    "non_fire_damage": {"fire", "damage"},
    "elemental_ailments": {"ailment"},
    "energy_shield_leech": {"energy_shield", "life_leech"},
    "energy_shield_recharge": {"energy_shield", "recharge"},
    "energy_shield": {"shield"},
    "life_regeneration": {"life"},
    "mana_regeneration": {"mana"},
    "projectile_attack": {"projectile", "attack"},
    "fully_broken_armour": {"armour", "armour_break"},
    "armour_break": {"armour"},
    "runic_ward": set(),
    "elemental_damage": {"damage"},
    "damage_over_time": {"damage"},
    "physical": {"damage"},
    "fire": {"damage"},
    "cold": {"damage"},
    "lightning": {"damage"},
    "chaos": {"damage"},
    "life_leech": {"life"},
    "critical_hits": {"hit"},
    "critical_damage": {"damage"},
    "maximum_resistance": {"resistance"},
    "elemental_resistance": {"elemental_damage", "resistance"},
    "life_recovery": {"life"},
    "mana_recovery": {"mana"},
    "life_flask": {"life"},
    "damage_absorption": {"damage"},
    "body_armour": {"armour"},
    "power_charge": {"charge"},
    "frenzy_charge": {"charge"},
    "endurance_charge": {"charge"},
    "elemental_infusion": {"infusion"},
}


ACTIVE_SKILL_TYPE_FACTS: dict[str, list[tuple[str, str]]] = {
    "skillconsumesfreeze": [("consumes", "freeze")],
    "skillconsumesignite": [("consumes", "ignite")],
    "skillconsumesshock": [("consumes", "shock")],
    "skillconsumesbleeding": [("consumes", "bleed")],
    "skillconsumespoison": [("consumes", "poison")],
    "skillconsumesdazed": [("consumes", "daze")],
    "skillconsumesparried": [("consumes", "parry")],
    "consumesfullybrokenarmour": [("consumes", "armour_break")],
    "consumesrage": [("consumes", "rage")],
    "consumesinstillment": [("consumes", "instillment")],
    "consumescharges": [("consumes", "charge")],
    "skillconsumespowerchargesonuse": [("consumes", "power_charge")],
    "skillconsumesfrenzychargesonuse": [("consumes", "frenzy_charge")],
    "skillconsumesendurancechargesonuse": [("consumes", "endurance_charge")],
    "generatescharges": [("generates", "charge")],
    "generatesenergy": [("generates", "energy")],
    "generatesinfusion": [("generates", "infusion")],
    "generatesremnants": [("generates", "remnant")],
    "createsminion": [("creates", "minion")],
    "createscompanion": [("creates", "companion")],
    "createsundeadminion": [("creates", "minion")],
    "createsskeletonminion": [("creates", "minion")],
    "createsdemonminion": [("creates", "minion")],
    "summonstotem": [("creates", "totem")],
    "summonsattacktotem": [("creates", "totem")],
    "requirescharges": [("requires", "charge")],
    "requiresshield": [("requires", "shield")],
    "requiresbuckler": [("requires", "buckler")],
    "nodualwield": [("prevents", "dual_wield")],
    "activeblock": [("provides", "block")],
    "guard": [("provides", "guard")],
    "appliescurse": [("inflicts", "curse")],
    "appliesmaim": [("inflicts", "maim")],
    "causesburning": [("inflicts", "ignite")],
    "physical": [("has_property", "physical")],
    "fire": [("has_property", "fire")],
    "cold": [("has_property", "cold")],
    "lightning": [("has_property", "lightning")],
    "chaos": [("has_property", "chaos")],
    "damageovertime": [("has_property", "damage_over_time")],
    "minion": [("has_property", "minion")],
    "companion": [("has_property", "companion")],
    "warcry": [("has_property", "warcry")],
}

TAXONOMY_DAMAGE_TYPES = {"physical", "fire", "cold", "lightning", "chaos"}


def normalized_phrase(value: Any) -> str:
    text = str(value or "")
    # PoE reminder markup is [internal key|display label]. Preserve both: the
    # key is useful for stable matching, while the display label can be more
    # specific (for example [Ward|Runic Ward]).
    text = re.sub(r"\[([^\]|]+)\|([^\]]+)\]", r"\1 \2", text)
    text = re.sub(r"\[([^\]]+)\]", r"\1", text)
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    text = text.replace("’", "'").lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def _contains_alias(normalized: str, alias: str) -> bool:
    needle = normalized_phrase(alias)
    return bool(needle and re.search(rf"(?:^|_){re.escape(needle)}(?:_|$)", normalized))


def mechanics_in(value: Any) -> list[str]:
    normalized = normalized_phrase(value)
    found: list[str] = []
    for mechanic, aliases in MECHANIC_ALIASES:
        if mechanic in found:
            continue
        if any(_contains_alias(normalized, alias) for alias in aliases):
            found.append(mechanic)

    # Current player-facing text often shortens Runic Ward to just "Ward",
    # while several named skills use a different '<name> Ward' concept. Treat
    # the standalone resource as Runic Ward without conflating those names.
    non_runic_wards = ("sorcery_ward", "mothers_ward", "morrigan_ward")
    if (
        "runic_ward" not in found
        and _contains_alias(normalized, "ward")
        and not any(named_ward in normalized for named_ward in non_runic_wards)
    ):
        found.append("runic_ward")

    suppressed: set[str] = set()
    for compound, components in COMPOUND_SUPPRESSIONS.items():
        if compound in found:
            suppressed.update(components)
    return [mechanic for mechanic in found if mechanic not in suppressed]


def _evidence(kind: str, value: Any) -> dict[str, Any]:
    return {"kind": kind, "value": value}


def make_fact(
    relation: str,
    *,
    subject: str,
    source_kind: str,
    source_value: Any,
    mechanic: str | None = None,
    from_mechanic: str | None = None,
    to_mechanic: str | None = None,
    confidence: str = "strong",
    condition: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    fact: dict[str, Any] = {
        "relation": relation,
        "subject": subject,
        "confidence": confidence,
        "evidence": [_evidence(source_kind, source_value)],
    }
    if mechanic:
        fact["mechanic"] = mechanic
    if from_mechanic:
        fact["from"] = from_mechanic
    if to_mechanic:
        fact["to"] = to_mechanic
    if condition:
        fact["condition"] = condition
    if scope:
        fact["scope"] = scope
    return fact


def _condition_from_normalized(normalized: str) -> str | None:
    for marker in ("_unless_", "_while_", "_when_", "_if_", "_vs_"):
        if marker in normalized:
            return normalized.split(marker, 1)[1] or None
    return None


def _conversion_fact(value: Any, source_kind: str, subject: str) -> dict[str, Any] | None:
    normalized = normalized_phrase(value)
    left = right = ""
    relation = "converts"
    scope = None

    if "_converted_to_" in normalized:
        left, right = normalized.split("_converted_to_", 1)
    elif "_convert_to_" in normalized:
        left, right = normalized.split("_convert_to_", 1)
    elif "_taken_as_" in normalized:
        left, right = normalized.split("_taken_as_", 1)
        scope = "incoming"
    elif normalized.startswith("convert_all_") and "_to_" in normalized:
        left, right = normalized[len("convert_all_"):].split("_to_", 1)
    elif "convert_" in normalized and "_to_" in normalized.split("convert_", 1)[1]:
        left, right = normalized.split("convert_", 1)[1].split("_to_", 1)
    elif "_instead_of_" in normalized:
        target_text, source_text = normalized.split("_instead_of_", 1)
        # Keep replacement parsing local to the marker. Long descriptions often
        # mention unrelated mechanics earlier or later in the same paragraph.
        target_tokens = target_text.split("_")[-14:]
        source_tokens = source_text.split("_")[:14]
        left, right = "_".join(source_tokens), "_".join(target_tokens)
        relation = "replaces"
    else:
        chance_instead = re.search(r"(?:base_)?(.+?)_chance_is_(.+?)_chance_instead(?:_|$)", normalized)
        if chance_instead:
            left, right = chance_instead.group(1), chance_instead.group(2)
            relation = "replaces"

    if not left or not right:
        return None

    # Joined scraped fragments can contain a second sentence after the
    # conversion target. Do not allow that later clause to replace the target.
    right = re.split(r"_(?:deal_no|cannot|but|from|take|lose)_", right, maxsplit=1)[0]
    left = re.split(r"_(?:cannot|but|take|gain|lose)_", left, maxsplit=1)[0]

    from_mechanic = _conversion_endpoint(left, prefer="first" if relation == "replaces" else "last")
    to_mechanic = _conversion_endpoint(right, prefer="last" if relation == "replaces" else "first")
    if not from_mechanic or not to_mechanic or from_mechanic == to_mechanic:
        return None

    return make_fact(
        relation,
        subject=subject,
        source_kind=source_kind,
        source_value=value,
        from_mechanic=from_mechanic,
        to_mechanic=to_mechanic,
        confidence="exact" if source_kind in {"stat_id", "active_skill_type"} else "strong",
        condition=_condition_from_normalized(normalized) if source_kind == "stat_id" else None,
        scope=scope or ("outgoing" if relation == "converts" and "damage" in normalized else None),
    )


def _mechanic_positions(value: Any) -> dict[str, int]:
    normalized = normalized_phrase(value)
    positions: dict[str, int] = {}
    for mechanic, aliases in MECHANIC_ALIASES:
        matches = []
        for alias in aliases:
            needle = normalized_phrase(alias)
            if not needle:
                continue
            match = re.search(rf"(?:^|_){re.escape(needle)}(?:_|$)", normalized)
            if match:
                matches.append(match.start())
        if matches:
            positions[mechanic] = min(matches)

    suppressed: set[str] = set()
    for compound, components in COMPOUND_SUPPRESSIONS.items():
        if compound in positions:
            suppressed.update(components)
    return {mechanic: position for mechanic, position in positions.items() if mechanic not in suppressed}


def _conversion_endpoint(value: Any, *, prefer: str) -> str | None:
    positions = _mechanic_positions(value)
    priority_groups = [
        {"energy_shield_leech", "life_leech", "mana_leech"},
        {"non_fire_damage", "elemental_damage", "physical", "fire", "cold", "lightning", "chaos"},
        {"movement_speed", "infernal_flame"},
        {"life", "mana", "energy_shield", "spirit"},
        {"block", "deflection", "runic_ward"},
        {"rage", "power_charge", "frenzy_charge", "endurance_charge"},
        {"damage"},
        {"attack", "spell", "hit", "warcry"},
        {"shield", "body_armour", "charge"},
    ]
    for group in priority_groups:
        candidates = [(position, mechanic) for mechanic, position in positions.items() if mechanic in group]
        if candidates:
            candidates.sort()
            return candidates[0 if prefer == "first" else -1][1]
    if not positions:
        return None
    ordered = sorted((position, mechanic) for mechanic, position in positions.items())
    return ordered[0 if prefer == "first" else -1][1]


def _negative_scope(normalized: str) -> str:
    if "body_armour" in normalized:
        return "self"
    if any(marker in normalized for marker in ("cannot_inflict", "cannot_cause", "deal_no", "cannot_use", "cannot_generate")):
        return "outgoing"
    if normalized.startswith("take_no_") or normalized.startswith("damage_taken_"):
        return "incoming"
    if "_cannot_be_" in f"_{normalized}_" or normalized.startswith("cannot_be_"):
        return "incoming"
    if "prevent" in normalized and any(marker in normalized for marker in ("inflict", "cause", "deal", "use")):
        return "outgoing"
    if re.search(r"(?:^|_)cannot_(?:poison|ignite|bleed|chill|freeze|shock|electrocute)(?:_|$)", normalized):
        return "outgoing"
    return "self"


def _negative_mechanics(value: Any, *, source_kind: str) -> list[str]:
    normalized = normalized_phrase(value)
    if re.search(r"(?:^|_)(?:base_)?deal_no_damage_over_time(?:_|$)", normalized):
        return ["damage_over_time"]
    if re.search(r"(?:^|_)deal_no_non_fire_damage(?:_|$)", normalized):
        return ["non_fire_damage"]
    if re.search(r"(?:^|_)(?:deal_)?no_elemental_damage(?!_resistance)(?:_|$)", normalized):
        return ["elemental_damage"]
    if re.search(r"(?:^|_)(?:deal_)?no_physical_damage(?:_|$)", normalized):
        return ["physical"]
    if re.search(r"(?:^|_)(?:deal_)?no_chaos_damage(?:_|$)", normalized):
        return ["chaos"]
    if "cannot_use_projectile_attack" in normalized:
        return ["projectile_attack"]

    # "Damage prevented" describes mitigation, not a prohibition. Likewise,
    # removing a penalty/loss is positive and must not become a negative fact.
    if any(marker in normalized for marker in ("_prevented_by_", "_you_prevent_", "damage_prevented_", "amount_of_hit_damage_prevented")):
        return []
    if re.search(r"(?:^|_)no_(?:[^_]+_){0,5}(?:penalty|loss)(?:_|$)", normalized):
        return []

    precise = re.search(
        r"(?:cannot|prevent|prevents|prevented|preventing)_(?:[^_]+_){0,5}?(?:inflict|inflicting|cause|causing|use)_([^.;]+)",
        normalized,
    )
    if precise:
        return mechanics_in(precise.group(1))

    if "cannot_load_or_fire_ammunition" in normalized:
        return ["ammunition"]
    if "cannot_consume_power_frenzy_endurance_charges" in normalized:
        return ["power_charge", "frenzy_charge", "endurance_charge"]
    if "cannot_miss" in normalized or normalized.startswith("disable_rare_mod_"):
        return []
    if "hits_cannot_be_evaded" in normalized or "enemies_cannot_evade" in normalized:
        return ["evasion"]
    if "enemies_cannot_regenerate_life" in normalized:
        return ["life_regeneration"]
    if "enemies_you_curse_cannot_recharge_energy_shield" in normalized:
        return ["energy_shield_recharge"]
    if "your_life_cannot_change" in normalized:
        return ["life"]
    if "cannot_have_more_than_1_damaging_ailment" in normalized:
        return []
    if "cannot_evade" in normalized:
        return ["evasion"]
    if "cannot_break_armour" in normalized:
        return ["armour_break"]
    if "cannot_regenerate_mana" in normalized:
        return ["mana_regeneration"]
    if "cannot_use_life_flask" in normalized:
        return ["life_flask"]
    if "cannot_die" in normalized and "minion" in normalized:
        return ["minion_death"]
    if "cannot_be_rerollcrit" in normalized or "cannot_be_reroll_crit" in normalized:
        return ["critical_reroll"]
    if "take_no_extra_damage_from_critical" in normalized:
        return ["critical_damage"]
    if "cannot_recover_life_to_above_low_life" in normalized:
        return ["life_recovery"]
    if "cannot_recover_mana" in normalized:
        return ["mana_recovery"]

    cannot_be = re.search(r"(?:^|_)cannot_be_(.+)$", normalized)
    if cannot_be:
        target = re.split(r"_(?:by|while|if|for|after|during|from)_", cannot_be.group(1), maxsplit=1)[0]
        return mechanics_in(target)

    have_no = re.search(r"(?:^|_)(?:you_)?have_no_(.+)$", normalized)
    if have_no:
        target = re.split(r"_(?:while|if|for|during|from)_", have_no.group(1), maxsplit=1)[0]
        return mechanics_in(target)

    # Stat identifiers are atomic and can safely fall back to the direct tail.
    # Long human-readable clauses cannot: unrelated mechanics may follow.
    if source_kind != "stat_id":
        return []
    marker = re.search(
        r"(?:^|_)(?:cannot|never|prevent|prevents|prevented|preventing|disable|disabled|no)(?:_|$)",
        normalized,
    )
    if not marker:
        return []
    return mechanics_in(normalized[marker.end():])


def parse_active_skill_type(value: Any, subject: str = "skill") -> list[dict[str, Any]]:
    normalized = normalized_phrase(value).replace("_", "")
    facts = []
    for relation, mechanic in ACTIVE_SKILL_TYPE_FACTS.get(normalized, []):
        facts.append(
            make_fact(
                relation,
                subject=subject,
                source_kind="active_skill_type",
                source_value=value,
                mechanic=mechanic,
                confidence="exact",
                scope="outgoing" if relation in {"inflicts", "prevents"} else None,
            )
        )
    return facts


def parse_taxonomy_damage_type(value: Any, subject: str = "skill") -> list[dict[str, Any]]:
    """Parse the enriched skill taxonomy's canonical damage-type field.

    This field is stronger than a retrieval tag: enrichment derives it from
    structured gem taxonomy. It proves the skill's damage carrier, but it does
    not prove that the skill applies the corresponding ailment.
    """
    mechanic = normalized_phrase(value)
    if mechanic not in TAXONOMY_DAMAGE_TYPES:
        return []
    return [
        make_fact(
            "has_property",
            subject=subject,
            source_kind="taxonomy_damage_type",
            source_value=value,
            mechanic=mechanic,
            confidence="exact",
        )
    ]


def parse_stat_id(value: Any, subject: str = "player") -> list[dict[str, Any]]:
    normalized = normalized_phrase(value)
    if not normalized:
        return []

    if (
        normalized.startswith("display_")
        or "_no_display" in normalized
        or normalized.startswith("disable_visual_")
        or normalized.startswith("show_")
    ):
        return []

    facts: list[dict[str, Any]] = []
    conversion = _conversion_fact(value, "stat_id", subject)
    if conversion:
        facts.append(conversion)

    if "cannot_have_more_than_1_damaging_ailment" in normalized:
        facts.append(
            make_fact(
                "modifies",
                subject=subject,
                source_kind="stat_id",
                source_value=value,
                mechanic="damaging_ailment_limit",
                confidence="exact",
            )
        )
        return merge_facts(facts)

    explicit_no = bool(
        re.search(r"(?:^|_)(?:base_)?deal_no_(?:damage|physical|fire|cold|lightning|chaos|elemental)", normalized)
        or re.search(r"(?:^|_)no_inherent_(?:mana|life|energy_shield)", normalized)
    )
    negative = bool(
        re.search(r"(?:^|_)(cannot|never|prevent|prevents|prevented|preventing|disable|disabled|suppress|suppressed)(?:_|$)", normalized)
        or explicit_no
    )
    if negative:
        negative_mechanics = _negative_mechanics(value, source_kind="stat_id")
        fact_subject = subject
        if (
            normalized.startswith(("bleeding_enemies_", "broken_armour_enemies_", "pinned_enemies_"))
            or normalized.startswith("hits_cannot_be_evaded")
            or normalized.startswith("enemies_you_curse_")
        ):
            fact_subject = "enemy"
        for mechanic in negative_mechanics:
            scope = _negative_scope(normalized)
            if fact_subject == "enemy":
                scope = "target"
            elif "_on_self" in normalized:
                scope = "incoming"
            elif subject in {"skill", "supported_skill"} and mechanic in {
                "ignite",
                "bleed",
                "poison",
                "chill",
                "freeze",
                "shock",
                "electrocute",
                "armour_break",
                "stun",
                "pin",
                "daze",
                "critical_hits",
            } and "cannot_be_" not in normalized:
                scope = "outgoing"
            condition = _condition_from_normalized(normalized)
            if normalized.startswith("cannot_damage_"):
                condition = f"target_is_{normalized.split('cannot_damage_', 1)[1]}"
            elif normalized == "base_deal_no_damage":
                # Many active gems delegate damage to a spawned hazard,
                # ammunition effect, or linked subskill. This stat describes
                # only the parent effect and must not prohibit the entity from
                # serving as a primary damage recommendation.
                condition = "base_effect_only"
            facts.append(
                make_fact(
                    "prevents",
                    subject=fact_subject,
                    source_kind="stat_id",
                    source_value=value,
                    mechanic=mechanic,
                    confidence="exact",
                    condition=condition,
                    scope=scope,
                )
            )
        return merge_facts(facts)

    if "consume" in normalized:
        for mechanic in mechanics_in(value):
            if mechanic not in {"damage", "attack", "spell", "hit"}:
                facts.append(
                    make_fact(
                        "consumes",
                        subject=subject,
                        source_kind="stat_id",
                        source_value=value,
                        mechanic="armour_break" if mechanic == "fully_broken_armour" else mechanic,
                        confidence="exact",
                        condition=_condition_from_normalized(normalized),
                    )
                )

    stat_mechanics = mechanics_in(value)
    if "runic_ward" in stat_mechanics:
        is_ward_cost = bool(
            re.search(r"(?:^|_)(?:base_skill_)?ward_cost(?:_|$)", normalized)
            or re.search(r"(?:^|_)ward_spend|ward_spent(?:_|$)", normalized)
            or normalized.startswith("support_slam_spend_")
        )
        if is_ward_cost:
            facts.extend(
                [
                    make_fact(
                        "consumes",
                        subject=subject,
                        source_kind="stat_id",
                        source_value=value,
                        mechanic="runic_ward",
                        confidence="exact",
                    ),
                    make_fact(
                        "requires",
                        subject=subject,
                        source_kind="stat_id",
                        source_value=value,
                        mechanic="runic_ward",
                        confidence="exact",
                    ),
                ]
            )
        elif "requires" in normalized:
            facts.append(
                make_fact(
                    "requires",
                    subject=subject,
                    source_kind="stat_id",
                    source_value=value,
                    mechanic="runic_ward",
                    confidence="exact",
                )
            )

        if re.search(r"(?:gain|recover|restore)(?:_[a-z0-9%]+){0,8}_(?:as_)?ward(?:_|$)", normalized):
            facts.append(
                make_fact(
                    "provides",
                    subject=subject,
                    source_kind="stat_id",
                    source_value=value,
                    mechanic="runic_ward",
                    confidence="exact",
                )
            )

    if re.search(r"(?:chance_to_|always_)(?:cause_|inflict_)?(?:ignite|bleed|bleeding|poison|chill|freeze|shock|electrocute)", normalized):
        for mechanic in mechanics_in(value):
            if mechanic in {"ignite", "bleed", "poison", "chill", "freeze", "shock", "electrocute"}:
                facts.append(
                    make_fact(
                        "inflicts",
                        subject=subject,
                        source_kind="stat_id",
                        source_value=value,
                        mechanic=mechanic,
                        confidence="strong",
                        condition=_condition_from_normalized(normalized),
                        scope="outgoing",
                    )
                )

    for mechanic in stat_mechanics:
        if mechanic in DEFENSE_MECHANICS | RECOVERY_MECHANICS | OFFENSE_MECHANICS:
            if mechanic == "runic_ward" and is_ward_cost:
                continue
            facts.append(
                make_fact(
                    "modifies",
                    subject=subject,
                    source_kind="stat_id",
                    source_value=value,
                    mechanic=mechanic,
                    confidence="strong",
                    condition=_condition_from_normalized(normalized),
                )
            )

    return merge_facts(facts)


AILMENT_TEXT_TERMS: dict[str, str] = {
    "ignite": r"ignite|ignites|igniting",
    "bleed": r"bleed|bleeds|bleeding",
    "poison": r"poison|poisons|poisoning",
    "chill": r"chill|chills|chilling",
    "freeze": r"freeze|freezes|freezing",
    "shock": r"shock|shocks|shocking",
    "electrocute": r"electrocute|electrocutes|electrocuting|electrocution",
}


def _consume_mechanics_from_text(normalized: str) -> list[str]:
    consumed: list[str] = []
    marker = re.compile(r"(?:^|_)(?:consume|consumes|consuming|consumed)(?:_|$)")
    boundary = re.compile(
        r"_(?:to|on|but|when|while|if|after|before|causing|causes|cause|grant|grants|trigger|triggers|reload|reloads)(?:_|$)"
    )
    for match in marker.finditer(normalized):
        tail = normalized[match.end():]
        local = boundary.split(tail, maxsplit=1)[0]
        local = "_".join(local.split("_")[:18])
        consumed.extend(mechanics_in(local))
    return list(dict.fromkeys(consumed))


def _has_direct_ailment_application(normalized: str, mechanic: str) -> bool:
    application = re.compile(
        rf"(?:^|_){mechanic}(?:_(?:all|nearby))?_(?:enemy|enemies|target|targets)(?:_|$)"
    )
    contextual_reference = re.compile(
        r"(?:when_you|if_you|whenever_you|skills?_which|skills?_that_can|"
        r"can|cannot|unable_to|against|all|blind)$"
    )
    for match in application.finditer(normalized):
        prefix = normalized[:match.start()].rstrip("_")
        nearby_context = bool(
            re.search(r"(?:when|if|whenever)_you(?:_[a-z0-9]+){0,8}$", prefix)
            or re.search(r"skills?(?:_[a-z0-9]+){0,4}_(?:which|that_can)(?:_[a-z0-9]+){0,4}$", prefix)
        )
        if not nearby_context and not contextual_reference.search(prefix):
            return True
    return False


def _text_ailment_facts(
    text: str,
    normalized: str,
    *,
    source_kind: str,
    subject: str,
) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for mechanic, terms in AILMENT_TEXT_TERMS.items():
        buildup = bool(
            re.search(
                rf"(?:apply|applies|applying|contribute|contributes|contributing)"
                rf"(?:_[a-z0-9]+){{0,5}}_(?:{terms})(?:_[a-z0-9]+){{0,2}}_buildup(?:_|$)",
                normalized,
            )
        )
        if buildup:
            facts.append(
                make_fact(
                    "provides",
                    subject=subject,
                    source_kind=source_kind,
                    source_value=text,
                    mechanic=mechanic,
                    confidence="strong",
                    scope="outgoing",
                )
            )

        explicit_application = bool(
            re.search(
                rf"(?:always|chance_to|chance_to_cause|inflict|inflicts|inflicting|causing_them_to)"
                rf"(?:_[a-z0-9]+){{0,8}}_(?:{terms})(?:_|$)",
                normalized,
            )
            or _has_direct_ailment_application(normalized, mechanic)
        )

        delivered_environment = False
        if mechanic == "chill":
            delivered_environment = bool(
                re.search(
                    r"(?:leave|leaves|leaving|create|creates|creating)"
                    r"(?:_[a-z0-9]+){0,8}_chilled_ground(?:_|$)",
                    normalized,
                )
            )
        elif mechanic == "shock":
            delivered_environment = bool(
                re.search(
                    r"(?:leave|leaves|leaving|create|creates|creating)"
                    r"(?:_[a-z0-9]+){0,8}_shocked_ground(?:_|$)",
                    normalized,
                )
            )
        elif mechanic == "poison":
            delivered_environment = bool(
                re.search(
                    r"(?:cause|causes|causing|create|creates|creating|leave|leaves|leaving|release|releases)"
                    r"(?:_[a-z0-9]+){0,10}_poison(?:_poison)?_(?:gas|cloud)(?:_|$)",
                    normalized,
                )
            )

        if explicit_application or delivered_environment:
            facts.append(
                make_fact(
                    "inflicts",
                    subject=subject,
                    source_kind=source_kind,
                    source_value=text,
                    mechanic=mechanic,
                    confidence="exact" if "always" in normalized or "inflict" in normalized else "strong",
                    scope="outgoing",
                )
            )
    return facts


def parse_text(value: Any, source_kind: str, subject: str) -> list[dict[str, Any]]:
    text = str(value or "").strip()
    normalized = normalized_phrase(text)
    if not normalized:
        return []

    facts: list[dict[str, Any]] = []
    conversion = _conversion_fact(text, source_kind, subject)
    if conversion:
        facts.append(conversion)

    negative_mechanics = _negative_mechanics(text, source_kind=source_kind)
    is_prohibition = bool(negative_mechanics)
    if is_prohibition:
        fact_subject = "enemy" if normalized.startswith("enemies_") or "targets_from_inflicting" in normalized else subject
        for mechanic in negative_mechanics:
            facts.append(
                make_fact(
                    "prevents",
                    subject=fact_subject,
                    source_kind=source_kind,
                    source_value=text,
                    mechanic=mechanic,
                    confidence="exact",
                    condition=_condition_from_normalized(normalized),
                    scope=_negative_scope(normalized),
                )
            )

    if "consume" in normalized:
        consumed = _consume_mechanics_from_text(normalized)
        if "elemental_infusion" in consumed:
            consumed = ["elemental_infusion"]
        for mechanic in consumed:
            if mechanic not in {"damage", "attack", "spell", "hit"}:
                facts.append(
                    make_fact(
                        "consumes",
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic="armour_break" if mechanic == "fully_broken_armour" else mechanic,
                        confidence="strong",
                    )
                )

    stored_damage_requirement = re.search(
        r"(?:store|stores|stored|storing)(?:_[a-z0-9]+){0,10}_(ignite|bleed|poison)_damage_(?:you_)?(?:deal|dealt)",
        normalized,
    )
    if stored_damage_requirement:
        facts.append(
            make_fact(
                "requires",
                subject=subject,
                source_kind=source_kind,
                source_value=text,
                mechanic=stored_damage_requirement.group(1),
                confidence="strong",
            )
        )

    if not is_prohibition:
        facts.extend(
            _text_ailment_facts(
                text,
                normalized,
                source_kind=source_kind,
                subject=subject,
            )
        )

    if re.search(r"(?:^|_)on_hit(?:_|$)", normalized) and ("always" in normalized or "chance" in normalized):
        facts.append(
            make_fact(
                "requires",
                subject=subject,
                source_kind=source_kind,
                source_value=text,
                mechanic="hit",
                confidence="strong",
            )
        )

    positive_mechanics = mechanics_in(text)
    if not is_prohibition:
        if "runic_ward" in positive_mechanics:
            ward_reference = r"(?:ward_)?runic_ward|ward"
            ward_consume_match = re.search(
                rf"(?:spend|spends|spending|spent|expend|expends|sacrifice|sacrifices|lose|loses|drain|drains|draining|cost|costs)(?:_[a-z0-9]+){{0,8}}_(?:{ward_reference})(?:_|$)",
                normalized,
            )
            ward_consumed = bool(
                (
                    ward_consume_match
                    and not re.search(
                        r"(?:^|_)(?:recover|recovers|recovered|gain|gains|grant|grants|generate|generates|restore|restores)(?:_|$)",
                        ward_consume_match.group(0),
                    )
                )
                or re.search(r"(?:ward_)?runic_ward_cost(?:_|$)", normalized)
            )
            if ward_consumed:
                facts.append(
                    make_fact(
                        "consumes",
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic="runic_ward",
                        confidence="strong",
                    )
                )

            ward_required = bool(
                re.search(rf"(?:requires?|need|needs|enough)(?:_[a-z0-9]+){{0,8}}_(?:{ward_reference})(?:_|$)", normalized)
                or re.search(rf"(?:{ward_reference})(?:_[a-z0-9]+){{0,5}}_(?:required|needed)(?:_|$)", normalized)
            )
            if ward_required:
                facts.append(
                    make_fact(
                        "requires",
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic="runic_ward",
                        confidence="strong",
                    )
                )

            ward_provided = bool(
                re.search(
                    rf"(?:recover|recovers|recovered|restore|restores|regenerate|regenerates)(?:_[a-z0-9]+){{0,8}}_(?:{ward_reference})(?:_|$)",
                    normalized,
                )
                or re.search(
                    rf"(?:gain|gains|grant|grants|generate|generates)(?:_[a-z0-9]+){{0,3}}_(?:{ward_reference})(?:_|$)",
                    normalized,
                )
                or re.search(rf"(?:{ward_reference})(?:_[a-z0-9]+){{0,5}}_(?:recovered|restored|overflow)(?:_|$)", normalized)
            ) and not bool(re.search(rf"(?:{ward_reference})_cost(?:_|$)", normalized))
            if ward_provided:
                facts.append(
                    make_fact(
                        "provides",
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic="runic_ward",
                        confidence="strong",
                    )
                )

            if re.search(rf"(?:maximum|increased|more|reduced|recovery|overflow)(?:_[a-z0-9]+){{0,6}}_(?:{ward_reference})(?:_|$)", normalized):
                facts.append(
                    make_fact(
                        "modifies",
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic="runic_ward",
                        confidence="strong",
                    )
                )

        for mechanic in positive_mechanics:
            if mechanic in RECOVERY_MECHANICS:
                relation = "provides" if re.search(r"leech|recoup|regenerate|recover", normalized) else "modifies"
                facts.append(
                    make_fact(
                        relation,
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic=mechanic,
                        confidence="strong",
                    )
                )
            elif (
                mechanic in DEFENSE_MECHANICS
                and mechanic != "runic_ward"
                and re.search(r"gain|grants?|chance|rating|reduction|ward|block|deflect", normalized)
            ):
                facts.append(
                    make_fact(
                        "modifies",
                        subject=subject,
                        source_kind=source_kind,
                        source_value=text,
                        mechanic=mechanic,
                        confidence="strong",
                    )
                )

    return merge_facts(facts)


def parse_evidence(source_kind: str, value: Any, subject: str) -> list[dict[str, Any]]:
    if source_kind == "active_skill_type":
        return parse_active_skill_type(value, subject=subject)
    if source_kind == "taxonomy_damage_type":
        return parse_taxonomy_damage_type(value, subject=subject)
    if source_kind == "stat_id":
        return parse_stat_id(value, subject=subject)
    return parse_text(value, source_kind=source_kind, subject=subject)


def _semantic_key(fact: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(
        (key, _hashable(fact.get(key)))
        for key in ("relation", "subject", "mechanic", "from", "to", "condition", "scope")
        if key in fact
    )


def _hashable(value: Any) -> Any:
    if isinstance(value, dict):
        return tuple((key, _hashable(value[key])) for key in sorted(value))
    if isinstance(value, list):
        return tuple(_hashable(item) for item in value)
    return value


def merge_facts(facts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for fact in facts:
        key = _semantic_key(fact)
        if key not in merged:
            merged[key] = {**fact, "evidence": list(fact.get("evidence") or [])}
            continue
        current = merged[key]
        if CONFIDENCE_ORDER.get(fact.get("confidence", "inferred"), 0) > CONFIDENCE_ORDER.get(current.get("confidence", "inferred"), 0):
            current["confidence"] = fact["confidence"]
        seen = {(entry.get("kind"), str(entry.get("value"))) for entry in current.get("evidence") or []}
        for evidence in fact.get("evidence") or []:
            evidence_key = (evidence.get("kind"), str(evidence.get("value")))
            if evidence_key not in seen:
                current.setdefault("evidence", []).append(evidence)
                seen.add(evidence_key)

    return sorted(
        merged.values(),
        key=lambda fact: (
            fact.get("relation", ""),
            fact.get("mechanic", ""),
            fact.get("from", ""),
            fact.get("to", ""),
            fact.get("subject", ""),
        ),
    )


def candidate_roles(
    *,
    content_type: str,
    facts: Iterable[dict[str, Any]],
    active_skill_types: Iterable[str] = (),
) -> list[str]:
    active_types = {normalized_phrase(value).replace("_", "") for value in active_skill_types}
    facts_list = list(facts)
    mechanics = {fact.get("mechanic") for fact in facts_list if fact.get("mechanic")}
    relations = {fact.get("relation") for fact in facts_list}
    positive_relations = {"fulfills", "inflicts", "provides", "modifies", "generates", "creates", "has_property"}
    positive_mechanics = {
        fact.get("mechanic")
        for fact in facts_list
        if fact.get("mechanic") and fact.get("relation") in positive_relations
    }
    produced_mechanics = {
        fact.get("to")
        for fact in facts_list
        if fact.get("to") and fact.get("relation") in {"converts", "replaces"}
    }
    roles: set[str] = set()

    direct_damage_types = {"physical", "fire", "cold", "lightning", "chaos", "damage_over_time"}
    utility_delivery_types = {"appliescurse", "mark", "offering", "guard", "activeblock", "meta"}
    is_primary_damage_candidate = bool(
        "damage" in active_types
        or "attack" in active_types
        or "damageovertime" in active_types
        or (
            "spell" in active_types
            and positive_mechanics & direct_damage_types
            and not active_types & utility_delivery_types
        )
        or (
            relations & {"creates"}
            and positive_mechanics & {"minion", "companion", "totem"}
            and not active_types & {"offering", "meta", "triggered"}
        )
    )
    if content_type == "active_skill" and is_primary_damage_candidate:
        roles.add("primary_damage")
    if "inflicts" in relations or "generates" in relations or ({"curse", "mark", "maim", "wall", "hazard"} & mechanics):
        roles.add("setup_control")
    if "consumes" in relations:
        roles.add("payoff")
    if content_type == "support_gem" or (
        content_type in {"passive", "ascendancy_passive", "keystone", "unique"}
        and (positive_mechanics | produced_mechanics) & OFFENSE_MECHANICS
    ):
        roles.add("enabler")
    if (positive_mechanics | produced_mechanics) & DEFENSE_MECHANICS:
        roles.add("defense")
    if any(fact.get("relation") == "prevents" and fact.get("scope") == "incoming" for fact in facts_list):
        roles.add("defense")
    if (positive_mechanics | produced_mechanics) & RECOVERY_MECHANICS:
        roles.add("recovery")
    if content_type == "active_skill" and ({"movement", "travel", "aura", "buff", "warcry", "persistent"} & active_types):
        roles.add("utility")
    return [role for role in ROLE_ORDER if role in roles]


def fact_matches(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    return all(actual.get(key) == value for key, value in expected.items())
