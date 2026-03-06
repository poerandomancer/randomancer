#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.shared.file_utils import load_json, write_json
from scripts.shared.report_utils import utc_now_iso
from scripts.shared.unique_utils import build_unique_id

DATA = ROOT / 'data'


def _load_id_overrides() -> dict[str, str]:
    path = DATA / 'overrides' / 'merge_overrides' / 'uniques_id_overrides.json'
    if not path.exists():
        return {}
    payload = load_json(path)
    if not isinstance(payload, dict):
        return {}
    return {str(k): str(v) for k, v in payload.items()}


def build_canonical_uniques() -> dict[str, Any]:
    normalized_path = DATA / 'normalized' / 'scraped' / 'uniques_scraped_normalized.json'
    payload = load_json(normalized_path)
    items = payload.get('items', []) if isinstance(payload, dict) else []
    id_overrides = _load_id_overrides()

    canonical_items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    duplicate_ids: list[str] = []
    id_counts: dict[str, int] = {}

    for row in items:
        if not isinstance(row, dict):
            continue
        source_id = str(row.get('source_id', ''))
        merge_key = str(row.get('merge_key', ''))
        id_override = id_overrides.get(source_id, '') or id_overrides.get(merge_key, '')
        base_uid = build_unique_id(
            name=str(row.get('name', '')),
            slot=str(row.get('slot', '')),
            base_type=str(row.get('base_type', '')),
            source_id=source_id,
            id_override=id_override,
        )
        id_counts[base_uid] = id_counts.get(base_uid, 0) + 1
        uid = base_uid
        if id_counts[base_uid] > 1 and not id_override:
            slot_part = str(row.get('slot', '')).replace('_', '-')
            base_part = str(row.get('base_type', '')).lower().replace(' ', '-')
            uid = f"{base_uid}--{slot_part or 'slot'}--{base_part or 'base'}"
        if uid in seen_ids and uid not in duplicate_ids:
            duplicate_ids.append(uid)
        seen_ids.add(uid)

        mods = [*row.get('implicit_mods', []), *row.get('explicit_mods', [])]

        canonical_items.append(
            {
                'id': uid,
                'entity_type': 'unique',
                'name': row.get('name', ''),
                'slot': row.get('slot', ''),
                'item_class': row.get('item_class', ''),
                'base_type': row.get('base_type', ''),
                'description_readable': row.get('description_readable', ''),
                'mods': mods,
                'requirements': row.get('requirements', {}),
                'granted_skills': row.get('granted_skills', []),
                'source': {
                    'base': 'scraped',
                    'text': 'scraped',
                    'tags': 'generated',
                    'raw_refs': {
                        'source_id': source_id,
                        'source_url': row.get('source_url', ''),
                        'source_label': row.get('source_label', ''),
                        'merge_key': merge_key,
                    },
                },
                'source_tags': row.get('source_tags', []),
                'flavour_text': row.get('flavour_text', []),
            }
        )

    canonical = {
        '_meta': {
            'generated_at': utc_now_iso(),
            'source_policy': 'scraped_first',
            'source_file': 'data/normalized/scraped/uniques_scraped_normalized.json',
            'count': len(canonical_items),
            'duplicate_ids': duplicate_ids,
        },
        'items': canonical_items,
    }
    write_json(DATA / 'canonical' / 'uniques.json', canonical)

    return {
        'count': len(canonical_items),
        'duplicate_ids': duplicate_ids,
        'output': 'data/canonical/uniques.json',
    }


if __name__ == '__main__':
    print(build_canonical_uniques())
