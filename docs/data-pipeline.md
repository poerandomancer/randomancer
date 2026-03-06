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

## Run

```bash
python scripts/pipeline/run_pipeline.py
```

Optional:

```bash
python scripts/pipeline/run_pipeline.py --skip-enrich
```
