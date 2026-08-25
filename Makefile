.PHONY: normalize-tags-check normalize-tags-strict normalize-tags-audit recommendation-data recommendation-data-check recommendation-selector-check recommendation-critical-profiles recommendation-coverage

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

recommendation-data-check:
	python data/helperScripts/validate_recommendation_catalog_v3.py

recommendation-selector-check:
	node --test tests/recommendation-v3-selector.test.mjs

recommendation-coverage:
	node data/helperScripts/generate_recommendation_coverage_v3.mjs

recommendation-critical-profiles:
	python data/helperScripts/scrape_skill_critical_profiles_v3.py
