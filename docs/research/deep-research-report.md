# Chronomancer + Mace Offense Evidence Dossier for Randomancer

## Current Chronomancer mechanics

**Version baseline.** This dossier treats the live Path of Exile 2 game as the authority and the Randomancer `release` branch as the authority only for what Randomancer can roll and what its recommender currently knows. The external baseline reviewed is the 0.5.5-era game state current in September 2026, including Grinding Gear Games' 0.5.5 update material and later 0.5.5-series maintenance. Chronomancer itself received especially important changes in 0.5.0, so pre-0.5 descriptions are unsafe. citeturn24view3turn11search2turn11search15

Randomancer's current `release` inventory contains **16 Offense records**, but the release roller explicitly blacklists `critical_hits`/`critical_hit`. Therefore the current experiment has exactly **15 rollable Offenses**:

**Physical Damage, Fire Damage, Cold Damage, Lightning Damage, Chaos Damage, Ignite, Bleed, Poison, Chill, Freeze, Shock, Electrocute, Minions, Companions, Totems.**

Critical Hits is present in the inventory but is not rollable; Heavy Stun and Armour Break remain elsewhere in older/general game-data structures but are not Offense inventory rolls. fileciteturn2file0L1-L5 fileciteturn3file0L1-L6 fileciteturn6file0L1-L2

### Chronomancer's present attack-build identity

The current Chronomancer is not primarily an attack-damage ascendancy. Its useful contribution to a Mace build is **tempo manipulation, burst windows, cooldown control, enemy slowing, and damage smoothing/recovery of position/state**, rather than direct Mace, Strength, Slam, or physical-damage scaling. Current PoE2DB and the official 0.5.0 changes agree on the important structure. citeturn11search2turn11search3

**Apex of the Moment** Slows enemies in the Chronomancer's Presence by 20%. For a Mace character this is strategically valuable because many Mace attacks have substantial commitment time: it makes the ascendancy a credible "create a safe window for the heavy swing" class even though it does not directly increase Mace damage. It should not be described as a damage multiplier, nor should a generator assume unverified additive stacking with Chill or every other Slow effect. citeturn11search3

**Quicksand Hourglass → Sands of Time** is particularly relevant. In the current version Sands of Time cycles between increased Skill Speed and increased Area of Effect, reaching up to 60% Skill Speed at one end of the cycle and up to 60% Area of Effect at the other. The 0.5.0 update changed the speed component from Cast Speed to **Skill Speed**, making it far more relevant to attacks than older descriptions imply. citeturn11search2turn21search3

That does **not** make every Mace skill scale cleanly with Sands of Time. Current Supercharged Slam, for example, specifies that its own attack time cannot be modified, while Stampede's use speed is governed by movement speed rather than normal attack-speed scaling. Those should not be advertised as obvious Sands of Time beneficiaries without direct testing. More ordinary attacks such as Rolling Slam, Perfect Strike, or similar Mace attacks are much safer candidates for a Skill-Speed interpretation. citeturn23view0

**Unbound Encore → Time Snap** grants a cooldown-reset tool. Current Time Snap resets the cooldowns of the character's other Skills, with its own long cooldown. This is a real bridge to cooldown-bearing Mace utilities and attacks: Forge Hammer is an obvious example, and Warcries can also benefit where applicable. The important semantic constraint is that **resetting a cooldown does not manufacture another prerequisite**. If Hammer of the Gods still requires Glory, Time Snap does not supply Glory merely because it resets a timer. citeturn21search2turn15search0

**Ultimate Command → Time Freeze** is a control tool rather than a Mace damage scaler. Its natural role in this experiment is to open a safe commitment window for a slow strike, slam, Perfect Strike timing sequence, totem placement, or other setup. Claims about particular boss interactions should be separately validated rather than inferred from the word "Freeze." citeturn11search3

**Phased Form** is one of the clearest defensive reasons to play melee Chronomancer. It causes the character to take 30% less damage from Hits initially, then take the delayed portion four seconds later. **Temporal Rift**, granted through Footprints in the Sand, removes that delayed damage when used, making the two mechanics an intentional defensive package. A Mace Chronomancer can therefore commit to close-range attacks and use Temporal Rift as both positional correction and delayed-hit cleanup. citeturn11search2turn11search3

**Inevitability → Inevitable Agony** is also highly relevant to large Mace hits. It was reworked in 0.5.0: it is no longer the old Curse-like mechanic. The current debuff tracks a portion of Hit damage dealt to the target as life loss and can cull once the tracked loss reaches the Culling Strike threshold. That makes high-hit Mace play a natural partner even when the Offense roll is elemental or ailment-based; crucially, this is a **Hit** interaction, so an Ignite/Bleed/Poison generator should not pretend the damage-over-time ticks themselves fuel the mechanic unless current rules explicitly say so. citeturn11search2turn11search3

The most important negative finding is **Now and Again**. Rapid River was removed/replaced, and current Now and Again concerns Cascadable and Repeatable **Spells** having chances to Echo/Repeat. It is not a generic "attacks repeat" notable and should not be invoked to justify a Mace attack route. This is exactly the kind of stale Chronomancer interpretation that a data-only recommender could get wrong. citeturn11search2turn11search3

**Chronomancer summary for downstream generation:** the reliable universal hooks are Inevitable Agony for hit-heavy offense, Apex/Time Freeze for commitment windows, Sands of Time for applicable Skill-Speed/AoE cycling, Time Snap for genuine cooldowns, and Phased Form + Temporal Rift for melee survivability. Now and Again should generally be omitted from Mace attack interpretations.

## Current Mace ecosystem

Mace remains a Strength-oriented martial family in Randomancer's current equipment data, with one-handed and two-handed forms. Randomancer's hard equipment layer currently recognizes a range of one-handed Mace offhands, including another Mace, Shield, Buckler, Focus, and Sceptre, while the older `core-data.json` representation is not fully identical to that list. That internal discrepancy is worth validating against live equipment rules before Randomancer ever makes an offhand-specific claim; **Shield** is the conservative defensive recommendation for one-handed Mace routes. fileciteturn6file0L1-L2 fileciteturn11file0L1-L6

**Giant's Blood** remains an important build-enabling keystone: it allows two-handed Axes, Maces and Swords to be wielded in one hand, at the cost of triple weapon attribute requirements and reduced inherent Life benefit from Strength. It provides a real path to combining a high-damage two-handed Mace with an offhand defensive item, but the attribute/life opportunity cost is material on an Intelligence-starting Chronomancer. citeturn16search3

### High-value Mace carriers

