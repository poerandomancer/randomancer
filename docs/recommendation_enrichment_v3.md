# Recommendation enrichment v3

## Purpose

Recommendation enrichment v3 is the semantic input contract for solution-oriented Build Ideas. It is additive during migration: the existing skill, passive, and unique datasets remain available to the current application, while the new recommendation catalog normalizes their mechanics into one vocabulary.

Affinity is deliberately outside this contract. Affinity controls only randomized Fate selection. Recommendations always seek the most compatible and mechanically complete solution available.

## Source precedence

1. Datamined relationships are the authoritative mechanics source when present.
2. Scraped descriptions augment missing or server-provided data, especially unique modifiers and ascendancy descriptions.
3. Curated ontology rules interpret domain relationships that raw data cannot establish by itself.
4. Entity overrides handle exceptional or ambiguous mechanics and must retain an explanation.

Scraping and datamining provide evidence. They do not decide whether incidental overlap fulfills a Fate obligation.

## Generated artifacts

- `data/enriched/recommendation_catalog_v3.json` contains the compact browser-facing recommendation entities.
- `data/enriched/recommendation_catalog_v3_report.json` reports source coverage, parsed evidence, ambiguity, and unparsed samples.
- `data/enriched/recommendation_skill_crafting_v3.json` maps active Skill Idea candidates to their crafting type, school, and weapon-affinity metadata.
- `data/enriched/recommendation_granted_skill_access_v3.json` records skill access that depends on ascendancy passives or selected uniques.
- `data/recommendation_ontology_v3.json` defines relations, roles, confidence levels, directed offense semantics, and survivability families.
- `data/config/recommendation_fact_overrides_v3.json` is the curated exception boundary.
- `data/config/recommendation_semantic_fixtures_v3.json` contains parser and catalog regression fixtures.

The catalog is the data boundary consumed by the package solver. The current runtime slice builds and scores complete one- or two-skill packages, then assigns zero, one, or two typed bridge supports to each selected skill. Broader survivability assignment remains a later slice.

## Runtime migration slice

The package selector is the default recommendation workflow and its catalog loads during normal application startup.

The first slice:

- converts canonical Offense plus primary equipment into explicit obligations
- builds an access-legal, nonseasonal, normally craftable active-skill pool from direct Offense evidence, native damage carriers, and a narrow closure over typed setup costs and prerequisites
- requires at least one package member with a legal `primary_damage` role and weapon delivery; unrestricted setup, payoff, and enabler skills still need equipment and ascendancy access
- uses only exact or strong typed facts as fulfillment evidence
- distinguishes direct fulfillment from native damage carriers: a Lightning skill can carry Shock or Electrocute, for example, but the corresponding ailment remains unresolved until another package piece explicitly applies it
- excludes active skills without populated crafting metadata, item- or passive-granted skills, basic/default attack skills, and Spirit, persistent, or reservation-style active gems from Skill Ideas
- treats `prevents` as a hard conflict for the matching Offense
- excludes source-tagged Kalguuran gems from recommendation eligibility while retaining them in the catalog and Codex
- ignores Affinity entirely
- enumerates legal singleton and ordered two-skill packages before choosing either skill
- scores package-wide direct coverage, carrier coverage, directed setup/payoff edges, prerequisite resolution, complementary roles, and unresolved costs
- strongly prefers two skills when the second contributes typed Offense coverage or a real cross-skill relationship, but lets a singleton win instead of adding unrelated filler
- permits parallel damage skills when they add real Offense coverage, while ranking explicit setup/payoff and enabler relationships above comparable parallel packages
- samples complete packages from a narrow high-quality shortlist using a persisted per-draw seed, while suppressing an immediate primary repeat when an equivalent package exists
- writes the ordered primary-plus-supporting package through the existing canonical recommendation contract
- evaluates support assignments only after the active package is chosen, with at most two supports per skill and one selected member from each support family across the whole package
- attaches a normal support only when it resolves a drawn Offense or an explicit unresolved skill dependency; unused support positions remain empty
- displays each chosen support inline with the specific Build Card skill it modifies
- records complementary defense, recovery, and package dependencies as unresolved instead of filling them with weak candidates

