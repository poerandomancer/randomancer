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

Cohesion is a continuous `[0..1]` preference strength.

### General affinity domains

Weapon, Offense, and other ordinary affinity-driven pools use soft probabilistic selection:

- Normalize STR/DEX/INT affinity vectors as distributions.
- Affinity overlap is `sum(min(base_i, candidate_i))`, in the range 0–1.
- Attributed candidates use `baseWeight * exp(4 * cohesion * overlap)`.
- `baseWeight` is intrinsic frequency and is independent from affinity.
- At Madness (`0`), affinity is ignored and only explicit base weights affect frequency.
- `cohesionNeutral` candidates retain their raw base-weight share independent of cohesion.
- Do not reintroduce general hard affinity thresholds or threshold-relaxation fallback behavior for these domains.

### Primary Defense exception

Primary Defense uses a topology-aware policy because its six outcomes map directly to the six class/passive-tree directions and off-axis defense is unusually punitive in real builds.

- Ring order: Armour -> Armour & Evasion -> Evasion -> Evasion & Energy Shield -> Energy Shield -> Armour & Energy Shield -> Armour.
- `cohesion > .75`: home Defense only.
- `.50 < cohesion <= .75`: home + adjacent defenses.
- `0 < cohesion <= .50`: home + adjacent + distance-two defenses.
- Madness (`0`): the full ring, including the direct opposite.
- Within the legal ring radius, use soft distance weighting so closer defenses remain more common.
- If explicit user Fates or hard game compatibility remove every in-radius option, use only the nearest remaining legal ring distance rather than failing the roll.

See `docs/cohesion_selection.md` for the canonical selection contract.

## Key runtime boundaries

- `js/06a-cohesion-selection.js` — shared normalized overlap, weighted probability, and ring-topology selection helpers.
- `js/06-cohesion.js` — shared cohesion state/context facade and Primary Defense policy routing.
- `js/06b-build-compatibility.js` — narrow game compatibility rules, separate from affinity scoring.
- `js/26-offense-roll.js` — canonical Offense helpers.
- `js/27-offense-runtime.js` — transitional Offense compatibility bridge.
- `js/28-primary-equipment-runtime.js` — transitional primary-family adapter and external-search bridge.
- `js/29-selection-frequency-runtime.js` — explicit base-frequency adapter for special primary families.

## Recommendation overhaul contract

- Cohesion affects only randomized core Fate selection. It must not relax, diversify, or add variance to recommendation quality.
- Primary Defense remains a core Fate component. Secondary defensive layers and recovery are solution obligations owned by the recommendation engine.
- Recommendations are selected as a coherent package, not independent content-type buckets or fixed quotas.
- Tags are candidate-retrieval hints only. Typed semantic facts and directed ontology relationships determine fulfillment, prerequisites, and conflicts.
- Primary-skill delivery must match the selected weapon family. Generic spells are caster-weapon candidates, not permissive fallbacks for martial weapons; weapon-specific exceptions require typed skill-type or equipment evidence.
- Native damage may qualify a skill as an ailment carrier, but it must not mark ailment application fulfilled. Keep the ailment unresolved until another package piece supplies explicit typed application evidence.
- Treat `Totemable` as compatibility, never totem identity. Totem fulfillment requires explicit creation or provision evidence.
- Exclude recommendation entities tagged with seasonal source `kalguuran` until the content is deliberately re-enabled; retain those entities in enrichment and Codex data.
- If v3 cannot select a legal primary, preserve the existing canonical recommendation and attach unresolved diagnostics instead of replacing it with an empty list.
- The first package expansion may add at most one active setup/enabler companion. It must resolve a typed missing Offense application or explicit primary dependency, remain equipment-legal and nonseasonal, and never be added as thematic filler.
- Preserve package order and role metadata in the canonical skill list: primary damage first, supporting setup/enabler second.
- Recommendation variation may sample only within a high-quality, fully legal shortlist. Persist the per-roll selection seed, suppress immediate repeats when equivalent alternatives exist, and never use Cohesion to vary recommendation quality.
- `data/enriched/recommendation_catalog_v3.json` is the additive semantic migration boundary for the package solver. The feature-flagged runtime slice consumes it for a seed-reproducible, equipment-legal primary plus at most one evidence-backed setup/enabler companion; the remaining live selectors stay unchanged.
- Enable the migration slice explicitly with `?recommendationV3=1`. Do not make the large catalog part of the default startup payload until rollout evidence supports that change.
- Scraped ascendancy descriptions and unique modifiers are intentional augmentation sources where datamined descriptions are incomplete or server-provided.

## Major-refactor follow-up docket

- Continue affinity calibration/load testing across primary equipment and Offense. Adjust affinity vectors or global strength only from observed distribution evidence.
- Continue Primary Defense load testing and tune ring bands/falloff from real roll distributions if needed.
- Replace the core secondary defensive-strategy roll with solution-oriented defensive and recovery Build Ideas after the v3 catalog is ready for runtime use.
- Replace the current recommendation compatibility layer with variable, solution-oriented Build Ideas.

## Working style

- Preserve user-facing behavior unless explicitly asked to change it.
- Prefer targeted patches over rewrites.
- Keep the roll pipeline robust to missing data.
- Preserve narrow compatibility readers where old saved/shared data still needs them.
- Treat `release` as read-only during the current overhaul. Branch from and merge back into `build-card-refactor`; the production merge to `release` is user-controlled.