| Skill | Current mechanical role | Dossier significance |
|---|---|---|
| **Rolling Slam** | Physical Mace Attack/AoE/Melee/Slam; works with one- or two-handed Maces and has substantial attack-time commitment. | Clean baseline Physical carrier and a neutral platform for Attunement or ailment supports. citeturn6search1 |
| **Perfect Strike** | Timed Mace attack; normal hit converts part of Physical to Fire and a Perfect strike converts substantially more. | Excellent Fire carrier, but **it no longer always Ignites**; that pre-0.2 behavior is stale. citeturn14view0 |
| **Molten Blast** | Mace Fire projectile attack; projectile converts 60% Physical to Fire and shrapnel 100%; strongly interacts with Flammability and Ignite duration. | Strong Fire/Ignite carrier, but its Ignite-related text is not equivalent to unconditional Ignite application. citeturn15search1 |
| **Volcanic Fissure** | Fire Mace Slam with 80% Physical-to-Fire conversion; fissures can be triggered by later/allied Slams. | Fire carrier and especially interesting with Shockwave Totem. citeturn15search2 |
| **Forge Hammer** | Fire Mace Slam with an 8-second cooldown; embeds a hammer, can be recalled, and a nearby Warcry shatters it into Molten Fissures. | Fire/cooldown route and one of the best unusual Minion bridges because it exposes the stone-elemental interaction used by Skittering Stone. citeturn15search0 |
| **Hammer of the Gods** | Very high-impact Glory-based Mace slam; Glory is generated through appropriate combat conditions such as Heavy Stuns. | Burst secondary for Hit-centric routes; prerequisite cannot be hand-waved away by Chronomancer cooldown tools. citeturn6search2turn23view0 |
| **Shockwave Totem** | Summons a Totem that repeatedly Slams using equipped martial weapon(s). | The direct Mace→Totem solution. Since 0.3, ordinary supports no longer modify the Totem's attack the old way; the current version also makes the equipped weapon matter. citeturn14view1 |

Other current Mace tools such as Earthquake, Sunder, Leap Slam, Stampede, Boneshatter, Supercharged Slam and Seismic Cry remain relevant as carriers or utility, but their conditional mechanics matter. For example, Seismic Cry's Slam/Aftershock payoff depends on its setup, and Sunder has armour-break-specific payoff that should not be silently treated as inherent to the Offense roll. citeturn23view0

### Damage-type bridges

The current Attunement supports are strategically central because they make several "unnatural" Mace Offenses possible without pretending the Mace skill natively has that damage type.

**Cold Attunement** supports a damaging skill and grants damage as extra Cold while penalizing other elemental types. It is a **gain-as-extra** route, not Physical-to-Cold conversion. citeturn22search2

**Lightning Attunement** similarly grants damage as extra Lightning while penalizing Cold and Fire and is valid for Mace attacks. This is a powerful bridge into Lightning, Electrocute, and Living Lightning, but adding Lightning damage is not by itself proof of Shock application. citeturn23view0

**Chaos Attunement** provides a current route for a Mace hit to gain Chaos damage, at the cost of other damage. Again, "gain Chaos" must not be rewritten as "convert to Chaos." This is the cleanest verified generic Chaos bridge found in the skill/support ecosystem. citeturn22search1

Fire has the advantage of multiple **native Mace conversions**—Perfect Strike, Molten Blast, Volcanic Fissure and Forge Hammer—so Fire does not need an Attunement bridge to be credible. citeturn14view0turn15search0turn15search1turn15search2

### Ailment rules that materially change recommendation semantics

Current Ignite is Flammability-driven: Fire Hit damage contributes to Ignite magnitude, and Ignite chance is determined through the target's accumulated Flammability. Dedicated Ignite supports such as the current Ignite tiers increase application capability; Searing Flame is a payoff for stronger Ignites rather than a substitute for establishing the application route. This is why "Perfect Strike is Fire" is not enough to claim "Perfect Strike Ignites." citeturn20view0

Current Poison likewise requires explicit application chance. Physical and Chaos Hit damage contribute to Poison magnitude, but the amount of Physical/Chaos damage is not itself Poison chance. Poison I currently gives the supported skill explicit Poison chance and is valid on Mace attacks. This makes a **Physical Mace + Poison support** mechanically sound without any Chaos conversion at all. citeturn18search1turn24view0

Cold Hits naturally produce Chill and contribute to Freeze buildup, which makes Cold Attunement unusually efficient: one support can establish the Cold carrier needed for both Cold damage and cold-ailment routes, though Freeze still needs sufficient buildup and should not be treated as guaranteed from an arbitrarily tiny Cold component. citeturn18search2turn22search2

**Electrocute** has a particularly explicit bridge: Electrocute Support causes the supported skill's Lightning Damage to contribute to Electrocution buildup, while preventing that supported skill from inflicting Shock. Thus a Mace attack + Lightning Attunement + Electrocute is a verified chain; Shock and Electrocute should use separate application lanes when both are wanted. citeturn16search0

### Totem, minion, and companion bridges

**Living Lightning** is a striking current support-level bridge: when the supported skill deals Lightning damage, it can create temporary Living Lightning Minions. Therefore a Mace attack can become a legitimate Minion creator by first acquiring Lightning damage—for example with Lightning Attunement—and then using Living Lightning. citeturn22search3

**Skittering Stone** creates temporary stone Minions through the eligible earthen-object interaction, and Forge Hammer is currently marked with the relevant stone-elemental capability/recommended interaction. This yields a second, mechanically distinct Mace→Minion route that does not depend on generic summon skills. citeturn16search1turn15search0

**Tame Beast** is the best generic Companion bridge found. It captures a Rare Beast under its specified condition and transforms into a skill that summons that Beast as a reviving Companion. However, this is a **sidecar Companion system**, not a Mace-delivered Companion mechanic. A build can wield and attack with a Mace while maintaining Tame Beast, but the weapon does not cause the Companion. citeturn16search2

**Shockwave Totem**, in contrast, is directly weapon-native. Current Ancestral Bond doubles Totem Limit and removes the normal placement cost/Charge requirement while making each Totem reserve 75 Spirit. It is powerful enough to mention, but that Spirit cost is a requirement, not an optional detail. citeturn21search0turn21search1

## Randomancer data observations

Randomancer's current recommendation architecture is substantially more conservative than a naive tag matcher, and several of its design decisions directly address the failure mode described in the prompt. The v3 documentation explicitly distinguishes a native damage **carrier** from actual Offense fulfillment; a Lightning skill can carry a Shock/Electrocute route without automatically proving either ailment. It also distinguishes gained damage from conversion, applies `prevents` conflicts, treats `Totemable` as compatibility rather than proof that a skill summons a Totem, and evaluates support prerequisites as typed dependencies. fileciteturn4file0L1-L6

The release selector codifies that distinction. Its ailment-carrier map identifies Fire as an Ignite carrier, Physical as a Bleed carrier, Physical/Chaos as Poison carriers, Cold as Chill/Freeze carriers, and Lightning as Shock/Electrocute carriers. Importantly, those are carrier relationships, not unconditional application claims. Mace is explicitly a martial weapon family, so a martial primary must actually have legal Mace delivery rather than merely being weapon-agnostic. fileciteturn7file0L1-L2

