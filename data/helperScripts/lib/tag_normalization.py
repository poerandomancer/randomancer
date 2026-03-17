"""Shared tag normalization helpers for data helper scripts."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


def _rules_path() -> Path:
    return Path(__file__).resolve().parents[2] / "tag_normalization_rules.json"


@lru_cache(maxsize=1)
def load_rules() -> Dict[str, Any]:
    with _rules_path().open("r", encoding="utf-8") as f:
        return json.load(f)


def sanitize_raw_tag(raw: Any) -> str:
    s = str(raw or "").lower().strip()
    s = s.replace("[", "").replace("]", "").replace("'", "")
    s = re.sub(r"[\s_-]+", "_", s)
    s = re.sub(r"[^a-z0-9_:]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def should_reject_tag(raw_or_canonical: Any, reject_grants: bool = True) -> bool:
    raw = str(raw_or_canonical or "").strip().lower()
    if not raw:
        return True
    if not reject_grants:
        return False
    rules = load_rules()
    for prefix in rules.get("reject_prefixes", []):
        if raw.startswith(prefix):
            return True
    for fragment in rules.get("reject_contains", []):
        if fragment in raw:
            return True
    return False


def canonicalize_tag(raw: Any, reject_grants: bool = True) -> Optional[str]:
    token = sanitize_raw_tag(raw)
    if not token:
        return None
    if should_reject_tag(token, reject_grants=reject_grants):
        return None
    aliases = load_rules().get("aliases_to_canonical", {})
    return aliases.get(token, token)


def to_match_key(raw_or_canonical: Any) -> str:
    token = canonicalize_tag(raw_or_canonical, reject_grants=False) or sanitize_raw_tag(raw_or_canonical)
    return re.sub(r"[^a-z0-9]+", "", token)


def expand_canonical_tag(raw_or_canonical: Any, reject_grants: bool = True) -> List[str]:
    canonical = canonicalize_tag(raw_or_canonical, reject_grants=reject_grants)
    if not canonical:
        return []
    expansions = load_rules().get("expansions", {}).get(canonical, [])
    out = [canonical]
    for value in expansions:
        token = canonicalize_tag(value, reject_grants=reject_grants)
        if token:
            out.append(token)
    return out


def expand_match_keys(raw_or_canonical: Any, reject_grants: bool = True) -> List[str]:
    seen = []
    for tag in expand_canonical_tag(raw_or_canonical, reject_grants=reject_grants):
        mk = to_match_key(tag)
        if mk and mk not in seen:
            seen.append(mk)
    return seen


def normalize_tag_list(tags: Any, expand: bool = False, match_keys: bool = False) -> List[str]:
    out: List[str] = []
    for tag in tags or []:
        vals = expand_canonical_tag(tag) if expand else [canonicalize_tag(tag)]
        for item in vals:
            if not item:
                continue
            value = to_match_key(item) if match_keys else item
            if value not in out:
                out.append(value)
    return out


def is_noise_tag(raw_or_canonical: Any, include_stop_tags: bool = False) -> bool:
    if include_stop_tags:
        return False
    canonical = canonicalize_tag(raw_or_canonical, reject_grants=False)
    if not canonical:
        return False
    stop = {canonicalize_tag(t, reject_grants=False) for t in load_rules().get("stop_tags", [])}
    return canonical in stop
