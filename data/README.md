# Randomancer update pipeline skeleton (v3)

This pass remains intentionally **orchestration-only**.

It does **not** replace or rewrite the logic inside your existing helper scripts. Instead, it:

- shells out to the current helper scripts in a controlled order
- verifies that expected outputs exist
- snapshots artifact summaries and hashes before/after
- writes a structured report to `data/reports/update_runs/`
- prints a compact terminal summary
- optionally adds a **semantic stability** layer so the wrapper can distinguish byte-only drift from likely content drift

That keeps the boundary you called out intact:

> Given the same helper scripts, the same inputs, the same flags, and the same external conditions, this pipeline should produce the same enriched outputs because it is only coordinating the existing scripts.

## Files

- `data/helperScripts/update_app_data.py`
- `data/helperScripts/lib/pipeline_runner.py`
- `data/helperScripts/lib/pipeline_diff.py`
- `data/helperScripts/lib/__init__.py`

## Profiles

- `full-patch`
- `fast-local`
- `tags-only`
- `verify-only`
- `skills-only`
- `passives-only`
- `uniques-only`
- `keystones-only`
- `recommendations-only`

## Examples

```bash
python data/helperScripts/update_app_data.py --profile verify-only --fail-fast
python data/helperScripts/update_app_data.py --profile fast-local --fail-fast
python data/helperScripts/update_app_data.py --profile full-patch --poe-version 0.4.x --resume --fail-fast
python data/helperScripts/update_app_data.py --profile tags-only --strict
python data/helperScripts/update_app_data.py --profile skills-only --semantic-stability-check
python data/helperScripts/update_app_data.py --profile recommendations-only --fail-fast
```

## Recommendation enrichment v3

The additive recommendation v3 stage builds a unified qualitative mechanics catalog. The default recommendation workflow consumes it for the primary-plus-one-companion package slice:

- `data/enriched/recommendation_catalog_v3.json`
- `data/enriched/recommendation_catalog_v3_report.json`
- `data/enriched/recommendation_skill_crafting_v3.json`
- `data/enriched/recommendation_granted_skill_access_v3.json`
- `data/enriched/weapon_offense_coverage_v3.json`
- `data/enriched/weapon_offense_coverage_v3_report.md`
- `data/config/recommendation_critical_profiles_v3.json`

It joins current enriched entities back to structured datamined relationships, retains scrape-backed unique and ascendancy evidence, emits typed positive and negative facts, and reports evidence that remains ambiguous or unparsed. Canonical taxonomy damage types are retained as carrier evidence without implying ailment application; seasonal Kalguuran entities remain in the catalog but are excluded by the runtime selector. Its schema and migration boundary are documented in `docs/recommendation_enrichment_v3.md`.

The generator is local-only. It consumes the currently committed enriched scrape outputs; it does not make network requests itself.

The selector also loads the small crafting, granted-access, and
critical-profile overlays when v3 is enabled.
It records explicit skill-owned base critical-hit chances from PoE2DB so
otherwise equivalent Critical Hits recommendations can prefer the stronger
intrinsic value. Ordinary weapon attacks remain weapon-sourced and neutral;
the selector does not invent a per-skill value for them. Refresh the overlay
with `make recommendation-critical-profiles` when the upstream skill data or
game patch changes.

## Semantic stability mode

Use `--semantic-stability-check` when you want the report to classify changed artifacts as one of:

- `unchanged`
- `byte_changed_semantically_same`
- `semantic_changed`
- `artifact_presence_changed`

This is meant to answer questions like:

- “Did the helper just reorder arrays or object entries?”
- “Did the file hash change, but the semantic content stay effectively the same?”
- “Did something materially change in the enriched output?”

The implementation is still **reporting-only**:

- it computes a second normalized fingerprint for each tracked artifact
- it ignores row ordering at the artifact level for list-backed outputs
- it normalizes dictionary key order and scalar-list order when computing semantic hashes
- it does **not** rewrite any output files or modify helper behavior

In other words, this mode helps you interpret rerun drift. It does not change generation logic.

## Notes

- `enrich_skills.py` is treated as a no-argument script, matching the current uploaded version.
- `enrich_passives.py` still owns its own logic. The wrapper only forwards `--lang`, `--timeout`, and optionally `--disable-network`.
- `generate_keystone_tooltips.py` and `scrape_poe2db_uniques_min.py` are treated as network-backed steps and are skipped when `--disable-network` is provided.
- The report includes both raw SHA-256 hashes and semantic SHA-256 hashes for tracked artifacts.

Important caveat: semantic stability is intentionally conservative. It is designed to tell you when a raw byte hash changed **without obvious content drift**. It should not be treated as a formal proof that two files are identical in every meaningful way. Its job is to help separate likely ordering noise from likely real content changes.