That latter rule is especially important for **Minions and Companions**. The v3 design explicitly says weapon-agnostic Minion or Companion skills should not cross the martial boundary merely because their archetype matches the Offense. For a Mace roll, an ideal Minion solution therefore comes from a Mace-native skill plus a real bridge support. Living Lightning and Skittering Stone are exactly the sort of relationships that justify that policy. Tame Beast, by comparison, is mechanically legitimate as a build sidecar but is correctly weaker evidence of a true Mace+Companion integration. fileciteturn4file0L1-L6

The curated overrides are also doing useful semantic repair. They explicitly record that Tame Beast creates a Minion/Companion only after Beast capture; Living Lightning requires Lightning damage before creating Minions; Eternal Flame does not independently grant Ignite; Lightning Exposure does not independently grant Shock; Frost Nexus/Spreading Frost need Freeze before supplying their secondary Chill effect; and Coursing Current needs an already-existing Shock or other specified setup rather than creating the first Shock for free. The Electrocute conflict is likewise represented. fileciteturn5file0L1-L2

The **Minion bridges are unusually well represented locally**. Randomancer's overrides explicitly give Living Lightning a `creates:minion` fact together with `requires:lightning`, and give Skittering Stone a `creates:minion` fact. Those are good examples of enrichment finding real solutions that may be missed by public "what Mace skill has a Minion tag?" reasoning. fileciteturn5file0L1-L2

There are, however, important freshness and coverage limitations. The current catalog report contains 2,964 entities and 5,458 structured facts, but also 864 entities with no facts. Only about 26.6% of retained skill-description evidence is structured, and substantial passive evidence remains unparsed. Its sample corpus even contains old-style website prose for skills such as Ice Nova and Leap Slam that is recognizably unsafe as current mechanic evidence. This does **not** prove that the structured datamined facts are wrong—the documented source precedence correctly ranks structured/datamined evidence above prose—but it demonstrates that "text exists in the repository" is not a current-version guarantee. fileciteturn9file0L1-L2

Ancestral Bond illustrates that problem well: the report shows its source material among partially recognized/unparsed passive evidence, while the live 0.5-era mechanic was significantly changed to doubled Totem Limit plus 75 Spirit reservation per Totem. External validation should therefore override any older Ancestral Bond interpretation. fileciteturn9file0L1-L2 citeturn21search0turn21search1

Another implementation gap is that `js/31-non-skill-recommendation-selector.js` deliberately excludes entities whose `content_type` is `keystone`. That means build-defining current keystones such as **Giant's Blood**, **Ancestral Bond**, or the Bleed-oriented **Crimson Assault** can matter enormously to a solution while not being selected through that non-skill recommendation path. The downstream generator should therefore treat keystones as a separate research/enrichment responsibility instead of concluding "not recommended by selector = not relevant." fileciteturn10file0L1-L2 citeturn16search3turn21search0turn18search0

The release unique-semantics artifact reveals several useful but also suspicious edges. It contains explicit Mace-relevant candidates such as Frostbreath for Cold/Freeze, Brain Rattler and Olrovasara for Lightning, Nebuloch for Chaos, and Twisted Empyrean for Cold/Chill. Because those named unique interactions are patch-sensitive and not every one could be independently revisited against a current external item page in this pass, **only Twisted Empyrean is promoted below to a researched route**; the others should be considered retrieval candidates requiring external validation, not publishable facts. fileciteturn12file0L1-L6

Twisted Empyrean itself is an important success case. Randomancer's compact semantics correctly sees its granted **Starborn Onslaught** as converting Physical toward Cold and providing a strong Cold/Chill context. Current external skill data confirms that Starborn Onslaught is a two-handed Mace skill granted from the unique, converts most of its impact to Cold and its star impacts fully to Cold, and uses Chill/Freeze to build its Glory resource. fileciteturn12file0L1-L6 citeturn24view2turn10view0

There are also **semantic mismatches around uniques**. Current external data makes The Three Dragons potentially useful for cross-element ailment routing, yet Randomancer's compact unique semantics represents its Shock side mainly as a contradiction/replacement rather than an obvious positive Mace→Shock recommendation. Blistering Bond is even more revealing: the local compact artifact mostly sees its Physical→Fire replacement consequence, while current item data has a much more interesting Bleed identity involving Fire's contribution to Bleeding. Those are exactly the cases where preserving only compact offense semantics can lose a build-defining bridge. fileciteturn12file0L1-L6 citeturn20view0turn6search3

A final repository limitation for this audit: the 3.3 MB `recommendation_catalog_v3.json` could not be retrieved wholesale through the connected GitHub file interface because of its size. The release **selector, overrides, unique semantic projection, catalog report, inventory, equipment code, core data and design documentation were successfully read**, but I cannot claim an entity-by-entity audit of all 2,964 catalog entries. Any statement below saying "Randomancer captures" therefore refers to those inspected artifacts, not an inferred inspection of the inaccessible full payload. The catalog report itself confirms the file and its size/provenance. fileciteturn8file0L1-L6

## Rollable Offense dossiers

The assessment labels below mean: **Natural** = the Mace ecosystem supplies a direct, low-interpretation solution; **Workable** = a clearly verified bridge is needed; **Experimental** = mechanically defensible but support/item dependent or poorly represented publicly; **Difficult** = no strong weapon-native bridge was found and the build is fundamentally hybrid.

**Physical Damage**

**Assessment — Natural.** Physical is the least forced Chronomancer+Mace roll. Rolling Slam is a direct Mace physical carrier, and Earthquake, Sunder, Hammer of the Gods and other Mace attacks provide alternate physical-heavy packages. citeturn6search1turn23view0

**Plausible solution route — large-hit physical Slam.**  
**Core idea / primary carrier:** Rolling Slam is the safest neutral primary; Hammer of the Gods is a burst secondary rather than something whose Glory prerequisite should be ignored. **Supporting mechanics:** Seismic Cry can support Slam/Aftershock play where its own setup is satisfied; Chronomancer supplies Inevitable Agony for extra value from large Hits, Apex/Time Freeze for attack windows, and Phased Form + Temporal Rift for surviving commitment. **Useful supports:** physical/attack/slam supports such as Heavy Swing or Brutality are appropriate where the current skill's compatibility allows them. **Dependencies:** Hammer of the Gods still needs its actual Glory engine. **Scaling:** weapon Physical damage, attack/slam damage, applicable attack or Skill Speed, AoE and physical resistance/mitigation solutions. **Defense:** one-handed Mace + Shield is the conservative route; two-handed Mace gains hit size but leans more heavily on Chronomancer's defensive tempo, with Giant's Blood as a costly hybrid option. citeturn6search1turn6search2turn16search3turn21search3

