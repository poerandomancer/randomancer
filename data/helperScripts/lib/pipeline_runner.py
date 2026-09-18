from __future__ import annotations

import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .pipeline_diff import ARTIFACT_PATHS, summarize_artifact_key, summarize_semantic_stability


class PipelineError(RuntimeError):
    pass


@dataclass
class PipelineContext:
    repo_root: Path
    script_dir: Path
    profile: str
    poe_version: str
    lang: str
    timeout: float
    sleep: float
    resume: bool
    disable_network: bool
    strict: bool
    fail_fast: bool
    allow_dirty_git: bool
    verbose: bool
    semantic_stability_check: bool
    stable_report_path: Path
    timestamped_report_enabled: bool = True


@dataclass
class PipelineStep:
    name: str
    command: list[str]
    outputs: list[Path] = field(default_factory=list)
    summary_artifact_keys: list[str] = field(default_factory=list)
    required: bool = True
    networked: bool = False
    description: str = ""


REQUIRED_INPUTS_BY_PROFILE: dict[str, list[Path]] = {
    "full-patch": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/datamined/skills_tables"),
        Path("data/datamined/passiveskills.json"),
        Path("data/datamined/stats.json"),
        Path("data/datamined/ascendancy.json"),
    ],
    "fast-local": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/datamined/skills_tables"),
        Path("data/datamined/passiveskills.json"),
        Path("data/datamined/stats.json"),
        Path("data/datamined/ascendancy.json"),
    ],
    "tags-only": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/enriched/skills_enriched.json"),
        Path("data/enriched/passives_enriched.json"),
        Path("data/enriched/poe2db_uniques_min.json"),
    ],
    "verify-only": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/enriched/skills_enriched.json"),
        Path("data/enriched/passives_enriched.json"),
        Path("data/enriched/poe2db_uniques_min.json"),
    ],
    "skills-only": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/datamined/skills_tables"),
        Path("data/enriched/passives_enriched.json"),
        Path("data/enriched/poe2db_uniques_min.json"),
    ],
    "passives-only": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/datamined/passiveskills.json"),
        Path("data/datamined/stats.json"),
        Path("data/datamined/ascendancy.json"),
        Path("data/enriched/skills_enriched.json"),
        Path("data/enriched/poe2db_uniques_min.json"),
    ],
    "uniques-only": [
        Path("data/tag_normalization_rules.json"),
        Path("data/skill_families.json"),
        Path("data/enriched/skills_enriched.json"),
        Path("data/enriched/passives_enriched.json"),
    ],
    "keystones-only": [
        Path("data/enriched/passives_enriched.json"),
    ],
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _tail(text: str, max_lines: int = 25) -> str:
    if not text:
        return ""
    lines = text.splitlines()
    return "\n".join(lines[-max_lines:])


def _step_label(status: str) -> str:
    return {
        "passed": "PASS",
        "failed": "FAIL",
        "skipped": "SKIP",
    }.get(status, status.upper())


def _format_ms(ms: int) -> str:
    if ms < 1000:
        return f"{ms}ms"
    return f"{ms / 1000.0:.2f}s"


def build_base_report(ctx: PipelineContext) -> dict[str, Any]:
    started_at = utc_now_iso()
    return {
        "schema_version": "update_pipeline.v3",
        "run_id": started_at.replace(":", "-").replace("+00:00", "Z"),
        "profile": ctx.profile,
        "poe_version": ctx.poe_version,
        "status": "running",
        "started_at": started_at,
        "finished_at": None,
        "duration_ms": None,
        "environment": {
            "python_version": sys.version.split()[0],
            "cwd": str(ctx.repo_root),
            "lang": ctx.lang,
            "timeout": ctx.timeout,
            "sleep": ctx.sleep,
            "resume": ctx.resume,
            "disable_network": ctx.disable_network,
            "strict": ctx.strict,
            "fail_fast": ctx.fail_fast,
            "semantic_stability_check": ctx.semantic_stability_check,
        },
        "guarantees": {
            "orchestration_only": True,
            "note": (
                "This pipeline does not replace or rewrite enrichment logic. It only invokes the existing helper "
                "scripts, verifies outputs, and summarizes results."
            ),
        },
        "git": {},
        "steps": [],
        "artifacts": {key: str(path) for key, path in ARTIFACT_PATHS.items()},
        "diff": {},
        "semantic_stability": {},
        "warnings": [],
        "errors": [],
    }


