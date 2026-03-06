from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from scripts.shared.file_utils import ensure_dir, file_size, load_json, write_json
from scripts.shared.report_utils import utc_now_iso
from scripts.shared.validation_utils import check_json_file

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data'
REPORTS = DATA / 'reports'


def check_inputs() -> dict[str, Any]:
    required = [
        DATA / 'core-data.json',
        DATA / 'datamined' / 'passiveskills.json',
        DATA / 'datamined' / 'ascendancy.json',
        DATA / 'datamined' / 'skills_tables' / 'skillgems.json',
        DATA / 'datamined' / 'skills_tables' / 'skillgemsupports.json',
        DATA / 'datamined' / 'skills_tables' / 'activeskills.json',
    ]
    warnings = [
        DATA / 'raw' / 'scraped' / 'poe2db_uniques_min.json',
        DATA / 'raw' / 'handcrafted' / 'display_overrides.json',
    ]

    missing_required = [str(path.relative_to(ROOT)) for path in required if not path.exists()]
    missing_warnings = [str(path.relative_to(ROOT)) for path in warnings if not path.exists()]

    return {
        'ok': not missing_required,
        'missing_required': missing_required,
        'missing_optional': missing_warnings,
    }


def run_normalize_stage() -> dict[str, Any]:
    normalized_dir = ensure_dir(DATA / 'normalized')
    payload = {
        'generated_at': utc_now_iso(),
        'phase': 'phase_1_scaffold',
        'notes': 'Normalization stage scaffolded. Source-policy migrations deferred to later phases.',
        'sources_detected': {
            'datamined_skills_tables': (DATA / 'datamined' / 'skills_tables').exists(),
            'datamined_uniques': (DATA / 'datamined' / 'Uniques').exists(),
            'scraped_uniques_min': (DATA / 'enriched' / 'poe2db_uniques_min.json').exists(),
        },
    }
    out = normalized_dir / 'normalization_summary.json'
    write_json(out, payload)
    return {'output': str(out.relative_to(ROOT))}


def run_canonical_stage() -> dict[str, Any]:
    canonical_dir = ensure_dir(DATA / 'canonical')
    payload = {
        'generated_at': utc_now_iso(),
        'phase': 'phase_1_scaffold',
        'notes': [
            'Canonical stage boundary established.',
            'Canonical source migrations for uniques/passives are intentionally deferred.',
        ],
    }
    out = canonical_dir / 'canonical_summary.json'
    write_json(out, payload)
    return {'output': str(out.relative_to(ROOT))}


def _run_script(script_path: Path) -> tuple[int, str]:
    cmd = ['python', str(script_path)]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)
    output = (proc.stdout + '\n' + proc.stderr).strip()
    return proc.returncode, output


def run_enrich_stage() -> dict[str, Any]:
    scripts = [
        ROOT / 'data' / 'helperScripts' / 'enrich_skills.py',
        ROOT / 'data' / 'helperScripts' / 'enrich_passives.py',
        ROOT / 'data' / 'helperScripts' / 'enrich_uniques.py',
        ROOT / 'data' / 'helperScripts' / 'generate_keystone_tooltips.py',
    ]

    script_results: dict[str, Any] = {}
    for script in scripts:
        code, output = _run_script(script)
        script_results[str(script.relative_to(ROOT))] = {
            'exit_code': code,
            'ok': code == 0,
            'output_tail': '\n'.join(output.splitlines()[-8:]),
        }
        if code != 0:
            return {'ok': False, 'scripts': script_results}

    return {'ok': True, 'scripts': script_results}


def run_runtime_stage() -> dict[str, Any]:
    runtime_dir = ensure_dir(DATA / 'runtime')
    targets = [
        DATA / 'core-data.json',
        DATA / 'enriched' / 'skills_enriched.json',
        DATA / 'enriched' / 'passives_enriched.json',
        DATA / 'enriched' / 'uniques_enriched.json',
    ]
    payload = {
        'generated_at': utc_now_iso(),
        'runtime_inputs': [
            {
                'path': str(path.relative_to(ROOT)),
                'exists': path.exists(),
                'bytes': file_size(path),
            }
            for path in targets
        ],
    }
    out = runtime_dir / 'runtime_index.json'
    write_json(out, payload)
    return {'output': str(out.relative_to(ROOT))}


def run_validation_stage() -> dict[str, Any]:
    checks = [
        DATA / 'enriched' / 'skills_enriched.json',
        DATA / 'enriched' / 'passives_enriched.json',
        DATA / 'enriched' / 'uniques_enriched.json',
        DATA / 'runtime' / 'runtime_index.json',
    ]
    messages: list[str] = []
    ok = True
    for path in checks:
        passed, message = check_json_file(path)
        ok = ok and passed
        messages.append(message)

    passives = load_json(DATA / 'enriched' / 'passives_enriched.json') if (DATA / 'enriched' / 'passives_enriched.json').exists() else {}
    nodes = passives.get('nodes', []) if isinstance(passives, dict) else []
    duplicate_ids: list[int] = []
    if isinstance(nodes, list):
        seen: set[int] = set()
        for node in nodes:
            node_id = node.get('id') if isinstance(node, dict) else None
            if isinstance(node_id, int):
                if node_id in seen and node_id not in duplicate_ids:
                    duplicate_ids.append(node_id)
                seen.add(node_id)

    if duplicate_ids:
        ok = False
        messages.append(f'Duplicate passive node IDs found: {duplicate_ids[:10]}')

    validation_report = {
        'generated_at': utc_now_iso(),
        'ok': ok,
        'messages': messages,
        'duplicate_passive_node_ids': duplicate_ids,
    }
    write_json(REPORTS / 'validation_report.json', validation_report)
    return validation_report


def update_version_manifest(stage_results: dict[str, Any]) -> dict[str, Any]:
    manifest_path = ROOT / 'version_manifest.json'
    existing: dict[str, Any] = {}
    if manifest_path.exists():
        try:
            existing = load_json(manifest_path)
            if not isinstance(existing, dict):
                existing = {}
        except Exception:  # noqa: BLE001
            existing = {}

    existing.setdefault('schema', 'randomancer_pipeline_manifest_v1')
    existing['last_pipeline_run_at'] = utc_now_iso()
    existing['pipeline'] = {
        'entrypoint': 'scripts/pipeline/run_pipeline.py',
        'phase': 'phase_1_foundation',
        'stages': {key: value.get('status', 'unknown') for key, value in stage_results.items()},
    }
    write_json(manifest_path, existing)
    return {'manifest_path': str(manifest_path.relative_to(ROOT))}
