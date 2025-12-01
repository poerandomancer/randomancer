#!/usr/bin/env python3
"""
enrich_uniques.py

Offline unique-item enrichment for Randomancer.

Reads datamined PoE2 unique data from:

    data/datamined/Uniques/*.json     (per-slot files: amulet.json, bow.json, ...)

and writes the compact, app-ready file:

    data/enriched/uniques_enriched.json

The output matches what core-script.js expects today:

{
  "items": [
    {
      "slot": "amulet",
      "name": "The Anvil",
      "base": "Bloodstone Amulet",
      "tags": {
        "canonical": ["Block"],
        "raw": ["block"]
      },
      "lines": [
        "The Anvil",
        "Bloodstone Amulet",
        "Variant: Pre 0.2.0",
        "Variant: Current",
        ...
      ]
    },
    ...
  ]
}

Option B behavior:
- If an item exists in the current uniques_enriched.json (by slot+name+base),
  we reuse its tags exactly.
- If it's new (future patches), we fall back to simple heuristics to seed tags;
  the JS side will still derive extra tags from `lines` as it does today.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


# ---------- seed loading (Option B core) ----------

def load_seed(seed_path: Path) -> tuple[Dict[tuple[str, str, str], Dict[str, Any]], Optional[set[str]]]:
    """
    Load existing uniques_enriched.json if present and build:
      - seed_by_key: (slot, name, base) -> tags dict
      - allowed_slots: set of slots seen in the seed (or None if no seed)
    """
    if not seed_path.exists():
        print(f"[enrich_uniques] No seed file at {seed_path}, running without tags seed")
        return {}, None

    try:
        with seed_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[enrich_uniques] WARNING: Failed to load seed {seed_path}: {e}", file=sys.stderr)
        return {}, None

    items = data.get("items") or []
    seed_by_key: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    slots: set[str] = set()

    for it in items:
        slot = it.get("slot")
        name = it.get("name")
        base = it.get("base")
        tags = it.get("tags") or {}
        if not slot or not name or not base:
            continue
        key = (slot, name, base)
        seed_by_key[key] = {
            "canonical": list(tags.get("canonical", [])),
            "raw": list(tags.get("raw", [])),
        }
        slots.add(slot)

    print(f"[enrich_uniques] Seed loaded: {len(seed_by_key)} items, slots = {sorted(slots)}")
    return seed_by_key, slots or None


# ---------- simple heuristics for new uniques ----------

def derive_tags(slot: str, lines: List[str], seed_tags: Optional[Dict[str, Any]]) -> Dict[str, List[str]]:
    """
    For items present in the seed, return an exact copy of the seed tags.
    For new items, apply simple heuristics and let JS do the heavy lifting
    from `lines` (deriveExtraTags, filterCanonicalsByEvidence, etc.).
    """
    if seed_tags is not None:
        return {
            "canonical": list(seed_tags.get("canonical", [])),
            "raw": list(seed_tags.get("raw", [])),
        }

    text = "\n".join(lines).lower()
    raw: set[str] = set()
    canon: set[str] = set()

    # Always include slot as a raw tag
    if slot:
        raw.add(slot)

    # Very lightweight heuristics – just enough to give new uniques a head start.
    def has(pattern: str) -> bool:
        return pattern in text

    # Elements / ailments
    if "ignite" in text or "ignited" in text or "burning" in text:
        raw.add("fire")
        canon.add("Ignite")
    if "cold " in text or " cold" in text or "freeze" in text or "frozen" in text or "chill" in text or "chilled" i