**Randomancer cross-check:** the inventory directly reinforces Physical↔Bleed, and the v3 selector also gives Physical affinity to Armour Break context. That is useful retrieval context, but Armour Break is not the rolled Offense and must not displace Physical itself. fileciteturn2file0L1-L5 fileciteturn7file0L1-L2

**Confidence / unresolved questions:** **High.** The main publication risk is not viability but overcomplication—do not make Heavy Stun/Armour Break mandatory unless the selected skill/package actually needs them.

**Fire Damage**

**Assessment — Natural.** Maces have multiple current native Fire carriers, so no speculative conversion is required. citeturn14view0turn15search0turn15search1turn15search2

**Plausible solution route — Perfect Strike fire hit.**  
**Core idea / carrier:** time Perfect Strike for its stronger Physical-to-Fire conversion. **Supporting mechanics:** Chronomancer's Slows/Time Freeze create safer timing windows; Sands of Time can support the broader attack-tempo/AoE plan where the skill accepts Skill-Speed modification; Inevitable Agony rewards the large Hit. **Named pieces:** Perfect Strike, Fire Penetration or appropriate Fire supports; Ignite supports are optional only if the build also wants Ignite. **Scaling:** strong Physical weapon base is still valuable because the skill converts it; then Fire/elemental/attack scaling and relevant penetration. **Defense:** either Shield setup for consistency or a heavier two-handed commitment with Phased Form/Rift. citeturn14view0turn11search3

**Plausible solution route — Molten Blast / Volcanic Fissure / Forge Hammer.** Molten Blast gives ranged-ish projectile coverage from a Mace and substantial Fire conversion; Volcanic Fissure provides persistent fissure interactions; Forge Hammer adds a cooldown/recall rhythm that Time Snap can interact with. Forge Hammer does not *need* Time Snap because its own recall can reset its cooldown, so the ascendancy interaction is convenience/tempo, not a requirement. citeturn15search0turn15search1turn15search2turn21search2

**Randomancer cross-check:** Fire is a first-class Offense with Ignite as a reinforcing relation, and the v3 selector knows Fire's affinity to Ignite/detonation. Correct semantics require Fire fulfillment to remain distinct from Ignite fulfillment. fileciteturn2file0L1-L5 fileciteturn7file0L1-L2

**Confidence:** **High.** The critical warning is that **Perfect Strike no longer always Ignites**. A generated Fire build may omit Ignite entirely; a generated Ignite build needs a current application mechanism. citeturn14view0

**Cold Damage**

**Assessment — Workable, with one unusually strong unique route.**

**Plausible solution route — physical Mace + Cold Attunement.**  
**Core idea / carrier:** put Cold Attunement on a legal physical Mace attack such as Rolling Slam. It grants extra Cold damage; it does not convert the base Physical hit. **Supporting mechanics:** the Cold component naturally opens Chill/Freeze interactions, while Chronomancer adds its separate Slow/control package. **Scaling:** because the Cold is gained from the underlying damage, improving the weapon's base hit remains valuable alongside Cold/elemental scaling and Cold penetration. **Dependency:** the support must be legal on the chosen Mace skill. **Defense:** one-handed Shield is attractive because this route does not depend on maximizing a giant two-handed hit. citeturn22search2turn18search2

**Plausible solution route — Twisted Empyrean / Starborn Onslaught.**  
This is the most distinctive Cold-Mace answer. Starborn Onslaught is a unique-granted two-handed Mace skill whose impact is predominantly converted to Cold and whose starfall is fully Cold-converted; Chill/Freeze feeds its Glory system. That gives a genuine Cold Mace identity instead of merely tacking extra Cold onto a physical skill. The cost is a hard unique dependency and two-handed equipment commitment. citeturn24view2turn10view0

**Randomancer cross-check:** Randomancer's compact unique semantics correctly recognizes Twisted Empyrean/Starborn Onslaught as build-defining Cold and Chill evidence. However, v3's normal Skill Idea rules deliberately exclude item-granted skills from the ordinary craftable-skill pool, so this excellent solution can exist in enrichment while being inaccessible to the primary Skill Idea picker. That is an important recommendation-surface gap. fileciteturn12file0L1-L6 fileciteturn4file0L1-L6

**Confidence:** **High** for Cold Attunement; **high mechanically but unique-dependent** for Starborn. Validate Twisted Empyrean again immediately before publication because unique modifiers are patch-sensitive.

**Lightning Damage**

**Assessment — Workable.**

**Plausible solution route — Mace hit + Lightning Attunement.**  
**Core idea / carrier:** Rolling Slam or another legal damaging Mace attack gains extra Lightning through Lightning Attunement. **Supporting mechanics:** this can remain a pure hit-damage package, or become the first half of Electrocute or Living Lightning. **Scaling:** maximize the base hit from which extra Lightning is gained, plus Lightning/elemental attack scaling and penetration. **Caveat:** Lightning Attunement's "gain" wording must not be rewritten as full conversion, and its elemental penalties matter when trying to mix several elements. citeturn23view0

A repository-only scan also surfaced current-local unique candidates such as Brain Rattler, Olrovasara and Seeing Stars for Lightning/Mace relationships. They are **not promoted as verified routes here**, because their current external item text was not independently revalidated in this pass. fileciteturn12file0L1-L6

**Randomancer cross-check:** this is exactly the sort of `provides:lightning` support bridge the v3 model is designed to handle. It should fulfill Lightning Damage but only make Shock/Electrocute a *carrier possibility*. fileciteturn4file0L1-L6 fileciteturn7file0L1-L2

**Confidence:** **High** for the Attunement route. Do not silently add Shock just because the final hit contains Lightning.

**Chaos Damage**

**Assessment — Experimental but mechanically defensible.** No comparably obvious native Chaos Mace attack was externally verified; the clean generic route is a support bridge.

**Plausible solution route — physical Mace + Chaos Attunement.**  
**Core idea / carrier:** use a high-base-damage Mace attack and have Chaos Attunement add Chaos damage. **Supporting mechanics:** a Wither source can be useful if independently compatible, but it is not required to prove the rolled Chaos Offense. **Scaling:** base hit first, then Chaos/attack damage and appropriate enemy Chaos-defense reduction. **Dependency:** Chaos Attunement's penalty to other damage types means this is more coherent when the build accepts a strong Chaos emphasis rather than trying to be five-element hybrid. citeturn22search1

A possible secondary identity is Chaos+Poison because Physical and Chaos can both contribute to Poison magnitude, but that should only be proposed when Poison is intentionally added. Chaos Damage alone does not imply Poison. citeturn18search1

**Randomancer cross-check:** the offense inventory deliberately marks Chaos as cohesion-neutral and relates it to Poison. The selector is even more conservative: unlike the other elemental types, `DAMAGE_TYPE_AFFINITIES` gives Chaos no automatic Poison context. That is a good design choice for this route. fileciteturn2file0L1-L5 fileciteturn7file0L1-L2