Weapon delivery is intentionally stricter than technical equip legality. Skill Ideas use normal craftable active skill gems, not item-granted skills, passive-granted skills, default attacks, or Spirit/persistent reservation skills. Martial rolls require the skill's crafting metadata to identify the selected weapon family. Caster rolls for Staff, Wand, and Sceptre require a craftable spell from the Occult, Elemental, or Primal schools, with a narrow metadata exception for skills whose payload explicitly permits Spell support even when the active type list omits it. Weapon-agnostic Minion or Companion skills no longer cross the martial boundary by archetype alone; if a martial weapon can use Minions, that should come from a weapon-native skill and any required normal support bridge. If no direct fulfiller exists, a legal native damage carrier may be selected without claiming fulfillment. If no legal carrier exists either, the selector reports the obligation as unresolved.

The selector also emits a final `diagnostics.offenseCoverage` entry for each
drawn Offense after support assignment. This classifies what actually happened
to the selected package as `active_direct`, `support_assigned`, `carrier_only`,
`support_route_unassigned`, `selected_unresolved`, or `no_primary`. The
diagnostic is intentionally post-selection rather than a draw-time filter: it
lets audits and future picker work distinguish a genuinely unsupported
weapon/Offense pairing from a package that was made viable by a bridge support.

That delivery rule identifies the primary damage position in every candidate package. A supporting skill is instead checked for explicit equipment and ascendancy access, so an otherwise unrestricted curse, mark, or spell can accompany a martial primary. Unrestricted access alone never earns a slot: the supporting skill must add hard Offense evidence or participate in a typed supply-to-require/consume relationship. Damage-type `has_property` and native-carrier evidence only count from a supporting skill when that skill is itself legal damage delivery; this prevents a passive aura or curse from masquerading as a second damage skill.

The solver evaluates both relationship directions. A setup can supply a state or resource consumed by the primary, while the primary can establish a state consumed by a payoff. Generic `charge` evidence is deliberately too broad to bridge specific Power, Frenzy, or Endurance Charge costs. Package-wide direct Offense fulfillment outranks a superficially synergistic package that still leaves a drawn Offense unapplied.

The primary Build Card is authoritative during this migration. The v3 runtime installs canonical skill ideas after Offense normalization only when v3 has selected a primary. The card preserves package order and labels contextual roles as Primary, Secondary, Setup, Payoff, or Enabler. An unresolved v3 result records diagnostics without erasing the existing recommendation.

## Build-time entity contract

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

## Runtime catalog projection

The generator deliberately builds the rich entity contract above only as a build-time intermediate. The committed `recommendation_catalog_v3.json` is a deterministic runtime projection containing only fields read by the application plus tiny semantic markers required to keep downstream recommendation audits deterministic. Full descriptions, original evidence clauses, raw stats, parser/component provenance, links, and other diagnostic material are not browser payload.

Verbose fact evidence is compiled to short markers. Support markers preserve the selector's affirmative-bridge distinction; active-skill and unique markers preserve only payoff/component classification used by the deterministic unique-semantics audit. Normal skill prose is omitted; only a minimal exclusion marker is retained for DNT/unused content. Active-skill type data, compatibility, access sidecars, crafting metadata, and the typed fact fields used by matching remain authoritative. No additional runtime network request is introduced by this projection; display text continues to come from the existing enriched skill/passive/unique datasets already loaded by the app.

For investigation during a patch refresh, generate the full developer artifact explicitly with `--provenance-out data/enriched/debug/recommendation_catalog_v3_provenance.json`. That path is gitignored and is intentionally not part of the application or normal Git history.

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

These are legality and package-cost facts. They are never relaxed by a low-affinity Fate.

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
than a two-support bridge. Skill Ideas support slots use normal support gems
only. Lineage supports remain enriched in the catalog for future surfaces such
as unique or conditional idea sections, but they do not occupy active support
recommendation slots. Every selected support must be necessary for at least one
resolved target, and a family cannot be reused on another selected skill.
Conflicts are applied after the full support set, so an enabler cannot silently
remove an already-working drawn Offense route. Empty support positions are the
correct result when no unresolved drawn Offense or explicit dependency is
improved.

Some bridges are mutually exclusive on a single supported skill. `Electrocute`
is the canonical example: it can let Lightning damage inflict Electrocute, but
it also prevents the supported skill from Shocking. When two drawn Offenses
need conflicting support routes, the solver may select a second active skill as
a separate support lane even if both skills expose the same potential carrier
coverage. This keeps Shock and Electrocute recommendations honest instead of
pretending one supported skill can do both jobs.

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
