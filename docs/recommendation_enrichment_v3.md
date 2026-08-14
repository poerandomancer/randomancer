# Recommendation enrichment v3

## Purpose

Recommendation enrichment v3 is the semantic input contract for solution-oriented Build Ideas. It is additive during migration: the existing skill, passive, and unique datasets remain available to the current application, while the new recommendation catalog normalizes their mechanics into one vocabulary.

Cohesion is deliberately outside this contract. Cohesion controls only randomized Fate selection. Recommendations always seek the most compatible and mechanically complete solution available.

## Source precedence

1. Datamined relationships are the authoritative mechanics source when present.
2. Scraped descriptions augment missing or server-provided data, especially unique modifiers and ascendancy descriptions.
3. Curated ontology rules interpret domain relationships that raw data cannot establish by itself.
4. Entity overrides handle exceptional or ambiguous mechanics and must retain an explanation.

Scraping and datamining provide evidence. They do not decide whether incidental overlap fulfills a Fate obligation.

## Generated artifacts

- `data/enriched/recommendation_catalog_v3.json` contains normalized recommendation entities.
- `data/enriched/recommendation_catalog_v3_report.json` reports source coverage, parsed evidence, ambiguity, and unparsed samples.
- `data/recommendation_ontology_v3.json` defines relations, roles, confidence levels, directed offense semantics, and survivability families.
- `data/config/recommendation_fact_overrides_v3.json` is the curated exception boundary.
- `data/config/recommendation_semantic_fixtures_v3.json` contains parser and catalog regression fixtures.

The catalog is the data boundary consumed by the feature-flagged package-solver migration. The first runtime slice selects only the primary-skill role; later slices will assign the remaining roles and obligations.

## Runtime migration slice

Append `?recommendationV3=1` to opt into the experimental selector. The normal application path does not fetch the 8 MB catalog and continues using the existing recommendation selectors.

The first slice:

- converts canonical Offense plus primary equipment into explicit obligations
- considers active skills with a `primary_damage` candidate role
- enforces equipment and ascendancy compatibility before ranking
- uses only exact or strong typed facts as fulfillment evidence
- treats `prevents` as a hard conflict for the matching Offense
- ignores Cohesion entirely
- writes the selected skill through the existing canonical recommendation contract
- records complementary defense, recovery, and package dependencies as unresolved instead of filling them with weak candidates

The primary Build Card is authoritative during this migration. Legacy recommendation rendering may still compute its former result, but the v3 runtime adapter replaces the canonical primary-skill idea after Offense normalization.

## Entity contract

Each entity has:

- a stable namespaced `id`
- a `content_type` and original `source_id`
- zero or more contextual `candidate_roles`
- `retrieval_terms` for candidate recall only
- typed `facts`
- structured `compatibility`
- source-specific `links`
- retained `source_evidence`
- dataset `provenance`

Retrieval terms never prove fulfillment. They may retrieve a candidate for semantic evaluation, but only typed facts and curated ontology relationships can satisfy an obligation.

## Fact contract

A fact contains:

- `relation`: one of the ontology relations
- `subject`: the affected actor or object
- `mechanic`: the canonical mechanic for single-mechanic facts
- `from` and `to`: required for conversions and replacements
- `condition`: optional prerequisite or contextual clause
- `confidence`: `exact`, `strong`, or `inferred`
- `evidence`: source kind plus the original stat ID, skill type, or text clause

Subjects matter. “Player cannot be Poisoned” is an incoming resilience property; “supported skill cannot inflict Poison” is an outgoing incompatibility.

## Compatibility contract

Compatibility is represented separately from affinity and candidate ranking:

- weapon and off-hand requirements
- allowed and excluded support target skill types
- support weapon restrictions
- ascendancy exclusivity
- equipment-slot occupation

These are legality and package-cost facts. They are never relaxed by a low-cohesion Fate.

## Contextual roles

Roles are possible uses, not permanent labels. A skill that applies Shock can be setup/control in one package and primary damage in another. The catalog records credible candidate roles; the package solver assigns final roles based on the obligations and other selected pieces.

Supported roles are:

- primary damage
- setup/control
- payoff
- enabler
- defense
- recovery
- utility

## Survivability responsibility

Primary Defense remains part of the randomized Fate. Secondary defensive layers and recovery are recommendation obligations. The internal solution families are avoidance, mitigation, buffer, recovery, resilience, and emergency sustain. They are not fixed UI buckets or quotas.

The eventual package solver should seek a credible complementary defensive layer and recovery loop unless other selected pieces already provide them. When it cannot do so, it should report the unresolved need instead of returning filler.

## Confidence and unknowns

The generator is intentionally conservative:

- structured datamined constraints are exact
- explicit, deterministic text/stat interpretations are exact or strong
- broad mechanical mentions are inferred and cannot establish hard fulfillment
- unparsed evidence is retained in the coverage report

Increasing the number of inferred tags is not a success metric. Coverage must improve without converting prohibitions, incoming protections, or incidental mentions into false positive fulfillment.
