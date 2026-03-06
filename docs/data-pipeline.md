# Data Pipeline (Phase 1 Foundation)

This repository now includes a staged data pipeline scaffold with a single orchestrator:

- `scripts/pipeline/run_pipeline.py`

## Stage order

1. input checks
2. normalization (scaffold)
3. canonical assembly (scaffold)
4. enrichment (wraps existing helper scripts)
5. runtime projection summary
6. validation
7. version manifest + pipeline report update

## Folder architecture

Pipeline-oriented data folders are organized under `data/`:

- `raw/` (datamined, scraped, handcrafted)
- `normalized/` (datamined, scraped, handcrafted)
- `canonical/`
- `enriched/` (existing app-consumed outputs remain here)
- `runtime/`
- `overrides/` (merge, field, tag, taxonomy, display)
- `reports/`

## Current phase scope

Phase 1 intentionally focuses on structure and orchestration only.
Major source-policy migrations (for uniques/passives) are deferred.

## Phase 2 tag architecture

Tag normalization now runs through shared utilities and config-driven overrides:

- `scripts/shared/tag_utils.py`
- `data/overrides/tag_overrides/aliases.json`
- `data/overrides/tag_overrides/blacklist.json`
- `data/overrides/tag_overrides/visibility_rules.json`
- `data/overrides/tag_overrides/weights.json`

Pipeline validation now includes tag-hygiene checks and emits `data/reports/tag_report.json`.

## Phase 3 uniques migration

Uniques are now the first scraped-first canonical entity family:

- Normalized scraped uniques: `data/normalized/scraped/uniques_scraped_normalized.json`
- Canonical uniques: `data/canonical/uniques.json`
- Enriched app-compatible uniques: `data/enriched/uniques_enriched.json`

Related reports:

- `data/reports/uniques_migration_report.json`
- `data/reports/validation_report.json` (`uniques_hygiene` section)

## Run

```bash
python scripts/pipeline/run_pipeline.py
```

Optional:

```bash
python scripts/pipeline/run_pipeline.py --skip-enrich
```