The local unique semantics also contains **Nebuloch** as Physical+Chaos on a Hammer, an intriguing potential native-ish alternative, but because its live 2026 item text was not independently verified here it belongs in a future-validation queue, not generated prose. fileciteturn12file0L1-L6

**Confidence:** **Medium-high** for Chaos Attunement; **low/unverified** for repository-only unique alternatives.

**Ignite**

**Assessment — Workable and fairly natural once application is handled explicitly.**

**Plausible solution route — Molten Blast + Ignite support.**  
**Core idea:** Molten Blast supplies substantial Fire damage, extra Flammability pressure and extended Ignite duration; an explicit current Ignite support supplies/strengthens application rather than relying on a vague Fire tag. **Named pieces:** Molten Blast, Ignite I/II/III as appropriate, Searing Flame after application is secure, Fire Exposure only as a payoff if its Ignite prerequisite is already satisfied. **Scaling:** strong Fire hit, Flammability/application chance, Ignite magnitude and appropriate damage-over-time modifiers. Hit penetration should not be casually described as scaling the Ignite damage itself. citeturn15search1turn20view0

**Plausible solution route — Perfect Strike + explicit Ignite support.** Perfect Strike produces a large Fire-converted Hit and therefore good potential Ignite magnitude, but it **must not** inherit its obsolete "always Ignite" identity. Chronomancer's Time control is useful for landing the timed strike; Inevitable Agony benefits the Hit component independently of the Ignite. citeturn14view0turn11search3

**Randomancer cross-check:** the overrides correctly suppress false-positive application from Eternal Flame and Fire Exposure. This is excellent evidence that the data model already understands "modifies an Ignite" versus "creates the Ignite." fileciteturn5file0L1-L2

**Confidence:** **High**, provided the generated route explicitly identifies an application source. A statement such as "Perfect Strike always Ignites" should be treated as a mandatory validation failure.

**Bleed**

**Assessment — Natural for Physical Mace; one additional exotic item route is plausible but more fragile.**

**Plausible solution route — large Physical hit + Bleed III.**  
**Core idea / carrier:** Rolling Slam, Earthquake, Hammer of the Gods or another physical-heavy Mace attack supplies the hit; current Bleed III can give supported attacks 100% chance to inflict Bleeding. **Named passives/items:** Crimson Assault is a powerful keystone option—current data makes inflicted Bleeding Aggravated with a very short base duration and greater magnitude—while Perforation offers a Jagged-Ground-oriented aggravation route. Soul Core of Opiloti is another current Bleed-magnitude equipment tool. **Scaling:** physical hit contribution, Bleed magnitude, duration/application reliability, and aggravation mechanics. citeturn24view1turn18search0

Chronomancer contributes control and large-hit synergy but does not intrinsically make Bleed better. Inevitable Agony should be credited to the initial Hit lane, not to Bleed ticks. citeturn11search3

**Experimental alternate — Blistering Bond Fire/Bleed.** Current PoE2DB material has identified Blistering Bond as a route where Fire participates in Bleeding semantics and the resulting Bleeding's damage type is altered. That creates a strange but defensible bridge from Fire Mace attacks such as Perfect Strike into Bleed. Because this is a unique-dependent, patch-sensitive rule and the compact Randomancer representation is incomplete, it should be validated on the current item page again before publication rather than made a default route. citeturn6search3

**Randomancer cross-check:** the Bleed inventory relation to Physical is correct, and the overrides correctly suppress a later Bleed support whose text actually prevents the supported skill from inflicting Bleed. More importantly, the compact unique semantics for Blistering Bond retains only a coarse Physical→Fire replacement and does **not** express the full useful Bleed bridge found externally. fileciteturn2file0L1-L5 fileciteturn5file0L1-L2 fileciteturn12file0L1-L6

**Confidence:** **High** for Physical Mace + Bleed III; **medium** for Blistering Bond pending mandatory live-item revalidation.

**Poison**

**Assessment — Workable and cleaner than a tag-only system might assume.**

**Plausible solution route — Physical Mace + explicit Poison chance.**  
**Core idea:** Poison in current PoE2 can use Physical Hit damage directly for its magnitude; a Mace does **not** need Chaos conversion first. Poison I gives explicit chance to Poison and is compatible with damage attacks including Maces. **Scaling:** increase the Physical/Chaos pre-mitigation hit contribution, Poison magnitude/duration/stacking as appropriate, and application chance. **Caveat:** hit penetration is not equivalent to Poison scaling; the Poison rules use the relevant pre-mitigation contributing damage. citeturn18search1turn24view0

**Optional second bridge:** Chaos Attunement can add Chaos to the same Mace hit, and Chaos also contributes to Poison magnitude. It therefore enhances the Poison carrier without being the thing that grants Poison application. citeturn22search1turn18search1

**Randomancer cross-check:** the inventory models Chaos as reinforcing and Physical as secondary to Poison, and the v3 carrier model explicitly recognizes both Chaos and Physical as Poison carriers. That mapping is mechanically useful as long as the solver still demands a real `inflicts/provides` application fact. fileciteturn2file0L1-L5 fileciteturn7file0L1-L2

**Confidence:** **High.** Downstream prose should say "Physical damage can contribute to Poison magnitude; Poison support supplies the application chance," not "physical hits inherently Poison."

**Chill**

**Assessment — Workable with a very low-complexity support bridge.**

**Plausible solution route — Cold Attunement on a Mace attack.**  
**Core idea:** gain a meaningful Cold component on Rolling Slam or another legal Mace attack. Cold Hits apply Chill, so once Cold damage truly exists the Mace has a direct Chill mechanism rather than a mere semantic tag. **Scaling:** base hit, Cold component, Chill effectiveness/magnitude where available, and enemy Cold mitigation. **Chronomancer interaction:** Apex of the Moment supplies an independent enemy Slow, while Time Freeze and Temporal Rift enhance control/safety; avoid claiming an exact stacking formula without separate evidence. citeturn18search2turn22search2turn11search3

**Unique alternate:** Twisted Empyrean/Starborn Onslaught explicitly uses Chill/Freeze to build its Glory and is itself a strong Cold/Chill route, making it unusually cohesive for this roll. citeturn24view2turn10view0

**Randomancer cross-check:** the Frost Nexus and Spreading Frost overrides deserve preservation: each derives its Chill route from an already-established Freeze and must not be surfaced as the first Chill source. Twisted Empyrean's local unique semantics, by contrast, correctly contains strong Chill evidence. fileciteturn5file0L1-L2 fileciteturn12file0L1-L6

**Confidence:** **High.**

**Freeze**

**Assessment — Workable, but more investment-sensitive than Chill.**

