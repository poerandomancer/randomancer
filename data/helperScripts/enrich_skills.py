#!/usr/bin/env python3
"""enrich_skills.py (skills_enriched v2)

Builds `data/enriched/skills_enriched.json` from PoE2 datamined table exports.

Expected inputs (preferred):

  data/datamined/skills_tables/
    - skillgems.json
    - skillgemsupports.json
    - activeskills.json
    - activeskilltype.json
    - activeskillweaponrequirement.json
    - baseitemtypes.json
    - gemeffects.json
    - gemtags.json
    - grantedeffects.json
    - skillcraftingdata.json

Optional (not required for v2):
  - grantedeffectstatsets.json

Notes
-----
* Weapon gating is derived from `activeskillweaponrequirement.WieldableClasses`.
* We add `weapon_requirements.wieldable_classes` and computed tag gates:
    - mainhand_tags_any_of
    - offhand_tags_any_of
    - allowed_weapon_tags_any_of
* Some "game rules" are not encoded in WeaponRequirements (e.g. most spells
  have no explicit weapon requirement). Those remain frontend hard rules.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

from lib.tag_normalization import canonicalize_tag, normalize_tag_list


# --------------------------- Tag normalization ---------------------------

def norm_tag(s: Any) -> str:
    return canonicalize_tag(s) or ""


def uniq_canonical(tags: Iterable[Any]) -> List[str]:
    return normalize_tag_list(list(tags), expand=False, match_keys=False)


# ---------- effect tag derivation (from GrantedEffect stat sets) ----------

# NOTE: stat Ids are usually snake_case, so avoid strict word-boundary () regex.
# We also ignore negative/disable stats (e.g. 'cannot_inflict_elemental_ailments') to avoid misleading tags.

_EFFECT_PATTERNS = [
    # ailments / status
    (re.compile(r'ignite|chance_to_ignite|burn|burning', re.I), ['ignite']),
    (re.compile(r'poison|chance_to_poison', re.I), ['poison']),
    (re.compile(r'bleed|bleeding|chance_to_bleed', re.I), ['bleeding', 'bleed']),
    (re.compile(r'shock|chance_to_shock', re.I), ['shock']),
    (re.compile(r'electrocute', re.I), ['electrocute', 'shock']),
    (re.compile(r'freeze|chance_to_freeze|chill', re.I), ['freeze', 'chill']),

    # tactics / mechanics
    (re.compile(r'totem', re.I), ['totem', 'totems']),
    (re.compile(r'ballista', re.I), ['ballista', 'totem']),
    (re.compile(r'minion', re.I), ['minion', 'minions']),
    (re.compile(r'corpse', re.I), ['corpse', 'corpses']),
    (re.compile(r'offering', re.I), ['offering', 'offerings']),
    (re.compile(r'grenade', re.I), ['grenade', 'grenades']),
    (re.compile(r'projectile', re.I), ['projectile', 'projectiles']),
    (re.compile(r'warcry', re.I), ['warcry']),
    (re.compile(r'slam', re.I), ['slam']),
    (re.compile(r'shockwave', re.I), ['shockwave']),
    (re.compile(r'aftershock', re.I), ['aftershock']),
    (re.compile(r'runic_ward|(?:^|_)ward(?:_|$)', re.I), ['ward', 'runic_ward']),
]

_NEGATIVE_MARKERS = ('cannot', 'prevent', 'disable', 'suppresses', 'suppressed')


def effect_tags_from_stat_id(stat_id: str) -> List[str]:
    if not stat_id:
        return []

    s = str(stat_id)
    low = s.lower()

    # Skip negative/disable stats to avoid implying the opposite effect.
    if any(m in low for m in _NEGATIVE_MARKERS):
        return []

    out: List[str] = []
    for rx, tags in _EFFECT_PATTERNS:
        if rx.search(low):
            for t in tags:
                nt = norm_tag(t)
                if nt and nt not in out:
                    out.append(nt)
    return out


def derive_effect_tags_from_granted_effects(
    granted_effect_rids: List[int],
    granted_by_rid: Dict[int, Dict[str, Any]],
    statsets_by_rid: Dict[int, Dict[str, Any]],
    stat_id_by_rid: Dict[int, str]
) -> List[str]:
    if not granted_effect_rids or not statsets_by_rid or not stat_id_by_rid:
        return []

    tags: List[str] = []
    seen = set()

    def add_tag(t: str):
        nt = norm_tag(t)
        if nt and nt not in seen:
            tags.append(nt)
            seen.add(nt)

    for gr in granted_effect_rids:
        row = granted_by_rid.get(gr)
        if not row:
            continue
        sets: List[int] = []
        ss = row.get('StatSet')
        if isinstance(ss, int):
            sets.append(ss)
        addl = row.get('AdditionalStatSets')
        if isinstance(addl, list):
            sets.extend([x for x in addl if isinstance(x, int)])

        for ssid in sets:
            ssrow = statsets_by_rid.get(ssid)
            if not ssrow:
                continue
            stat_rids: List[int] = []
            for k in ('ImplicitStats', 'ConstantStats'):
                v = ssrow.get(k)
                if isinstance(v, list):
                    stat_rids.extend([x for x in v if isinstance(x, int)])

            for srid in stat_rids:
                sid = stat_id_by_rid.get(srid, '')
                for t in effect_tags_from_stat_id(sid):
                    add_tag(t)

    return tags


def extract_bracket_tags(text: Any) -> List[str]:
    found: List[str] = []
    for inner in re.findall(r"\[([^\]]+)\]", str(text or "")):
        parts = [p.strip() for p in inner.split("|") if p.strip()]
        for p in parts:
            n = norm_tag(p)
            if n and n not in found:
                found.append(n)
    return found


# --------------------------- IO helpers ---------------------------


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def idx_by_rid(rows: List[Mapping[str, Any]]) -> Dict[int, Mapping[str, Any]]:
    out: Dict[int, Mapping[str, Any]] = {}
    for r in rows:
        rid = r.get("_rid")
        if isinstance(rid, int):
            out[rid] = r
    return out


# --------------------------- Weapon requirement mapping ---------------------------


OFFHAND_TAGS = {"shield", "thrown_shield", "buckler", "quiver", "focus"}


# These paths are the stable BaseItemType IDs for the 23 Kalguuran skills and
# seven Kalguuran supports introduced in 0.5. They remain in enriched data and
# the Codex, while the frontend uses this source tag to keep them out of Build.
KALGUURAN_BASE_ITEM_IDS = frozenset({
    "Metadata/Items/Gems/SkillGemAnimusExchange",
    "Metadata/Items/Gems/SkillGemAnimusSplinters",
    "Metadata/Items/Gems/SkillGemBitterDead",
    "Metadata/Items/Gems/SkillGemConductiveRunes",
    "Metadata/Items/Gems/SkillGemDetonateLiving",
    "Metadata/Items/Gems/SkillGemEternalMarch",
    "Metadata/Items/Gems/SkillGemExplosiveTransmutation",
    "Metadata/Items/Gems/SkillGemFragmentsOfThePast",
    "Metadata/Items/Gems/SkillGemFrostflameNova",
    "Metadata/Items/Gems/SkillGemGrimPillars",
    "Metadata/Items/Gems/SkillGemHollowShell",
    "Metadata/Items/Gems/SkillGemLeylines",
    "Metadata/Items/Gems/SkillGemPoweredByVerisium",
    "Metadata/Items/Gems/SkillGemRainOfBlades",
    "Metadata/Items/Gems/SkillGemRefutation",
    "Metadata/Items/Gems/SkillGemRemnantsOfKalguur",
    "Metadata/Items/Gems/SkillGemRepulsion",
    "Metadata/Items/Gems/SkillGemRunicReprieve",
    "Metadata/Items/Gems/SkillGemSkyfall",
    "Metadata/Items/Gems/SkillGemTriskelionCascade",
    "Metadata/Items/Gems/SkillGemVerisiumManifestation",
    "Metadata/Items/Gems/SkillGemVoltaicBarrier",
    "Metadata/Items/Gems/SkillGemWardboundMinions",
    "Metadata/Items/Gems/SupportGemConcussiveRunes",
    "Metadata/Items/Gems/SupportGemFistOfKalguur",
    "Metadata/Items/Gems/SupportGemHealingRunes",
    "Metadata/Items/Gems/SupportGemRuneforgedBlades",
    "Metadata/Items/Gems/SupportGemRunicExtraction",
    "Metadata/Items/Gems/SupportGemRunicInfusion",
    "Metadata/Items/Gems/SupportGemScouringFlame",
})


def _tag_from_requirement_name(req_id: str) -> Optional[str]:
    s = req_id.strip().lower()
    # direct matches
    if "talisman" in s:
        return "talisman"
    if "quarterstaff" in s:
        return "quarterstaff"
    if s == "wand":
        return "wand"
    if s == "bow":
        return "bow"
    if "crossbow" in s:
        return "crossbow"
    if "spear" in s:
        return "spear"
    if "flail" in s:
        return "flail"
    if "shield" in s:
        return "shield"
    if "buckler" in s:
        return "buckler"
    if "dagger" in s:
        return "dagger"
    if "claw" in s:
        return "claw"
    if "sword" in s:
        return "sword"
    if "axe" in s:
        return "axe"
    if "mace" in s:
        return "mace"
    if "unarmed" in s:
        return "unarmed"
    if s == "nothing":
        return "nothing"
    return None


def derive_wieldable_class_tag_map(weaponreq_rows: List[Mapping[str, Any]]) -> Dict[int, str]:
    """Derive a mapping of WieldableClass RID -> normalized weapon tag.

    We seed from singleton requirements (WieldableClasses length == 1) where
    the requirement Id contains a recognizable weapon name. We then fill a few
    remaining known classes by deduction from composite rows:
      - Any Staff = [staff, quarterstaff]
      - Any Blunt Weapon includes sceptre (in PoE2) alongside maces/staves.
      - Any Thrown Axe -> treat as axe
      - Thrown Shield is an in-flight shield state, not a main-hand weapon

    Unknown classes are mapped to a stable synthetic tag ("wclass{rid}") so
    hard gating errs on the side of exclusion rather than false allowance.
    """

    mapping: Dict[int, str] = {}

    # 1) Seed from singletons
    for r in weaponreq_rows:
        classes = r.get("WieldableClasses")
        if not isinstance(classes, list) or len(classes) != 1:
            continue
        cid = classes[0]
        if not isinstance(cid, int):
            continue
        tag = _tag_from_requirement_name(str(r.get("Id") or ""))
        if tag and tag != "nothing":
            mapping[cid] = tag

    # 2) Deduce staff from Any Staff
    any_staff = next((r for r in weaponreq_rows if str(r.get("Id") or "").lower() == "any staff"), None)
    if any_staff:
        classes = [c for c in (any_staff.get("WieldableClasses") or []) if isinstance(c, int)]
        # If we know quarterstaff, the other is caster staff
        if len(classes) == 2 and any(c in mapping and mapping[c] == "quarterstaff" for c in classes):
            for c in classes:
                if c not in mapping:
                    mapping[c] = "staff"

    # 3) Deduce sceptre from Any Blunt Weapon
    any_blunt = next((r for r in weaponreq_rows if str(r.get("Id") or "").lower() == "any blunt weapon"), None)
    if any_blunt:
        classes = [c for c in (any_blunt.get("WieldableClasses") or []) if isinstance(c, int)]
        # Known blunt tags among these: mace, staff, quarterstaff
        known_blunt = {c for c in classes if mapping.get(c) in {"mace", "staff", "quarterstaff"}}
        unknown = [c for c in classes if c not in mapping]
        if unknown:
            # In PoE2, sceptres are blunt weapons and are the missing class in this set.
            # If there's exactly one unknown, assume it's sceptre.
            if len(unknown) == 1:
                mapping[unknown[0]] = "sceptre"

    # 4) Any Thrown Axe -> axe
    thrown = next((r for r in weaponreq_rows if str(r.get("Id") or "").lower() == "any thrown axe"), None)
    if thrown:
        classes = [c for c in (thrown.get("WieldableClasses") or []) if isinstance(c, int)]
        for c in classes:
            if c not in mapping:
                mapping[c] = "axe"

    # 5) The Nightfall-granted skill requirements combine the ordinary shield
    # class with a distinct in-flight ThrownShield class. Keep both on the
    # off-hand side so the resulting gate is shield OR thrown_shield.
    thrown_shield_rows = [
        r for r in weaponreq_rows
        if "thrownshield" in re.sub(r"[^a-z]", "", str(r.get("Id") or "").lower())
    ]
    for row in thrown_shield_rows:
        classes = [c for c in (row.get("WieldableClasses") or []) if isinstance(c, int)]
        for c in classes:
            if c not in mapping:
                mapping[c] = "thrown_shield"

    # 6) Fill unknowns with stable synthetic tags
    all_classes: Set[int] = set()
    for r in weaponreq_rows:
        for c in (r.get("WieldableClasses") or []):
            if isinstance(c, int):
                all_classes.add(c)
    for c in sorted(all_classes):
        if c not in mapping:
            mapping[c] = f"wclass{c}"

    return mapping


def weapon_gate_from_requirement(
    weaponreq_row: Mapping[str, Any],
    class_tag_map: Mapping[int, str],
) -> Dict[str, Any]:
    req_id = str(weaponreq_row.get("Id") or "").strip()
    classes = [c for c in (weaponreq_row.get("WieldableClasses") or []) if isinstance(c, int)]

    tags = [class_tag_map.get(c, f"wclass{c}") for c in classes]
    tags = [t for t in tags if t and t != "nothing"]

    # Split into mainhand/offhand by known tag semantics
    mainhand = [t for t in tags if t not in OFFHAND_TAGS]
    offhand = [t for t in tags if t in OFFHAND_TAGS]

    def uniq(xs: Iterable[str]) -> List[str]:
        out: List[str] = []
        for x in xs:
            x = str(x).lower()
            if x and x not in out:
                out.append(x)
        return out

    return {
        "requirement_id": req_id,
        "display": f"Requires {req_id}" if req_id else "",
        "wieldable_classes": classes,
        "mainhand_tags_any_of": uniq(mainhand),
        "offhand_tags_any_of": uniq(offhand),
        "allowed_weapon_tags_any_of": uniq(tags),
        "is_unrestricted": False,
    }


# --------------------------- Taxonomy derivations ---------------------------


DMG_TYPES = {"physical", "fire", "cold", "lightning", "chaos"}


def derive_taxonomy(gem_tags: List[str], skill_types: List[str]) -> Dict[str, Any]:
    tset = set([t.lower() for t in gem_tags] + [t.lower() for t in skill_types])

    damage_types = [t for t in DMG_TYPES if t in tset]

    delivery: List[str] = []
    for k in [
        "attack",
        "spell",
        "melee",
        "projectile",
        "area",
        "channel",
        "totem",
        "trap",
        "mine",
        "minion",
        "aura",
        "curse",
        "mark",
        "movement",
        "guard",
    ]:
        if k in tset and k not in delivery:
            delivery.append(k)

    role: List[str] = []
    if "movement" in tset:
        role.append("movement")
    if "aura" in tset or "buff" in tset:
        role.append("buff")
    if "curse" in tset or "mark" in tset:
        role.append("debuff")
    if "guard" in tset or "defensive" in tset or "activeblock" in tset:
        role.append("defense")
    if not role:
        role.append("damage")

    return {
        "gem_tags": uniq_canonical(gem_tags),
        "skill_types": sorted({t.lower() for t in skill_types if t}),
        "damage_types": damage_types,
        "delivery": delivery,
        "role": role,
    }


# --------------------------- Main enrichment ---------------------------


def enrich_from_tables(table_dir: Path, out_path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    req_files = {
        "skillgems.json",
        "skillgemsupports.json",
        "activeskills.json",
        "activeskilltype.json",
        "activeskillweaponrequirement.json",
        "baseitemtypes.json",
        "gemeffects.json",
        "gemtags.json",
        "grantedeffects.json",
        "skillcraftingdata.json",
    }
    missing = [f for f in sorted(req_files) if not (table_dir / f).exists()]
    if missing:
        raise FileNotFoundError(
            "Missing required table exports in skills_tables/: " + ", ".join(missing)
        )

    # load tables
    skillgems = load_json(table_dir / "skillgems.json")
    skillgemsupports = load_json(table_dir / "skillgemsupports.json")
    activeskills = load_json(table_dir / "activeskills.json")
    activeskilltype = load_json(table_dir / "activeskilltype.json")
    weaponreq = load_json(table_dir / "activeskillweaponrequirement.json")
    baseitemtypes = load_json(table_dir / "baseitemtypes.json")
    gemeffects = load_json(table_dir / "gemeffects.json")
    gemtags = load_json(table_dir / "gemtags.json")
    grantedeffects = load_json(table_dir / "grantedeffects.json")
    skillcraftingdata = load_json(table_dir / "skillcraftingdata.json")

    # Optional: derive effect_tags (primarily for support gems) from stat sets.
    statsets_by_rid: Dict[int, Dict[str, Any]] = {}
    stat_id_by_rid: Dict[int, str] = {}
    try:
        statsets_path = table_dir / "grantedeffectstatsets.json"
        stats_path = table_dir.parent / "stats.json"
        if statsets_path.exists() and stats_path.exists():
            statsets_by_rid = idx_by_rid(load_json(statsets_path))
            stats_rows = load_json(stats_path)
            for r in stats_rows:
                rid = r.get("_rid")
                sid = r.get("Id")
                if isinstance(rid, int) and sid:
                    stat_id_by_rid[rid] = str(sid)
            print(f"[enrich_skills] effect_tags enabled: {len(statsets_by_rid)} statsets, {len(stat_id_by_rid)} stats")
        else:
            print("[enrich_skills] effect_tags disabled: missing grantedeffectstatsets.json and/or stats.json")
    except Exception as e:
        print(f"[enrich_skills] WARN: effect_tags init failed: {e}", file=sys.stderr)
        statsets_by_rid = {}
        stat_id_by_rid = {}

    # indices
    base_by_rid = idx_by_rid(baseitemtypes)
    ge_by_rid = idx_by_rid(gemeffects)
    gemtag_by_rid = idx_by_rid(gemtags)
    granted_by_rid = idx_by_rid(grantedeffects)
    active_by_rid = idx_by_rid(activeskills)
    astype_by_rid = idx_by_rid(activeskilltype)
    weaponreq_by_rid = idx_by_rid(weaponreq)
    craft_by_rid = idx_by_rid(skillcraftingdata)
    skillgem_by_rid = idx_by_rid(skillgems)

    # supports map: active gem rid -> list of support gem rids
    supports_map: Dict[int, List[int]] = {}
    for r in skillgemsupports:
        sg = r.get("SkillGem")
        supp = r.get("Supports")
        if isinstance(sg, int) and isinstance(supp, list):
            supports_map[sg] = [x for x in supp if isinstance(x, int)]

    # derive wieldable class -> tag mapping
    class_tag_map = derive_wieldable_class_tag_map(weaponreq)

    out: List[Dict[str, Any]] = []
    stats = {
        "total": 0,
        "active": 0,
        "support": 0,
        "missing_base": 0,
        "missing_effect": 0,
        "missing_granted": 0,
        "missing_active": 0,
    }

    for sg in skillgems:
        sg_rid = sg.get("_rid")
        if not isinstance(sg_rid, int):
            continue

        base_rid = sg.get("BaseItemType")
        base = base_by_rid.get(base_rid) if isinstance(base_rid, int) else None
        if not base:
            stats["missing_base"] += 1
            continue

        gem_effect_rids = [x for x in (sg.get("GemEffects") or []) if isinstance(x, int)]
        if not gem_effect_rids:
            stats["missing_effect"] += 1
            continue

        # gather linked data
        granted_effect_rids: List[int] = []
        gem_tag_ids: List[str] = []
        support_texts: List[str] = []
        support_names: List[str] = []
        is_support_any = False

        active_skill_rids: List[int] = []
        active_skill_ids: List[str] = []
        active_skill_objs: List[Dict[str, Any]] = []
        weapon_requirement_rid: Optional[int] = None

        for eff_rid in gem_effect_rids:
            eff = ge_by_rid.get(eff_rid)
            if not eff:
                continue

            # gem tags
            for t_rid in (eff.get("GemTags") or []):
                if isinstance(t_rid, int):
                    gt = gemtag_by_rid.get(t_rid)
                    if gt and gt.get("Id"):
                        gem_tag_ids.append(str(gt["Id"]))

            # support strings
            if eff.get("SupportText"):
                support_texts.append(str(eff.get("SupportText") or ""))
            if eff.get("SupportName"):
                support_names.append(str(eff.get("SupportName") or ""))

            gr_rid = eff.get("GrantedEffect")
            if isinstance(gr_rid, int):
                granted_effect_rids.append(gr_rid)
                gr = granted_by_rid.get(gr_rid)
                if gr:
                    if bool(gr.get("IsSupport")):
                        is_support_any = True
                    as_rid = gr.get("ActiveSkill")
                    if isinstance(as_rid, int):
                        active_skill_rids.append(as_rid)
                        a = active_by_rid.get(as_rid)
                        if a and a.get("Id"):
                            active_skill_ids.append(str(a["Id"]))
                            active_skill_objs.append(
                                {
                                    "id": str(a.get("Id") or ""),
                                    "name": str(a.get("DisplayedName") or ""),
                                    "display_name": str(a.get("DisplayedName") or ""),
                                    "description": str(a.get("Description") or ""),
                                }
                            )
                            if weapon_requirement_rid is None and isinstance(a.get("WeaponRequirements"), int):
                                weapon_requirement_rid = int(a["WeaponRequirements"])

        if not granted_effect_rids:
            stats["missing_granted"] += 1
            continue

        gem_type = "support" if is_support_any else "active"
        stats[gem_type] += 1

        # crafting categories (soft)
        craft_rids = [x for x in (sg.get("CraftingTypes") or []) if isinstance(x, int)]
        craft_names = [str(craft_by_rid.get(r, {}).get("Name") or "") for r in craft_rids]
        craft_names = [c for c in craft_names if c]
        schools = [c.lower() for c in craft_names if c.lower() in {"occult", "elemental", "primal"}]
        affin = [c.lower() for c in craft_names if c.lower() not in {"occult", "elemental", "primal"}]

        # skill types
        skill_types: List[str] = []
        if active_skill_rids:
            # union across all linked active skills
            for as_rid in set(active_skill_rids):
                a = active_by_rid.get(as_rid)
                if not a:
                    continue
                for t_rid in (a.get("ActiveSkillTypes") or []):
                    if isinstance(t_rid, int):
                        st = astype_by_rid.get(t_rid)
                        if st and st.get("Id"):
                            skill_types.append(str(st["Id"]))

        # description
        desc = ""
        if gem_type == "support":
            # prefer explicit support text, else fallback
            desc = next((t for t in support_texts if t.strip()), "")
        else:
            # active: prefer first active skill description
            desc = next((o.get("description") for o in active_skill_objs if o.get("description")), "")

        # weapon requirements (hard) for active skills
        weapon_req_obj: Dict[str, Any] = {"is_unrestricted": True}
        if gem_type == "active" and isinstance(weapon_requirement_rid, int):
            wr = weaponreq_by_rid.get(weapon_requirement_rid)
            if wr:
                wr_id = str(wr.get("Id") or "")
                if wr_id and wr_id.lower() != "nothing":
                    weapon_req_obj = weapon_gate_from_requirement(wr, class_tag_map)
                    weapon_req_obj["weapon_requirement_rid"] = weapon_requirement_rid
                else:
                    weapon_req_obj = {
                        "is_unrestricted": True,
                        "weapon_requirement_rid": weapon_requirement_rid,
                        "requirement_id": wr_id,
                        "display": "",
                        "wieldable_classes": list(wr.get("WieldableClasses") or []),
                    }

        # recommended supports (IDs)
        rec_supp: List[str] = []
        if gem_type == "active":
            for supp_rid in supports_map.get(sg_rid, []):
                srow = skillgem_by_rid.get(supp_rid)
                if not srow:
                    continue
                sbase_rid = srow.get("BaseItemType")
                sbase = base_by_rid.get(sbase_rid) if isinstance(sbase_rid, int) else None
                if sbase and sbase.get("Id"):
                    rec_supp.append(str(sbase["Id"]))

        # bracket tags from description text (useful for UI emphasis)
        bracket_tags = extract_bracket_tags(desc)

        # merged tags for scoring / matching
        base_id = str(base.get("Id") or "")
        source_tags = ["kalguuran"] if base_id in KALGUURAN_BASE_ITEM_IDS else []
        base_skill_gem_rid = sg.get("BaseSkillGem")
        base_skill_gem_id: Optional[str] = None
        if isinstance(base_skill_gem_rid, int):
            source_tags.append("derived_template")
            base_skill_gem_row = skillgem_by_rid.get(base_skill_gem_rid)
            linked_base_rid = base_skill_gem_row.get("BaseItemType") if base_skill_gem_row else None
            linked_base = base_by_rid.get(linked_base_rid) if isinstance(linked_base_rid, int) else None
            if linked_base and linked_base.get("Id"):
                base_skill_gem_id = str(linked_base["Id"])

        merged_tags = uniq_canonical([
            *gem_tag_ids,
            *skill_types,
            *schools,
            *affin,
            *bracket_tags,
            *source_tags,
        ])

        taxonomy = derive_taxonomy(gem_tag_ids, skill_types)
        effect_tags = uniq_canonical(derive_effect_tags_from_granted_effects(granted_effect_rids, granted_by_rid, statsets_by_rid, stat_id_by_rid))

        # build output gem
        base_name = str(base.get("Name") or "")

        entry: Dict[str, Any] = {
            "schema_version": 2,
            "id": base_id,
            "name": base_name,
            "type": gem_type,
            "base_item": {"id": base_id, "display_name": base_name},
            "description": desc or "",
            "support_text": next((t for t in support_texts if t.strip()), "") if support_texts else "",
            "support_name": next((n for n in support_names if n.strip()), "") if support_names else "",
            "crafting_level": sg.get("CraftingLevel"),
            "min_level_req": sg.get("MinLevelReq"),
            "tier": sg.get("Tier"),
            "tutorial_video": sg.get("TutorialVideo"),
            "ui_image": sg.get("UI_Image"),
            "requirement_weights": {
                "strength": sg.get("StrengthRequirementPercent", 0),
                "dexterity": sg.get("DexterityRequirementPercent", 0),
                "intelligence": sg.get("IntelligenceRequirementPercent", 0),
            },
            "crafting": {
                "types_raw": craft_names,
                "schools": uniq_canonical(schools),
                "weapon_affinities": uniq_canonical(affin),
            },
            "taxonomy": taxonomy,
            "effect_tags": effect_tags,
            "source_tags": source_tags,
            "weapon_requirements": weapon_req_obj,
            "recommended_supports": rec_supp,
            "tags": merged_tags,
            "bracket_tags": bracket_tags,
            "links": {
                "base_item_rid": base_rid,
                "gem_effect_rids": gem_effect_rids,
                "granted_effect_rids": granted_effect_rids,
                "active_skill_rids": list(dict.fromkeys(active_skill_rids)),
                "active_skill_ids": list(dict.fromkeys(active_skill_ids)),
                "weapon_requirement_rid": weapon_requirement_rid,
            },
        }

        if active_skill_objs:
            entry["active_skills"] = active_skill_objs

        if isinstance(base_skill_gem_rid, int):
            entry["links"]["base_skill_gem_rid"] = base_skill_gem_rid
            entry["links"]["base_skill_gem_id"] = base_skill_gem_id

        out.append(entry)
        stats["total"] += 1

    # write
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    return out, stats


def main(argv: Sequence[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])

    here = Path(__file__).resolve().parent
    data_root = here.parent  # data/
    datamined_dir = data_root / "datamined"
    table_dir = datamined_dir / "skills_tables"
    enriched_dir = data_root / "enriched"
    out_path = enriched_dir / "skills_enriched.json"

    if not table_dir.exists():
        print(
            f"[enrich_skills] ERROR: expected table exports at {table_dir} (folder missing)",
            file=sys.stderr,
        )
        print(
            "[enrich_skills] Create data/datamined/skills_tables/ and place the JSON exports there.",
            file=sys.stderr,
        )
        return 1

    try:
        print(f"[enrich_skills] Loading tables from {table_dir}")
        enriched, stats = enrich_from_tables(table_dir, out_path)
    except FileNotFoundError as e:
        print(f"[enrich_skills] ERROR: {e}", file=sys.stderr)
        return 1

    print(
        f"[enrich_skills] Wrote {stats['total']} gems (active={stats['active']} support={stats['support']}) to {out_path}"
    )
    print(
        f"[enrich_skills] Missing base={stats['missing_base']} effect={stats['missing_effect']} granted={stats['missing_granted']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
