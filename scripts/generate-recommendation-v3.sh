#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

generated=(
  data/enriched/recommendation_catalog_v3.json
  data/enriched/recommendation_catalog_v3_report.json
  data/enriched/recommendation_granted_skill_access_v3.json
  data/enriched/recommendation_skill_crafting_v3.json
  data/enriched/recommendation_unique_semantics_v3.json
  data/enriched/recommendation_unique_analysis_v3.json
  docs/recommendation_unique_analysis_v3.md
  data/enriched/recommendation_native_coverage_v3.json
  data/enriched/recommendation_carrier_bridges_v3.json
  docs/recommendation_coverage_v3.md
  data/enriched/recommendation_gap_analysis_v3.json
  data/enriched/recommendation_gap_followup_v3.json
  docs/recommendation_gap_analysis_v3.md
)

# Order is intentional: every analysis reads the catalog, and gap analysis also
# reads the native-coverage artifact produced immediately before it.
python3 data/helperScripts/generate_recommendation_catalog_v3.py
python3 data/helperScripts/validate_recommendation_catalog_v3.py
node data/helperScripts/generate_recommendation_unique_analysis_v3.mjs
node data/helperScripts/generate_recommendation_coverage_v3.mjs
node data/helperScripts/generate_recommendation_gap_analysis_v3.mjs
node scripts/recommendation-audit.mjs

if [[ "${1:-}" == "--check" ]]; then
  git diff --exit-code -- "${generated[@]}"
fi
