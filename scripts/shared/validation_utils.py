from __future__ import annotations

from pathlib import Path
from typing import Any

from scripts.shared.file_utils import load_json


def check_json_file(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return False, f'Missing file: {path}'

    try:
        payload = load_json(path)
    except Exception as exc:  # noqa: BLE001
        return False, f'Failed to parse JSON at {path}: {exc}'

    if payload in ({}, [], None):
        return False, f'Empty JSON payload at {path}'

    return True, f'OK: {path}'


def detect_duplicate_ids(records: list[dict[str, Any]], key: str = 'id') -> list[str]:
    seen: set[str] = set()
    dupes: list[str] = []
    for record in records:
        value = str(record.get(key, ''))
        if not value:
            continue
        if value in seen and value not in dupes:
            dupes.append(value)
        seen.add(value)
    return dupes
