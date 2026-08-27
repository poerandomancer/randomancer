#!/usr/bin/env python3
"""Hybrid passive enrichment pipeline for Randomancer.

Builds data/enriched/passives_enriched.json by combining datamined passive
structure with optional PoE2DB scraped lines/tags for keystones and
ascendancy nodes. Also emits data/enriched/passive_scrape_report.json.

Ascendancy scraping is intentionally bucketed into distinct page shapes:
- direct passive attr blocks on the node page
- skill/meta-skill pages that contain the granted skill description near the top
- ascendancy overview pages that list each notable inline
- metadata-only pages that should be rejected or reduced to a safe fallback
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict, deque
import heapq
from html import unescape
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from lib.tag_normalization import canonicalize_tag, normalize_tag_list

TEXT_TAG_RULES = [
    (re.compile(r"(?:break|broken|breaks)\s+armou?r|armou?r\s*(?:break|broken)", re.I), "armour_break"),
    (re.compile(r"(armou?r.*shatter|shatter.*armou?r)", re.I), "armour_break"),
    (re.compile(r"\bhinder(?:ed|ing|s)?\b|\bhindrance\b", re.I), "hinder"),
    (re.compile(r"\bslow(?:ed|ing|s)?\b|\bslowing\b", re.I), "slow"),
    (re.compile(r"\bmaim(?:ed|ing|s)?\b", re.I), "maim"),
    (re.compile(r"\blife\s+regen(eration)?\b|\bregenerat(e|es|ed|ing|ion)\b", re.I), "life_regeneration"),
    (re.compile(r"\bleech(ed|ing|es)?\b", re.I), "leech"),
    (re.compile(r"\bcrit(ical|s|ically| chance)?\b|\bcritical\s+strike\b", re.I), "crit"),
    (re.compile(r"\brunic\s+ward\b", re.I), "runic_ward"),
]

SCRAPE_TAG_RULES = [
    (re.compile(r"\barmou?r\b", re.I), "armour"),
    (re.compile(r"\bevasion\b", re.I), "evasion"),
    (re.compile(r"\benergy\s+shield\b", re.I), "energy_shield"),
    (re.compile(r"\bmana\b", re.I), "mana"),
    (re.compile(r"\blife\b", re.I), "life"),
    (re.compile(r"\bminion\b", re.I), "minion"),
    (re.compile(r"\btotem\b", re.I), "totem"),
    (re.compile(r"\bprojectile\b", re.I), "projectile"),
    (re.compile(r"\bmelee\b", re.I), "melee"),
    (re.compile(r"\bspell\b", re.I), "spell"),
    (re.compile(r"\battack\b", re.I), "attack"),
    (re.compile(r"\bcritical\b|\bcrit\b", re.I), "critical_hit"),
    (re.compile(r"\bfire\b", re.I), "fire"),
    (re.compile(r"\bcold\b", re.I), "cold"),
    (re.compile(r"\blightning\b", re.I), "lightning"),
    (re.compile(r"\bchaos\b", re.I), "chaos"),
    (re.compile(r"\bphysical\b", re.I), "physical"),
    (re.compile(r"\brunic\s+ward\b", re.I), "runic_ward"),
]

HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parent
INPUT_PASSIVES = DATA_ROOT / "datamined" / "passiveskills.json"
INPUT_STATS = DATA_ROOT / "datamined" / "stats.json"
INPUT_ASCENDANCY = DATA_ROOT / "datamined" / "ascendancy.json"
INPUT_PASSIVE_TREE = DATA_ROOT / "datamined" / "Default.json"
OUTPUT_FILE = DATA_ROOT / "enriched" / "passives_enriched.json"
OUTPUT_REPORT_FILE = DATA_ROOT / "enriched" / "passive_scrape_report.json"
LEGACY_KEYSTONE_TOOLTIPS = DATA_ROOT / "enriched" / "keystone_tooltips.json"
POE2DB_HOST = "https://poe2db.tw"

PASSIVE_TREE_STARTS = {
    "str": 47175,
    "dex": 50459,
    "int": 54447,
    "str_dex": 50986,
    "dex_int": 44683,
    "str_int": 61525,
}


def participates_in_character_tree(node):
    """Whether a datamined node may be used for ordinary tree travel."""
    return bool(
        node
        and node.get("SkillType") == 0
        and node.get("Ascendancy") is None
        and not node.get("IsAnointmentOnly")
        and not node.get("IsJustIcon")
        and not node.get("IsKeystone")
        and node.get("MasteryGroup") is None
        and not node.get("IsProxyPassive")
        and not node.get("IsExpansion")
    )


def resolve_passive_ascendancy_owners(passive_skills, ascendancy_names_by_id=None):
    """Resolve direct and granted-tree ownership through passive row references."""
    by_rid = {row.get("_rid"): row for row in passive_skills}
    owner_id_by_rid = {
        rid: row.get("Ascendancy")
        for rid, row in by_rid.items()
        if row.get("Ascendancy") is not None
    }
    changed = True
    while changed:
        changed = False
        for rid, row in by_rid.items():
            if rid in owner_id_by_rid:
                continue
            owners = {
                owner_id_by_rid[reference]
                for reference in row.get("Unknown53") or []
                if reference in owner_id_by_rid
            }
            if len(owners) == 1:
                owner_id_by_rid[rid] = owners.pop()
                changed = True
    names = ascendancy_names_by_id or {}
    by_id = {
        row.get("Id"): names.get(owner_id, owner_id)
        for rid, owner_id in owner_id_by_rid.items()
        if (row := by_rid[rid]).get("Id")
    }
    by_graph = {
        row.get("PassiveSkillGraphId"): owner_id_by_rid[rid]
        for rid, row in by_rid.items()
        if rid in owner_id_by_rid and row.get("PassiveSkillGraphId") is not None
    }
    return by_id, by_graph


def build_passive_tree_adjacency(tree, passive_skills):
    """Build the filtered character graph; exported connections are undirected."""
    raw_by_hash = {row.get("PassiveSkillGraphId"): row for row in passive_skills}
    _, owner_by_graph = resolve_passive_ascendancy_owners(passive_skills)
    allowed = {
        graph_id for graph_id, row in raw_by_hash.items()
        if participates_in_character_tree(row) and graph_id not in owner_by_graph
    }
    adjacency = {graph_id: set() for graph_id in allowed}
    for group in tree.get("groups") or []:
        for graph_node in group.get("passives") or []:
            source = graph_node.get("hash")
            if source not in allowed:
                continue
            for target in graph_node.get("connections") or []:
                if target in allowed:
                    adjacency[source].add(target)
                    adjacency[target].add(source)
    return adjacency


def shortest_path_distances(adjacency, root):
    distances = {root: 0} if root in adjacency else {}
    queue = deque(distances)
    while queue:
        source = queue.popleft()
        for target in sorted(adjacency[source]):
            if target not in distances:
                distances[target] = distances[source] + 1
                queue.append(target)
    return distances


def ascendancy_owned_distances(tree, passive_skills, ordinary_adjacency, ordinary_distances):
    """Locate owned nodes without ever using them as ordinary-tree shortcuts."""
    raw_by_hash = {row.get("PassiveSkillGraphId"): row for row in passive_skills}
    _, resolved_owners = resolve_passive_ascendancy_owners(passive_skills)
    owner_by_hash = {
        graph_id: owner for graph_id, owner in resolved_owners.items()
        if (row := raw_by_hash.get(graph_id)) and row.get("SkillType") == 0
        and not row.get("IsAnointmentOnly") and not row.get("IsJustIcon")
    }
    owned_adjacency = {graph_id: set() for graph_id in owner_by_hash}
    boundaries = defaultdict(set)
    for group in tree.get("groups") or []:
        for graph_node in group.get("passives") or []:
            source = graph_node.get("hash")
            for target in graph_node.get("connections") or []:
                if source in owner_by_hash and target in owner_by_hash and owner_by_hash[source] == owner_by_hash[target]:
                    owned_adjacency[source].add(target)
                    owned_adjacency[target].add(source)
                elif source in owner_by_hash and target in ordinary_adjacency:
                    boundaries[source].add(target)
                elif target in owner_by_hash and source in ordinary_adjacency:
                    boundaries[target].add(source)

    result = {}
    for start, ordinary in ordinary_distances.items():
        distances = {}
        queue = []
        for owned, neighbors in boundaries.items():
            seeds = [ordinary[node] + 1 for node in neighbors if node in ordinary]
            if seeds:
                distances[owned] = min(seeds)
                heapq.heappush(queue, (distances[owned], owned))
        while queue:
            distance, source = heapq.heappop(queue)
            if distance != distances[source]:
                continue
            for target in sorted(owned_adjacency[source]):
                candidate = distance + 1
                if candidate < distances.get(target, sys.maxsize):
                    distances[target] = candidate
                    heapq.heappush(queue, (candidate, target))
        result[start] = distances
    return result


def closest_passive_tree_starts(distance_by_start, graph_id):
    """Return all regions at or below the third-lowest distance, preserving ties."""
    reachable = [(distance[graph_id], start) for start, distance in distance_by_start.items() if graph_id in distance]
    if len(reachable) < 3:
        return []
    cutoff = sorted(distance for distance, _ in reachable)[2]
    return sorted(start for distance, start in reachable if distance <= cutoff)

MANUAL_SCRAPE_ALIASES = {
    "giants blood": "giant s blood",
}

METADATA_EXACT_TOKENS = {
    "keystone",
    "ascendancy",
    "notable",
    "passive",
    "name",
    "level",
    "buff",
    "persistent",
    "trigger",
    "duration",
    "meta",
    "command",
    "aoe",
    "support",
    "implicit",
}

METADATA_LABEL_ROWS = {
    "name",
    "id",
    "family",
    "metadata",
    "weight",
    "icon",
    "tags",
    "skill gem",
    "support gem",
    "ascendancy class",
    "can be equipped in",
    "grantedeffectsperlevel",
    "passiveskillshash",
}

CLASS_NAMES = {
    "warrior",
    "ranger",
    "witch",
    "sorceress",
    "monk",
    "mercenary",
    "duelist",
    "marauder",
    "templar",
    "shadow",
    "scion",
    "huntress",
    "druid",
}

SKILL_STOP_HEADINGS = (
    "##### from",
    "##### recommended support gems",
    "##### supported by",
    "##### level effect",
    "##### attribute",
    "##### version history",
    "#### community wiki",
)

OVERVIEW_STOP_PATTERNS = (
    re.compile(r"^#####\s+.+\s+attr\s*/\d+", re.I),
    re.compile(r"^####\s+community wiki", re.I),
    re.compile(r"^wikis content is available under\b", re.I),
)

SITE_METADATA_PATTERNS = [
    re.compile(r"^name\s+show\s+full\s+descriptions$", re.I),
    re.compile(r"^id\b", re.I),
    re.compile(r"^icon\b", re.I),
    re.compile(r"^ascendancyid\b", re.I),
    re.compile(r"^passiveskillshash\b", re.I),
    re.compile(r"^tags\b", re.I),
    re.compile(r"^is(?:keystone|notable|ascendancystart|multiplechoice|multiplechoiceoption|blighted|jewelsocket|mastery|proxy|used|royale)\b", re.I),
    re.compile(r"^wikis\s+content\s+is\s+available\s+under\b", re.I),
    re.compile(r"^cc\s+by", re.I),
    re.compile(r"^unless\s+otherwise\s+noted\b", re.I),
    re.compile(r"^copyright\b", re.I),
    re.compile(r"^(sites|news|about site|community)$", re.I),
    re.compile(r"^(edit|reset)$", re.I),
    re.compile(r"^(version changes|implicit|support|from\s*/\d+|supported by\s*/\d+|recommended support gems\s*/\d+)$", re.I),
    re.compile(r"^(level effect|additional effects from quality)\b", re.I),
    re.compile(r"^(acronym|basetype|class|targettypes|type|itemtype|activeskillscode|buffgroupsid|isbuffdefinition|buffmergemodesid|isskillbuff)\b", re.I),
    re.compile(r"^(poe2db\.tw|poedb\.tw|tlidb\.com|paldb\.cc)$", re.I),
    re.compile(r"^grantedeffectsperlevel\b", re.I),
    re.compile(r"^last bumped on\b", re.I),
]

SKILL_PAGE_METADATA_PATTERNS = [
    re.compile(r"^level:\b", re.I),
    re.compile(r"^requires:\b", re.I),
    re.compile(r"^attack damage:\b", re.I),
    re.compile(r"^cooldown time:\b", re.I),
    re.compile(r"^additional effects from quality:\b", re.I),
    re.compile(r"^quality display\b", re.I),
    re.compile(r"^base [^:]{1,50}:", re.I),
    re.compile(r"^skill desired amount override\b", re.I),
    re.compile(r"^skill disabled unless cloned\b", re.I),
    re.compile(r"^hide minion frame\b", re.I),
    re.compile(r"^chance to be triggered\b", re.I),
    re.compile(r"^is area damage\b", re.I),
    re.compile(r"^can be attached\b", re.I),
    re.compile(r"^applies socketed .* marks to enemies within \(0", re.I),
]

EFFECT_VERB_RE = re.compile(
    r"\b(gain|gains|grants?|deal|deals|take|takes|taken|apply|applies|applied|create|creates|consume|consuming|trigger|triggers|triggering|recover|recovers|inflict|inflicts|causes?|reserve|reserves|convert|converts|become|becomes|double|doubled|cannot|can|while|when|if|lose|loses|fire|fires|used|use|using|reveal|reveals|recoup|recovers?|equip|equipped|counts?|have|has|is|are|was|were)\b",
    re.I,
)


def load_json(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Failed to load {path}: {e}", file=sys.stderr)
        sys.exit(1)



def load_optional_json(path: Path):
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None



def normalize_name_key(name: str) -> str:
    s = str(name or "").strip().lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = " ".join(s.split())
    return MANUAL_SCRAPE_ALIASES.get(s, s)



def poe2db_slug(name: str) -> str:
    s = str(name or "").strip().replace("’", "'")
    s = s.replace("'", "")
    s = re.sub(r"[,!\.:;()\[\]{}\"“”‘’]+", " ", s)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s)
    s = s.strip("_")
    return quote(s, safe=":_-")



def fetch_html(url: str, timeout: float = 8.0) -> str:
    req = Request(url, headers={"User-Agent": "Randomancer/passive-enrichment"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")



def html_to_lines(html: str):
    text = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = unescape(text)
    out = []
    for raw in text.splitlines():
        line = clean_text_line(raw)
        if line:
            out.append(line)
    return out



def clean_text_line(value: str) -> str:
    ln = unescape(str(value or ""))
    ln = re.sub(r"【\d+†([^】]+)】", r"\1", ln)
    ln = re.sub(r"\[\d+\]", "", ln)
    ln = re.sub(r"\s+", " ", ln).strip()
    return ln



def is_junk_name(name: str) -> bool:
    if not name:
        return True
    if name.startswith("[DNT"):
        return True
    if "UNUSED" in name:
        return True
    return False



def build_ascendancy_map_from_file(entries, allowed_names=None):
    out = {}
    for entry in entries:
        name = (entry.get("Name") or "").strip()
        if not name or is_junk_name(name) or entry.get("Disabled"):
            continue
        if allowed_names and name not in allowed_names:
            continue
        rid = entry.get("_rid")
        if rid is None:
            continue
        out[int(rid)] = name
    return out



def classify_node(node, ascendancy_names_by_id, *, require_character_tree=True):
    # The 0.5 export combines the character tree with Atlas/Masters and
    # Genesis-tree records. Only SkillType 0 belongs in build recommendations.
    if require_character_tree and node.get("SkillType") != 0:
        return None
    asc = node.get("Ascendancy", None)
    name = node.get("Name", "")
    if is_junk_name(name):
        return None
    if node.get("IsKeystone"):
        return {"type": "keystone", "ascendancyId": None, "ascendancy": None}
    is_notable = bool(node.get("IsNotable"))
    if asc is not None and is_notable:
        asc_name = ascendancy_names_by_id.get(asc)
        if not asc_name:
            return None
        return {"type": "ascendancy", "ascendancyId": asc, "ascendancy": asc_name}
    if is_notable and asc is None:
        return {"type": "notable", "ascendancyId": None, "ascendancy": None}
    return None



def humanize_stat_id(stat_id: str) -> str:
    if not stat_id:
        return ""
    s = stat_id.replace("_+%", " %").replace("+%", " %").replace("_per_", " per ").replace("_%", " %")
    s = " ".join(s.replace("_", " ").split())
    return (s[0].upper() + s[1:]) if s else ""



def format_stat(stat: dict, value) -> str:
    raw_text = (stat.get("Text") or "").strip() if stat else ""
    stat_id = stat.get("Id") if stat else ""
    base = raw_text or humanize_stat_id(stat_id)
    if not base:
        return ""
    semantic = stat.get("Semantic")
    if semantic == 4 and (value == 0 or value == 1):
        return base
    if not isinstance(value, (int, float)) or value == 0:
        return base
    base_lower = base.lower()
    is_percentish = "%" in base or stat_id.endswith("_%") or "chance" in base_lower or "resistance" in base_lower
    if is_percentish:
        cleaned = base.replace("%", " ").strip()
        sign = "+" if value > 0 else ""
        return f"{sign}{value}% {cleaned}"
    sign = "+" if value > 0 else ""
    return f"{sign}{value} {base}"



def extract_stat_lines(node: dict, stat_by_rid: dict, max_lines: int):
    stats_idxs = node.get("Stats") or []
    values = [node.get("Stat1Value"), node.get("Stat2Value"), node.get("Stat3Value"), node.get("Stat4Value")]
    lines, raw_stats = [], []
    for i, rid in enumerate(stats_idxs[:4]):
        stat = stat_by_rid.get(rid)
        if not stat:
            continue
        value = values[i] if i < len(values) else 0
        raw_stats.append({
            "rid": rid,
            "id": stat.get("Id"),
            "value": value,
            "semantic": stat.get("Semantic"),
            "category": stat.get("Category", None),
        })
        line = format_stat(stat, value)
        if line and line not in lines:
            lines.append(line)
        if len(lines) >= max_lines:
            break
    return lines, raw_stats



def derive_tags(raw_stats, lines=None):
    tags = set()

    def add(tag: str):
        canonical = canonicalize_tag(tag)
        if canonical:
            tags.add(canonical)

    for st in raw_stats or []:
        stat_id = (st.get("id") or "").lower()
        if "maximum_life" in stat_id or "life_regeneration" in stat_id:
            add("life")
        if "energy_shield" in stat_id:
            add("energy_shield")
        if "evasion" in stat_id:
            add("evasion")
        if "armour" in stat_id or "armor" in stat_id:
            add("armour")
        if "block" in stat_id:
            add("block")
        if "runic_ward" in stat_id:
            add("runic_ward")
        if "mana" in stat_id:
            add("mana")
        if "rage" in stat_id:
            add("rage")
        if "frenzy_charge" in stat_id:
            add("frenzy_charge")
        if "endurance_charge" in stat_id:
            add("endurance_charge")
        if "power_charge" in stat_id:
            add("power_charge")
        if "attack_" in stat_id or "weapon_" in stat_id:
            add("attack")
        if "cast_speed" in stat_id or "spell_" in stat_id:
            add("spell")
        if "critical_strike" in stat_id or "crit_chance" in stat_id:
            add("critical_hit")
        if "fire_" in stat_id:
            add("fire")
        if "cold_" in stat_id:
            add("cold")
        if "lightning_" in stat_id:
            add("lightning")
        if "chaos_" in stat_id:
            add("chaos")
        if "physical_" in stat_id or "phys_" in stat_id:
            add("physical")
        if "ignite" in stat_id:
            add("ignite")
        if "bleed" in stat_id or "bleeding" in stat_id:
            add("bleed")
        if "poison" in stat_id:
            add("poison")
        if "shock" in stat_id:
            add("shock")
        if "chill" in stat_id:
            add("chill")
        if "ailment" in stat_id:
            add("ailment")
        if "minion_" in stat_id:
            add("minion")
        if "totem_" in stat_id:
            add("totem")
        if "trap_" in stat_id:
            add("trap")
        if "mine_" in stat_id:
            add("mine")
        if "slam" in stat_id:
            add("slam")
        if "bow_" in stat_id:
            add("bow")
        if "staff_" in stat_id:
            add("staff")
        if "sword_" in stat_id:
            add("sword")
        if "axe_" in stat_id:
            add("axe")
        if "claw_" in stat_id:
            add("claw")
        if "dagger_" in stat_id:
            add("dagger")
        if "wand_" in stat_id:
            add("wand")
        if "shield_" in stat_id:
            add("shield")
        if "leech" in stat_id:
            add("leech")
        if "armour_break" in stat_id:
            add("armour_break")
        if "slow" in stat_id:
            add("slow")
        if "hinder" in stat_id:
            add("hinder")
        if "maim" in stat_id:
            add("maim")
        if "culling_strike" in stat_id:
            add("culling_strike")
        if "heavy_stun" in stat_id or "heavystun" in stat_id:
            add("heavy_stun")

    if lines:
        txt_lower = "\n".join(lines).lower()
        for rx, tag in TEXT_TAG_RULES:
            if rx.search(txt_lower):
                add(tag)

    return sorted(normalize_tag_list(list(tags), expand=False, match_keys=False))



def conservative_text_fallback_tags(lines):
    tags = set()
    blob = "\n".join(lines or [])
    for rx, tag in TEXT_TAG_RULES:
        if rx.search(blob):
            canonical = canonicalize_tag(tag)
            if canonical:
                tags.add(canonical)
    return sorted(normalize_tag_list(list(tags), expand=False, match_keys=False))



def derive_scraped_tags(lines):
    blob = "\n".join(lines or [])
    tags = []
    for rx, tag in SCRAPE_TAG_RULES:
        if rx.search(blob):
            tags.append(tag)
    return normalize_tag_list(tags, expand=False, match_keys=False)



def is_site_metadata_line(line: str) -> bool:
    lowered = clean_text_line(line)
    if not lowered:
        return True
    for rx in SITE_METADATA_PATTERNS:
        if rx.search(lowered):
            return True
    compact = lowered.lower().strip(" :")
    if compact in METADATA_LABEL_ROWS:
        return True
    if re.match(r"^(name|id|family|metadata|weight|version|hash)\s*:\s*\S+", lowered, re.I):
        return True
    if re.match(r"^(tags|ascendancy class|skill gem|support gem|can be equipped in)\s*:", lowered, re.I):
        return True
    if re.search(r"\b(last bumped on|grantedeffectsperlevel|passiveskillshash|show full descriptions)\b", lowered, re.I):
        return True
    return False



def is_skill_page_metadata_line(line: str) -> bool:
    lowered = clean_text_line(line)
    for rx in SKILL_PAGE_METADATA_PATTERNS:
        if rx.search(lowered):
            return True
    return False



def looks_incomplete_effect_line(line: str) -> bool:
    ln = clean_text_line(line)
    if not ln:
        return True
    lowered = ln.lower()
    words = re.findall(r"[A-Za-z0-9%+']+", ln)

    if len(words) == 1 and lowered in {"gain", "you", "can", "instead", "with", "for", "of", "base", "critical", "chance"}:
        return True
    if len(words) <= 2 and lowered in {"you can", "with hits instead", "deflection rating", "critical hit chance"}:
        return True
    if len(words) <= 4 and re.match(r"^(gain|deal up to|you have|\+\d+ to|enemies in your|body armou?r grants|base critical hit chance|skills fire an additional|applies a socketed|when collecting an|cannot be)\b", lowered):
        return True
    if re.match(r"^(for|with|instead|and|or|to|of|from|per|when|while|consume|consuming)\b", lowered):
        return True
    if re.search(r"\bfor spells is \d+$", lowered):
        return True
    if re.fullmatch(r"[+\-]?\d+(?:\.\d+)?", lowered):
        return True
    if re.search(r"(\+|\-|\*|/)$", lowered):
        return True
    if re.match(r"^grants?\s+skill\s*:?$", lowered):
        return True
    if re.search(r"\ban additional$", lowered):
        return True
    if lowered.endswith((" for", " with", " of", " to", " per", " instead", " your", " can", " grants", " is", " equal", " based")):
        return True
    return False



def strip_class_prefix_from_effect_line(line: str) -> str:
    ln = clean_text_line(line)
    if not ln:
        return ln
    prefix_re = r"^(?:" + "|".join(sorted(CLASS_NAMES, key=len, reverse=True)) + r")\s+(?=(?:Grants Skill:|\+|\d|[A-Z]))"
    return re.sub(prefix_re, "", ln, flags=re.I)



def looks_meaningful_effect_line(line: str) -> bool:
    ln = clean_text_line(line)
    if not ln or is_site_metadata_line(ln) or is_skill_page_metadata_line(ln):
        return False
    lowered = ln.lower().strip()
    if lowered in METADATA_EXACT_TOKENS or lowered in CLASS_NAMES:
        return False
    if re.match(r"^(ascendancy|character|class)\s*:", ln, re.I):
        return False
    if re.search(r"\battr\s*/\s*\d+\b", ln, re.I):
        return False
    if re.fullmatch(r"[+\-]?\d+(?:\.\d+)?%?", ln):
        return False
    if re.fullmatch(r"\(?\d+[—-]\d+\)?", ln):
        return False
    if re.fullmatch(r"[^A-Za-z0-9]+", ln):
        return False
    if re.search(r"^image(?::|$)", lowered):
        return False
    if EFFECT_VERB_RE.search(ln):
        return True
    if re.search(r"\b(projectile|attack|spell|damage|charges?|surges?|mark|life|mana|spirit|evasion|armour|shield|resistance|weakness|ring|slot|flasks?|charms?)\b", lowered) and any(ch.isdigit() for ch in ln):
        return True
    if lowered.startswith("grants skill:") and len(ln.split()) >= 3:
        return True
    return False



def stitch_scraped_fragments(raw_lines, node_name, node_type):
    cleaned = []
    for raw in raw_lines or []:
        ln = clean_text_line(raw)
        if not ln:
            continue
        if re.fullmatch(r"[^\w]+", ln) and ln != "%":
            continue
        cleaned.append(ln)

    stitched: list[str] = []

    def is_fragment_start(line: str) -> bool:
        l = line.lower().strip()
        return bool(re.search(r"(\+\d+ to|deal up to|you have|gain|enemies in your|body armou?r grants|base critical hit chance|skills fire an additional|applies a socketed|while active|when collecting an|cannot be)$", l))

    def is_fragment_piece(line: str) -> bool:
        words = re.findall(r"[A-Za-z0-9%+']+", line)
        if re.fullmatch(r"\(?\d+[—-]\d+\)?", line):
            return True
        if re.fullmatch(r"[+\-]?\d+(?:\.\d+)?%?", line):
            return True
        return len(words) <= 3

    def line_starts_like_suffix(line: str) -> bool:
        return bool(re.match(r"^(for|with|instead|of|from|per|to|and|or|you can|consume|consuming|while|when)\b", line.lower().strip()))

    for ln in cleaned:
        if not stitched:
            stitched.append(ln)
            continue

        prev = stitched[-1]
        prev_lower = prev.lower().strip()
        should_merge = (
            is_fragment_start(prev)
            or prev_lower.endswith((" to", " have", " up to", " your", " grants", " gain", " is", " equal", " on", " from"))
            or (is_fragment_piece(prev) and is_fragment_piece(ln))
            or ln.startswith("%")
            or line_starts_like_suffix(ln)
            or looks_incomplete_effect_line(prev)
        )

        if should_merge:
            joiner = "" if (ln.startswith("%") and re.search(r"\d$", prev)) else " "
            merged = re.sub(r"\s+", " ", f"{prev}{joiner}{ln}".strip())
            if len(merged) <= 220:
                stitched[-1] = merged
                continue
        stitched.append(ln)

    repaired: list[str] = []
    for ln in stitched:
        if not repaired:
            repaired.append(ln)
            continue
        prev = repaired[-1]
        if looks_incomplete_effect_line(prev) or line_starts_like_suffix(ln):
            merged = re.sub(r"\s+", " ", f"{prev} {ln}").strip()
            if len(merged) <= 220:
                repaired[-1] = merged
                continue
        repaired.append(ln)

    out: list[str] = []
    seen = set()
    for ln in repaired:
        if ln not in seen:
            seen.add(ln)
            out.append(ln)
    return out



def sanitize_scraped_lines(lines, node_name, node_type, ascendancy_name=None):
    out: list[str] = []
    seen = set()
    node_key = normalize_name_key(node_name)
    ascendancy_key = normalize_name_key(ascendancy_name) if ascendancy_name else None

    for raw in lines or []:
        ln = strip_class_prefix_from_effect_line(raw)
        ln = clean_text_line(ln)
        if not ln:
            continue
        if re.fullmatch(r"[^\w]+", ln):
            continue
        if is_site_metadata_line(ln) or is_skill_page_metadata_line(ln):
            continue

        ln_key = normalize_name_key(ln)
        lowered = ln.lower().strip(" :")
        lowered_no_space = lowered.replace(" ", "")

        if ln_key == node_key:
            continue
        if ascendancy_key and ln_key == ascendancy_key:
            continue
        if lowered in CLASS_NAMES:
            continue
        if lowered in METADATA_EXACT_TOKENS:
            continue
        if re.match(r"^(ascendancy|character|class)\s*:\s*", ln, flags=re.I):
            continue
        if re.search(r"\battr\s*/\s*\d+\b", ln, flags=re.I):
            continue
        if re.match(r"^[A-Za-z ]+\s*:\s*$", ln) and lowered in {"ascendancy", "character", "class"}:
            continue
        if re.match(r"^\[dnt\]", lowered, flags=re.I):
            continue
        if re.search(r"\b(?:supported by|recommended support gems|version history|wikis content|community wiki)\b", lowered, flags=re.I):
            continue
        if lowered_no_space in {"ascendancy", "character", "class", "attr/5", "attr/10"}:
            continue
        if lowered.startswith("place one or more skill gems"):
            continue
        if lowered.startswith("requires:"):
            continue
        if lowered.startswith("level:"):
            continue
        if lowered.startswith("cooldown time:"):
            continue
        if lowered.startswith("additional effects from quality"):
            continue
        if lowered.startswith("from /"):
            continue
        if lowered.startswith("image"):
            continue

        if ln not in seen:
            seen.add(ln)
            out.append(ln)
    return out



def is_valid_scraped_description(lines, node_name, node_type):
    if not lines:
        return False, "empty_after_sanitize"

    chip_like = 0
    metadata_like = 0
    numeric_like = 0
    incomplete_like = 0
    meaningful = 0
    for ln in lines:
        lowered = ln.lower().strip()
        words = re.findall(r"[A-Za-z0-9%+']+", ln)
        if len(words) <= 1:
            chip_like += 1
        if is_site_metadata_line(ln) or is_skill_page_metadata_line(ln):
            metadata_like += 1
        if re.search(r"\b(ascendancy|character|class|name|level|meta|attr|command)\b", lowered):
            metadata_like += 1
        if re.fullmatch(r"\(?\d+[—-]\d+\)?", lowered) or re.fullmatch(r"[+\-]?\d+(?:\.\d+)?%?", lowered):
            numeric_like += 1
        if looks_incomplete_effect_line(ln):
            incomplete_like += 1
        if looks_meaningful_effect_line(ln):
            meaningful += 1

    if len(lines) == 1:
        if metadata_like or numeric_like:
            return False, "single_non_meaningful_line"
        if incomplete_like > 0:
            return False, "single_incomplete_line"
        return True, None
    if chip_like >= max(2, len(lines) - 1):
        return False, "mostly_single_word_lines"
    if metadata_like >= 1:
        return False, "contains_metadata_lines"
    if node_type == "ascendancy" and numeric_like >= max(1, len(lines) - 1):
        return False, "mostly_numeric_fragments"
    if node_type == "ascendancy" and incomplete_like >= max(1, len(lines) - 1):
        return False, "mostly_incomplete_fragments"
    if meaningful == 0 and node_type == "ascendancy":
        return False, "no_meaningful_ascendancy_lines"
    return True, None



def clean_skill_name_candidate(value: str):
    c = clean_text_line(value).strip(" -:•,.")
    if not c or is_site_metadata_line(c) or is_skill_page_metadata_line(c):
        return None
    if not re.search(r"[A-Za-z]", c):
        return None
    if re.search(r"^(name|level|class|ascendancy|character|command|aoe|meta|trigger|duration|buff|persistent|requires)$", c, flags=re.I):
        return None
    if re.fullmatch(r"[+\-]?\d+(?:\.\d+)?%?", c):
        return None
    if len(c.split()) > 10:
        return None
    return c



def extract_skill_fallback_line(raw_lines):
    if not raw_lines:
        return None

    for i, ln in enumerate(raw_lines):
        m = re.search(r"grants?\s+skill\s*:?\s*(.+)$", ln, flags=re.I)
        if m:
            skill = clean_skill_name_candidate(m.group(1))
            if skill:
                return f"Grants Skill: {skill}"
            for cand in raw_lines[i + 1:i + 4]:
                nxt = clean_skill_name_candidate(cand)
                if nxt:
                    return f"Grants Skill: {nxt}"

    for i, ln in enumerate(raw_lines):
        if re.search(r"\b(command|djinn|grants?|skill)\b", ln, flags=re.I):
            for cand in raw_lines[i + 1:i + 4]:
                c = clean_skill_name_candidate(cand)
                if c:
                    return f"Grants Skill: {c}"
    return None



def is_attr_heading_for_name(line: str, name: str) -> bool:
    if not line or "attr /" not in line.lower():
        return False
    stripped = clean_text_line(line)
    stripped = re.sub(r"^#+\s*", "", stripped).strip()
    stripped = re.sub(r"\s*attr\s*/\s*\d+.*$", "", stripped, flags=re.I).strip()
    return normalize_name_key(stripped) == normalize_name_key(name)



def split_heading_blocks(lines):
    blocks = []
    current_heading = None
    current_lines = []
    for ln in lines:
        if ln.startswith("#####") or ln.startswith("####"):
            if current_heading is not None:
                blocks.append((current_heading, current_lines))
            current_heading = ln
            current_lines = []
        else:
            if current_heading is not None:
                current_lines.append(ln)
    if current_heading is not None:
        blocks.append((current_heading, current_lines))
    return blocks



def collect_until_boundary(lines, start_idx, stop_predicate, limit=30):
    out = []
    for ln in lines[start_idx:]:
        if stop_predicate(ln):
            break
        out.append(ln)
        if len(out) >= limit:
            break
    return out



def extract_direct_attr_lines(lines, node_name, node_type, ascendancy_name=None):
    target_blocks = []
    for heading, block_lines in split_heading_blocks(lines):
        if is_attr_heading_for_name(heading, node_name):
            target_blocks.append((heading, block_lines))

    candidates = []
    for _heading, block_lines in target_blocks:
        raw = []
        for ln in block_lines:
            if ln.startswith("#####") or ln.startswith("####"):
                break
            raw.append(ln)
        stitched = stitch_scraped_fragments(raw, node_name, node_type)
        cleaned = sanitize_scraped_lines(stitched, node_name, node_type, ascendancy_name=ascendancy_name)
        valid, reason = is_valid_scraped_description(cleaned, node_name, node_type)
        candidates.append({
            "source": "direct_attr",
            "raw": raw,
            "lines": cleaned,
            "valid": valid,
            "reason": reason,
        })
    return candidates



def extract_skill_page_lines(lines, node_name, node_type, ascendancy_name=None):
    key = normalize_name_key(node_name)
    first_attr_idx = next((i for i, ln in enumerate(lines) if ln.startswith("##### Attribute")), None)
    if first_attr_idx is None:
        first_attr_idx = len(lines)
    title_indices = [i for i, ln in enumerate(lines[:first_attr_idx]) if normalize_name_key(ln) == key]
    candidates = []
    for idx in title_indices[:2]:
        raw = []
        for ln in lines[idx + 1:]:
            low = ln.lower()
            if any(low.startswith(prefix) for prefix in SKILL_STOP_HEADINGS):
                break
            raw.append(ln)
            if len(raw) >= 30:
                break
        if not raw:
            continue
        stitched = stitch_scraped_fragments(raw, node_name, node_type)
        cleaned = sanitize_scraped_lines(stitched, node_name, node_type, ascendancy_name=ascendancy_name)
        # Prefer only meaningful lines for skill pages.
        cleaned = [ln for ln in cleaned if looks_meaningful_effect_line(ln)]
        # Drop generic embed text.
        cleaned = [ln for ln in cleaned if not ln.lower().startswith("place one or more skill gems")]
        if len(cleaned) > 4:
            cleaned = cleaned[:4]
        valid, reason = is_valid_scraped_description(cleaned, node_name, node_type)
        candidates.append({
            "source": "skill_page",
            "raw": raw,
            "lines": cleaned,
            "valid": valid,
            "reason": reason,
        })
    return candidates



def extract_overview_candidate(lines, node_name, ascendancy_name, known_name_keys):
    key = normalize_name_key(node_name)
    indices = [i for i, ln in enumerate(lines) if normalize_name_key(ln) == key]
    candidates = []

    def is_stop_line(ln: str, allow_same=False) -> bool:
        if any(rx.search(ln) for rx in OVERVIEW_STOP_PATTERNS):
            return True
        nk = normalize_name_key(ln)
        if nk in known_name_keys and (allow_same or nk != key):
            return True
        return False

    for idx in indices:
        forward_raw = []
        for ln in lines[idx + 1:]:
            if is_stop_line(ln):
                break
            forward_raw.append(ln)
            if len(forward_raw) >= 18:
                break

        stitched = stitch_scraped_fragments(forward_raw, node_name, "ascendancy")
        cleaned = sanitize_scraped_lines(stitched, node_name, "ascendancy", ascendancy_name=ascendancy_name)
        valid, reason = is_valid_scraped_description(cleaned, node_name, "ascendancy")
        candidates.append({
            "source": "overview_forward",
            "raw": forward_raw,
            "lines": cleaned,
            "valid": valid,
            "reason": reason,
        })

        # Backward fallback for selector / specialisation wrappers with no forward lines.
        backward_raw = []
        for ln in reversed(lines[max(0, idx - 8):idx]):
            if is_stop_line(ln, allow_same=False):
                break
            if re.match(r"^(ascendancy|character)\s*:", ln, re.I):
                break
            if not clean_text_line(ln):
                continue
            backward_raw.append(ln)
            if len(backward_raw) >= 3:
                break
        backward_raw.reverse()
        if backward_raw:
            stitched_back = stitch_scraped_fragments(backward_raw, node_name, "ascendancy")
            cleaned_back = sanitize_scraped_lines(stitched_back, node_name, "ascendancy", ascendancy_name=ascendancy_name)
            valid_back, reason_back = is_valid_scraped_description(cleaned_back, node_name, "ascendancy")
            candidates.append({
                "source": "overview_backward",
                "raw": backward_raw,
                "lines": cleaned_back,
                "valid": valid_back,
                "reason": reason_back,
            })
    return candidates



def score_candidate_lines(lines, source):
    if not lines:
        return -1000
    score = 0
    for ln in lines:
        words = re.findall(r"[A-Za-z0-9%+']+", ln)
        score += min(len(ln), 120)
        if looks_meaningful_effect_line(ln):
            score += 50
        if EFFECT_VERB_RE.search(ln):
            score += 25
        if re.search(r"grants? skill:", ln, re.I):
            score += 20
        if looks_incomplete_effect_line(ln):
            score -= 80
        if len(words) <= 1:
            score -= 40
    if len(lines) >= 2:
        score += 25
    if source == "skill_page":
        score += 15
    if source == "direct_attr":
        score += 10
    return score



def choose_best_candidate(candidates):
    valid = [c for c in candidates if c.get("valid") and c.get("lines")]
    if valid:
        return max(valid, key=lambda c: score_candidate_lines(c["lines"], c["source"]))
    fallback = [c for c in candidates if c.get("lines")]
    if fallback:
        return max(fallback, key=lambda c: score_candidate_lines(c["lines"], c["source"]))
    return None



def load_legacy_keystone_scrapes(path: Path):
    payload = load_optional_json(path) or {}
    out = {}
    for name, row in payload.items():
        lines = [clean_text_line(x) for x in (row or {}).get("lines", []) if clean_text_line(x)]
        if not lines:
            continue
        out[normalize_name_key(name)] = {
            "name": name,
            "slug": poe2db_slug(name),
            "lines": lines,
            "rawLines": list(lines),
            "tags": derive_scraped_tags(lines),
            "source": "legacy_keystone_tooltips",
            "matchedBy": "legacy",
        }
    return out



def scrape_keystone_node(node, lang: str, timeout: float = 8.0):
    name = node["name"]
    html = fetch_html(f"{POE2DB_HOST}/{lang}/{poe2db_slug(name)}", timeout=timeout)
    lines = html_to_lines(html)
    key = normalize_name_key(name)
    idx = next((i for i, ln in enumerate(lines) if normalize_name_key(ln) == key), None)
    if idx is None:
        return None
    raw = []
    for ln in lines[idx + 1:]:
        if re.search(r"^(community wiki|location|mechanics|vendor|related|gallery)\b", ln, flags=re.I):
            break
        if any(ln.lower().startswith(prefix) for prefix in SKILL_STOP_HEADINGS):
            break
        raw.append(ln)
        if len(raw) >= 12:
            break
    stitched = stitch_scraped_fragments(raw, name, "keystone")
    cleaned = sanitize_scraped_lines(stitched, name, "keystone")
    return {
        "name": name,
        "slug": poe2db_slug(name),
        "lines": cleaned,
        "rawLines": raw,
        "tags": derive_scraped_tags(cleaned),
        "source": "poe2db",
        "matchedBy": "name",
    }



def scrape_ascendancy_node(node, overview_lines, known_names_by_asc, lang: str, timeout: float = 8.0):
    name = node["name"]
    ascendancy = node.get("ascendancy")
    url = f"{POE2DB_HOST}/{lang}/{poe2db_slug(name)}"
    direct_lines = []
    direct_error = None
    direct_html = None
    try:
        direct_html = fetch_html(url, timeout=timeout)
        direct_lines = html_to_lines(direct_html)
    except HTTPError as exc:
        direct_error = exc
    except Exception as exc:
        direct_error = exc

    candidates = []
    if direct_lines:
        candidates.extend(extract_direct_attr_lines(direct_lines, name, "ascendancy", ascendancy_name=ascendancy))
        candidates.extend(extract_skill_page_lines(direct_lines, name, "ascendancy", ascendancy_name=ascendancy))

    overview_name_key = normalize_name_key(ascendancy)
    if overview_lines:
        candidates.extend(extract_overview_candidate(
            overview_lines,
            name,
            ascendancy,
            known_names_by_asc.get(overview_name_key, set()),
        ))

    best = choose_best_candidate(candidates)
    if best and best.get("lines"):
        return {
            "name": name,
            "slug": poe2db_slug(name),
            "lines": best["lines"],
            "rawLines": best.get("raw") or [],
            "tags": derive_scraped_tags(best["lines"]),
            "source": best["source"],
            "matchedBy": best["source"],
            "scrapeRejectedReason": None if best.get("valid") else best.get("reason"),
        }

    # Safe fallback: if all candidates are metadata-only but expose a skill name, keep Grants Skill.
    raw_for_fallback = []
    for cand in candidates:
        raw_for_fallback.extend(cand.get("raw") or [])
    skill_fallback = extract_skill_fallback_line(raw_for_fallback)
    if skill_fallback:
        return {
            "name": name,
            "slug": poe2db_slug(name),
            "lines": [skill_fallback],
            "rawLines": raw_for_fallback[:10],
            "tags": derive_scraped_tags([skill_fallback]),
            "source": "skill_fallback",
            "matchedBy": "skill_fallback",
            "scrapeRejectedReason": "metadata_only_page",
        }

    if direct_error:
        raise direct_error
    return None



def collect_scraped_passives(target_nodes, lang: str, timeout: float, disable_network: bool):
    by_name = load_legacy_keystone_scrapes(LEGACY_KEYSTONE_TOOLTIPS)
    by_slug = {entry["slug"]: entry for entry in by_name.values()}
    network_errors = []
    report_notes = defaultdict(int)

    if disable_network:
        return by_name, by_slug, network_errors, report_notes

    # Fetch overview pages once per ascendancy.
    overview_cache = {}
    known_names_by_asc = defaultdict(set)
    for node in target_nodes:
        if node.get("type") == "ascendancy" and node.get("ascendancy"):
            known_names_by_asc[normalize_name_key(node["ascendancy"])].add(normalize_name_key(node["name"]))

    for asc_key, names in known_names_by_asc.items():
        ascendancy_name = next((n["ascendancy"] for n in target_nodes if normalize_name_key(n.get("ascendancy")) == asc_key), None)
        if not ascendancy_name:
            continue
        try:
            overview_html = fetch_html(f"{POE2DB_HOST}/{lang}/{poe2db_slug(ascendancy_name)}", timeout=timeout)
            overview_cache[asc_key] = html_to_lines(overview_html)
        except Exception as exc:
            network_errors.append(f"{ascendancy_name} overview: {exc}")
            overview_cache[asc_key] = []

    for node in target_nodes:
        key = normalize_name_key(node.get("name"))
        if not key or key in by_name:
            continue
        try:
            if node.get("type") == "ascendancy":
                overview_lines = overview_cache.get(normalize_name_key(node.get("ascendancy"))) or []
                scraped = scrape_ascendancy_node(node, overview_lines, known_names_by_asc, lang=lang, timeout=timeout)
                if scraped and scraped.get("source", "").startswith("overview"):
                    report_notes["overviewPageFallbackMatches"] += 1
            else:
                scraped = scrape_keystone_node(node, lang=lang, timeout=timeout)
        except Exception as exc:
            network_errors.append(f"{node.get('name')}: {exc}")
            continue
        if not scraped:
            continue
        by_name[key] = scraped
        by_slug[scraped["slug"]] = scraped

    return by_name, by_slug, network_errors, report_notes



def pick_scrape_entry(name: str, scrape_by_name: dict, scrape_by_slug: dict):
    key = normalize_name_key(name)
    if key in scrape_by_name:
        entry = scrape_by_name[key]
        return entry, entry.get("matchedBy") or "name"
    slug = poe2db_slug(name)
    if slug in scrape_by_slug:
        entry = scrape_by_slug[slug]
        return entry, entry.get("matchedBy") or "slug"
    return None, None



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="us")
    ap.add_argument("--timeout", default=8.0, type=float)
    ap.add_argument("--disable-network", action="store_true")
    args = ap.parse_args()

    passive_skills = load_json(INPUT_PASSIVES)
    stats = load_json(INPUT_STATS)
    ascendancy_entries = load_json(INPUT_ASCENDANCY)
    passive_tree = load_json(INPUT_PASSIVE_TREE)

    stat_by_rid = {s.get("_rid"): s for s in stats}
    ascendancy_names_by_id = build_ascendancy_map_from_file(ascendancy_entries)
    passive_owner_by_id, _ = resolve_passive_ascendancy_owners(passive_skills, ascendancy_names_by_id)
    tree_adjacency = build_passive_tree_adjacency(passive_tree, passive_skills)
    distance_by_start = {
        start: shortest_path_distances(tree_adjacency, root)
        for start, root in PASSIVE_TREE_STARTS.items()
    }
    owned_distance_by_start = ascendancy_owned_distances(
        passive_tree, passive_skills, tree_adjacency, distance_by_start
    )

    target_nodes = []
    for node in passive_skills:
        cls = classify_node(node, ascendancy_names_by_id)
        if cls and cls["type"] in {"keystone", "ascendancy"}:
            target_nodes.append({
                "name": node.get("Name"),
                "type": cls["type"],
                "ascendancy": cls.get("ascendancy"),
            })

    scrape_by_name, scrape_by_slug, network_errors, scrape_notes = collect_scraped_passives(
        target_nodes,
        lang=args.lang,
        timeout=args.timeout,
        disable_network=args.disable_network,
    )

    report = {
        "totalKeystones": 0,
        "keystonesScrapeMatched": 0,
        "keystonesUnmatched": 0,
        "totalAscendancyNodes": 0,
        "ascendancyScrapeMatched": 0,
        "ascendancyUnmatched": 0,
        "nodesUsingScrapedLines": 0,
        "nodesUsingDataminedFallback": 0,
        "nodesWithTagsEnhancedByScraping": 0,
        "nodesUsingSanitizedScrapedLines": 0,
        "scrapeMatchesRejectedForBadLines": 0,
        "badScrapeLineSamples": [],
        "ascendancyBlankLinesAfterMerge": 0,
        "statlessAscendancyNodesUsingSkillFallback": 0,
        "scrapedFragmentRejections": 0,
        "overviewPageFallbackMatches": int(scrape_notes.get("overviewPageFallbackMatches", 0)),
        "unmatchedNames": [],
        "networkErrors": network_errors,
        "excludedNonCharacterNodes": 0,
        "excludedNonCharacterNodesBySkillType": {},
        "ordinaryNotablesMissingFromGraph": [],
    }

    excluded_by_skill_type = Counter()
    for node in passive_skills:
        skill_type = node.get("SkillType")
        if skill_type == 0:
            continue
        if classify_node(node, ascendancy_names_by_id, require_character_tree=False):
            excluded_by_skill_type[str(skill_type)] += 1
    report["excludedNonCharacterNodes"] = sum(excluded_by_skill_type.values())
    report["excludedNonCharacterNodesBySkillType"] = dict(sorted(excluded_by_skill_type.items()))

    enriched_nodes = []
    for node in passive_skills:
        classification = classify_node(node, ascendancy_names_by_id)
        if not classification:
            continue

        datamined_lines, raw_stats = extract_stat_lines(node, stat_by_rid, max_lines=2)
        derived_tags = derive_tags(raw_stats, datamined_lines)

        scrape_entry, matched_by = pick_scrape_entry(node.get("Name"), scrape_by_name, scrape_by_slug)
        node_type = classification["type"]
        raw_scraped_lines = list(scrape_entry.get("rawLines") or []) if scrape_entry else []
        scraped_lines = list(scrape_entry.get("lines") or []) if scrape_entry else []

        scrape_valid, scrape_rejected_reason = is_valid_scraped_description(scraped_lines, node.get("Name"), node_type) if scrape_entry else (False, None)
        should_prefer_scrape = node_type in {"keystone", "ascendancy"} and bool(scrape_entry) and scrape_valid

        skill_fallback_lines = []
        if (
            node_type == "ascendancy"
            and scrape_entry
            and not scrape_valid
            and not datamined_lines
            and not raw_stats
        ):
            skill_fallback = extract_skill_fallback_line(raw_scraped_lines)
            if skill_fallback:
                skill_fallback_lines = [skill_fallback]
                report["statlessAscendancyNodesUsingSkillFallback"] += 1

        final_lines = scraped_lines if should_prefer_scrape else (datamined_lines or skill_fallback_lines)
        description_source = "scraped" if should_prefer_scrape else "datamined"
        if skill_fallback_lines and not datamined_lines and not should_prefer_scrape:
            description_source = "skill_fallback"

        scraped_tags = derive_scraped_tags(scraped_lines) if scrape_entry and scrape_valid else []

        merged_tags = []
        tag_sources = []
        if node_type in {"keystone", "ascendancy"} and scraped_tags:
            merged_tags.extend(scraped_tags)
            tag_sources.append("scraped")
        if derived_tags:
            merged_tags.extend(derived_tags)
            tag_sources.append("derived")
        fallback_tags = conservative_text_fallback_tags(final_lines)
        if fallback_tags:
            merged_tags.extend(fallback_tags)
            tag_sources.append("text_fallback")
        final_tags = sorted(normalize_tag_list(merged_tags, expand=False, match_keys=False))

        if node_type == "keystone":
            report["totalKeystones"] += 1
            if scrape_entry:
                report["keystonesScrapeMatched"] += 1
            else:
                report["keystonesUnmatched"] += 1
                report["unmatchedNames"].append(node.get("Name"))
        elif node_type == "ascendancy":
            report["totalAscendancyNodes"] += 1
            if scrape_entry:
                report["ascendancyScrapeMatched"] += 1
            else:
                report["ascendancyUnmatched"] += 1
                report["unmatchedNames"].append(node.get("Name"))

        if should_prefer_scrape:
            report["nodesUsingScrapedLines"] += 1
            report["nodesUsingSanitizedScrapedLines"] += 1
        else:
            report["nodesUsingDataminedFallback"] += 1

        if scrape_entry and not scrape_valid:
            report["scrapeMatchesRejectedForBadLines"] += 1
            if scrape_rejected_reason and "fragment" in scrape_rejected_reason:
                report["scrapedFragmentRejections"] += 1
            if len(report["badScrapeLineSamples"]) < 12:
                report["badScrapeLineSamples"].append({
                    "name": node.get("Name"),
                    "type": node_type,
                    "reason": scrape_rejected_reason,
                    "rawSample": raw_scraped_lines[:6],
                    "sanitizedSample": scraped_lines[:6],
                })
        if node_type == "ascendancy" and not final_lines:
            report["ascendancyBlankLinesAfterMerge"] += 1
        if set(final_tags) - set(derived_tags):
            report["nodesWithTagsEnhancedByScraping"] += 1

        enriched_node = {
                "id": node.get("Id"),
                "type": node_type,
                "name": node.get("Name"),
                "ascendancyId": classification["ascendancyId"],
                "ascendancy": classification["ascendancy"],
                "icon": node.get("Icon_DDSFile"),
                "lines": final_lines,
                "tags": final_tags,
                "flavour": node.get("FlavourText") or "",
                "rawStats": raw_stats,
                "dataminedLines": datamined_lines,
                "scrapedLines": scraped_lines,
                "scrapedTags": scraped_tags,
                "derivedTags": derived_tags,
                "descriptionSource": description_source,
                "scrapeMatched": bool(scrape_entry),
                "scrapeMatchedBy": matched_by,
                "scrapeRejectedReason": scrape_rejected_reason if (scrape_entry and not scrape_valid) else None,
                "tagSources": sorted(set(tag_sources)),
            }
        required_ascendancy = passive_owner_by_id.get(node.get("Id"))
        if node_type in {"notable", "ascendancy"}:
            graph_id = node.get("PassiveSkillGraphId")
            locality_distances = owned_distance_by_start if required_ascendancy else distance_by_start
            starts = closest_passive_tree_starts(locality_distances, graph_id)
            if starts:
                enriched_node["passiveTreeStarts"] = starts
            elif node_type == "notable" and not required_ascendancy:
                report["ordinaryNotablesMissingFromGraph"].append({
                    "id": node.get("Id"), "name": node.get("Name"), "passiveSkillGraphId": graph_id
                })
        if required_ascendancy:
            enriched_node["requiredAscendancy"] = required_ascendancy
        enriched_nodes.append(enriched_node)

    type_order = {"keystone": 0, "ascendancy": 1, "notable": 2}
    enriched_nodes.sort(key=lambda n: (type_order.get(n.get("type"), 99), n.get("name") or ""))

    output = {
        "nodes": enriched_nodes,
        "ascendancies": {str(aid): {"id": int(aid), "name": nm} for aid, nm in ascendancy_names_by_id.items()},
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    report["unmatchedNames"] = sorted({x for x in report["unmatchedNames"] if x})
    report["ordinaryNotablesMissingFromGraph"].sort(key=lambda row: (row["name"] or "", row["id"] or ""))
    with OUTPUT_REPORT_FILE.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    counts = Counter(n["type"] for n in enriched_nodes)
    print(f"Wrote {len(enriched_nodes)} nodes to {OUTPUT_FILE}")
    print(f"Wrote scrape coverage report to {OUTPUT_REPORT_FILE}")
    print("By type:", dict(counts))


if __name__ == "__main__":
    main()