def collect_git_metadata(repo_root: Path) -> dict[str, Any]:
    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip() != ""
        return {"available": True, "branch": branch, "commit": commit, "dirty": dirty}
    except Exception:
        return {"available": False, "branch": "", "commit": "", "dirty": False}


def preflight_checks(ctx: PipelineContext, steps: list[PipelineStep]) -> None:
    missing: list[str] = []
    for rel_path in REQUIRED_INPUTS_BY_PROFILE.get(ctx.profile, []):
        abs_path = ctx.repo_root / rel_path
        if not abs_path.exists():
            missing.append(str(rel_path))

    for step in steps:
        script_path = Path(step.command[1]) if len(step.command) > 1 else None
        if script_path and not script_path.exists():
            try:
                missing.append(str(script_path.relative_to(ctx.repo_root)))
            except Exception:
                missing.append(str(script_path))

    (ctx.repo_root / "data/enriched").mkdir(parents=True, exist_ok=True)
    ctx.stable_report_path.parent.mkdir(parents=True, exist_ok=True)
    if ctx.timestamped_report_enabled:
        ctx.stable_report_path.parent.mkdir(parents=True, exist_ok=True)

    if missing:
        raise PipelineError("Preflight failed. Missing required paths:\n- " + "\n- ".join(sorted(set(missing))))


def make_skip_result(ctx: PipelineContext, step: PipelineStep, reason: str) -> dict[str, Any]:
    result = {
        "name": step.name,
        "status": "skipped",
        "duration_ms": 0,
        "returncode": 0,
        "command": step.command,
        "description": step.description,
        "outputs": [str(path.relative_to(ctx.repo_root)) for path in step.outputs],
        "warnings": [reason],
        "errors": [],
        "stdout_tail": "",
        "stderr_tail": "",
        "artifact_summary": {},
    }
    print(f"[{_step_label(result['status'])}] {step.name:<28} {_format_ms(0):>7}  {reason}")
    return result


def run_step(ctx: PipelineContext, step: PipelineStep) -> dict[str, Any]:
    started = time.perf_counter()
    proc = subprocess.run(
        step.command,
        cwd=ctx.repo_root,
        capture_output=True,
        text=True,
    )
    duration_ms = int((time.perf_counter() - started) * 1000)

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()
    warnings: list[str] = []
    errors: list[str] = []

    if proc.returncode != 0:
        errors.append(f"Exited with code {proc.returncode}.")

    missing_outputs: list[str] = []
    if proc.returncode == 0:
        for output in step.outputs:
            if not output.exists():
                missing_outputs.append(str(output.relative_to(ctx.repo_root)))
        if missing_outputs:
            errors.append("Expected output(s) missing: " + ", ".join(missing_outputs))

    artifact_summary: dict[str, Any] = {}
    if proc.returncode == 0 and not missing_outputs:
        for key in step.summary_artifact_keys:
            artifact_summary[key] = summarize_artifact_key(ctx.repo_root, key)

        if step.name == "generate_keystone_tooltips":
            entries = artifact_summary.get("keystone_tooltips", {}).get("entries", 0)
            if not isinstance(entries, int) or entries <= 0:
                errors.append("Generated keystone_tooltips.json is empty. Treating this as a failed step.")

    status = "passed" if not errors else "failed"
    note = step.description or ""
    if status == "failed" and errors:
        note = "; ".join(errors)
    print(f"[{_step_label(status)}] {step.name:<28} {_format_ms(duration_ms):>7}  {note}")

    if ctx.verbose or status == "failed":
        if stdout:
            print(f"\n[{step.name}] stdout\n{stdout}\n")
        if stderr:
            print(f"\n[{step.name}] stderr\n{stderr}\n", file=sys.stderr)

    return {
        "name": step.name,
        "status": status,
        "duration_ms": duration_ms,
        "returncode": proc.returncode,
        "command": step.command,
        "description": step.description,
        "outputs": [str(path.relative_to(ctx.repo_root)) for path in step.outputs],
        "warnings": warnings,
        "errors": errors,
        "stdout_tail": _tail(stdout),
        "stderr_tail": _tail(stderr),
        "artifact_summary": artifact_summary,
    }


