# Recommendation richness audit

Development-only output for the canonical 270-case corpus and seed `randomancer-recommendation-audit-v1`. Required solver supports are excluded from optional-support depth. Candidate bands reuse production package/passive/optimizer ranking concepts; no selector setting is changed.

## Skills

- Eligible candidates: average 7.61; median 6.
- Strong candidates: 0=0, 1=140, 2=16, 3+=114.
- Classification: POOL_LIMITED=140, SELECTOR_LIMITED=130, DIVERSITY_LIMITED=0, ALREADY_RICH=0.
- Production selected fewer than the strong band in 130 observations.

## Passives/notables

- Eligible candidates: average 3.11; median 3.
- Strong candidates: 0=38, 1=48, 2=48, 3+=136.
- Classification: POOL_LIMITED=86, SELECTOR_LIMITED=0, DIVERSITY_LIMITED=184, ALREADY_RICH=0.
- Production selected fewer than the strong band in 184 observations.

## Optional optimizer supports

- Eligible candidates: average 3.05; median 1.
- Strong candidates: 0=126, 1=35, 2=1, 3+=114.
- Classification: POOL_LIMITED=161, SELECTOR_LIMITED=115, DIVERSITY_LIMITED=0, ALREADY_RICH=0.
- Production selected fewer than the strong band in 115 observations.

## Optimizer-specific result

- Selected skills observed: 276.
- Skills with 2+ strong optional optimizers: 115; with 3+: 114.
- Skills leaving a strong optimizer unused: 115.
- Distinct support families are counted as non-duplicates, but the compact semantic priority shows many candidates occupy the same application/effect/duration/payoff lane. Treat complementarity as requiring a future pairwise conflict audit, not as proven here.

## Interpretation

The data supports investigating confidence-decay policies rather than quotas: continue through the existing top band, require a distinct entity/family and compatibility, and stop at the existing quality falloff. Skill and passive candidates should still require independent direct/package anchors. Optional supports should additionally require pairwise non-conflict and a distinct optimization purpose. The zero/one bands remain naturally sparse.

## Representative cases

### AUDIT-001 — Mace + Physical Damage

- Production skills: Armour Breaker; supports: none; passives: Swift Flight; required unique: none.
- Depth: skills 9 strong/9 eligible (SELECTOR_LIMITED); passives 5/5 (DIVERSITY_LIMITED); optional supports 0/0.
- Strong unselected: skills Boneshatter (10639, gap 12), Earthquake (10639, gap 12), Earthshatter (10639, gap 12); passives Forcewave (5, gap 0), Hidden Barb (5, gap 0), Staggering Palm (5, gap 0); supports none.

### AUDIT-002 — Mace + Fire Damage

- Production skills: Molten Blast; supports: none; passives: Cremating Cries; required unique: none.
- Depth: skills 4 strong/4 eligible (SELECTOR_LIMITED); passives 5/5 (DIVERSITY_LIMITED); optional supports 0/0.
- Strong unselected: skills Forge Hammer (10753, gap 0), Perfect Strike (10753, gap 0), Volcanic Fissure (10753, gap 0); passives Burning Nature (5, gap 2), Melting Flames (5, gap 2), Pyromancer (5, gap 2); supports none.

### AUDIT-003 — Mace + Cold Damage

- Production skills: Volcanic Fissure; supports: none; passives: Cold Nature; required unique: Painter's Servant.
- Depth: skills 13 strong/13 eligible (SELECTOR_LIMITED); passives 4/4 (DIVERSITY_LIMITED); optional supports 0/0.
- Strong unselected: skills Forge Hammer (625, gap 0), Hammer of the Gods (625, gap 0), Molten Blast (625, gap 0); passives Endless Blizzard (5, gap 0), Flurry (5, gap 0), Rhythm of Ice (5, gap 0); supports none.

### AUDIT-004 — Mace + Lightning Damage

- Production skills: Molten Blast; supports: none; passives: Electrifying Nature; required unique: Painter's Servant.
- Depth: skills 4 strong/13 eligible (SELECTOR_LIMITED); passives 1/1 (POOL_LIMITED); optional supports 0/0.
- Strong unselected: skills Forge Hammer (625, gap 0), Perfect Strike (625, gap 0), Volcanic Fissure (625, gap 0); passives none; supports none.

### AUDIT-005 — Mace + Chaos Damage

- Production skills: Perfect Strike; supports: none; passives: Madness in the Bones; required unique: Original Sin.
- Depth: skills 4 strong/13 eligible (SELECTOR_LIMITED); passives 4/4 (DIVERSITY_LIMITED); optional supports 0/0.
- Strong unselected: skills Forge Hammer (625, gap 0), Molten Blast (625, gap 0), Volcanic Fissure (625, gap 0); passives Entropy (5, gap 2), Spaghettification (5, gap 2), Void (5, gap 2); supports none.

