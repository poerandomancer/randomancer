# Offense Inventory Contract

`data/offense-inventory.json` is the canonical vocabulary for the Build roll's Offense axis.

This inventory is intentionally independent from the legacy `Ailments` / `Tactics` split in `core-data.json`. The legacy pools remain in place until the follow-up Offense roll migration is implemented.

## Categories

The supported category values are:

- `Damage Type`
- `Ailment`
- `Scaling`
- `Archetype`

`Archetype` currently contains `Minions/Companions`, `Totems`, and `Thorns`.

## Element shape

Each element provides:

- `id`: stable internal identifier. Relationships should reference IDs, not labels.
- `name`: user-facing label.
- `aliases`: optional compatibility/search labels.
- `category`: one of the supported category values above.
- `tags`: normalized matching vocabulary for future recommendation/scoring consumers.
- `attributes`: STR/DEX/INT cohesion affinity used by the roll system.
- `relations`: lightweight descriptive affinities between Offense elements.

### Relationship semantics

- `reinforcing`: a strong/native mechanical affinity. This is a preference signal, never a dependency.
- `secondary`: a meaningful but less direct affinity. This is also descriptive only.

Relationships must not be interpreted as hard compatibility gates. The Offense roll is intended to remain primarily cohesion-driven, including unconventional combinations.

## V1 vocabulary

Damage Type: Physical Damage, Fire Damage, Cold Damage, Lightning Damage, Chaos Damage.

Ailment: Ignite, Bleed, Poison, Chill, Freeze, Shock, Electrocute.

Scaling: Critical Hits.

Archetype: Minions/Companions, Totems, Thorns.

The follow-up roll migration will select one or two distinct Offense elements and enforce at most one `Archetype` selection. That behavior is deliberately not part of this inventory-only pass.
