#!/usr/bin/env python3
"""Hybrid passive enrichment pipeline for Randomancer.

Builds data/enriched/passives_enriched.json by combining datamined passive
structure with optional PoE2DB scraped lines/tags for keystones and
ascendancy nodes. Also emits data/enriched/passive_scrape_report.json.
"""

import argparse
import json
import re
import sys
from collections import Counter
from html import unescape
from pathlib import Path
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
]

HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parent
INPUT_PASSIVES = DATA_ROOT / "datamined" / "passiveskills.json"
INPUT_STATS = DATA_ROOT / "datamined" / "stats.json"
INPUT_ASCENDANCY = DATA_ROOT / "datamined" / "ascendancy.json"
OUTPUT_FILE = DATA_ROOT / "enriched" / "passives_enriched.json"
OUTPUT_REPORT_FILE = DATA_ROOT / "enriched" / "passive_scrape_report.json"
LEGACY_KEYSTONE_TOOLTIPS = DATA_ROOT / "enriched" / "keystone_tooltips.json"
POE2DB_HOST = "https://poe2db.tw"

MANUAL_SCRAPE_ALIASES = {
    "giants blood": "giant s blood",
}


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
    s = str(name or "").strip().replace("’", "'").replace(" ", "_")
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
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            out.append(line)
    return out


def derive_scraped_tags(lines):
    blob = "\n".join(lines or [])
    tags = []
    for rx, tag in SCRAPE_TAG_RULES:
        if rx.search(blob):
            tags.append(tag)
    return normalize_tag_list(tags, expand=False, match_keys=False)


def fallback_fetch_single_passive(name: str, lang: str, timeout: float = 8.0):
    html = fetch_html(f"{POE2DB_HOST}/{lang}/{poe2db_slug(name)}", timeout=timeout)
    lines = html_to_lines(html)
    idx = None
    node_key = normalize_name_key(name)
    for i, ln in enumerate(lines):
        if normalize_name_key(ln) == node_key:
            idx = i
            break
    if idx is None:
        return None

    collected = []
    for ln in lines[idx + 1:]:
        if re.search(r"^(community wiki|location|mechanics|vendor|related|gallery)\b", ln, flags=re.I):
            break
        if ln.lower() in {"keystone", "ascendancy", "notable", "passive"}:
            continue
        if len(ln) > 140 and collected:
            break
        if ln not in collected:
            collected.append(ln)
        if len(collected) >= 6:
            break

    if not collected:
        return None
    return {
        "name": name,
        "slug": poe2db_slug(name),
        "lines": collected,
        "tags": derive_scraped_tags(collected),
        "source": "poe2db",
    }


def load_legacy_keystone_scrapes(path: Path):
    payload = load_optional_json(path) or {}
    out = {}
    for name, row in payload.items():
        lines = [str(x).strip() for x in (row or {}).get("lines", []) if str(x).strip()]
        if not lines:
            continue
        out[normalize_name_key(name)] = {
            "name": name,
            "slug": poe2db_slug(name),
            "lines": lines,
            "tags": derive_scraped_tags(lines),
            "source": "legacy_keystone_tooltips",
        }
    return out


def collect_scraped_passives(target_nodes, lang: str, timeout: float, disable_network: bool):
    by_name = load_legacy_keystone_scrapes(LEGACY_KEYSTONE_TOOLTIPS)
    by_slug = {entry["slug"]: entry for entry in by_name.values()}
    network_errors = []

    if disable_network:
        return by_name, by_slug, network_errors

    for node in target_nodes:
        key = normalize_name_key(node.get("name"))
        if not key or key in by_name:
            continue
        try:
            scraped = fallback_fetch_single_passive(node.get("name"), lang=lang, timeout=timeout)
        except Exception as exc:
            network_errors.append(f"{node.get('name')}: {exc}")
            continue
        if not scraped:
            continue
        by_name[key] = scraped
        by_slug[scraped["slug"]] = scraped

    return by_name, by_slug, network_errors


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


def classify_node(node, ascendancy_names_by_id):
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


def pick_scrape_entry(name: str, scrape_by_name: dict, scrape_by_slug: dict):
    key = normalize_name_key(name)
    if key in scrape_by_name:
        return scrape_by_name[key], "name"
    slug = poe2db_slug(name)
    if slug in scrape_by_slug:
        return scrape_by_slug[slug], "slug"
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

    stat_by_rid = {s.get("_rid"): s for s in stats}
    ascendancy_names_by_id = build_ascendancy_map_from_file(ascendancy_entries)

    target_nodes = []
    for node in passive_skills:
        cls = classify_node(node, ascendancy_names_by_id)
        if cls and cls["type"] in {"keystone", "ascendancy"}:
            target_nodes.append({"name": node.get("Name"), "type": cls["type"]})

    scrape_by_name, scrape_by_slug, network_errors = collect_scraped_passives(
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
        "unmatchedNames": [],
        "networkErrors": network_errors,
    }

    enriched_nodes = []
    for node in passive_skills:
        classification = classify_node(node, ascendancy_names_by_id)
        if not classification:
            continue

        datamined_lines, raw_stats = extract_stat_lines(node, stat_by_rid, max_lines=2)
        derived_tags = derive_tags(raw_stats, datamined_lines)

        scrape_entry, matched_by = pick_scrape_entry(node.get("Name"), scrape_by_name, scrape_by_slug)
        scraped_lines = scrape_entry.get("lines", []) if scrape_entry else []
        scraped_tags = scrape_entry.get("tags", []) if scrape_entry else []

        node_type = classification["type"]
        should_prefer_scrape = node_type in {"keystone", "ascendancy"} and bool(scraped_lines)
        final_lines = scraped_lines if should_prefer_scrape else datamined_lines
        description_source = "scraped" if should_prefer_scrape else "datamined"

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
        else:
            report["nodesUsingDataminedFallback"] += 1
        if set(final_tags) - set(derived_tags):
            report["nodesWithTagsEnhancedByScraping"] += 1

        enriched_nodes.append(
            {
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
                "tagSources": sorted(set(tag_sources)),
            }
        )

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
    with OUTPUT_REPORT_FILE.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    counts = Counter(n["type"] for n in enriched_nodes)
    print(f"Wrote {len(enriched_nodes)} nodes to {OUTPUT_FILE}")
    print(f"Wrote scrape coverage report to {OUTPUT_REPORT_FILE}")
    print("By type:", dict(counts))


if __name__ == "__main__":
    main()
