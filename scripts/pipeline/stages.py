from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from scripts.shared.file_utils import ensure_dir, file_size, load_json, write_json
from scripts.shared.report_utils import utc_now_iso
from scripts.shared.tag_utils import is_blacklisted, normalize_tag_candidate
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

    tag_issues = validate_tag_hygiene()
    if tag_issues['issue_count'] > 0:
        ok = False
        messages.append(f"Tag hygiene issues found: {tag_issues['issue_count']}")

    validation_report = {
        'generated_at': utc_now_iso(),
        'ok': ok,
        'messages': messages,
        'duplicate_passive_node_ids': duplicate_ids,
        'tag_hygiene': tag_issues,
    }
    write_json(REPORTS / 'validation_report.json', validation_report)
    return validation_report


def generate_tag_report() -> dict[str, Any]:
    report: dict[str, Any] = {
        'generated_at': utc_now_iso(),
        'families': {},
        'summary': {
            'total_tags_seen': 0,
            'unique_tags': 0,
        },
    }

    family_sources = {
        'skills': DATA / 'enriched' / 'skills_enriched.json',
        'passives': DATA / 'enriched' / 'passives_enriched.json',
        'uniques': DATA / 'enriched' / 'uniques_enriched.json',
    }

    all_tags: set[str] = set()

    for family, path in family_sources.items():
        info = {'source': str(path.relative_to(ROOT)), 'total_tags': 0, 'unique_tags': 0, 'top_tags': []}
        if not path.exists():
            info['missing'] = True
            report['families'][family] = info
            continue

        payload = load_json(path)
        tags: list[str] = []
        if family == 'skills' and isinstance(payload, list):
            for row in payload:
                if isinstance(row, dict):
                    tags.extend([str(t) for t in (row.get('tags') or []) if str(t).strip()])
        elif family == 'passives' and isinstance(payload, dict):
            for node in payload.get('nodes', []):
                if isinstance(node, dict):
                    tags.extend([str(t) for t in (node.get('tags') or []) if str(t).strip()])
        elif family == 'uniques' and isinstance(payload, dict):
            for item in payload.get('items', []):
                if not isinstance(item, dict):
                    continue
                tag_block = item.get('tags') or {}
                if isinstance(tag_block, dict):
                    tags.extend([str(t) for t in (tag_block.get('raw') or []) if str(t).strip()])

        normalized = [normalize_tag_candidate(tag) for tag in tags if normalize_tag_candidate(tag)]
        all_tags.update(normalized)

        counts: dict[str, int] = {}
        for tag in normalized:
            counts[tag] = counts.get(tag, 0) + 1

        info['total_tags'] = len(normalized)
        info['unique_tags'] = len(counts)
        info['top_tags'] = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:20]
        report['families'][family] = info

    report['summary']['total_tags_seen'] = sum(v.get('total_tags', 0) for v in report['families'].values())
    report['summary']['unique_tags'] = len(all_tags)
    write_json(REPORTS / 'tag_report.json', report)
    return report


def validate_tag_hygiene() -> dict[str, Any]:
    issues: list[dict[str, Any]] = []

    def inspect(entity: str, tags: list[str], context: str) -> None:
        seen: set[str] = set()
        for tag in tags:
            normalized = normalize_tag_candidate(tag)
            if not normalized:
                issues.append({'entity': entity, 'context': context, 'tag': tag, 'issue': 'empty'})
                continue
            if normalized in seen:
                issues.append({'entity': entity, 'context': context, 'tag': normalized, 'issue': 'duplicate'})
            seen.add(normalized)
            if is_blacklisted(normalized, entity=entity):
                issues.append({'entity': entity, 'context': context, 'tag': normalized, 'issue': 'blacklisted'})
            if normalized.startswith('grants:') or normalized.startswith('grants '):
                issues.append({'entity': entity, 'context': context, 'tag': normalized, 'issue': 'suspicious_prefix'})

    skills = load_json(DATA / 'enriched' / 'skills_enriched.json') if (DATA / 'enriched' / 'skills_enriched.json').exists() else []
    if isinstance(skills, list):
        for row in skills[:5000]:
            if isinstance(row, dict):
                inspect('skills', [str(t) for t in (row.get('tags') or [])], str(row.get('id', 'unknown')))

    passives = load_json(DATA / 'enriched' / 'passives_enriched.json') if (DATA / 'enriched' / 'passives_enriched.json').exists() else {}
    if isinstance(passives, dict):
        for node in passives.get('nodes', [])[:5000]:
            if isinstance(node, dict):
                inspect('passives', [str(t) for t in (node.get('tags') or [])], str(node.get('id', 'unknown')))

    uniques = load_json(DATA / 'enriched' / 'uniques_enriched.json') if (DATA / 'enriched' / 'uniques_enriched.json').exists() else {}
    if isinstance(uniques, dict):
        for item in uniques.get('items', [])[:5000]:
            if not isinstance(item, dict):
                continue
            tag_block = item.get('tags') or {}
            raw_tags = tag_block.get('raw') if isinstance(tag_block, dict) else []
            inspect('uniques', [str(t) for t in (raw_tags or [])], str(item.get('name', 'unknown')))

    return {
        'issue_count': len(issues),
        'sample_issues': issues[:50],
    }


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
