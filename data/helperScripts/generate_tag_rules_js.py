#!/usr/bin/env python3
"""Generate js/generated/tag-normalization-rules.js from data/tag_normalization_rules.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
RULES_JSON_PATH = REPO_ROOT / "data" / "tag_normalization_rules.json"
OUTPUT_PATH = REPO_ROOT / "js" / "generated" / "tag-normalization-rules.js"


def _sorted_obj(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _sorted_obj(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [_sorted_obj(v) for v in value]
    return value


def build_js_module(rules: dict[str, Any]) -> str:
    payload = json.dumps(_sorted_obj(rules), indent=2, ensure_ascii=False)
    return (
        "// AUTO-GENERATED FILE. DO NOT EDIT.\n"
        "// Source: data/tag_normalization_rules.json\n"
        "// Regenerate with: python data/helperScripts/generate_tag_rules_js.py\n\n"
        f"const RULES = {payload};\n\n"
        "export { RULES };\n"
    )


def generate(rules_path: Path, output_path: Path) -> None:
    rules = json.loads(rules_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(build_js_module(rules), encoding="utf-8")


def main() -> int:
    generate(RULES_JSON_PATH, OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
