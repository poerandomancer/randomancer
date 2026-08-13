# agent.md

## Project: The Randomancer (Path of Exile 2 Build Randomizer)

The Randomancer is a front-end-only HTML/CSS/JS + JSON app that generates themed, semi-cohesive Path of Exile 2 builds.

Core principles:
- Fun and inspirational, not a simulator.
- Smart but lightweight rules to avoid obviously broken combinations.
- Maintainable, diff-friendly changes.

## Current Build contract

- Standard Build mode rolls one broad primary equipment family; detailed hand configuration is not part of the Fate.
- Standard Build mode rolls 1–2 canonical Offense elements, with at most one Archetype.
- Canonical Offense lives in `data/offense-inventory.json`; legacy mechanic fields remain only as a compatibility boundary for current recommendations.
- Build snapshots store outcomes rather than user-control settings.

## Cohesion

Cohesion is a continuous `[0..1]` preference strength, not an eligibility threshold.

- Normalize STR/DEX/INT affinity vectors as distributions.
- Affinity overlap is `sum(min(base_i, candidate_i))`, in the range 0–1.
- Attributed candidates use `baseWeight * exp(4 * cohesion * overlap)`.
- `baseWeight` is intrinsic frequency and is independent from affinity.
- At Madness (`0`), affinity is ignored and only explicit base weights affect frequency.
- `cohesionNeutral` candidates retain their raw base-weight share independent of cohesion.
- Do not reintroduce hard affinity thresholds or threshold-relaxation fallback behavior.

See `docs/cohesion_selection.md` for the canonical selection contract.

## Key runtime boundaries

- `js/06a-cohesion-selection.js` — normalized overlap and weighted probabilistic selection.
- `js/06-cohesion.js` — shared cohesion state/context facade.
- `js/06b-build-compatibility.js` — narrow game compatibility rules, separate from affinity scoring.
- `js/26-offense-roll.js` — canonical Offense helpers.
- `js/27-offense-runtime.js` — transitional Offense compatibility bridge.
- `js/28-primary-equipment-runtime.js` — transitional primary-family adapter and external-search bridge.
- `js/29-selection-frequency-runtime.js` — explicit base-frequency adapter for special primary families.

## Major-refactor follow-up docket

- Continue affinity calibration/load testing across primary equipment, Offense, and later Defense. Adjust affinity vectors or global strength only from observed distribution evidence.
- Run the planned Defense viability audit + load test.
- Replace the current recommendation compatibility layer with variable, solution-oriented Build Ideas.

## Working style

- Preserve user-facing behavior unless explicitly asked to change it.
- Prefer targeted patches over rewrites.
- Keep the roll pipeline robust to missing data.
- Preserve narrow compatibility readers where old saved/shared data still needs them.