### AUDIT-006 — Mace + Ignite

- Production skills: Molten Blast; supports: Eternal Flame III [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Searing Heat; required unique: none.
- Depth: skills 1 strong/4 eligible (POOL_LIMITED); passives 6/6 (DIVERSITY_LIMITED); optional supports 7/7.
- Strong unselected: skills Forge Hammer (647, gap 100), Perfect Strike (647, gap 100), Volcanic Fissure (647, gap 100); passives Affliction Enforcer (5, gap 0), Dread Engineer's Concoction (5, gap 0), Emboldened Avatar (5, gap 0); supports Ignite III (3, gap 0), Searing Flame II (2, gap 1), Fiery Death (0, gap 3).

### AUDIT-007 — Mace + Bleed

- Production skills: Boneshatter; supports: Bleed III [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Internal Bleeding; required unique: Edyrn's Tusks.
- Depth: skills 9 strong/13 eligible (SELECTOR_LIMITED); passives 1/1 (POOL_LIMITED); optional supports 7/7.
- Strong unselected: skills Armour Breaker (645, gap 0), Hammer of the Gods (639, gap 6), Stampede (639, gap 6); passives none; supports Deep Cuts II (2, gap 1), Malady (0, gap 3), Rip (0, gap 3).

### AUDIT-008 — Mace + Poison

- Production skills: Stampede; supports: Deadly Poison II [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Dread Engineer's Concoction; required unique: Snakebite.
- Depth: skills 9 strong/13 eligible (SELECTOR_LIMITED); passives 3/3 (DIVERSITY_LIMITED); optional supports 4/4.
- Strong unselected: skills Armour Breaker (645, gap 0), Hammer of the Gods (639, gap 6), Boneshatter (639, gap 6); passives Leeching Toxins (5, gap 0), Toxic Sludge (5, gap 0); supports Bursting Plague (0, gap 2), Escalating Poison (0, gap 2), Malady (0, gap 2).

### AUDIT-009 — Mace + Chill

- Production skills: Rolling Slam; supports: Cold Attunement [REQUIRED_ENABLE_SUPPORT], Frost Nexus [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Cold Nature; required unique: none.
- Depth: skills 13 strong/13 eligible (SELECTOR_LIMITED); passives 4/4 (DIVERSITY_LIMITED); optional supports 1/1.
- Strong unselected: skills Forge Hammer (110, gap 0), Hammer of the Gods (110, gap 0), Molten Blast (110, gap 0); passives Chilled to the Bone (5, gap 0), Shattering (5, gap 0), Unbound Forces (5, gap 0); supports none.

### AUDIT-010 — Mace + Freeze

- Production skills: Forge Hammer; supports: Cold Attunement [REQUIRED_ENABLE_SUPPORT], Bhatair's Vengeance [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Emboldened Avatar; required unique: none.
- Depth: skills 13 strong/13 eligible (SELECTOR_LIMITED); passives 1/1 (POOL_LIMITED); optional supports 7/7.
- Strong unselected: skills Hammer of the Gods (110, gap 0), Molten Blast (110, gap 0), Perfect Strike (110, gap 0); passives none; supports Brittle Armour (0, gap 0), Deep Freeze (0, gap 0), Freeze (0, gap 0).

### AUDIT-011 — Mace + Shock

- Production skills: Rolling Slam; supports: Lightning Attunement [REQUIRED_ENABLE_SUPPORT], Shock Conduction II [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Unbound Forces; required unique: none.
- Depth: skills 13 strong/13 eligible (SELECTOR_LIMITED); passives 3/3 (DIVERSITY_LIMITED); optional supports 11/11.
- Strong unselected: skills Forge Hammer (110, gap 0), Hammer of the Gods (110, gap 0), Molten Blast (110, gap 0); passives Emboldened Avatar (5, gap 0), Essence of the Storm (5, gap 0); supports Thrill of the Kill II (2, gap 0), Shock Conduction (1, gap 1), Coursing Current (0, gap 2).

### AUDIT-012 — Mace + Electrocute

- Production skills: Forge Hammer; supports: Lightning Attunement [REQUIRED_PREREQUISITE_SUPPORT], Electrocute [REQUIRED_ENABLE_SUPPORT]; passives: none; required unique: none.
- Depth: skills 13 strong/13 eligible (SELECTOR_LIMITED); passives 0/0 (POOL_LIMITED); optional supports 0/0.
- Strong unselected: skills Hammer of the Gods (110, gap 0), Molten Blast (110, gap 0), Perfect Strike (110, gap 0); passives none; supports none.

### AUDIT-013 — Mace + Minions

- Production skills: Skeletal Arsonist; supports: Bidding III [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Right Hand of Darkness; required unique: none.
- Depth: skills 6 strong/11 eligible (SELECTOR_LIMITED); passives 9/9 (DIVERSITY_LIMITED); optional supports 11/11.
- Strong unselected: skills Skeletal Brute (10800, gap 0), Skeletal Frost Mage (10800, gap 0), Skeletal Reaver (10800, gap 0); passives Bringer of Order (5, gap 0), Commanding Rage (5, gap 0), Comradery (5, gap 0); supports Infernal Legion III (3, gap 0), Feeding Frenzy II (2, gap 1), Meat Shield II (2, gap 1).

### AUDIT-014 — Mace + Companions

- Production skills: Tame Beast; supports: Loyalty [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Inspiring Ally; required unique: none.
- Depth: skills 1 strong/1 eligible (POOL_LIMITED); passives 4/4 (DIVERSITY_LIMITED); optional supports 1/1.
- Strong unselected: skills none; passives Bond of the Mamba (5, gap 0), Bond of the Owl (5, gap 0), Bond of the Viper (5, gap 0); supports none.

### AUDIT-015 — Mace + Totems

- Production skills: Shockwave Totem; supports: Urgent Totems III [OPTIONAL_OFFENSE_OPTIMIZER]; passives: none; required unique: none.
- Depth: skills 1 strong/1 eligible (POOL_LIMITED); passives 0/0 (POOL_LIMITED); optional supports 4/4.
- Strong unselected: skills none; passives none; supports Hardy Totems II (2, gap 1), Reinforced Totems II (2, gap 1), Splinter Totem II (2, gap 1).

### AUDIT-016 — Quarterstaff + Physical Damage

- Production skills: Vaulting Impact; supports: none; passives: Stylebender; required unique: none.
- Depth: skills 3 strong/6 eligible (SELECTOR_LIMITED); passives 5/5 (DIVERSITY_LIMITED); optional supports 0/0.
- Strong unselected: skills Whirling Assault (10739, gap 12), Wind Blast (10739, gap 12), Killing Palm (10651, gap 100); passives Blood Tearing (5, gap 0), Bone Chains (5, gap 0), Forcewave (5, gap 0); supports none.

### AUDIT-031 — Bow + Physical Damage

- Production skills: Tornado Shot; supports: none; passives: Forcewave; required unique: none.
- Depth: skills 7 strong/7 eligible (SELECTOR_LIMITED); passives 5/5 (DIVERSITY_LIMITED); optional supports 0/0.
- Strong unselected: skills Detonating Arrow (10639, gap 12), Poisonburst Arrow (10639, gap 12), Rain of Arrows (10639, gap 12); passives Hidden Barb (5, gap 0), Staggering Palm (5, gap 0), Stylebender (5, gap 0); supports none.

### AUDIT-056 — Crossbow + Shock

- Production skills: Galvanic Shards; supports: Shock Conduction II [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Emboldened Avatar; required unique: none.
- Depth: skills 5 strong/5 eligible (SELECTOR_LIMITED); passives 2/2 (DIVERSITY_LIMITED); optional supports 11/11.
- Strong unselected: skills Voltaic Grenade (647, gap 0), Plasma Blast (645, gap 2), Shockburst Rounds (645, gap 2); passives Electrifying Nature (5, gap 0); supports Thrill of the Kill II (2, gap 0), Shock Conduction (1, gap 1), Coursing Current (0, gap 2).

### AUDIT-063 — Staff + Cold Damage

- Production skills: Frost Darts; supports: none; passives: Cold Nature; required unique: none.
- Depth: skills 2 strong/8 eligible (SELECTOR_LIMITED); passives 1/1 (POOL_LIMITED); optional supports 0/0.
- Strong unselected: skills Ice Nova (10851, gap 0), Comet (10651, gap 200), Eye of Winter (10651, gap 200); passives none; supports none.

### AUDIT-081 — Talisman + Ignite

- Production skills: Flame Breath; supports: Eternal Flame III [OPTIONAL_OFFENSE_OPTIMIZER]; passives: Immolation; required unique: none.
- Depth: skills 3 strong/5 eligible (SELECTOR_LIMITED); passives 7/7 (DIVERSITY_LIMITED); optional supports 7/7.
- Strong unselected: skills Oil Barrage (747, gap 0), Rolling Magma (747, gap 0), Fury of the Mountain (647, gap 100); passives Affliction Enforcer (5, gap 0), Burning Nature (5, gap 0), Firestarter (5, gap 0); supports Ignite III (3, gap 0), Searing Flame II (2, gap 1), Fiery Death (0, gap 3).
