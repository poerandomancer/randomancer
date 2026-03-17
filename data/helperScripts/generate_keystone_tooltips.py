#!/usr/bin/env python3
"""
generate_keystone_tooltips.py

Generates data/enriched/keystone_tooltips.json (name -> {lines:[...]})
by scraping the PoE2DB keystone listing page and filtering to the
(non-Atlas) keystones present in your local passives_enriched.json.

Why scrape?
- Your datamined passives currently lack full English stat-line translations,
  so passives_enriched.json often contains placeholder lines like "Keystone X".
- PoE2DB maintains the human-readable keystone effect lines we want for tooltips.

Usage:
  python3 generate_keystone_tooltips.py \
    --passives-enriched data/enriched/passives_enriched.json \
    --out data/enriched/keystone_tooltips.json \
    --lang us

Dependencies:
  pip install requests beautifulsoup4
  (BeautifulSoup is optional; the script falls back to a simple HTML-stripper.)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import requests

try:
    from bs4 import BeautifulSoup  # type: ignore
except Exception:
    BeautifulSoup = None  # type: ignore


POE2DB_HOST = "https://poe2db.tw"
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]


def resolve_repo_path(path_str: str) -> Path:
    path = Path(path_str)
    return path if path.is_absolute() else REPO_ROOT / path



def load_project_keystone_names(passives_enriched_path: Path) -> Tuple[Set[str], Set[str]]:
    """
    Returns (keystone_names, excluded_names).

    Excludes Atlas/map-only keystones by checking rawStats ids containing "atlas_".
    Also excludes talisman/form-only special keystones (commonly non-tree keystones).
    """
    data = json.loads(passives_enriched_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])
    keystones = [n for n in nodes if n.get("type") == "keystone" and n.get("name")]

    excluded = set()
    included = set()

    for n in keystones:
        name = str(n["name"]).strip()
        raw_stats = n.get("rawStats") or []
        raw_ids = [str(s.get("id", "")) for s in raw_stats if isinstance(s, dict)]

        # Exclude Atlas keystones and similar map-only modifiers
        if any(rid.startswith("atlas_") or "atlas_keystone" in rid for rid in raw_ids):
            excluded.add(name)
            continue

        # Exclude talisman/form-only oddballs (keeps the keystone tooltips tree-focused)
        if any("talisman" in rid for rid in raw_ids):
            excluded.add(name)
            continue

        included.add(name)

    return included, excluded


def fetch_html(url: str, timeout: float = 20.0) -> str:
    r = requests.get(url, timeout=timeout, headers={"User-Agent": "Randomancer/keystone-tooltips (https://therandomancer.com)"})
    r.raise_for_status()
    return r.text


def html_to_lines(html: str) -> List[str]:
    """
    Convert HTML into a line list suitable for text-parsing.
    Prefers BeautifulSoup when available.
    """
    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text("\n")
    else:
        # crude fallback: strip tags
        text = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
        text = re.sub(r"<[^>]+>", "\n", text)
        text = re.sub(r"&nbsp;", " ", text)

    # Normalize whitespace but preserve line breaks
    lines = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            lines.append("")
            continue
        # Collapse repeated spaces/tabs
        s = re.sub(r"[ \t]+", " ", s)
        lines.append(s)
    return lines


def extract_keystone_lines_from_listing(
    lines: List[str],
    keystone_names: Set[str],
) -> Dict[str, List[str]]:
    """
    Parses the PoE2DB Keystone listing page (Keystone Passive section),
    using local keystone_names to identify headers.
    """
    # Locate the start of the Keystone Passive section.
    start_idx = None
    for i, ln in enumerate(lines):
        if re.search(r"^Keystone Passive\b", ln, flags=re.I):
            start_idx = i
            break

    if start_idx is None:
        raise RuntimeError("Could not find 'Keystone Passive' section in page text. PoE2DB markup may have changed.")

    # Stop at the Timeless section (we intentionally ignore it)
    stop_idx = None
    for i in range(start_idx + 1, len(lines)):
        if re.search(r"^Timeless Jewel Keystone\b", lines[i], flags=re.I):
            stop_idx = i
            break

    if stop_idx is None:
        stop_idx = len(lines)

    # Parse blocks: <NAME> then stat lines until next <NAME>
    out: Dict[str, List[str]] = {}
    current_name: Optional[str] = None
    current_lines: List[str] = []

    noise = {
        "reset",
        "keystone",
        "read more",
    }

    def commit():
        nonlocal current_name, current_lines
        if not current_name:
            return
        clean = [ln.strip() for ln in current_lines if ln and ln.strip()]
        # Remove accidental header echoes
        clean = [ln for ln in clean if ln.lower() not in noise]
        # De-dupe while preserving order
        seen = set()
        dedup = []
        for ln in clean:
            if ln in seen:
                continue
            seen.add(ln)
            dedup.append(ln)
        if dedup:
            out[current_name] = dedup
        current_name = None
        current_lines = []

    for ln in lines[start_idx:stop_idx]:
        if not ln or ln.lower() in noise:
            continue

        if ln in keystone_names:
            # New keystone
            commit()
            current_name = ln
            current_lines = []
            continue

        if current_name:
            # Filter out junk lines that sometimes appear in the listing
            if ln.startswith("Image") or ln.startswith("*"):
                continue
            if re.search(r"^PoE DB\b", ln, flags=re.I):
                continue
            current_lines.append(ln)

    commit()
    return out


def poe2db_slug(name: str) -> str:
    """
    Converts a keystone name into a PoE2DB page slug.
    Note: the listing scrape should cover almost everything; per-page fetch is fallback.
    """
    s = name.replace("’", "'")
    s = s.replace(" ", "_")
    # URL encode apostrophes etc.
    from urllib.parse import quote
    return quote(s, safe=":_-")


def fallback_fetch_single_keystone(name: str, lang: str, timeout: float = 20.0) -> Optional[List[str]]:
    """
    Fallback: fetch a keystone's own page and try to extract its short effect lines.
    This is intentionally conservative; if parsing fails, returns None.
    """
    url = f"{POE2DB_HOST}/{lang}/{poe2db_slug(name)}"
    html = fetch_html(url, timeout=timeout)
    lines = html_to_lines(html)

    # Heuristic: find the first occurrence of the name, then collect following short lines
    # until a blank line or a big section marker.
    idx = None
    for i, ln in enumerate(lines):
        if ln == name:
            idx = i
            break
    if idx is None:
        return None

    collected = []
    for ln in lines[idx + 1:]:
        if not ln:
            if collected:
                break
            continue
        if re.search(r"^(Community Wiki|Edit|Contents|Location|Mechanics)\b", ln, flags=re.I):
            break
        # stop once we hit a large paragraph
        if len(ln) > 120:
            break
        # Skip “Keystone” label lines
        if ln.lower() in {"keystone", "passive"}:
            continue
        collected.append(ln)

        # Most keystones are 2–4 lines; don't over-collect.
        if len(collected) >= 6:
            break

    collected = [c.strip() for c in collected if c.strip()]
    return collected or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--passives-enriched", default="data/enriched/passives_enriched.json", type=str)
    ap.add_argument("--out", default="data/enriched/keystone_tooltips.json", type=str)
    ap.add_argument("--lang", default="us", type=str, help="PoE2DB locale (us, fr, de, etc.)")
    ap.add_argument("--timeout", default=20.0, type=float)
    ap.add_argument("--allow-fallback", action="store_true", help="Try per-keystone pages for any missing names.")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    passives_path = resolve_repo_path(args.passives_enriched)
    out_path = resolve_repo_path(args.out)

    if not passives_path.exists():
        print(f"[error] passives_enriched not found: {passives_path}", file=sys.stderr)
        return 2

    keystone_names, excluded = load_project_keystone_names(passives_path)
    if args.verbose:
        print(f"[info] project keystones: {len(keystone_names)} (excluded: {len(excluded)})")

    listing_url = f"{POE2DB_HOST}/{args.lang}/Keystone"
    if args.verbose:
        print(f"[info] fetching: {listing_url}")

    html = fetch_html(listing_url, timeout=args.timeout)
    lines = html_to_lines(html)
    parsed = extract_keystone_lines_from_listing(lines, keystone_names)

    missing = sorted(keystone_names - set(parsed.keys()))
    if missing and args.allow_fallback:
        if args.verbose:
            print(f"[warn] {len(missing)} missing from listing parse; trying per-keystone fallback…")
        for name in missing:
            try:
                got = fallback_fetch_single_keystone(name, args.lang, timeout=args.timeout)
                if got:
                    parsed[name] = got
                    if args.verbose:
                        print(f"[ok] fallback fetched: {name}")
                else:
                    if args.verbose:
                        print(f"[miss] fallback failed: {name}")
            except Exception as e:
                if args.verbose:
                    print(f"[miss] fallback error for {name}: {e}")

        missing = sorted(keystone_names - set(parsed.keys()))

    # Build final JSON structure (name -> {lines:[...]})
    out_obj = {name: {"lines": parsed[name]} for name in sorted(parsed.keys())}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if missing:
        print(f"[warn] Missing keystones (no tooltip lines found): {missing}", file=sys.stderr)
        print("[warn] You can re-run with --allow-fallback to try individual pages.", file=sys.stderr)

    if args.verbose:
        print(f"[done] wrote: {out_path} ({len(out_obj)} keystones)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
