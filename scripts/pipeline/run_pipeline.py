#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.pipeline.stages import (  # noqa: E402
    REPORTS,
    check_inputs,
    generate_tag_report,
    run_canonical_stage,
    run_enrich_stage,
    run_normalize_stage,
    run_runtime_stage,
    run_validation_stage,
    update_version_manifest,
)
from scripts.shared.file_utils import ensure_dir  # noqa: E402
from scripts.shared.report_utils import utc_now_iso  # noqa: E402


def _stage(status: str, details: dict[str, Any]) -> dict[str, Any]:
    return {'status': status, 'details': details}


def _build_report(stage_results: dict[str, dict[str, Any]], success: bool) -> dict[str, Any]:
    return {
        'generated_at': utc_now_iso(),
        'success': success,
        'stages': stage_results,
    }


def run_pipeline(skip_enrich: bool = False) -> tuple[int, dict[str, Any]]:
    ensure_dir(REPORTS)
    stage_results: dict[str, dict[str, Any]] = {}

    input_result = check_inputs()
    if not input_result['ok']:
        stage_results['inputs'] = _stage('failed', input_result)
        return 1, _build_report(stage_results, success=False)
    stage_results['inputs'] = _stage('success', input_result)

    try:
        stage_results['normalize'] = _stage('success', run_normalize_stage())
        stage_results['canonical'] = _stage('success', run_canonical_stage())

        if skip_enrich:
            stage_results['enrich'] = _stage('skipped', {'reason': '--skip-enrich flag was provided'})
        else:
            enrich_result = run_enrich_stage()
            if not enrich_result.get('ok', False):
                stage_results['enrich'] = _stage('failed', enrich_result)
                return 1, _build_report(stage_results, success=False)
            stage_results['enrich'] = _stage('success', enrich_result)

        stage_results['runtime'] = _stage('success', run_runtime_stage())

        validation = run_validation_stage()
        stage_results['validate'] = _stage('success' if validation.get('ok') else 'failed', validation)
        stage_results['tag_report'] = _stage('success', generate_tag_report())
        stage_results['manifest'] = _stage('success', update_version_manifest(stage_results))

        success = all(value['status'] in {'success', 'skipped'} for value in stage_results.values())
        return (0 if success else 1), _build_report(stage_results, success=success)
    except Exception as exc:  # noqa: BLE001
        stage_results['pipeline_exception'] = _stage('failed', {'error': str(exc)})
        return 1, _build_report(stage_results, success=False)


def main() -> int:
    parser = argparse.ArgumentParser(description='Randomancer Phase 1 data pipeline orchestrator')
    parser.add_argument('--skip-enrich', action='store_true', help='Skip running enrichment helper scripts')
    args = parser.parse_args()

    exit_code, report = run_pipeline(skip_enrich=args.skip_enrich)
    report_path = Path('data/reports/latest_pipeline_report.json')
    ensure_dir(report_path.parent)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print('=== Randomancer Data Pipeline (Phase 1) ===')
    print(f"Status: {'SUCCESS' if report['success'] else 'FAILED'}")
    for stage_name, stage in report['stages'].items():
        print(f" - {stage_name}: {stage['status']}")
    print(f'Report: {report_path}')
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
