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
}

CLASS_PREFIX_LABELS = {
    "huntress",
    "druid",
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
    "amazon",
    "ritualist",
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
    s = str(name or "").strip().replace("’", "'")
    s = s.replace("'", "")
    s = re.sub(r"[,!\.:;()\"“”‘’]+", " ", s)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s)
    s = s.strip("_")
    return quote(s, safe=":_-")


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
]

SKILL_PAGE_METADATA_PATTERNS = [
    re.compile(r"^level:\b", re.I),
    re.compile(r"^requires:\b", re.I),
    re.compile(r"^attack damage:\b", re.I),
    re.compile(r"^cooldown time:\b", re.I),
    re.compile(r"^additional effects from quality:\b", re.I),
    re.compile(r"^quality display\b", re.I),
    re.compile(r"^base [^:]{1,40}:", re.I),
    re.compile(r"^skill desired amount override\b", re.I),
    re.compile(r"^skill disabled unless cloned\b", re.I),
    re.compile(r"^hide minion frame\b", re.I),
    re.compile(r"^chance to be triggered\b", re.I),
    re.compile(r"^is area damage\b", re.I),
]


def is_site_metadata_line(line: str) -> bool:
    lowered = re.sub(r"\s+", " ", str(line or "")).strip()
    if not lowered:
        return True
    for rx in SITE_METADATA_PATTERNS:
        if rx.search(lowered):
            return True
    if "show full descriptions" in lowered.lower():
        return True
    if "passiveskillshash" in lowered.lower():
        return True
    if "iskeystone:" in lowered.lower() or "isnotable:" in lowered.lower():
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
    if re.search(r"\b(tags\s+iskeystone|isnotable|isascendancystart)\b", lowered, re.I):
        return True
    return False


def looks_incomplete_effect_line(line: str) -> bool:
    ln = re.sub(r"\s+", " ", str(line or "")).strip()
    if not ln:
        return True
    lowered = ln.lower()
    words = re.findall(r"[A-Za-z0-9%+']+", ln)

    if len(words) == 1 and lowered in {"gain", "you", "can", "instead", "with", "for", "of"}:
        return True
    if len(words) <= 2 and lowered in {"you can", "with hits instead", "deflection rating"}:
        return True
    if len(words) <= 3 and re.match(r"^(gain|base critical hit chance|deal up to|body armou?r grants)\b", lowered):
        return True
    if re.match(r"^(for|with|instead|and|or|to|of|from|per|when|while|consume)\b", lowered):
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
    if lowered.endswith((" for", " with", " of", " to", " per", " instead", " your", " can", " grants", " is")):
        return True
    return False


def strip_class_prefix_from_effect_line(line: str) -> str:
    ln = re.sub(r"\s+", " ", str(line or "")).strip()
    parts = ln.split(" ", 1)
    if len(parts) != 2:
        return ln
    prefix = normalize_name_key(parts[0])
    rest = parts[1].strip()
    if prefix not in CLASS_PREFIX_LABELS or not rest:
        return ln
    if re.match(r"^(grants?\s+skill\b|every\s+\d+|you\b|skills?\b|attacks?\b|hits?\b|life\b|mana\b|gain\b|deal\b|recover\b|projectiles?\b|totems?\b|minions?\b|while\b|when\b|\+\d)", rest, re.I):
        return rest
    return ln


def extract_meta_skill_page_lines(lines, node_name: str):
    if not lines:
        return []
    attr_idx = find_best_attr_index(lines, node_name, "ascendancy")
    end = attr_idx if attr_idx is not None else min(len(lines), 80)
    head = lines[:end]

    node_key = normalize_name_key(node_name)
    start = 0
    matches = [i for i, ln in enumerate(head) if normalize_name_key(ln) == node_key]
    if matches:
        start = matches[-1] + 1

    block = []
    skill_style_cues = 0
    for ln in head[start:start + 36]:
        low = ln.lower().strip()
        if not low:
            continue
        if re.match(r"^(ascendancy|character|class)\s*:", ln, re.I):
            continue
        if re.search(r"^(requires:|attack damage:|cooldown time:|version history|community wiki|supported by|recommended support gems|skill gem|support gem)", low):
            break
        if is_site_metadata_line(ln) or is_skill_page_metadata_line(ln):
            continue
        if low in CLASS_NAMES:
            continue
        if normalize_name_key(ln) == node_key:
            continue
        if re.search(r"\b(grants?\s+skill|cooldown|critical hit chance|projectile|mirage|mark|fires?)\b", low):
            skill_style_cues += 1
        block.append(ln)

    if skill_style_cues == 0:
        return []
    return block


def is_skill_page_metadata_line(line: str) -> bool:
    lowered = re.sub(r"\s+", " ", str(line or "")).strip()
    if not lowered:
        return True
    for rx in SKILL_PAGE_METADATA_PATTERNS:
        if rx.search(lowered):
            return True
    return False


