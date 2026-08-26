# Unique recommendation semantic analysis v3

This deterministic diagnostic audits whole-item semantics while preserving the runtime Weapon + Offense contract. It does not change runtime selection.

## Summary

- Audited uniques: 131
- With granted skills: 94; with granted effects: 0
- Material granted-semantic gaps: 32
- Current empty cells: 108; gain a strong candidate: 29; remain legitimate: 79
- Non-empty current winners differing from the rich-semantic leader: 9
- Quality bands: one=52, two=9, three=7 (zero=67)

## Ranking model

BUILD_DEFINING_CAPABILITY outranks STRONG_SPECIALIZATION, which outranks AFFINITY_AMPLIFICATION, which outranks PAYOFF_CONTEXT. Contradiction/prevention rejects a candidate. Fact count only breaks ties inside a tier, so shallow match volume cannot outrank capability. The future variety band contains at most three candidates in the leading tier within 10 points.

## Fairgraves' Curse and Blackgleam

| Probe | Current | Proposed | Fairgraves | Blackgleam |
|---|---|---|---|---|
| Bow × Ignite | Blackgleam | Fairgraves' Curse | Fairgraves' Curse (BUILD_DEFINING_CAPABILITY, score 407) | Blackgleam (PAYOFF_CONTEXT, score 106) |
| Bow × Fire | empty | Fairgraves' Curse | Fairgraves' Curse (BUILD_DEFINING_CAPABILITY, score 407) | Blackgleam (STRONG_SPECIALIZATION, score 316) |

Fairgraves' parent catalog facts expose only its granted-skill marker and recovery. The whole-item audit additionally finds item Fire addition/magnitude plus Phantasmal Arrow's Physical→Fire conversion, Fire property, direct Ignite application, Ignite specialization, and explosion component provenance. Blackgleam exposes direct Ignite in the current catalog (derived from a payoff line), while its raw modifiers add/gain Fire and amplify Flammability. The regression therefore confirms that missing granted-skill semantics materially suppress Fairgraves; it does not justify an item-name exception.

## Bow and Quiver precedence

Slot type adds no semantic score. Bow and Quiver are equally family-legal, and richer ranking is tier-first. Current additive fact scoring can reward repeated shallow facts, but the current catalog more often under-represents item modifiers and granted behavior than systematically favoring Quivers. There is no evidence for a blanket Quiver preference and no Bow-first rule is proposed.

## Granted semantic gaps