def append_step_result(report: dict[str, Any], result: dict[str, Any]) -> None:
    report["steps"].append(result)
    report["warnings"].extend(result.get("warnings", []))
    report["errors"].extend([f"{result['name']}: {msg}" for msg in result.get("errors", [])])


def _analyze_diff_warnings(report: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    diff = report.get("diff", {})

    for artifact, fields in diff.items():
        for field, entry in fields.items():
            before = entry.get("before")
            after = entry.get("after")
            delta = entry.get("delta")
            if field in {"sha256", "semantic_sha256", "row_identity_set_sha256"}:
                continue
            if artifact == "tag_vocab_audit" and field == "total_collision_count" and isinstance(delta, (int, float)) and delta > 0:
                warnings.append(f"Tag collision count increased: {before} -> {after}.")
            if artifact == "passive_scrape_report" and field == "ascendancyUnmatched" and isinstance(delta, (int, float)) and delta > 0:
                warnings.append(f"Ascendancy unmatched scrape count increased: {before} -> {after}.")
            if artifact == "challenge_generated_pools" and field in {"strict_unique_count", "crafting_type_count"}:
                if isinstance(delta, (int, float)) and delta < 0:
                    warnings.append(f"Challenge pool {field} dropped: {before} -> {after}.")
            if artifact in {"skills_enriched", "passives_enriched", "poe2db_uniques_min", "keystone_tooltips"}:
                if isinstance(before, (int, float)) and isinstance(after, (int, float)) and before > 0 and after < before:
                    pct = ((before - after) / before) * 100.0
                    if pct >= 5.0:
                        warnings.append(f"{artifact}.{field} dropped by {pct:.1f}% ({before} -> {after}).")
    return warnings


def derive_final_status(report: dict[str, Any]) -> str:
    report["warnings"].extend(_analyze_diff_warnings(report))
    if report["errors"]:
        return "failed"
    if report["warnings"]:
        return "passed_with_warnings"
    return "passed"


def finalize_report(report: dict[str, Any], status: str, finished_at: str) -> None:
    report["status"] = status
    report["finished_at"] = finished_at
    try:
        started = datetime.fromisoformat(report["started_at"].replace("Z", "+00:00"))
        finished = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
        report["duration_ms"] = int((finished - started).total_seconds() * 1000)
    except Exception:
        report["duration_ms"] = None


def write_report_files(report: dict[str, Any], ctx: PipelineContext) -> None:
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    ctx.stable_report_path.write_text(payload, encoding="utf-8")

    if ctx.timestamped_report_enabled:
        ts_name = f"update_report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
        timestamped = ctx.stable_report_path.parent / ts_name
        timestamped.write_text(payload, encoding="utf-8")
        report.setdefault("report_files", {})["timestamped"] = str(timestamped.relative_to(ctx.repo_root))

    report.setdefault("report_files", {})["stable"] = str(ctx.stable_report_path.relative_to(ctx.repo_root))
    ctx.stable_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def print_final_summary(report: dict[str, Any]) -> None:
    passed = sum(1 for s in report.get("steps", []) if s.get("status") == "passed")
    skipped = sum(1 for s in report.get("steps", []) if s.get("status") == "skipped")
    failed = sum(1 for s in report.get("steps", []) if s.get("status") == "failed")
    print()
    print(f"Status:   {report.get('status')}")
    print(f"Steps:    {passed} passed, {skipped} skipped, {failed} failed")
    print(f"Warnings: {len(report.get('warnings', []))}")
    print(f"Errors:   {len(report.get('errors', []))}")

    semantic = report.get("semantic_stability") or {}
    if semantic:
        semantic_summary = summarize_semantic_stability(semantic)
        print(
            "Semantic: "
            f"{semantic_summary.get('byte_changed_semantically_same', 0)} byte-only, "
            f"{semantic_summary.get('semantic_changed', 0)} semantic, "
            f"{semantic_summary.get('artifact_presence_changed', 0)} presence"
        )

    reports = report.get("report_files", {})
    if reports.get("stable"):
        print(f"Report:   {reports['stable']}")