def sanitize_scraped_lines(lines, node_name, node_type, ascendancy_name=None):
    node_key = normalize_name_key(node_name)
    ascendancy_key = normalize_name_key(ascendancy_name or "")
    out = []
    seen = set()

    for raw in lines or []:
        ln = re.sub(r"\s+", " ", str(raw or "")).strip()
        ln = strip_class_prefix_from_effect_line(ln)
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
        if node_type == "ascendancy" and re.match(r"^(ascendancy|character|class)\b", lowered) and len(ln.split()) <= 4:
            continue
        if lowered_no_space in {"ascendancy", "character", "class", "attr/5", "attr/10"}:
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
        if re.match(r"^(gain|deal up to|you have|\+\d+ to|enemies in your|body armou?r grants|can only use a|modifiers to|reserves? \d+% of life|every \d+ rage)\b", lowered) and len(words) <= 6:
            incomplete_like += 1
        if lowered.endswith((" to", " up to", " your", " have", " grants", " can", " with", " from", " of", " per")):
            incomplete_like += 1
        if looks_incomplete_effect_line(ln):
            incomplete_like += 1
        if re.search(r"\b(gain|gains|increased|more|less|chance|when|while|cannot|you|deal|recover|inflict|consume|trigger|convert|converts|grants|regenerate|maximum|additional|reserve|reserves|apply|applies|damage|charges?|hits?|attacks?|spells?|totems?|projectiles?|armour|evasion|mana|life|shield|resistance|surges?)\b", lowered):
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


def stitch_scraped_fragments(raw_lines, node_name, node_type):
    cleaned = []
    seen = set()
    for raw in raw_lines or []:
        ln = re.sub(r"\s+", " ", str(raw or "")).strip()
        if not ln:
            continue
        if re.fullmatch(r"[^\w]+", ln) and ln != "%":
            continue
        if ln not in seen:
            seen.add(ln)
            cleaned.append(ln)

    stitched = []

    def is_fragment_start(line: str) -> bool:
        l = line.lower().strip()
        return bool(re.search(r"(\+\d+ to|deal up to|you have|gain|enemies in your|body armou?r grants)$", l))

    def is_fragment_piece(line: str) -> bool:
        words = re.findall(r"[A-Za-z0-9%+']+", line)
        if re.fullmatch(r"\(?\d+[—-]\d+\)?", line):
            return True
        if re.fullmatch(r"[+\-]?\d+(?:\.\d+)?%?", line):
            return True
        return len(words) <= 3

    def line_starts_like_suffix(line: str) -> bool:
        return bool(re.match(r"^(for|with|instead|of|from|per|to|and|or|you can|consume)\b", line.lower().strip()))

    for ln in cleaned:
        if not stitched:
            stitched.append(ln)
            continue

        prev = stitched[-1]
        prev_lower = prev.lower().strip()
        should_merge = (
            is_fragment_start(prev)
            or prev_lower.endswith((" to", " have", " up to", " your", " grants", " gain"))
            or (is_fragment_piece(prev) and is_fragment_piece(ln))
            or ln.startswith("%")
            or line_starts_like_suffix(ln)
            or looks_incomplete_effect_line(prev)
        )

        if not should_merge:
            stitched.append(ln)
            continue

        joiner = ""
        if not (ln.startswith("%") and re.search(r"\d$", prev)):
            joiner = " "
        merged = re.sub(r"\s+", " ", f"{prev}{joiner}{ln}".strip())
        if len(merged) <= 180:
            stitched[-1] = merged
        else:
            stitched.append(ln)

    out = []
    seen_out = set()
    for ln in stitched:
        if ln not in seen_out:
            seen_out.add(ln)
            out.append(ln)
    repaired = []
    for idx, ln in enumerate(out):
        if not repaired:
            repaired.append(ln)
            continue
        prev = repaired[-1]
        if looks_incomplete_effect_line(prev) or line_starts_like_suffix(ln):
            merged = re.sub(r"\s+", " ", f"{prev} {ln}").strip()
            if len(merged) <= 180:
                repaired[-1] = merged
                continue
        repaired.append(ln)

    return repaired


def clean_skill_name_candidate(value: str):
    c = re.sub(r"\s+", " ", str(value or "")).strip(" -:•,.")
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

def derive_scraped_tags(lines):
    blob = "\n".join(lines or [])
    tags = []
    for rx, tag in SCRAPE_TAG_RULES:
        if rx.search(blob):
            tags.append(tag)
    return normalize_tag_list(tags, expand=False, match_keys=False)


