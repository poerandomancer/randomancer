from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.shared.file_utils import write_json


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_report(path: Path, payload: dict[str, Any]) -> None:
    write_json(path, payload)


def summarize_stage(stage: str, ok: bool, notes: list[str] | None = None) -> dict[str, Any]:
    return {
        'stage': stage,
        'status': 'success' if ok else 'failed',
        'notes': notes or [],
    }
