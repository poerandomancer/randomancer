#!/usr/bin/env python3
"""
enrich_passives.py

Offline helper to turn:
  - passiveskills.json
  - stats.json
  - ascendancy.json

into a compact passives_enriched.json for Randomancer.

Usage (from the folder that has those three files):

    python enrich_passives.py

Output:

    passives_enriched.json
"""

import json
import sys
from pathlib import Path
from collections import Counter
import re

TEXT_TAG_RULES = [
    # Armour break / shattered armour
    (re.compile(r"(?:break|broken|breaks)\s+armou?r|armou?r\s*(?:break|broken)", re.I), "armourbreak"),
    (re.compile(r"(armou?r.*shatter|shatter.*armou?r)", re.I), "armourbreak"),

    # Tempo / mobility debuffs
    (re.compile(r"\bhinder(?:ed|ing|s)?\b|\bhindrance\b", re.I), "hinder"),
    (re.compile(r"\bslow(?:ed|ing|s)?\b|\bslowing\b", re.I), "slow"),
    (re.compile(r"\bmaim(?:ed|ing|s)?\b", re.I), "maim"),

    # Sustain / resource
    (re.compile(r"\blife\s+regen(eration)?\b|\bregenerat(e|es|ed|ing|ion)\b", re.I), "liferegeneration"),
    (re.compile(r"\bleech(ed|ing|es)?\b", re.I), "leech"),

    # Crit support
    (re.compile(r"\bcrit(ical|s|ically| chance)?\b|\bcritical\s+strike\b", re.I), "crit"),
]

INPUT_PASSIVES = "../datamined/passiveskills.json"
INPUT_STATS = "../datamined/stats.json"
INPUT_ASCENDANCY = "../datamined/ascendancy.json"
OUTPUT_FILE = "../enriched/passives_enriched.json"


# ---------- helpers ----------

