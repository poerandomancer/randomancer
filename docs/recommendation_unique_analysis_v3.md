# Unique recommendation semantic analysis v3

This deterministic report audits the implemented whole-item runtime semantics while preserving the Weapon + Offense contract.

## Summary

- Audited uniques: 131
- With granted skills: 94; with granted effects: 0
- Material granted-semantic gaps: 33
- Previous empty cells: 108; new empty cells: 69; empty→non-empty: 40
- Existing non-empty winner changes: 10; runtime/top-band agreement: 135/135
- Runtime semantics: 73 uniques, 255 promoted facts, 80055 bytes
- Quality bands: one=50, two=9, three=7 (zero=69)

## Ranking model

BUILD_DEFINING_CAPABILITY outranks STRONG_SPECIALIZATION, which outranks AFFINITY_AMPLIFICATION, which outranks PAYOFF_CONTEXT. Contradiction/prevention rejects a candidate. Fact count only breaks ties inside a tier, so shallow match volume cannot outrank capability. The runtime variation band contains at most three candidates in the leading tier within 10 points.

## Fairgraves' Curse and Blackgleam

| Probe | Current | Proposed | Fairgraves | Blackgleam |
|---|---|---|---|---|
| Bow × Ignite | Fairgraves' Curse | Fairgraves' Curse | Fairgraves' Curse (BUILD_DEFINING_CAPABILITY, score 407) | Blackgleam (PAYOFF_CONTEXT, score 106) |
| Bow × Fire | Fairgraves' Curse | Fairgraves' Curse | Fairgraves' Curse (BUILD_DEFINING_CAPABILITY, score 407) | Blackgleam (STRONG_SPECIALIZATION, score 306) |

Fairgraves' parent item facts now expose Fire addition and Ignite magnitude, while whole-item promotion additionally contributes Phantasmal Arrow's Physical→Fire conversion, Fire property, direct Ignite application, Ignite specialization, and explosion component provenance. Blackgleam's former false direct-Ignite catalog fact has been removed; its Ignited-enemy line is payoff context, while its raw modifiers add/gain Fire and amplify Flammability. The regression therefore confirms that missing granted-skill semantics materially suppress Fairgraves; it does not justify an item-name exception.

## Bow and Quiver precedence

Slot type adds no semantic score. Bow and Quiver are equally family-legal, and richer ranking is tier-first. Current additive fact scoring can reward repeated shallow facts, but the current catalog more often under-represents item modifiers and granted behavior than systematically favoring Quivers. There is no evidence for a blanket Quiver preference and no Bow-first rule is proposed.

## Promoted granted semantics

- Adonia's Ego → Pinnacle of Power, Power Siphon: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:has_property:lightning; AFFINITY_AMPLIFICATION:has_property:physical; offenses cold, fire, lightning, physical; changes a proposed winner.
- Atziri's Contempt → Shattering Spite: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:has_property:lightning; AFFINITY_AMPLIFICATION:modifies:fire; AFFINITY_AMPLIFICATION:modifies:lightning; BUILD_DEFINING_CAPABILITY:converts:fire; BUILD_DEFINING_CAPABILITY:converts:lightning; offenses fire, lightning.
- Brutus' Lead Sprinkler → Molten Shower: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:fire; BUILD_DEFINING_CAPABILITY:converts:fire; offenses fire.
- Cursecarver → Decompose: AFFINITY_AMPLIFICATION:has_property:chaos; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:chaos; AFFINITY_AMPLIFICATION:modifies:poison; offenses chaos, fire, poison.
- Double Vision → Gemini Surge: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:cold; AFFINITY_AMPLIFICATION:modifies:fire; BUILD_DEFINING_CAPABILITY:converts:cold; BUILD_DEFINING_CAPABILITY:converts:fire; offenses cold, fire.
- Dusk Vigil → Ember Fusillade, Firebolt: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:lightning; BUILD_DEFINING_CAPABILITY:inflicts:ignite; PAYOFF_CONTEXT:consumes:lightning; offenses fire, ignite, lightning.
- Earthbound → Lightning Bolt, Spark: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:lightning; offenses cold, lightning.
- Enezun's Charge → Volatile Dead: AFFINITY_AMPLIFICATION:has_property:fire; BUILD_DEFINING_CAPABILITY:inflicts:ignite; offenses fire, ignite.
- Fairgraves' Curse → Phantasmal Arrow: AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:modifies:fire; AFFINITY_AMPLIFICATION:modifies:ignite; BUILD_DEFINING_CAPABILITY:converts:fire; BUILD_DEFINING_CAPABILITY:inflicts:ignite; offenses fire, ignite.
- Fury of the King → Molten Crash: AFFINITY_AMPLIFICATION:modifies:fire; BUILD_DEFINING_CAPABILITY:converts:fire; offenses fire.
- Guiding Palm of the Eye → Purity of Ice: AFFINITY_AMPLIFICATION:has_property:cold; offenses cold.
- Guiding Palm of the Heart → Purity of Fire: AFFINITY_AMPLIFICATION:has_property:fire; offenses fire.
- Guiding Palm of the Mind → Purity of Lightning: AFFINITY_AMPLIFICATION:has_property:lightning; offenses lightning.
- Hysseg's Claw → Cackling Companions: AFFINITY_AMPLIFICATION:has_property:physical; offenses physical.
- Liminal Coil → Coiling Bolts: AFFINITY_AMPLIFICATION:has_property:chaos; offenses chaos.
- Murkshaft → Bursting Fen Toad: AFFINITY_AMPLIFICATION:has_property:chaos; AFFINITY_AMPLIFICATION:has_property:physical; offenses chaos, physical; changes a proposed winner.
- Nightfall → Soaring Midnight: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:modifies:cold; BUILD_DEFINING_CAPABILITY:converts:cold; offenses cold.
- Palm of the Dreamer → Impurity: AFFINITY_AMPLIFICATION:has_property:chaos; offenses chaos.
- Periphery → Azmerian Swarms: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:fire; AFFINITY_AMPLIFICATION:has_property:lightning; AFFINITY_AMPLIFICATION:has_property:physical; AFFINITY_AMPLIFICATION:modifies:physical; offenses cold, fire, lightning, physical.
- Runeseeker's Call → The Stars Answer: AFFINITY_AMPLIFICATION:has_property:cold; AFFINITY_AMPLIFICATION:has_property:physical; offenses cold, physical.

