# Cohesion Selection Contract

Cohesion is a continuous preference-strength control in the range `[0,1]`.

Most randomized Build domains use soft probabilistic affinity: otherwise-legal candidates remain selectable and cohesion only changes relative probability. Primary Defense is the intentional exception because its six outcomes form a fixed passive-tree ring with materially different viability costs when a build moves off-axis.

## General affinity selection

STR/DEX/INT vectors are normalized as distributions before comparison.

For normalized base distribution `A` and candidate distribution `B`, affinity overlap is:

`overlap(A, B) = sum(min(A_i, B_i))`

The result ranges from `0` (no shared attribute distribution) to `1` (identical distributions).

Attributed candidates use:

`weight = baseWeight * exp(4 * cohesion * overlap)`

`baseWeight` defaults to `1` and represents intrinsic frequency only. It is deliberately independent from attribute affinity.

At `cohesion = 0` (Madness), the affinity multiplier becomes `1`, so selection is driven only by explicit base weights.

Weapon and Offense selection remain in this permissive model: high cohesion strongly favors archetypal matches without making unusual legal combinations impossible.

## Neutral candidates

A candidate with `cohesionNeutral: true` does not participate in attribute-affinity weighting. Neutral candidates retain their raw base-weight share of the current candidate pool regardless of cohesion strength. If a neutral candidate is not selected, attributed candidates compete using the weighted model above.

This keeps selection affinity separate from downstream attribute contribution: a neutral candidate may still carry an `attributes` vector for build context without that vector affecting its selection frequency.

## Primary Defense ring

Primary Defense uses the six passive-tree directions as a circular topology:

`Armour -> Armour & Evasion -> Evasion -> Evasion & Energy Shield -> Energy Shield -> Armour & Energy Shield -> Armour`

The current archetype affinity resolves to a home point on that ring. Cohesion then establishes the maximum legal ring distance:

- `cohesion > 0.75`: home Defense only (`distance 0`)
- `0.50 < cohesion <= 0.75`: home + adjacent Defenses (`distance 0-1`)
- `0 < cohesion <= 0.50`: home + adjacent + second-ring Defenses (`distance 0-2`)
- `cohesion = 0` (Madness): the full ring, including the direct opposite (`distance 0-3`)

Within the legal radius, closer defenses remain more likely using the same global cohesion strength as a soft distance falloff:

`closeness = 1 - ringDistance / 3`

`weight = baseWeight * exp(4 * cohesion * closeness)`

At `.75`, for example, the home defense is favored over either adjacent hybrid/pure option. At `.50`, distance-two defenses become possible but remain less likely than home and adjacent outcomes.

Hard game compatibility and explicit Bind-the-Fates constraints are applied before Defense selection. If those constraints remove the entire in-radius Defense pool, the selector uses only the nearest remaining legal ring distance rather than failing the roll.

## Design goals

The general model is intended to provide smooth, monotonic preference changes, preserve unusual but legal Weapon/Offense outcomes even at high cohesion, handle genuinely neutral mechanics, and keep intrinsic rarity separate from affinity.

The Primary Defense exception deliberately trades some of that openness for structural viability: off-axis weapons and offensive ideas often create interesting build puzzles, while radically off-axis defensive foundations are substantially more punitive in actual play.