def load_json(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Failed to load {path}: {e}", file=sys.stderr)
        sys.exit(1)


def is_junk_name(name: str) -> bool:
    """
    Filter out obviously "do not use" names.
    """
    if not name:
        return True
    if name.startswith("[DNT"):
        return True
    if "UNUSED" in name:
        return True
    return False


def build_ascendancy_map_from_file(entries, allowed_names=None):
    """
    Build { ascendancyId(int): name(str) } from ascendancy.json.

    - Uses `_rid` as the numeric id.
    - Uses `Name` as the display name.
    - Skips [DNT-UNUSED] and Disabled ascendancies.
    - If allowed_names is provided, only keeps names in that set.
    """
    out = {}
    for entry in entries:
        name = (entry.get("Name") or "").strip()
        if not name:
            continue
        if is_junk_name(name):
            continue
        if entry.get("Disabled"):
            continue
        if allowed_names and name not in allowed_names:
            continue

        rid = entry.get("_rid")
        if rid is None:
            continue

        out[int(rid)] = name
    return out


def classify_node(node, ascendancy_names_by_id):
    """
    Classify a node into one of:
      - keystone
      - ascendancy (ascendancy + notable)
      - notable (tree notable)
      - None (ignored)

    IMPORTANT:
    - Ascendancy nodes we include are ONLY those that are also notables:
      Ascendancy != None AND IsNotable == True.
    - Ascendancy nodes that are NOT notables (small travel/attribute nodes)
      are ignored completely.
    """
    asc = node.get("Ascendancy", None)
    name = node.get("Name", "")

    # Filter junk names up front
    if is_junk_name(name):
        return None

    # Always treat keystones as keystones, even if they live in ascendancy areas
    if node.get("IsKeystone"):
        return {
            "type": "keystone",
            "ascendancyId": None,
            "ascendancy": None,
        }

    is_notable = bool(node.get("IsNotable"))

    # Ascendancy notables (what we want for "Ascendancy Nodes")
    # Only nodes that are BOTH ascendancy AND notable.
    if asc is not None and is_notable:
        asc_name = ascendancy_names_by_id.get(asc)
        # If the ascendancy id isn't in our mapping (not used), skip it.
        if not asc_name:
            return None

        return {
            "type": "ascendancy",
            "ascendancyId": asc,
            "ascendancy": asc_name,
        }

    # Generic notables on the main tree (no Ascendancy flag)
    if is_notable and asc is None:
        return {
            "type": "notable",
            "ascendancyId": None,
            "ascendancy": None,
        }

    # Everything else (small nodes, ascendancy smalls, etc.) is ignored for v1.
    return None


def humanize_stat_id(stat_id: str) -> str:
    if not stat_id:
        return ""
    s = stat_id
    s = s.replace("_+%", " %")
    s = s.replace("+%", " %")
    s = s.replace("_per_", " per ")
    s = s.replace("_%", " %")
    s = s.replace("_", " ")
    s = " ".join(s.split())
    if not s:
        return ""
    return s[0].upper() + s[1:]


def format_stat(stat: dict, value) -> str:
    if not stat:
        return ""

    raw_text = (stat.get("Text") or "").strip()
    stat_id = stat.get("Id") or ""
    base = raw_text or humanize_stat_id(stat_id)

    if not base:
        return ""

    semantic = stat.get("Semantic")

    # boolean / flag-like stats
    if semantic == 4 and (value == 0 or value == 1):
        return base

    if not isinstance(value, (int, float)):
        return base

    if value == 0:
        return base

    base_lower = base.lower()
    is_percentish = (
        "%" in base
        or stat_id.endswith("_%")
        or "chance" in base_lower
        or "resistance" in base_lower
    )

    if is_percentish:
        cleaned = base.replace("%", " ").strip()
        sign = "+" if value > 0 else ""
        return f"{sign}{value}% {cleaned}"

    sign = "+" if value > 0 else ""
    return f"{sign}{value} {base}"


def extract_stat_lines(node: dict, stat_by_rid: dict, max_lines: int):
    stats_idxs = node.get("Stats") or []
    values = [
        node.get("Stat1Value"),
        node.get("Stat2Value"),
        node.get("Stat3Value"),
        node.get("Stat4Value"),
    ]

    lines = []
    raw_stats = []

    for i, rid in enumerate(stats_idxs[:4]):
        stat = stat_by_rid.get(rid)
        if not stat:
            continue

        value = values[i] if i < len(values) else 0

        raw_stats.append(
            {
                "rid": rid,
                "id": stat.get("Id"),
                "value": value,
                "semantic": stat.get("Semantic"),
                "category": stat.get("Category", None),
            }
        )

        line = format_stat(stat, value)
        if line and line not in lines:
            lines.append(line)
        if len(lines) >= max_lines:
            break

    return lines, raw_stats


def derive_tags(raw_stats, lines=None):
    tags = set()

    for s in raw_stats:
        stat_id = (s.get("id") or "").lower()

        # Defences
        if "maximum_life" in stat_id or "life_regeneration" in stat_id:
            tags.add("Life")
        if "energy_shield" in stat_id:
            tags.add("Energy Shield")
        if "evasion" in stat_id:
            tags.add("Evasion")
        if "armour" in stat_id:
            tags.add("Armour")
        if "block" in stat_id:
            tags.add("Block")

        # Mana / resources
        if "mana" in stat_id:
            tags.add("Mana")
        if "rage" in stat_id:
            tags.add("Rage")
        if "frenzy_charge" in stat_id:
            tags.add("Frenzy")
        if "endurance_charge" in stat_id:
            tags.add("Endurance")
        if "power_charge" in stat_id:
            tags.add("Power")

        # Offence (generic)
        if "attack_" in stat_id or "weapon_" in stat_id:
            tags.add("Attack")
        if "cast_speed" in stat_id or "spell_" in stat_id:
            tags.add("Spell")
        if "critical_strike" in stat_id or "crit_chance" in stat_id:
            tags.add("Crit")

        # Damage types
        if "fire_" in stat_id:
            tags.add("Fire")
        if "cold_" in stat_id:
            tags.add("Cold")
        if "lightning_" in stat_id:
            tags.add("Lightning")
        if "chaos_" in stat_id:
            tags.add("Chaos")
        if "physical_" in stat_id or "phys_" in stat_id:
            tags.add("Physical")

        # Ailments
        if "ignite" in stat_id:
            tags.add("Ignite")
        if "bleed" in stat_id or "bleeding" in stat_id:
            tags.add("Bleed")
        if "poison" in stat_id:
            tags.add("Poison")
        if "shock" in stat_id:
            tags.add("Shock")
        if "chill" in stat_id:
            tags.add("Chill")
        if "ailment" in stat_id:
            tags.add("Ailments")

        # Archetypes
        if "minion_" in stat_id:
            tags.add("Minions")
        if "totem_" in stat_id:
            tags.add("Totems")
        if "trap_" in stat_id:
            tags.add("Traps")
        if "mine_" in stat_id:
            tags.add("Mines")
        if "slam" in stat_id:
            tags.add("Slam")

        # Weapon hints
        if "bow_" in stat_id:
            tags.add("Bow")
        if "staff_" in stat_id:
            tags.add("Staff")
        if "sword_" in stat_id:
            tags.add("Sword")
        if "axe_" in stat_id:
            tags.add("Axe")
        if "claw_" in stat_id:
            tags.add("Claw")
        if "dagger_" in stat_id:
            tags.add("Dagger")
        if "wand_" in stat_id:
            tags.add("Wand")
        if "shield_" in stat_id:
            tags.add("Shield")

        # Leech
        if "leech" in stat_id:
            tags.add("Leech")

        # NEW: debuff / tempo / armour-break-y stats from IDs
        if "armour_break" in stat_id:
            tags.add("armourbreak")
        if "slow" in stat_id:
            tags.add("slow")
        if "hinder" in stat_id:
            tags.add("hinder")
        if "maim" in stat_id:
            tags.add("maim")
        if "culling_strike" in stat_id:
            tags.add("cullingstrike")
        if "heavy_stun" in stat_id or "heavystun" in stat_id:
            tags.add("heavystun")

    # Text-based hints from the already-formatted lines
    if lines:
        txt = "\n".join(lines)
        txt_lower = txt.lower()
        for rx, tag in TEXT_TAG_RULES:
            if rx.search(txt_lower):
                tags.add(tag)

    return sorted(tags)



# ---------- main ----------

def main():
    cwd = Path(".").resolve()
    print(f"Loading data from {cwd}...")

    passive_path = cwd / INPUT_PASSIVES
    stats_path = cwd / INPUT_STATS
    asc_path = cwd / INPUT_ASCENDANCY

    passive_skills = load_json(passive_path)
    stats = load_json(stats_path)
    ascendancy_entries = load_json(asc_path)

    # Map _rid -> stat obj
    stat_by_rid = {s.get("_rid"): s for s in stats}

    # Map ascendancy id (rid) -> name, using ascendancy.json
    ascendancy_names_by_id = build_ascendancy_map_from_file(ascendancy_entries)

    enriched_nodes = []

    for node in passive_skills:
        classification = classify_node(node, ascendancy_names_by_id)
        if not classification:
            continue

        # Keep it concise: 1 line for ascendancy, 2 for keystones/notables
        max_lines = 1 if classification["type"] == "ascendancy" else 2

        lines, raw_stats = extract_stat_lines(node, stat_by_rid, max_lines)
        tags = derive_tags(raw_stats, lines)

        enriched_nodes.append(
            {
                "id": node.get("Id"),
                "type": classification["type"],  # "keystone" | "ascendancy" | "notable"
                "name": node.get("Name"),
                "ascendancyId": classification["ascendancyId"],
                "ascendancy": classification["ascendancy"],
                "icon": node.get("Icon_DDSFile"),
                "lines": lines,
                "tags": tags,
                "flavour": node.get("FlavourText") or "",
                "rawStats": raw_stats,
            }
        )

    # Build ascendancy map directly from ascendancy.json, using our filtered mapping
    ascendancies = {
        str(asc_id): {"id": int(asc_id), "name": name}
        for asc_id, name in ascendancy_names_by_id.items()
    }

    # Optional: sort nodes by type, then name
    type_order = {"keystone": 0, "ascendancy": 1, "notable": 2}

    def sort_key(node):
        t = node.get("type")
        return (type_order.get(t, 99), node.get("name") or "")

    enriched_nodes.sort(key=sort_key)

    output = {
        "nodes": enriched_nodes,
        "ascendancies": ascendancies,
    }

    out_path = cwd / OUTPUT_FILE
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    counts = Counter(n["type"] for n in enriched_nodes)
    print(f"Wrote {len(enriched_nodes)} nodes to {out_path}")
    print("By type:", dict(counts))


if __name__ == "__main__":
    main()