def is_attr_heading_for_name(line: str, name: str) -> bool:
    if not line or "attr /" not in line.lower():
        return False
    stripped = re.sub(r"^#+\s*", "", str(line or "")).strip()
    stripped = re.sub(r"\s*attr\s*/\s*\d+.*$", "", stripped, flags=re.I).strip()
    return normalize_name_key(stripped) == normalize_name_key(name)


def find_best_attr_index(lines, name: str, node_type: str):
    candidates = []
    for i, ln in enumerate(lines or []):
        if not is_attr_heading_for_name(ln, name):
            continue
        lookback = lines[max(0, i - 18):i]
        score = i
        if node_type == "ascendancy":
            if any(re.match(r"^ascendancy\s*:", x, re.I) for x in lookback):
                score += 10000
            if any(re.match(r"^character\s*:", x, re.I) for x in lookback):
                score += 10000
            if any("grants skill" in x.lower() for x in lookback):
                score += 2500
        else:
            if any(normalize_name_key(x) == normalize_name_key(name) for x in lookback):
                score += 1000
        candidates.append((score, i))
    if not candidates:
        return None
    candidates.sort()
    return candidates[-1][1]


def extract_attr_section_lines(lines, name: str, node_type: str):
    attr_idx = find_best_attr_index(lines, name, node_type)
    if attr_idx is None:
        return []

    node_key = normalize_name_key(name)
    window_start = max(0, attr_idx - 24)
    window = lines[window_start:attr_idx]
    anchor = None

    if node_type == "ascendancy":
        for j in range(len(window) - 1, -1, -1):
            if re.match(r"^character\s*:", window[j], re.I):
                anchor = j + 1
                break
        if anchor is None:
            for j in range(len(window) - 1, -1, -1):
                if re.match(r"^ascendancy\s*:", window[j], re.I):
                    anchor = j + 1
                    break

    if anchor is None:
        for j in range(len(window) - 1, -1, -1):
            if normalize_name_key(window[j]) == node_key:
                anchor = j + 1
                break

    if anchor is None:
        anchor = 0

    collected = []
    for ln in window[anchor:]:
        lowered = ln.lower().strip()
        if not lowered:
            continue
        if is_site_metadata_line(ln):
            continue
        if re.match(r"^(ascendancy|character|class)\s*:", ln, re.I):
            continue
        if lowered in CLASS_NAMES:
            continue
        if normalize_name_key(ln) == node_key:
            continue
        collected.append(ln)

    return collected


def extract_node_lines_from_ascendancy_overview(lines, node_name: str):
    node_key = normalize_name_key(node_name)
    start_indices = [i for i, ln in enumerate(lines or []) if normalize_name_key(ln) == node_key]
    if not start_indices:
        return []

    best = start_indices[-1]
    for idx in start_indices:
        window = lines[idx:idx + 48]
        if any(is_attr_heading_for_name(x, node_name) for x in window):
            best = idx
            break

    block = []
    for ln in lines[best + 1:best + 48]:
        low = ln.lower().strip()
        if not low:
            continue
        if normalize_name_key(ln) == node_key and block:
            break
        if re.search(r"^(community wiki|version history|patch notes|wikis content|sites|news|about site|community)\b", low):
            break
        if re.search(r"\b(attr\s*/\s*\d+)\b", low) and block:
            break
        if re.match(r"^(ascendancy|character|class)\s*:", ln, re.I):
            continue
        block.append(ln)
    return block


def fallback_fetch_single_passive(name: str, node_type: str, lang: str, timeout: float = 8.0, ascendancy_name: str = None):
    direct_404 = False
    try:
        html = fetch_html(f"{POE2DB_HOST}/{lang}/{poe2db_slug(name)}", timeout=timeout)
    except Exception as exc:
        if getattr(exc, "code", None) == 404 and node_type == "ascendancy" and ascendancy_name:
            direct_404 = True
            html = ""
        else:
            raise

    lines = html_to_lines(html) if html else []

    collected = []
    used_overview_fallback = False
    source = "poe2db"
    if lines:
        if node_type == "ascendancy":
            skill_style_lines = extract_meta_skill_page_lines(lines, name)
            if skill_style_lines:
                collected = skill_style_lines
                source = "poe2db_skill_page"
        if not collected:
            collected = extract_attr_section_lines(lines, name, node_type)
    if lines and not collected:
        idx = None
        node_key = normalize_name_key(name)
        matching_indices = [i for i, ln in enumerate(lines) if normalize_name_key(ln) == node_key]
        if matching_indices:
            idx = matching_indices[-1]
        if idx is None:
            return None

        for ln in lines[idx + 1:]:
            lower = ln.lower().strip()
            if re.search(r"^(community wiki|location|mechanics|vendor|related|gallery|version history|patch notes|item acquisition|supported by|wikis content|sites|news|about site|community)\b", lower, flags=re.I):
                break
            if normalize_name_key(ln) == node_key and collected:
                break
            if lower in {"keystone", "ascendancy", "notable", "passive"}:
                continue
            if ln not in collected:
                collected.append(ln)
            if len(collected) >= 20:
                break

    if (direct_404 or not collected) and node_type == "ascendancy" and ascendancy_name:
        try:
            overview_html = fetch_html(f"{POE2DB_HOST}/{lang}/{poe2db_slug(ascendancy_name)}", timeout=timeout)
            overview_lines = html_to_lines(overview_html)
            local_block = extract_node_lines_from_ascendancy_overview(overview_lines, name)
            if not local_block:
                local_block = extract_attr_section_lines(overview_lines, name, node_type)
            if local_block:
                collected = local_block
                used_overview_fallback = True
                source = "poe2db_overview"
        except Exception:
            pass

    stitched = stitch_scraped_fragments(collected, name, node_type)
    sanitized = sanitize_scraped_lines(stitched, name, node_type)
    metadata_only = bool(collected) and not sanitized
    if not sanitized and not collected:
        return None
    return {
        "name": name,
        "slug": poe2db_slug(name),
        "rawLines": collected,
        "lines": sanitized,
        "tags": derive_scraped_tags(sanitized),
        "metadataOnly": metadata_only,
        "source": "poe2db_overview" if used_overview_fallback else source,
    }


