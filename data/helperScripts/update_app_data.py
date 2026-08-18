#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from lib.pipeline_diff import analyze_semantic_stability, compute_diff, snapshot_artifacts
from lib.pipeline_runner import (
    PipelineContext,
    PipelineError,
    PipelineStep,
    append_step_result,
    build_base_report,
    collect_git_metadata,
    derive_final_status,
    finalize_report,
    make_skip_result,
    preflight_checks,
    print_final_summary,
    run_step,
    utc_now_iso,
    write_report_files,
)


REPORT_DIR = Path("data/reports/update_runs")
LATEST_REPORT = REPORT_DIR / "latest.json"
AUDIT_JSON = Path("data/enriched/tag_vocab_audit.json")
PASSIVES_ENRICHED = Path("data/enriched/passives_enriched.json")


PROFILE_STEP_NAMES: dict[str, list[str]] = {
    "full-patch": [
        "generate_tag_rules_js",
        "enrich_skills",
        "enrich_passives",
        "scrape_poe2db_uniques_min",
        "generate_recommendation_catalog_v3",
        "validate_recommendation_catalog_v3",
        "generate_challenge_pools",
        "generate_keystone_tooltips",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "fast-local": [
        "generate_tag_rules_js",
        "enrich_skills",
        "enrich_passives",
        "generate_recommendation_catalog_v3",
        "validate_recommendation_catalog_v3",
        "generate_challenge_pools",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "tags-only": [
        "generate_tag_rules_js",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "verify-only": [
        "validate_recommendation_catalog_v3",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "skills-only": [
        "generate_tag_rules_js",
        "enrich_skills",
        "generate_recommendation_catalog_v3",
        "validate_recommendation_catalog_v3",
        "generate_challenge_pools",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "passives-only": [
        "generate_tag_rules_js",
        "enrich_passives",
        "generate_recommendation_catalog_v3",
        "validate_recommendation_catalog_v3",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "uniques-only": [
        "scrape_poe2db_uniques_min",
        "generate_recommendation_catalog_v3",
        "validate_recommendation_catalog_v3",
        "generate_challenge_pools",
        "validate_tag_normalization",
        "audit_tag_vocab",
    ],
    "keystones-only": [
        "generate_keystone_tooltips",
    ],
    "recommendations-only": [
        "generate_recommendation_catalog_v3",
        "validate_recommendation_catalog_v3",
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Orchestrate Randomancer data rebuilds without changing any existing "
            "dataset-generation logic. This script only shells out to the current helper scripts, "
            "captures results, and writes reports."
        )
    )
    parser.add_argument(
        "--profile",
        default="fast-local",
        choices=sorted(PROFILE_STEP_NAMES.keys()),
        help="Which update profile to run.",
    )
    parser.add_argument("--poe-version", default="", help="Recorded in the report metadata only.")
    parser.add_argument("--lang", default="us", help="Locale to forward to scrape-backed helpers.")
    parser.add_argument("--timeout", type=float, default=20.0, help="Timeout forwarded to network helpers.")
    parser.add_argument("--sleep", type=float, default=0.25, help="Politeness delay for uniques scraping.")
    parser.add_argument("--resume", action="store_true", help="Resume the uniques scrape from the current output file.")
    parser.add_argument("--disable-network", action="store_true", help="Skip network-backed steps and/or forward local-only modes.")
    parser.add_argument("--strict", action="store_true", help="Enable stricter validation mode where supported.")
    parser.add_argument(
        "--semantic-stability-check",
        action="store_true",
        help=(
            "Add semantic stability analysis to the report so the wrapper can distinguish byte-only drift "
            "from likely semantic changes. This does not rerun or rewrite any helper logic."
        ),
    )
    parser.add_argument(
        "--report-out",
        default=str(LATEST_REPORT),
        help="Stable path for the latest JSON report, relative to repo root unless absolute.",
    )
    parser.add_argument(
        "--no-timestamped-report",
        action="store_true",
        help="Do not also write a timestamped report copy under data/reports/update_runs/.",
    )
    parser.add_argument("--fail-fast", action="store_true", help="Stop on the first failed required step.")
    parser.add_argument("--allow-dirty-git", action="store_true", help="Do not warn when the repo has uncommitted changes.")
    parser.add_argument("--verbose", action="store_true", help="Print full child stdout/stderr for passing steps too.")
    return parser.parse_args()


def build_steps(ctx: PipelineContext) -> list[PipelineStep]:
    py = sys.executable
    script_dir = ctx.script_dir

    def p(name: str) -> str:
        return str(script_dir / name)

    steps_by_name: dict[str, PipelineStep] = {
        "generate_tag_rules_js": PipelineStep(
            name="generate_tag_rules_js",
            command=[py, p("generate_tag_rules_js.py")],
            outputs=[ctx.repo_root / "js/generated/tag-normalization-rules.js"],
            summary_artifact_keys=[],
            required=True,
            description="Sync browser tag rules from the shared JSON source.",
        ),
        "enrich_skills": PipelineStep(
            name="enrich_skills",
            command=[py, p("enrich_skills.py")],
            outputs=[ctx.repo_root / "data/enriched/skills_enriched.json"],
            summary_artifact_keys=["skills_enriched"],
            required=True,
            description="Rebuild skills_enriched from local datamined skill tables.",
        ),
        "enrich_passives": PipelineStep(
            name="enrich_passives",
            command=[
                py,
                p("enrich_passives.py"),
                "--lang",
                ctx.lang,
                "--timeout",
                str(ctx.timeout),
                *( ["--disable-network"] if ctx.disable_network else [] ),
            ],
            outputs=[
                ctx.repo_root / "data/enriched/passives_enriched.json",
                ctx.repo_root / "data/enriched/passive_scrape_report.json",
            ],
            summary_artifact_keys=["passives_enriched", "passive_scrape_report"],
            required=True,
            description="Rebuild passives_enriched and passive_scrape_report.",
        ),
        "scrape_poe2db_uniques_min": PipelineStep(
            name="scrape_poe2db_uniques_min",
            command=[
                py,
                p("scrape_poe2db_uniques_min.py"),
                "--lang",
                ctx.lang,
                "--timeout",
                str(ctx.timeout),
                "--sleep",
                str(ctx.sleep),
                *( ["--resume"] if ctx.resume else [] ),
                *( ["--verbose"] if ctx.verbose else [] ),
            ],
            outputs=[ctx.repo_root / "data/enriched/poe2db_uniques_min.json"],
            summary_artifact_keys=["poe2db_uniques_min"],
            required=True,
            networked=True,
            description="Refresh the runtime uniques scrape from PoE2DB.",
        ),
        "generate_recommendation_catalog_v3": PipelineStep(
            name="generate_recommendation_catalog_v3",
            command=[py, p("generate_recommendation_catalog_v3.py")],
            outputs=[
                ctx.repo_root / "data/enriched/recommendation_catalog_v3.json",
                ctx.repo_root / "data/enriched/recommendation_catalog_v3_report.json",
                ctx.repo_root / "data/enriched/recommendation_granted_skill_access_v3.json",
            ],
            summary_artifact_keys=[
                "recommendation_catalog_v3",
                "recommendation_catalog_v3_report",
                "recommendation_granted_skill_access_v3",
            ],
            required=True,
            description="Build the additive semantic recommendation catalog from current enriched and datamined sources.",
        ),
        "validate_recommendation_catalog_v3": PipelineStep(
            name="validate_recommendation_catalog_v3",
            command=[py, p("validate_recommendation_catalog_v3.py")],
            outputs=[],
            summary_artifact_keys=[],
            required=True,
            description="Validate recommendation v3 schema, source parity, and semantic regression fixtures.",
        ),
        "generate_challenge_pools": PipelineStep(
            name="generate_challenge_pools",
            command=[
                py,
                p("generate_challenge_pools.py"),
                "--skills-enriched",
                "data/enriched/skills_enriched.json",
                "--uniques",
                "data/enriched/poe2db_uniques_min.json",
                "--overrides",
                "data/config/challenge_unique_granted_skill_overrides.json",
                "--out",
                "data/enriched/challenge_generated_pools.json",
            ],
            outputs=[ctx.repo_root / "data/enriched/challenge_generated_pools.json"],
            summary_artifact_keys=["challenge_generated_pools"],
            required=True,
            description="Rebuild challenge mode generated pools from enriched skills + uniques data.",
        ),
        "generate_keystone_tooltips": PipelineStep(
            name="generate_keystone_tooltips",
            command=[
                py,
                p("generate_keystone_tooltips.py"),
                "--passives-enriched",
                str(PASSIVES_ENRICHED),
                "--out",
                "data/enriched/keystone_tooltips.json",
                "--lang",
                ctx.lang,
                "--timeout",
                str(ctx.timeout),
                "--allow-fallback",
                *( ["--verbose"] if ctx.verbose else [] ),
            ],
            outputs=[ctx.repo_root / "data/enriched/keystone_tooltips.json"],
            summary_artifact_keys=["keystone_tooltips"],
            required=True,
            networked=True,
            description="Rebuild keystone tooltips from passives_enriched + PoE2DB.",
        ),
        "validate_tag_normalization": PipelineStep(
            name="validate_tag_normalization",
            command=[
                py,
                p("validate_tag_normalization.py"),
                *( ["--strict"] if ctx.strict else [] ),
            ],
            outputs=[],
            summary_artifact_keys=[],
            required=True,
            description="Run tag normalization regression checks.",
        ),
        "audit_tag_vocab": PipelineStep(
            name="audit_tag_vocab",
            command=[
                py,
                p("audit_tag_vocab.py"),
                "--json-out",
                str(AUDIT_JSON),
            ],
            outputs=[ctx.repo_root / AUDIT_JSON],
            summary_artifact_keys=["tag_vocab_audit"],
            required=True,
            description="Generate the machine-readable tag vocabulary audit.",
        ),
    }

    return [steps_by_name[name] for name in PROFILE_STEP_NAMES[ctx.profile]]


def main() -> int:
    args = parse_args()
    script_path = Path(__file__).resolve()
    script_dir = script_path.parent
    repo_root = script_path.parents[2]

    stable_report_path = Path(args.report_out)
    if not stable_report_path.is_absolute():
        stable_report_path = repo_root / stable_report_path

    ctx = PipelineContext(
        repo_root=repo_root,
        script_dir=script_dir,
        profile=args.profile,
        poe_version=args.poe_version,
        lang=args.lang,
        timeout=args.timeout,
        sleep=args.sleep,
        resume=args.resume,
        disable_network=args.disable_network,
        strict=args.strict,
        fail_fast=args.fail_fast,
        allow_dirty_git=args.allow_dirty_git,
        verbose=args.verbose,
        semantic_stability_check=args.semantic_stability_check,
        stable_report_path=stable_report_path,
        timestamped_report_enabled=not args.no_timestamped_report,
    )

    report = build_base_report(ctx)
    report["git"] = collect_git_metadata(ctx.repo_root)
    if report["git"].get("dirty") and not ctx.allow_dirty_git:
        report["warnings"].append("Git working tree is dirty.")

    try:
        steps = build_steps(ctx)
        preflight_checks(ctx, steps)
        before = snapshot_artifacts(ctx.repo_root)

        for step in steps:
            if step.networked and ctx.disable_network:
                append_step_result(report, make_skip_result(ctx, step, "Skipped because --disable-network was provided."))
                continue

            result = run_step(ctx, step)
            append_step_result(report, result)
            if result["status"] == "failed" and step.required and ctx.fail_fast:
                break

        after = snapshot_artifacts(ctx.repo_root)
        report["diff"] = compute_diff(before, after)
        if ctx.semantic_stability_check:
            report["semantic_stability"] = analyze_semantic_stability(before, after)
        finalize_report(report, derive_final_status(report), utc_now_iso())
        write_report_files(report, ctx)
        print_final_summary(report)
        return 0 if report["status"].startswith("passed") else 1
    except PipelineError as exc:
        report["errors"].append(str(exc))
        finalize_report(report, "failed", utc_now_iso())
        write_report_files(report, ctx)
        print_final_summary(report)
        return 1
    except Exception as exc:  # pragma: no cover
        report["errors"].append(f"Unexpected pipeline error: {exc}")
        finalize_report(report, "failed", utc_now_iso())
        write_report_files(report, ctx)
        print_final_summary(report)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
