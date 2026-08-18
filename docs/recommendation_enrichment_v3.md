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

The catalog is the data boundary consumed by the feature-flagged package-solver migration. The current runtime slice builds and scores complete one- or two-skill packages, then assigns zero, one, or two typed bridge supports to each selected skill. Broader survivability assignment remains a later slice.

## Runtime migration slice

Append `?recommendationV3=1` to opt into the experimental selector. The normal application path does not fetch the 8 MB catalog and continues using the existing recommendation selectors.

The first slice:

- converts canonical Offense plus primary equipment into explicit obligations
- builds an access-legal, nonseasonal active-skill pool from direct Offense evidence, native damage carriers, and a narrow closure over typed setup costs and prerequisites
- requires at least one package member with a legal `primary_damage` role and weapon delivery; unrestricted setup, payoff, and enabler skills still need equipment and ascendancy access
- uses only exact or strong typed facts as fulfillment evidence
- distinguishes direct fulfillment from native damage carriers: a Lightning skill can carry Shock or Electrocute, for example, but the corresponding ailment remains unresolved until another package piece explicitly applies it
- treats `prevents` as a hard conflict for the matching Offense
- excludes source-tagged Kalguuran gems from recommendation eligibility while retaining them in the catalog and Codex
- ignores Cohesion entirely
- enumerates legal singleton and ordered two-skill packages before choosing either skill
- scores package-wide direct coverage, carrier coverage, directed setup/payoff edges, prerequisite resolution, complementary roles, and unresolved costs
- strongly prefers two skills when the second contributes typed Offense coverage or a real cross-skill relationship, but lets a singleton win instead of adding unrelated filler
- permits parallel damage skills when they add real Offense coverage, while ranking explicit setup/payoff and enabler relationships above comparable parallel packages
- samples complete packages from a narrow high-quality shortlist using a persisted per-roll seed, while suppressing an immediate primary repeat when an equivalent package exists
- writes the ordered primary-plus-supporting package through the existing canonical recommendation contract
- evaluates support assignments only after the active package is chosen, with at most two supports per skill and one selected member from each support family across the whole package
- attaches a support only when it resolves a rolled Offense or an explicit unresolved skill dependency; unused support positions remain empty
- displays each chosen support inline with the specific Build Card skill it modifies
- records complementary defense, recovery, and package dependencies as unresolved instead of filling them with weak candidates

Weapon delivery is intentionally stricter than technical equip legality. Generic spells are eligible for Wand, Sceptre, and caster Staff rolls. Martial rolls require structured evidence that the skill belongs to the selected weapon family, either through its active skill types or its equipment requirement. A spell may cross that boundary only when the catalog explicitly proves the martial-weapon relationship. If no direct fulfiller exists, a legal native damage carrier may be selected without claiming fulfillment. If no legal carrier exists either, the selector reports the obligation as unresolved.

The selector also emits a final `diagnostics.offenseCoverage` entry for each
rolled Offense after support assignment. This classifies what actually happened
to the selected package as `active_direct`, `support_assigned`, `carrier_only`,
`support_route_unassigned`, `selected_unresolved`, or `no_primary`. The
diagnostic is intentionally post-selection rather than a roll-time filter: it
lets audits and future picker work distinguish a genuinely unsupported
weapon/Offense pairing from a package that was made viable by a bridge support.

That delivery rule identifies the primary damage position in every candidate package. A supporting skill is instead checked for explicit equipment and ascendancy access, so an otherwise unrestricted curse, mark, or spell can accompany a martial primary. Unrestricted access alone never earns a slot: the supporting skill must add hard Offense evidence or participate in a typed supply-to-require/consume relationship. Damage-type `has_property` and native-carrier evidence only count from a supporting skill when that skill is itself legal damage delivery; this prevents a passive aura or curse from masquerading as a second damage skill.

The solver evaluates both relationship directions. A setup can supply a state or resource consumed by the primary, while the primary can establish a state consumed by a payoff. Generic `charge` evidence is deliberately too broad to bridge specific Power, Frenzy, or Endurance Charge costs. Package-wide direct Offense fulfillment outranks a superficially synergistic package that still leaves a rolled Offense unapplied.

