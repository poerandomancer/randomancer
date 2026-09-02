#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

generated=(
  data/enriched/recommendation_catalog_v3.json
  data/enriched/recommendation_catalog_v3_report.json
  data/enriched/recommendation_granted_skill_access_v3.json
  data/enriched/recommendation_skill_crafting_v3.json
  data/enriched/recommendation_unique_semantics_v3.json
)

python3 data/helperScripts/generate_recommendation_catalog_v3.py
python3 data/helperScripts/validate_recommendation_catalog_v3.py
node data/helperScripts/generate_recommendation_unique_semantics_v3.mjs

if [[ "${1:-}" == "--check" ]]; then
  git diff --exit-code -- "${generated[@]}"
fi
