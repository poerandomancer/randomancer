from __future__ import annotations

from typing import Any

from scripts.shared.id_utils import slugify

SLOT_MAP = {
    'amulet': 'amulet',
    'ring': 'ring',
    'belt': 'belt',
    'helmet': 'helmet',
    'body armour': 'body_armour',
    'body armor': 'body_armour',
    'gloves': 'gloves',
    'boots': 'boots',
    'shield': 'shield',
    'buckler': 'shield',
    'focus': 'focus',
    'quiver': 'quiver',
    'wand': 'wand',
    'bow': 'bow',
    'crossbow': 'crossbow',
    'staff': 'staff',
    'quarterstaff': 'quarterstaff',
    'mace': 'mace',
    'sword': 'sword',
    'axe': 'axe',
    'dagger': 'dagger',
    'claw': 'claw',
    'spear': 'spear',
    'flail': 'flail',
    'sceptre': 'sceptre',
    'talisman': 'talisman',
}


def normalize_slot(value: Any) -> str:
    raw = str(value or '').strip().lower()
    return SLOT_MAP.get(raw, slugify(raw).replace('-', '_')) if raw else ''


def unique_merge_key(name: str, slot: str, base_type: str) -> str:
    return f"{slugify(name)}|{slugify(slot)}|{slugify(base_type)}"


def build_unique_id(name: str, slot: str = '', base_type: str = '', source_id: str = '', id_override: str = '') -> str:
    if id_override:
        return id_override

    base = slugify(name)
    if not base:
        base = slugify(source_id) or unique_merge_key(name, slot, base_type)
    return f'unique.{base}'