**Plausible solution route — high-hit Mace + Cold Attunement + Freeze investment.**  
**Core idea:** create a meaningful Cold Hit with Cold Attunement; Cold Hits contribute to Freeze buildup. Large Mace hits are a sensible carrier because Freeze depends on actually accumulating sufficient buildup, not merely possessing a `cold` tag. **Scaling:** base hit, Cold contribution, Freeze buildup/effectiveness and relevant Cold defenses. **Gameplay:** use Apex/Time Freeze to create windows for slow high-impact attacks and capitalize on actual Freezes when they occur. citeturn18search2turn22search2turn11search3

**Unique route — Starborn Onslaught.** Twisted Empyrean's granted Mace skill has a native Cold identity and specifically wants Chill/Freeze to build Glory, so it is the most thematically complete Freeze/Cold Mace package located. citeturn24view2turn10view0

**Important non-solutions:** Randomancer's own overrides correctly warn that **Olroth's Hubris** and **Tul's Stillness** make another damage type contribute to Freeze buildup; that is not equivalent to saying the support independently Freezes. Likewise Frost Nexus requires a Freeze before its Chilled Ground effect. fileciteturn5file0L1-L2

**Randomancer cross-check:** good carrier/application distinction, but Starborn is again hidden behind the ordinary-skill policy because it is item-granted. The local unique layer knows about it; the primary craftable-skill layer intentionally cannot select it. fileciteturn4file0L1-L6 fileciteturn12file0L1-L6

**Confidence:** **High** for the mechanical route; Freeze consistency against high-threshold targets is build-dependent and should not be promised generically.

**Shock**

**Assessment — Workable, but this is one of the combinations where the generator must be especially strict about carrier versus application.**

**Plausible route — Fire Mace + The Three Dragons.**  
The Three Dragons provides an explicit cross-element ailment rule that allows a Fire-hit route to feed Shock rather than the Fire ailment path. That makes a fire-heavy Mace attack such as Perfect Strike or Molten Blast a defensible Shock carrier through a named item rather than by hand-waving "elemental damage." This is a unique-dependent route and its replacement rules mean the build gives up normal ailment behavior in exchange. citeturn20view0

**Alternate route — Lightning Attunement plus an independently verified Shock source.** Lightning Attunement is an excellent Lightning **carrier**, but this dossier deliberately does not promote it alone to "inflicts Shock." Before generated prose names this route, the exact current Shock-applying support/passive/item used by the package should be revalidated and explicitly stated. Coursing Current/Shock Conduction cannot solve the initial application by itself, and Lightning Exposure is likewise not a first-Shock source according to Randomancer's curated overrides. citeturn23view0 fileciteturn5file0L1-L2

**Randomancer cross-check:** the selector correctly treats Lightning as a Shock carrier rather than proof of Shock. The compact unique semantics for The Three Dragons is less satisfactory: its Shock relationship is represented principally as contradiction/replacement semantics, which may prevent it from being retrieved as a positive cross-element solution even though its live mechanic is potentially build-defining. This deserves an enrichment test fixture. fileciteturn7file0L1-L2 fileciteturn12file0L1-L6

**Confidence:** **Medium-high** for The Three Dragons route; **medium/validation-required** for a generic Lightning-Attunement Shock route until the actual application piece is named.

**Electrocute**

**Assessment — Workable, with one of the cleanest multi-support bridges in the entire dossier.**

**Plausible solution route — Mace attack + Lightning Attunement + Electrocute.**  
**Core idea:** the first support gives the Mace attack real Lightning damage; Electrocute then explicitly permits that Lightning damage to contribute to Electrocution buildup. **Carrier:** Rolling Slam or any other compatible damaging Mace attack. **Scaling:** strong base hit, meaningful Lightning contribution and Electrocution buildup. **Caveat:** Electrocute Support prevents the supported skill from inflicting Shock, so a build seeking both Shock and Electrocute needs separate application lanes rather than pretending the same supported attack performs both. citeturn23view0turn16search0

Chronomancer is unusually comfortable with the resulting control-heavy playstyle: Electrocution, Apex slow and Time Freeze all create tempo, while Phased Form/Rift protects the character during committed attack sequences. They are distinct mechanics and should not be collapsed into "everything is frozen/stunned." citeturn11search3

**Randomancer cross-check:** this is effectively the canonical example in the v3 documentation: Electrocute can make Lightning damage inflict/build Electrocution but prevents Shock, and the solver is explicitly designed to choose a second skill lane if conflicting Shock/Electrocute obligations need separation. fileciteturn4file0L1-L6

**Confidence:** **High.** This is an excellent regression fixture for bridge ordering and conflict handling.

**Minions**

**Assessment — Workable, and substantially stronger than a simple reading of "Mace has no summon skills" would suggest.**

**Plausible solution route — Forge Hammer + Skittering Stone.**  
**Core idea:** Forge Hammer supplies a weapon-native Mace skill that participates in the earthen/stone-elemental system; Skittering Stone releases temporary stone Minions from the eligible created objects. **Supporting mechanics:** Forge Hammer's cooldown/recall/Warcry loop already gives Chronomancer a meaningful Time Snap interaction. **Scaling:** the player must decide whether the Mace hit or spawned Minions are primary—trying to scale both equally may be inefficient. Current Skittering Stone also has Strength-related Minion scaling, which at least has thematic overlap with Mace stat requirements. **Dependency:** do not generalize Skittering Stone to every Mace attack; it requires the correct earthen-object capability, and Forge Hammer is the verified fit. citeturn15search0turn16search1

**Plausible solution route — Lightning Mace + Living Lightning.**  
**Core idea:** support a Mace hit with Lightning Attunement so it deals Lightning damage, then use Living Lightning to create temporary chaining Minions when the supported skill deals that Lightning damage. This is a wonderfully explicit two-step semantic chain: **Mace → Lightning provision → Minion creation**. citeturn23view0turn22search3

**Useful unique candidate:** Chober Chaber is a Mace-family minion-themed unique in current/recent PoE2 data and is worth checking for a dedicated hybrid, but its exact live minion modifiers should be revalidated immediately before publication rather than assumed from the repository. citeturn6search3

**Defensive direction:** one-handed Mace + Shield is attractive if the Minions are doing meaningful secondary work; a Forge Hammer setup can instead accept heavier melee exposure and lean into Phased Form/Rift.

**Randomancer cross-check:** this is one of the strongest parts of the enriched dataset. The overrides explicitly record both Living Lightning (`creates minion`, `requires lightning`) and Skittering Stone (`creates minion`), while the v3 martial rule prevents a generic weapon-agnostic summon from falsely satisfying Mace delivery. fileciteturn5file0L1-L2 fileciteturn4file0L1-L6

**Confidence:** **High** for both bridges. These should be prominent test cases because public Mace build discussion is much more likely to foreground conventional Slam damage than these support-mediated Minion solutions.

**Companions**

**Assessment — Difficult / hybrid rather than truly weapon-native.**