def load_legacy_keystone_scrapes(path: Path):
    payload = load_optional_json(path) or {}
    out = {}
    for name, row in payload.items():
        raw_lines = [str(x).strip() for x in (row or {}).get("lines", []) if str(x).strip()]
        stitched = stitch_scraped_fragments(raw_lines, name, "keystone")
        lines = sanitize_scraped_lines(stitched, name, "keystone")
        if not lines:
            continue
        out[normalize_name_key(name)] = {
            "name": name,
            "slug": poe2db_slug(name),
            "rawLines": raw_lines,
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
            scraped = fallback_fetch_single_passive(
                node.get("name"),
                node.get("type"),
                lang=lang,
                timeout=timeout,
                ascendancy_name=node.get("ascendancy"),
            )
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
            target_nodes.append({"name": node.get("Name"), "type": cls["type"], "ascendancy": cls.get("ascendancy")})

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
        "nodesUsingSanitizedScrapedLines": 0,
        "scrapeMatchesRejectedForBadLines": 0,
        "badScrapeLineSamples": [],
        "ascendancyBlankLinesAfterMerge": 0,
        "statlessAscendancyNodesUsingSkillFallback": 0,
        "scrapedFragmentRejections": 0,
        "overviewPageFallbackMatches": 0,
        "truncatedFragmentRejections": 0,
        "footerLeakRejections": 0,
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
        node_type = classification["type"]
        raw_scraped_lines = scrape_entry.get("rawLines") if scrape_entry else []
        if not raw_scraped_lines and scrape_entry:
            raw_scraped_lines = scrape_entry.get("lines", [])
        stitched_scraped_lines = stitch_scraped_fragments(raw_scraped_lines, node.get("Name"), node_type) if scrape_entry else []
        scraped_lines = sanitize_scraped_lines(
            stitched_scraped_lines,
            node.get("Name"),
            node_type,
            ascendancy_name=classification.get("ascendancy"),
        ) if scrape_entry else []

        scrape_valid, scrape_rejected_reason = is_valid_scraped_description(scraped_lines, node.get("Name"), node_type) if scrape_entry else (False, None)
        if scrape_entry and not scrape_valid and scrape_entry.get("metadataOnly"):
            scrape_rejected_reason = "metadata_only_page"
        should_prefer_scrape = node_type in {"keystone", "ascendancy"} and bool(scrape_entry) and scrape_valid

        if scrape_entry and scrape_entry.get("source") == "poe2db_overview":
            report["overviewPageFallbackMatches"] += 1
        if scrape_entry and any(is_site_metadata_line(x) for x in raw_scraped_lines):
            report["footerLeakRejections"] += 1

        skill_fallback_lines = []
        if (
            node_type == "ascendancy"
            and scrape_entry
            and not scrape_valid
            and not raw_stats
        ):
            skill_fallback = extract_skill_fallback_line(raw_scraped_lines)
            if skill_fallback:
                skill_fallback_lines = [skill_fallback]
                report["statlessAscendancyNodesUsingSkillFallback"] += 1

        final_lines = scraped_lines if should_prefer_scrape else (datamined_lines or skill_fallback_lines)
        description_source = "scraped" if should_prefer_scrape else "datamined"

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
            if scrape_rejected_reason and ("incomplete" in scrape_rejected_reason or "fragment" in scrape_rejected_reason):
                report["truncatedFragmentRejections"] += 1
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
                "scrapeRejectedReason": scrape_rejected_reason if (scrape_entry and not scrape_valid) else None,
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
