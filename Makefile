.PHONY: normalize-tags-check normalize-tags-strict normalize-tags-audit recommendation-data recommendation-data-check

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
