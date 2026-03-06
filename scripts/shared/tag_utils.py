from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from scripts.shared.file_utils import load_json
from scripts.shared.text_utils import normalize_whitespace

ROOT = Path(__file__).resolve().parents[2]
TAG_OVERRIDES_DIR = ROOT / 'data' / 'overrides' / 'tag_overrides'


@dataclass
class TagProcessResult:
    tags: list[str]
    raw_count: int = 0
    alias_collapses: int = 0
    blacklisted_removals: int = 0
    empty_removals: int = 0
    malformed_removals: int = 0
    debug: list[dict[str, str]] = field(default_factory=list)


def _load_config(name: str, default: dict[str, Any]) -> dict[str, Any]:
    path = TAG_OVERRIDES_DIR / name
    if not path.exists():
        return default
    payload = load_json(path)
    return payload if isinstance(payload, dict) else default


_ALIASES = _load_config('aliases.json', {'global': {}})
_BLACKLIST = _load_config('blacklist.json', {'global': [], 'prefixes': []})

_PREFIX_SAFE_PATTERN = re.compile(r'^[a-z0-9]+:[a-z0-9][a-z0-9 ]*$')
_TOKEN_SAFE_PATTERN = re.compile(r'^[a-z0-9][a-z0-9 ]*$')


def normalize_tag_candidate(value: Any) -> str:
    token = str(value or '').strip().lower().replace('_', ' ').replace('-', ' ')
    token = normalize_whitespace(token)
    token = re.sub(r'[^a-z0-9: ]+', '', token)
    token = normalize_whitespace(token)
    return token


def _alias_map_for(entity: str | None) -> dict[str, str]:
    merged: dict[str, str] = {}
    for source in (_ALIASES.get('global', {}), _ALIASES.get(entity or '', {})):
        if isinstance(source, dict):
            for raw, canonical in source.items():
                merged[normalize_tag_candidate(raw)] = normalize_tag_candidate(canonical)
    return merged


def _blacklist_for(entity: str | None) -> tuple[set[str], list[str]]:
    blocked = set(normalize_tag_candidate(x) for x in _BLACKLIST.get('global', []) if str(x).strip())
    entity_items = _BLACKLIST.get(entity or '', [])
    if isinstance(entity_items, list):
        blocked.update(normalize_tag_candidate(x) for x in entity_items if str(x).strip())

    prefixes = _BLACKLIST.get('prefixes', [])
    normalized_prefixes = [normalize_tag_candidate(p) for p in prefixes if str(p).strip()]
    return blocked, normalized_prefixes


def is_blacklisted(token: str, entity: str | None = None) -> bool:
    normalized = normalize_tag_candidate(token)
    blocked, blocked_prefixes = _blacklist_for(entity)
    return normalized in blocked or any(normalized.startswith(prefix) for prefix in blocked_prefixes)


def _is_malformed(token: str) -> bool:
    if not token:
        return True
    if ':' in token:
        return _PREFIX_SAFE_PATTERN.match(token) is None
    return _TOKEN_SAFE_PATTERN.match(token) is None


def process_tags(raw_candidates: list[Any], entity: str | None = None, *, sort_tags: bool = True) -> TagProcessResult:
    aliases = _alias_map_for(entity)
    blocked, blocked_prefixes = _blacklist_for(entity)

    kept: list[str] = []
    seen: set[str] = set()
    result = TagProcessResult(tags=[])

    for raw in raw_candidates:
        result.raw_count += 1
        token = normalize_tag_candidate(raw)
        if not token:
            result.empty_removals += 1
            continue

        if token in aliases:
            canonical = aliases[token]
            if canonical != token:
                result.alias_collapses += 1
                result.debug.append({'from': token, 'to': canonical, 'reason': 'alias'})
            token = canonical

        if token in blocked or any(token.startswith(prefix) for prefix in blocked_prefixes):
            result.blacklisted_removals += 1
            result.debug.append({'from': token, 'to': '', 'reason': 'blacklist'})
            continue

        if _is_malformed(token):
            result.malformed_removals += 1
            result.debug.append({'from': token, 'to': '', 'reason': 'malformed'})
            continue

        if token in seen:
            continue
        seen.add(token)
        kept.append(token)

    result.tags = sorted(kept) if sort_tags else kept
    return result