**Plausible solution route — Mace primary + Tame Beast sidecar.**  
**Core idea:** use a genuine Mace primary such as Rolling Slam, Perfect Strike or another offense-appropriate attack, while Tame Beast supplies the Companion half of the build. Tame Beast captures a qualifying Rare Beast and transforms into a persistent skill summoning it as a reviving Companion. **Dependency:** capture requirements and Spirit reservation/capacity must actually be satisfied. **Scaling:** this is inherently split investment; the Companion does not become a Mace attack merely because the player is wielding a Mace. **Defense:** a one-handed Mace/Shield setup is sensible because this archetype has less reason to maximize a two-handed hit at all costs. citeturn16search2

**Explicit exclusion:** Rhoa Mount is not a valid Mace bridge; its weapon restriction is Bow/Spear. Randomancer's curated override correctly records this rather than trusting a generic Companion/Rhoa tag. fileciteturn5file0L1-L2

**Randomancer cross-check:** Tame Beast is also well-curated locally: Randomancer explicitly models its transformation after Beast capture and its creation of both a Companion and Minion. But the v3 martial-delivery rule intentionally says a weapon-agnostic Companion skill cannot by itself satisfy a martial weapon's primary-damage position. As a result, a package may quite reasonably classify **Mace + Companion as unresolved or sidecar-supported rather than directly fulfilled**. fileciteturn5file0L1-L2 fileciteturn4file0L1-L6

That is probably the right semantic outcome. No current **Mace-causes-Companion** bridge comparable to Living Lightning or Skittering Stone was verified in this research.

**Confidence:** **High** that Tame Beast can coexist with a Mace; **low** that this should be described as an integrated Mace-Companion engine. This is the weakest of the 15 combinations.

**Totems**

**Assessment — Natural.**

**Plausible solution route — Shockwave Totem using a Mace.**  
**Core idea:** Shockwave Totem currently uses equipped martial weapon(s), making Mace directly relevant to its attacks. This is not merely a generic `Totemable` skill; Shockwave Totem actually creates the Totem. **Scaling:** weapon damage and the current Totem-specific mechanics rather than relying on obsolete assumptions that ordinary socketed damage supports directly modify the Totem's attack. citeturn14view1

**Supporting setup — Jagged Ground.** Shockwave Totem can cause useful interactions with Jagged Ground but does not itself create that ground, so another skill must establish it. Earthquake/other verified Jagged-Ground creators are therefore setup pieces rather than optional flavor. citeturn14view1turn23view0

**Supporting setup — Volcanic Fissure.** Current Volcanic Fissure says allied Slams can trigger its fissures, and its history specifically contains fixes/interactions involving Shockwave Totem. This makes Volcanic Fissure + Shockwave Totem a much more interesting Mace package than two unrelated damage buttons: create fissures with the player, let allied Totem Slams trigger them. citeturn15search2turn14view1

**Keystone option — Ancestral Bond.** It can double Totem Limit and eliminate the ordinary placement cost/Charge requirement, but each Totem reserves 75 Spirit. This is a real build constraint; the generator must not recommend it without noting the Spirit plan. citeturn21search0turn21search1

**Defensive direction:** Totems let the Chronomancer spend more time positioning and using Temporal Rift/Time Freeze rather than face-tanking every attack. That is an operational advantage, not evidence that Chronomancer directly buffs Totem damage.

**Randomancer cross-check:** two issues matter. First, its documentation correctly distinguishes `Totemable` compatibility from evidence that a skill actually creates a Totem. Second, the non-skill recommender currently excludes keystones, so Ancestral Bond can be mechanically central yet invisible to that selector. The current Shockwave Totem change that normal supports no longer apply to its attack is also exactly the sort of skill-specific negative compatibility fact that should be represented explicitly in enrichment. fileciteturn4file0L1-L6 fileciteturn10file0L1-L2

**Confidence:** **High.** Shockwave Totem is one of the strongest complete answers in the dossier.

## Cross-offense findings for the recommendation system

Several patterns recur often enough that they should become explicit recommendation semantics rather than prose heuristics.

**"Gain as extra" must remain distinct from conversion.** Cold, Lightning and Chaos Attunement can turn a legal Mace hit into a carrier for those damage types, but the original damage is not necessarily replaced. That distinction affects scaling advice, ailments, penetration, and interactions that specifically inspect damage conversion. Randomancer's v3 documentation already states this principle; downstream generation should preserve the exact relation verb. fileciteturn4file0L1-L6 citeturn22search1turn22search2turn23view0

**Carrier ≠ application is the single most important ailment rule.** Fire gives an Ignite carrier but current Ignite still needs its application/Flammability path; Physical/Chaos contribute Poison magnitude but Poison needs explicit chance; Lightning can carry Shock/Electrocute but neither should be asserted merely from a Lightning tag. Cold is somewhat different because Cold Hits intrinsically participate in Chill/Freeze mechanics, but even there Freeze success depends on buildup. citeturn20view0turn18search1turn18search2turn16search0

**Conditional supports need their prerequisite attached to the resulting fact.** Randomancer's overrides correctly do this for Frost Nexus, Spreading Frost, Corrosion, Breachlord's Rift, Living Lightning and other cases. The downstream generator should carry that principle through to prose: "after you Freeze..." and "when the supported skill deals Lightning damage..." are build requirements, not explanatory trivia. fileciteturn5file0L1-L2

**Current Chronomancer contributes tempo, not attack replication.** Sands of Time, Apex, Time Freeze, Time Snap, Inevitable Agony, and Phased Form/Rift are broadly useful. Now and Again is spell-specific. Any generic template that says "Chronomancer repeats your Mace attack" is currently wrong. citeturn11search2turn11search3turn21search2turn21search3

**Cooldown reset needs a separate prerequisite model.** Time Snap can reset Forge Hammer's or other skills' cooldowns, but it cannot generate Glory, Endurance Charges, corpses, ailment states, or whatever other prerequisite a skill may have. A generic relation `resets_cooldown(skill)` must never be interpreted as `resolves_all_skill_requirements(skill)`. citeturn21search2turn15search0

**Item-granted skills are a significant blind spot in the ordinary Skill Idea surface.** Twisted Empyrean/Starborn Onslaught is the clearest example: it is arguably the strongest true Cold-Mace interpretation in this whole experiment, Randomancer's unique semantics knows about it, but the normal craftable-active-skill policy intentionally excludes item-granted skills. A downstream content generator should have a separate "unique-enabled alternate solution" channel rather than either losing the route or contaminating ordinary skill recommendations. fileciteturn4file0L1-L6 fileciteturn12file0L1-L6 citeturn24view2

**Keystones are a second blind spot.** Giant's Blood can materially redefine Mace defense/offhand design; Ancestral Bond redefines Totem quantity and Spirit costs; Crimson Assault can redefine Bleed behavior. Yet the current non-skill selector filters out keystones categorically. A recommendation system that aims to explain solution mechanics needs either a dedicated keystone phase or a structured "required/enabling passive" attachment to a route. fileciteturn10file0L1-L2 citeturn16search3turn21search0turn18search0

