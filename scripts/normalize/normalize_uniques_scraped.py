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
from scripts.shared.tag_utils import process_tags
from scripts.shared.unique_utils import normalize_slot, unique_merge_key

DATA = ROOT / 'data'


def _source_path() -> Path:
    preferred = DATA / 'raw' / 'scraped' / 'poe2db_uniques_min.json'
    fallback = DATA / 'enriched' / 'poe2db_uniques_min.json'
    return preferred if preferred.exists() else fallback


def _load_field_overrides() -> dict[str, Any]:
    path = DATA / 'overrides' / 'field_overrides' / 'uniques.json'
    if not path.exists():
        return {}
    payload = load_json(path)
    return payload if isinstance(payload, dict) else {}


def normalize_scraped_uniques() -> dict[str, Any]:
    src_path = _source_path()
    payload = load_json(src_path)
    items = payload.get('items', {}) if isinstance(payload, dict) else {}
    field_overrides = _load_field_overrides()

    by_source = field_overrides.get('by_source_id', {}) if isinstance(field_overrides.get('by_source_id', {}), dict) else {}
    by_name = field_overrides.get('by_name', {}) if isinstance(field_overrides.get('by_name', {}), dict) else {}

    normalized: list[dict[str, Any]] = []
    missing_slot = 0
    missing_base = 0

    for source_id, raw in items.items():
        if not isinstance(raw, dict):
            continue

        name = str(raw.get('name') or '').strip()
        base_type = str(raw.get('base') or '').strip()
        slot_raw = str(raw.get('slot') or '').strip()

        record: dict[str, Any] = {
            'source_id': str(source_id),
            'source_url': str((raw.get('source') or {}).get('url', '')),
            'source_label': str((raw.get('source') or {}).get('label', '')),
            'name': name,
            'base_type': base_type,
            'slot_raw': slot_raw,
            'slot': normalize_slot(slot_raw),
            'item_class': normalize_slot(slot_raw),
            'requirements': raw.get('requirements') or {},
            'implicit_mods': [str(x).strip() for x in (raw.get('implicit_mods') or []) if str(x).strip()],
            'explicit_mods': [str(x).strip() for x in (raw.get('explicit_mods') or []) if str(x).strip()],
            'flavour_text': [str(x).strip() for x in (raw.get('flavour_text') or []) if str(x).strip()],
            'granted_skills': [str(x).strip() for x in (raw.get('granted_skills') or []) if str(x).strip()],
            'source_tags': process_tags(list(raw.get('tags') or []), entity='uniques').tags,
        }

        # apply overrides by source_id, then by name
        if record['source_id'] in by_source and isinstance(by_source[record['source_id']], dict):
            record.update(by_source[record['source_id']])
        if record['name'] in by_name and isinstance(by_name[record['name']], dict):
            record.update(by_name[record['name']])

        record['slot'] = normalize_slot(record.get('slot') or record.get('slot_raw'))
        record['item_class'] = record['slot']
        record['merge_key'] = unique_merge_key(record.get('name', ''), record.get('slot', ''), record.get('base_type', ''))
        text_lines = [*record['implicit_mods'], *record['explicit_mods']]
        record['description_readable'] = '\n'.join(text_lines)

        if not record['slot']:
            missing_slot += 1
        if not record['base_type']:
            missing_base += 1

        normalized.append(record)

    normalized.sort(key=lambda r: (r.get('name', ''), r.get('base_type', '')))

    out = {
        '_meta': {
            'generated_at': utc_now_iso(),
            'source_file': str(src_path.relative_to(ROOT)),
            'count': len(normalized),
        },
        'items': normalized,
    }
    write_json(DATA / 'normalized' / 'scraped' / 'uniques_scraped_normalized.json', out)

    return {
        'count': len(normalized),
        'missing_slot': missing_slot,
        'missing_base_type': missing_base,
        'source_file': str(src_path.relative_to(ROOT)),
        'output': 'data/normalized/scraped/uniques_scraped_normalized.json',
    }


if __name__ == '__main__':
    print(normalize_scraped_uniques())
