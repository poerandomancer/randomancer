from __future__ import annotations

import re


def normalize_whitespace(text: str) -> str:
    return re.sub(r'\s+', ' ', (text or '')).strip()


def compact_list(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = normalize_whitespace(value)
        if cleaned and cleaned not in seen:
            out.append(cleaned)
            seen.add(cleaned)
    return out