The primary Build Card is authoritative during this migration. Legacy recommendation rendering may still compute its former result, but the v3 runtime adapter replaces the canonical skill ideas after Offense normalization only when v3 has selected a primary. The card preserves package order and labels contextual roles as Primary, Secondary, Setup, Payoff, or Enabler. An unresolved v3 result records diagnostics without erasing the existing recommendation.

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

Support-gem entities additionally carry a `support_family` object with a
stable family ID, display name, and optional numeric tier. All tiers in a
family are one recommendation concept: they may provide different values, but
they cannot occupy multiple support positions in the same package.

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

`Totemable` is compatibility evidence only: it means a skill can be used by a totem-supporting system. It does not prove that the skill creates or is a totem. Only explicit structured evidence such as `SummonsTotem` or `SummonsAttackTotem` establishes that identity.

Seasonal availability is also a legality boundary. The current selector excludes entities whose provenance contains the `kalguuran` source tag. The data stays enriched so the exclusion can be removed cleanly if that content becomes appropriate for a future league.

## Support bridge contract

Support effects are facts whose subject is `supported_skill`. They retain the
same relation semantics as active skills while remaining attached to a legal
target skill:

- `provides` records an additive damage-type bridge or ailment-eligibility
  route, such as gaining Fire damage or allowing Chaos damage to Shock
- `inflicts` records explicit application by the supported skill
- `creates` records a provider effect such as creating Minions
- `converts` records replacement of one damage type or mechanic with another
- `requires` records the native carrier or state needed by the support
- `prevents` records a hard conflict that must be evaluated after all support
  effects are applied

Damage gained as another type is provision, not conversion. Likewise, a stat
such as `chaos_damage_can_shock` provides Shock eligibility and requires Chaos
damage; it does not claim the supported skill independently inflicts Shock.
The package solver evaluates zero-, one-, and two-support assignments as a unit
so one support may supply another support's typed requirement. Direct
fulfillment remains stronger than a one-support bridge, which remains stronger
than a two-support bridge. Within otherwise equivalent support routes, normal
support gems are preferred over lineage supports, and a two-support normal
bridge may beat a one-support lineage bridge. Lineage supports remain legal
when they provide the only route or solve extra package requirements. Every
selected support must be necessary for at least one resolved target, and a
family cannot be reused on another selected skill. Conflicts are applied after
the full support set, so an enabler cannot silently remove an already-working
rolled Offense route. Empty support positions are the correct result when no
unresolved rolled Offense or explicit dependency is improved.

Support target expressions that contain an unambiguous `AND` require every
listed skill type. Mixed flattened `AND`/`OR` expressions remain ineligible
until the catalog preserves their grouping; permissive matching would make
weapon- or delivery-specific supports appear legal on unrelated skills.

## Contextual roles

Roles are possible uses, not permanent labels. A skill that applies Shock can be setup/control in one package and primary damage in another. The catalog records credible candidate roles; the package solver assigns final roles based on the obligations and other selected pieces.

Supported roles are:

- primary damage
- secondary damage (assigned contextually when the second skill is parallel damage rather than setup or payoff)
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
- explicit ailment application and ailment-ground/cloud creation become `inflicts`; text that only enables ailment buildup becomes `provides`
- consume parsing is clause-local, so a later effect such as Chilled Ground is not mislabeled as the consumed resource
- descriptions that store Ignite, Bleed, or Poison damage dealt record that ailment as an input requirement instead of presenting the storage skill as self-sufficient
- `base_deal_no_damage` is scoped to `base_effect_only`; it does not disqualify a composite skill whose triggered or secondary effect deals damage
- broad mechanical mentions are inferred and cannot establish hard fulfillment
- unparsed evidence is retained in the coverage report

Increasing the number of inferred tags is not a success metric. Coverage must improve without converting prohibitions, incoming protections, or incidental mentions into false positive fulfillment.
