from __future__ import annotations

import re


def slugify(value: str) -> str:
    normalized = re.sub(r'[^a-z0-9]+', '-', (value or '').lower()).strip('-')
    return normalized


def stable_id(prefix: str, value: str) -> str:
    return f'{slugify(prefix)}:{slugify(value)}'
