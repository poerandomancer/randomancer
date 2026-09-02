.PHONY: normalize-tags-check normalize-tags-strict normalize-tags-audit recommendation-data recommendation-data-check recommendation-selector-check recommendation-critical-profiles recommendation-coverage recommendation-gap-analysis recommendation-provenance recommendation-v3 recommendation-v3-check

normalize-tags-check:
	python data/helperScripts/generate_tag_rules_js.py
	python data/helperScripts/validate_tag_normalization.py

normalize-tags-strict:
	python data/helperScripts/generate_tag_rules_js.py
	python data/helperScripts/validate_tag_normalization.py --strict

normalize-tags-audit:
	python data/helperScripts/audit_tag_vocab.py --json-out data/enriched/tag_vocab_audit.json

recommendation-data:
	python data/helperScripts/generate_recommendation_catalog_v3.py
	python data/helperScripts/validate_recommendation_catalog_v3.py
	node data/helperScripts/generate_recommendation_unique_analysis_v3.mjs

recommendation-data-check:
	python data/helperScripts/validate_recommendation_catalog_v3.py

recommendation-selector-check:
	node --test tests/recommendation-v3-selector.test.mjs

recommendation-coverage:
	node data/helperScripts/generate_recommendation_coverage_v3.mjs

recommendation-gap-analysis:
	node data/helperScripts/generate_recommendation_gap_analysis_v3.mjs

recommendation-critical-profiles:
	python data/helperScripts/scrape_skill_critical_profiles_v3.py

recommendation-provenance:
	python data/helperScripts/generate_recommendation_catalog_v3.py --provenance-out data/enriched/debug/recommendation_catalog_v3_provenance.json
	python data/helperScripts/validate_recommendation_catalog_v3.py

recommendation-v3:
	./scripts/generate-recommendation-v3.sh

recommendation-v3-check:
	./scripts/generate-recommendation-v3.sh --check
