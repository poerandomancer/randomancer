# Offense Inventory Contract

`data/offense-inventory.json` is the canonical vocabulary for the Build roll's Offense axis.

The inventory is intentionally independent from the legacy `Ailments` / `Tactics` split in `core-data.json`. During the current migration, the standard Build roll projects canonical Offense entries through the legacy mechanics boundary only long enough for the existing recommendation stack to consume their tags. New state and presentation should treat the `offense*` snapshot fields as authoritative.

## Categories

The supported category values are:

- `Damage Type`
- `Ailment`
- `Scaling`
- `Archetype`

`Archetype` currently contains `Minions/Companions` and `Totems`. `Thorns`
remains available to passive and gearing semantics, but is not a rollable
Offense obligation.

## Element shape

Each element provides:

- `id`: stable internal identifier. Relationships should reference IDs, not labels.
- `name`: user-facing label.
- `aliases`: optional compatibility/search labels.
- `category`: one of the supported category values above.
- `tags`: normalized matching vocabulary for recommendation/scoring consumers.
- `attributes`: STR/DEX/INT affinity used for cohesion selection and/or downstream build context.
- `cohesionNeutral`: optional boolean for mechanics that should receive a baseline selection share independent of STR/DEX/INT cohesion.
- `relations`: lightweight descriptive affinities between Offense elements.

### Cohesion-neutral semantics

`Critical Hits` and `Chaos Damage` are currently cohesion-neutral Offense elements. A neutral entry keeps its raw share of the current candidate pool regardless of cohesion threshold; it does not count as a passing attribute match that prevents the normal threshold-relaxation behavior for other candidates. This models broad applicability without making a three-stat vector artificially favor hybrid builds or making a neutral result dominate strict pools.

A cohesion-neutral element may still retain an `attributes` vector for downstream build balance/context. `Chaos Damage`, for example, keeps a mild `0.3 STR / 0.3 DEX / 0.4 INT` lean while its selection frequency remains cohesion-neutral. `Critical Hits` has no attribute contribution.

### Relationship semantics

- `reinforcing`: a strong/native mechanical affinity. This is a preference signal, never a dependency.
- `secondary`: a meaningful but less direct affinity. This is also descriptive only.

Relationships must not be interpreted as hard compatibility gates. The Offense roll remains primarily cohesion-driven, including unconventional combinations.

## V1 vocabulary

Damage Type: Physical Damage, Fire Damage, Cold Damage, Lightning Damage, Chaos Damage.

Ailment: Ignite, Bleed, Poison, Chill, Freeze, Shock, Electrocute.

Scaling: Critical Hits.

Archetype: Minions/Companions, Totems.

## Roll contract

Standard Build rolls select either one or two distinct Offense elements. The Fate chooses that count independently on every roll; there is no player-facing Offense-count control. V1 uses equal 1-vs-2 weighting. A build may contain at most one `Archetype`.

No pairwise Damage Type/Ailment compatibility matrix is applied. Weapon-to-Offense hard gates are also intentionally not introduced here; cohesion remains the primary governor of conventional versus unusual combinations.

Bind the Fates uses the canonical Offense vocabulary while retaining the existing `combat` storage category as a migration detail. Legacy names such as `Minions`, `Companions`, `Critical Hit`, `Bleeding`, and `Electrocution` resolve through aliases where possible; retired mechanics that are no longer part of the Offense contract are dropped from the active standard-roll fate set.

## Recommendation compatibility

The existing recommendation engine still expects `ailmentSet` / `tacticSet`. Until that engine is replaced, `js/27-offense-runtime.js` provides a narrow compatibility membrane:

- canonical Offense entries are temporarily projected through the legacy mechanics picker for a standard roll;
- the resulting build is immediately normalized to authoritative `offense`, `offenseList`, `offenseSet`, and `offenseTags` fields;
- legacy mechanics fields remain populated only so existing skill/passive/unique scorers continue functioning;
- the original `core-data.json` Ailment/Tactic pools are restored after each standard roll.

This compatibility layer is transitional and should be removed when the recommendation engine consumes canonical Offense directly.