- Adonia's Ego → Pinnacle of Power, Power Siphon: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:has_property:lightning; AFFINITY_AMPLIFICATION:has_property:physical; offenses cold, fire, lightning, physical; changes a proposed winner.
- Atziri's Contempt → Shattering Spite: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:has_property:lightning; AFFINITY_AMPLIFICATION:modifies:fire; AFFINITY_AMPLIFICATION:modifies:lightning; BUILD_DEFINING_CAPABILITY:converts:fire; BUILD_DEFINING_CAPABILITY:converts:lightning; offenses fire, lightning; changes a proposed winner.
- Brutus' Lead Sprinkler → Molten Shower: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:fire; BUILD_DEFINING_CAPABILITY:converts:fire; offenses fire; changes a proposed winner.
- Cursecarver → Decompose: AFFINITY_AMPLIFICATION:has_property:chaos; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:chaos; AFFINITY_AMPLIFICATION:modifies:poison; offenses chaos, fire, poison; changes a proposed winner.
- Double Vision → Gemini Surge: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:cold; AFFINITY_AMPLIFICATION:modifies:fire; BUILD_DEFINING_CAPABILITY:converts:cold; BUILD_DEFINING_CAPABILITY:converts:fire; offenses cold, fire; changes a proposed winner.
- Dusk Vigil → Ember Fusillade, Firebolt: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:lightning; BUILD_DEFINING_CAPABILITY:inflicts:ignite; PAYOFF_CONTEXT:consumes:lightning; offenses fire, ignite, lightning; changes a proposed winner.
- Earthbound → Lightning Bolt, Spark: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:lightning; offenses cold, lightning; changes a proposed winner.
- Enezun's Charge → Volatile Dead: AFFINITY_AMPLIFICATION:has_property:fire; BUILD_DEFINING_CAPABILITY:inflicts:ignite; offenses fire, ignite; changes a proposed winner.
- Fairgraves' Curse → Phantasmal Arrow: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:fire; AFFINITY_AMPLIFICATION:modifies:ignite; BUILD_DEFINING_CAPABILITY:converts:fire; BUILD_DEFINING_CAPABILITY:inflicts:ignite; offenses fire, ignite; changes a proposed winner.
- Fury of the King → Molten Crash: AFFINITY_AMPLIFICATION:modifies:fire; BUILD_DEFINING_CAPABILITY:converts:fire; offenses fire; changes a proposed winner.
- Guiding Palm of the Eye → Purity of Ice: AFFINITY_AMPLIFICATION:has_property:cold; offenses cold; changes a proposed winner.
- Guiding Palm of the Heart → Purity of Fire: AFFINITY_AMPLIFICATION:has_property:fire; offenses fire.
- Guiding Palm of the Mind → Purity of Lightning: AFFINITY_AMPLIFICATION:has_property:lightning; offenses lightning; changes a proposed winner.
- Hysseg's Claw → Cackling Companions: AFFINITY_AMPLIFICATION:has_property:physical; offenses physical.
- Liminal Coil → Coiling Bolts: AFFINITY_AMPLIFICATION:has_property:chaos; offenses chaos; changes a proposed winner.
- Murkshaft → Bursting Fen Toad: AFFINITY_AMPLIFICATION:has_property:chaos; AFFINITY_AMPLIFICATION:has_property:physical; offenses chaos, physical; changes a proposed winner.
- Palm of the Dreamer → Impurity: AFFINITY_AMPLIFICATION:has_property:chaos; offenses chaos; changes a proposed winner.
- Periphery → Azmerian Swarms: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:has_property:lightning; AFFINITY_AMPLIFICATION:has_property:physical; AFFINITY_AMPLIFICATION:modifies:physical; offenses cold, fire, lightning, physical; changes a proposed winner.
- Runeseeker's Call → The Stars Answer: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:physical; offenses cold, physical.
- Sacred Flame → Purity of Fire: AFFINITY_AMPLIFICATION:has_property:fire; offenses fire; changes a proposed winner.

## Empty results

- GENUINELY_NO_RELEVANT_UNIQUE: 67
- ITEM_SEMANTIC_DATA_INCOMPLETENESS: 17
- MISSING_APPLICATION_OR_CONVERSION_PARSING: 1
- MISSING_GRANTED_SEMANTICS: 23

Empty cells retain only up to three meaningful legal leads in the JSON artifact. No cell is force-filled. The dominant cause is absence or incompleteness of typed item semantics; granted behavior explains only the subset with a provable promoted fact.

## Contradiction and prevention

- Brutus' Lead Sprinkler is rejected for Mace × physical: converts physical→fire.
- Kaltenhalt is rejected for Mace × physical: converts physical→cold.
- Nightfall is rejected for Mace × physical: converts physical→cold.
- Twisted Empyrean is rejected for Mace × physical: converts physical→cold.
- Nightfall is rejected for Mace × fire: converts fire→cold.
- Nightfall is rejected for Mace × lightning: converts lightning→cold.
- The Sentry is rejected for Quarterstaff × physical: prevents physical.
- Fairgraves' Curse is rejected for Bow × physical: converts physical→fire.
- Double Vision is rejected for Crossbow × physical: converts physical→cold, converts physical→fire.
- Redemption is rejected for Crossbow × fire: prevents fire.
- The Unborn Lich is rejected for Staff × ignite: prevents ignite.
- The Whispering Ice is rejected for Staff × chill: prevents chill.

Incoming player immunity is not treated as an outgoing Offense contradiction. Directionally adverse item or skill conversion remains a hard rejection.

## Conclusions

The audit supports the central diagnosis: the selector contract is not inherently too narrow; the unique semantic model is incomplete, particularly where behavior lives on granted skills and raw modifiers. A future runtime change should promote provenance-preserving typed facts to the parent unique, rank lexicographically by semantic tier, retain directional conversion and contradiction safety, and randomize only within the best quality band.

No class, ascendancy, package, named-item exception, Weapon × Offense exception, or runtime randomization was introduced.
