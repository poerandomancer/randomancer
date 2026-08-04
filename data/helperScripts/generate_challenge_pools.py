#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write('\n')


def normalize_id(label: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', label.strip().lower()).strip('_')


def is_placeholder_skill(skill: dict[str, Any]) -> bool:
    source_tags = {str(tag).strip().lower() for tag in (skill.get('source_tags') or [])}
    if 'derived_template' in source_tags:
        return True
    text = ' '.join(
        str(skill.get(k, '') or '')
        for k in ('name', 'description', 'support_text', 'id')
    )
    return bool(re.search(r'\b(dnt|unused|placeholder|coming\s*soon|\?\?\?)\b|\{\d+\}', text, re.I))


def display_name(skill: dict[str, Any]) -> str:
    base = skill.get('base_item') or {}
    return str(base.get('display_name') or skill.get('name') or skill.get('support_name') or '').strip()


def strip_markup(text: str) -> str:
    t = str(text or '')
    t = re.sub(r'\[([^\]|]+)\|([^\]]+)\]', r'\2', t)
    t = re.sub(r'\[([^\]]+)\]', r'\1', t)
    return re.sub(r'\s+', ' ', t).strip()


def build_unique_index(uniques_payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    items = uniques_payload.get('items')
    values = []
    if isinstance(items, list):
        values = items
    elif isinstance(items, dict):
        values = [v for v in items.values() if isinstance(v, dict)]

    out: dict[str, dict[str, Any]] = {}
    for item in values:
        name = str(item.get('name') or '').strip()
        if not name:
            continue
        out[name.lower()] = item
    return out


def summarize_unique(unique: dict[str, Any], skill_name: str) -> str:
    base = str(unique.get('base') or '').strip()
    slot = str(unique.get('slot') or '').strip()
    explicit = [str(m).strip() for m in (unique.get('explicit_mods') or []) if str(m).strip()]
    granted = []
    for g in (unique.get('granted_skills') or []):
        if isinstance(g, dict):
            name = str(g.get('name') or g.get('raw') or '').strip()
            if name:
                granted.append(name)
        else:
            text = str(g).strip()
            if text:
                granted.append(text)

    lines = []
    if base and slot:
        lines.append(f'{base} ({slot})')
    elif base:
        lines.append(base)
    elif slot:
        lines.append(slot)

    if explicit:
        lines.append('; '.join(explicit[:2]))

    grants_line = next((g for g in granted if skill_name.lower() in g.lower()), None)
    if grants_line:
        lines.append(grants_line)
    elif granted:
        lines.append(granted[0])

    return ' — '.join([x for x in lines if x])


def generate_pools(skills: list[dict[str, Any]], uniques_payload: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    active_skills = [s for s in skills if s.get('type') == 'active' and not is_placeholder_skill(s)]

    by_skill_name = {display_name(s).lower(): s for s in skills if display_name(s)}
    unique_by_name = build_unique_index(uniques_payload)

    strict_rows = []
    for row in (overrides.get('strictUniqueGrantedSkills') or []):
        unique_name = str(row.get('uniqueName') or '').strip()
        skill_name = str(row.get('skillName') or '').strip()
        if not unique_name or not skill_name:
            continue

        unique = unique_by_name.get(unique_name.lower(), {})
        skill = by_skill_name.get(skill_name.lower(), {})

        required_level = int(row.get('requiredLevel') or unique.get('required_level') or 0)
        slot = unique.get('slot')
        category = str(row.get('category') or '').strip().lower() or ('weapon' if str(slot or '').lower() in {
            'bow', 'crossbow', 'staff', 'quarterstaff', 'spear', 'sword', 'mace', 'axe', 'claw', 'wand', 'sceptre'
        } else 'nonweapon')

        skill_desc = strip_markup(skill.get('description') or skill.get('support_text') or '')
        if not skill_desc:
            skill_desc = f'{skill_name} (description unavailable in current enrichment data).'

        strict_rows.append({
            'id': f"{normalize_id(unique_name)}__{normalize_id(skill_name)}",
            'uniqueName': unique_name,
            'skillName': skill_name,
            'requiredLevel': required_level,
            'category': category,
            'slot': slot,
            'skillId': skill.get('id') or None,
            'skillDescription': skill_desc,
            'uniqueSummary': summarize_unique(unique, skill_name) or unique_name,
            'uniqueSourceKey': unique.get('key') or None,
            'uniqueSourceUrl': (unique.get('source') or {}).get('url') if isinstance(unique, dict) else None,
            'icon': skill.get('ui_image') or None,
        })

    craft_counts: dict[str, dict[str, Any]] = {}
    for skill in active_skills:
        craft = skill.get('crafting') or {}
        types_raw = craft.get('types_raw') if isinstance(craft.get('types_raw'), list) else []
        if not types_raw:
            continue
        schools = {str(s).strip().lower() for s in (craft.get('schools') or []) if str(s).strip()}
        weapons = {str(s).strip().lower() for s in (craft.get('weapon_affinities') or []) if str(s).strip()}

        for raw in types_raw:
            label = str(raw).strip()
            if not label:
                continue
            cid = normalize_id(label)
            row = craft_counts.setdefault(cid, {
                'id': cid,
                'label': label,
                'kind': 'school',
                'skillCount': 0,
            })
            l = label.lower()
            if l in weapons and l not in schools:
                row['kind'] = 'weapon'
            row['skillCount'] += 1

    crafting_types = sorted(craft_counts.values(), key=lambda r: (-int(r['skillCount']), r['label']))

    return {
        'meta': {
            'generator': 'data/helperScripts/generate_challenge_pools.py',
            'strictUniqueCount': len(strict_rows),
            'craftingTypeCount': len(crafting_types),
        },
        'strictUniqueGrantedSkills': strict_rows,
        'craftingTypes': crafting_types,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Generate enriched challenge support pools.')
    parser.add_argument('--skills-enriched', default='data/enriched/skills_enriched.json')
    parser.add_argument('--uniques', default='data/enriched/poe2db_uniques_min.json')
    parser.add_argument('--overrides', default='data/config/challenge_unique_granted_skill_overrides.json')
    parser.add_argument('--out', default='data/enriched/challenge_generated_pools.json')
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    skills = load_json(Path(args.skills_enriched))
    uniques = load_json(Path(args.uniques))
    overrides = load_json(Path(args.overrides))

    payload = generate_pools(skills if isinstance(skills, list) else [], uniques if isinstance(uniques, dict) else {}, overrides if isinstance(overrides, dict) else {})
    write_json(Path(args.out), payload)
    print(f"[challenge-pools] wrote {args.out}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