## Empty results

- GENUINELY_NO_RELEVANT_UNIQUE: 69

Empty cells retain only up to three meaningful legal leads in the JSON artifact. No cell is force-filled. The dominant cause is absence or incompleteness of typed item semantics; granted behavior explains only the subset with a provable promoted fact.

## Contradiction and prevention

- Brutus' Lead Sprinkler is rejected for Mace × physical: converts physical→fire.
- Kaltenhalt is rejected for Mace × physical: converts physical→cold.
- Nightfall is rejected for Mace × physical: converts physical→cold.
- Twisted Empyrean is rejected for Mace × physical: converts physical→cold.
- The Sentry is rejected for Quarterstaff × physical: prevents physical.
- Fairgraves' Curse is rejected for Bow × physical: converts physical→fire.
- Voltaxic Rift is rejected for Bow × lightning: converts lightning→chaos.
- Double Vision is rejected for Crossbow × physical: converts physical→cold, converts physical→fire.
- The Unborn Lich is rejected for Staff × ignite: prevents ignite.
- The Whispering Ice is rejected for Staff × chill: prevents chill.
- The Whispering Ice is rejected for Staff × freeze: prevents freeze.
- Fury of the King is rejected for Talisman × physical: converts physical→fire.

Incoming player immunity is not treated as an outgoing Offense contradiction. Directionally adverse item or skill conversion remains a hard rejection.

## Seeded quality-band variation

- Mace × Physical Damage: Brynhand's Mark, Chober Chaber, Frostbreath (3 in band).
- Mace × Lightning Damage: Brain Rattler, Olrovasara, Seeing Stars (3 in band).
- Quarterstaff × Physical Damage: Nazir's Judgement, The Blood Thorn (2 in band).
- Bow × Physical Damage: Murkshaft, Asphyxia's Wrath, Beyond Reach (3 in band).
- Bow × Cold Damage: Periphery, Asphyxia's Wrath (2 in band).
- Crossbow × Physical Damage: Rampart Raptor, Redemption, The Last Lament (3 in band).
- Staff × Cold Damage: The Whispering Ice, Earthbound, Taryn's Shiver (3 in band).
- Staff × Lightning Damage: Earthbound, Dusk Vigil (2 in band).
- Staff × Chaos Damage: The Burden of Shadows, The Unborn Lich (2 in band).
- Wand × Fire Damage: Cursecarver, Adonia's Ego, Enezun's Charge (3 in band).
- Wand × Cold Damage: Adonia's Ego, Runeseeker's Call (2 in band).
- Sceptre × Fire Damage: Guiding Palm of the Heart, Sacred Flame (2 in band).

Only candidates in the strongest represented tier and within 10 strength points enter a band; the band is capped at three. 16 cells can vary by seed.

## Conclusions

The audit supports the central diagnosis: the selector contract is not inherently too narrow; the unique semantic model is incomplete, particularly where behavior lives on granted skills and raw modifiers. Runtime now consumes compact generation-time parent semantics, ranks lexicographically by semantic tier, retains directional conversion and contradiction safety, and seeded-selects only within the best quality band.

No class, ascendancy, package, named-item exception, or Weapon × Offense exception was introduced; variation is deterministic and limited to the semantic quality band.
