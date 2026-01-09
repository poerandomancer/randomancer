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
    if "cold " in text or " cold" in text or "freeze" in text or "frozen" in text or "chill" in text or "chilled" in text:
        raw.add("cold")
        canon.add("Freeze")
    if "lightning" in text or "shock" in text or "shocked" in text:
        raw.add("lightning")
        canon.add("Shock")
    if "chaos" in text:
        raw.add("chaos")
        if "damage over time" in text:
            canon.add("Chaos Damage Over Time")

    # Physical-ish
    if "physical damage" in text:
        raw.add("physical")

    # Bleed / poison
    if "bleeding" in text or "bleed" in text:
        raw.add("bleed")
        canon.add("Bleed")
    if "poison" in text:
        raw.add("poison")
        canon.add("Poison")

    # Block / deflection
    if "block" in text:
        raw.add("block")
        canon.add("Block")
        canon.add("Deflection")

    # Crit
    if "critical" in text:
        raw.add("critical")
        canon.add("Critical Hit")

    # Leech / regen
    if "leech" in text:
        raw.add("leech")
        raw.add("life leech")
        canon.add("Leech")
    if "regenerate" in text or "regeneration" in text:
        raw.add("life regeneration")
        canon.add("Life Regeneration")

    # Marks / curses
    if " mark " in text or text.startswith("mark ") or " marks " in text:
        raw.add("mark")
        canon.add("Mark")
    if "marks " in text or " marks\n" in text:
        raw.add("marks")
        canon.add("Marks")
    if "curse " in text or " curses" in text or "hex " in text or "hexes" in text:
        raw.add("curses")
        canon.add("Curses")

    # Minions / companions
    if "minion" in text or "minions" in text:
        raw.add("minions")
        canon.add("Minions")
    if "companion" in text or "companions" in text:
        raw.add("companions")
        canon.add("Companions")

    # Totems / warcries
    if "totem" in text or "totems" in text:
        raw.add("totems")
        canon.add("Totems")
    if "warcry" in text or "warcries" in text:
        raw.add("warcry")
        canon.add("Warcry")

    # Stun / slow / culling / thorns
    if "stun" in text or "stunned" in text:
        raw.add("stun")
        canon.add("Heavy Stun")
    if (
        " maim" in text
        or "maimed" in text
        or " hinder" in text
        or "hindered" in text
        or "reduced movement speed" in text
        or "less movement speed" in text
        or "reduced action speed" in text
        or "less action speed" in text
        or "slows" in text
    ):
        raw.add("slow")
        canon.add("Slow/Maim/Hinder")
    if "culling strike" in text:
        raw.add("cullingstrike")
        canon.add("Culling Strike")
    if "reflects" in text and "damage" in text:
        raw.add("thorns")
        canon.add("Thorns")

    # Elemental infusions / generic
    if "exposure" in text:
        canon.add("Elemental Infusions")

    # Summon
    if "summon " in text or "summoned" in text:
        canon.add("Summon")

    return {
        "canonical": sorted(canon),
        "raw": sorted(raw),
    }


# ---------- datamined reader ----------

def iter_datamined_items(uniques_root: Path, allowed_slots: Optional[set[str]]) -> Iterable[Dict[str, Any]]:
    """
    Iterate over per-slot JSON files in data/datamined/Uniques.

    Each file is a list of newline-joined strings. We convert each into:
      { "slot": <slot>, "name": <line0>, "base": <line1>, "lines": [all lines...] }
    """
    if not uniques_root.exists():
        print(f"[enrich_uniques] ERROR: {uniques_root} does not exist", file=sys.stderr)
        return

    for path in sorted(uniques_root.glob("*.json")):
        slot = path.stem
        if allowed_slots is not None and slot not in allowed_slots:
            # Seed says we don't currently use this slot in the app; skip it for now.
            continue

        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"[enrich_uniques] WARNING: Failed to load {path}: {e}", file=sys.stderr)
            continue

        if not isinstance(data, list):
            continue

        for text in data:
            if not isinstance(text, str):
                continue
            lines = text.splitlines()
            if len(lines) < 2:
                continue
            name = lines[0].strip()
            base = lines[1].strip()
            if not name and not base:
                continue

            yield {
                "slot": slot,
                "name": name,
                "base": base,
                "lines": lines,
            }


# ---------- main pipeline ----------

def main(argv: Sequence[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])

    here = Path(__file__).resolve().parent
    data_root = here.parent                                 # data/
    uniques_root = data_root / "datamined" / "Uniques"
    out_dir = data_root / "enriched"
    out_path = out_dir / "uniques_enriched.json"
    seed_path = out_path  # we seed from the same file we write to

    seed_by_key, allowed_slots = load_seed(seed_path)

    items_out: List[Dict[str, Any]] = []
    seeded_count = 0
    heuristic_count = 0

    for item in iter_datamined_items(uniques_root, allowed_slots):
        key = (item["slot"], item["name"], item["base"])
        seed_tags = seed_by_key.get(key)
        tags = derive_tags(item["slot"], item["lines"], seed_tags)
        if seed_tags is not None:
            seeded_count += 1
        else:
            heuristic_count += 1

        items_out.append({
            "slot": item["slot"],
            "name": item["name"],
            "base": item["base"],
            "tags": tags,
            "lines": item["lines"],
        })

    out_dir.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"items": items_out}, f, ensure_ascii=False, indent=2)

    print(
        f"[enrich_uniques] Wrote {len(items_out)} unique items to {out_path} "
        f"({seeded_count} from seed, {heuristic_count} heuristic)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