**Negative facts deserve first-class modeling.** Perfect Strike's old always-Ignite behavior is gone; Shockwave Totem's support behavior changed; Electrocute prevents Shock on the supported skill; Rhoa Mount requires Bow/Spear; some supports mentioning an ailment actually require or prevent it. These negatives are at least as important as positive tags for preventing plausible-sounding nonsense. citeturn14view0turn14view1turn16search0 fileciteturn5file0L1-L2

**The enriched catalog appears strongest where it encodes non-obvious support chains.** Forge Hammer→Skittering Stone and Lightning Attunement→Living Lightning are exactly the sort of real builds a public-discussion-frequency recommender might underweight. In the sources reviewed, these mechanics were much more visible in data/support documentation than as established "Chronomancer Mace builds." That is a search observation, not proof that no players use them. citeturn15search0turn16search1turn22search3 fileciteturn5file0L1-L2

## Final synthesis

**Strongest solution routes.** The highest-confidence combinations are Physical via Rolling Slam/other physical Mace Slams; Fire via Perfect Strike, Molten Blast, Volcanic Fissure or Forge Hammer; Ignite via a Fire Mace carrier plus explicit Ignite application; Bleed via a Physical Mace hit plus Bleed III; Poison via Physical Mace plus explicit Poison chance; Cold/Chill/Freeze via Cold Attunement; Lightning via Lightning Attunement; Electrocute via Lightning Attunement + Electrocute; Minions via Forge Hammer + Skittering Stone or Lightning Mace + Living Lightning; and Totems via Shockwave Totem. citeturn6search1turn14view0turn15search1turn22search2turn23view0turn16search0turn15search0turn16search1turn22search3turn14view1

**Strangest but still defensible routes.** Twisted Empyrean/Starborn Onslaught provides a genuinely cold two-handed Mace identity and a Chill/Freeze→Glory loop. The Three Dragons offers a cross-element Shock route for Fire Mace attacks. Blistering Bond appears capable of turning a Fire-heavy attack into an unconventional Bleed package, though that unique needs current-item revalidation before publication. Chaos Attunement gives an otherwise non-Chaos Mace a defensible Chaos hit identity. citeturn24view2turn20view0turn6search3turn22search1

**Weakest bridge.** **Companions** is the clear outlier. Tame Beast can coexist with a Mace and is a current, verified Companion system, but no equally strong weapon-native Mace→Companion causal bridge was found. The downstream generator should describe this as a hybrid "Mace attacker accompanied by a captured Beast," not imply the Mace summons or scales the Beast. citeturn16search2

**Other qualified combinations.** Chaos is mechanically sound through Chaos Attunement but lacks the naturally integrated Mace identity that Fire or Physical has. Shock is viable, particularly through The Three Dragons, but a generic Lightning-Attunement route must still identify the exact Shock application mechanism instead of treating Lightning as proof. Freeze is sound but threshold-dependent rather than guaranteed merely by adding Cold. citeturn22search1turn20view0turn18search2

**Repository facts or assumptions that are stale or dangerous to reuse.** Critical Hits remains in `offense-inventory.json` but is deliberately non-rollable; Heavy Stun and Armour Break appear in older/general tactic data but are not current Offense rolls. Any Chronomancer data that still contains Rapid River, old Inevitable Agony semantics, or a generic-attack interpretation of Now and Again is stale relative to 0.5.0. Any Perfect Strike fact saying it always Ignites is stale. Any Shockwave Totem support model based on its older self-contained attack/support behavior needs current-version validation. Ancestral Bond must use its current doubled-limit/75-Spirit formulation. fileciteturn2file0L1-L5 fileciteturn3file0L1-L6 fileciteturn6file0L1-L2 citeturn11search2turn14view0turn14view1turn21search0

**Repository semantic/enrichment gaps exposed.** The catalog report shows substantial unstructured/unparsed evidence and even stale-looking legacy skill prose, so existence in the repository cannot substitute for current verification. Item-granted skills are excluded from the ordinary Skill Idea pool, losing routes like Starborn Onslaught from the main surface. Keystones are excluded by the current non-skill selector, hiding Giant's Blood/Ancestral Bond/Crimson Assault. The Three Dragons' compact semantics do not clearly expose its most useful positive Shock bridge, and Blistering Bond's compact semantics fail to express the full unusual Bleed relationship found externally. The one-handed-Mace offhand list also differs between `core-data.json` and `js/06-equipment.js`, so unusual offhands such as Sceptre should be externally validated before generation. fileciteturn9file0L1-L2 fileciteturn4file0L1-L6 fileciteturn10file0L1-L2 fileciteturn12file0L1-L6 fileciteturn11file0L1-L6

**Especially valuable mechanics that first-generation logic could miss:** Cold/Lightning/Chaos Attunement as typed damage bridges; Living Lightning as a Lightning→Minion bridge; Skittering Stone plus Forge Hammer as a Mace-native Minion route; Starborn Onslaught as an item-granted Cold Mace solution; Giant's Blood as a defense/loadout transformer; Ancestral Bond's current Spirit-based Totem design; explicit Poison chance on physical Mace attacks; and the Electrocute support's simultaneous enabling of Electrocution and prevention of Shock. citeturn22search1turn22search2turn23view0turn22search3turn16search1turn24view2turn16search3turn21search0turn24view0turn16search0

**Mandatory validation dependencies before publishing an interpretation:** current official patch notes for Chronomancer; current PoE2DB text for every named skill/support/unique that materially defines the route; Perfect Strike's current Ignite behavior; the current Ignite/Poison application rules; Shockwave Totem's post-0.3 support and weapon behavior; Ancestral Bond's Spirit requirement; Electrocute's Shock-prevention clause; Tame Beast's current capture/Companion requirements; and current unique text for Twisted Empyrean, The Three Dragons, Blistering Bond, or any repository-only unique. The Randomancer catalog should be treated as candidate/relation evidence, not as a waiver of those validations. citeturn11search2turn14view0turn20view0turn18search1turn14view1turn21search0turn16search0turn16search2turn24view2

The resulting research picture is encouraging for the recommendation experiment: **14 of the 15 current Offense rolls have at least one credible mechanical construction, and several have multiple distinct constructions; Companions is the only combination for which the evidence supports a hybrid coexistence package more strongly than a genuine Mace-delivered bridge.** The most important design lesson is not to add more fuzzy tags. It is to retain explicit causal chains—*Mace skill deals Lightning → Living Lightning can create Minions*; *Mace gains Lightning → Electrocute makes that Lightning build Electrocution but disables Shock*; *Fire Mace hit → Ignite still needs application*; *item grants Cold Mace skill → ordinary craftable-skill selector cannot surface it*. That is the level of semantic specificity required for the downstream Codex agent to generate concise interpretations without silently converting correlation into mechanics. fileciteturn4file0L1-L6 fileciteturn5file0L1-L2