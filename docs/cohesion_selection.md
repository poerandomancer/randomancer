# Cohesion Selection Contract

Cohesion is a continuous preference-strength control in the range `[0,1]`.

It does not make candidates eligible or ineligible. Every otherwise-legal candidate remains selectable; cohesion only changes relative probability.

## Affinity

STR/DEX/INT vectors are normalized as distributions before comparison.

For normalized base distribution `A` and candidate distribution `B`, affinity overlap is:

`overlap(A, B) = sum(min(A_i, B_i))`

The result ranges from `0` (no shared attribute distribution) to `1` (identical distributions).

## Selection weight

Attributed candidates use:

`weight = baseWeight * exp(4 * cohesion * overlap)`

`baseWeight` defaults to `1` and represents intrinsic frequency only. It is deliberately independent from attribute affinity.

At `cohesion = 0` (Madness), the affinity multiplier becomes `1`, so selection is driven only by explicit base weights.

At `cohesion = 1` (Strict), higher-overlap candidates receive a strong preference but lower-overlap legal candidates never become impossible.

## Neutral candidates

A candidate with `cohesionNeutral: true` does not participate in attribute-affinity weighting. Neutral candidates retain their raw base-weight share of the current candidate pool regardless of cohesion strength. If a neutral candidate is not selected, attributed candidates compete using the weighted model above.

This keeps selection affinity separate from downstream attribute contribution: a neutral candidate may still carry an `attributes` vector for build context without that vector affecting its selection frequency.

## Design goals

The model is intended to provide smooth, monotonic changes in preference as the cohesion control moves, avoid threshold cliffs and relaxation artifacts, preserve unusual but legal outcomes at Strict, and keep intrinsic rarity separate from attribute matching.
