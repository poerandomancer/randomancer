# Recommendation-v3 bounded discovery

## New-Offense diagnosis

The production-catalog baseline for the deliberately awkward cells was resolved but shallow:

| Cell | Baseline construction | Discovery limitation |
|---|---|---|
| Stormweaver / Spear / Heavy Stun | hit skill + Stun III + Enduring Impact II | support bridge and payoff worked; no class-local Heavy Stun passive was eligible |
| Infernalist / Wand / Heavy Stun | hit spell + Stun III + Enduring Impact II | support bridge and payoff worked; no class-local Heavy Stun passive was eligible |
| Disciple of Varashta / Bow / Armour Break | attack + Armour Break support + Armour Explosion | unconditional support bridge outranked conditional routes |
| Lich / Wand / Armour Break | spell + Armour Break support + Break Endurance | conditional skill/support bundles were invisible during active-package enumeration |
| Chronomancer / Spear / Armour Break | attack + Armour Break support + Armour Explosion | conditional skill/support bundles were invisible during active-package enumeration |
| Invoker / Quarterstaff / Armour Break | attack + Armour Break support + Armour Explosion | conditional skill/support bundles were invisible during active-package enumeration |

Straightforward Critical Hits cells resolved directly and attached explicit critical
optimizers. The remaining Crit weakness was outside skill fulfillment: a passive
transformation such as spell Crit to Armour Break could not validate its typed source
mechanic against the selected package.

The gaps had three distinct causes:

1. candidate retrieval did not include a legal damage skill whose relevance appeared
   only after attaching a conditional Offense support;
2. support assignment happened after two-skill enumeration, so a setup skill could not
   make that conditional support meaningful during package ranking;
3. active and non-skill `requires`/`consumes` facts were not treated as package-aware
   payoff evidence, and passive transformations did not validate one typed source step.

No failure in these cells required relaxing weapon, class-locality, content, Lineage,
or support-family legality.

## Bounded model

Discovery remains limited to `setup source -> supported damage skill -> rolled Offense ->
one payoff`. Conditional support bundles contain at most two normal supports and one
setup active. They enter ranking only when the setup supplies an exact/strong typed
prerequisite and the supported skill completes the unresolved rolled Offense. The
normal complexity penalty and support limits still apply.

After fulfillment, one explicit payoff may come from a compatible support or active
skill. Passive, ascendancy, and unique payoff facts using `requires` or `consumes` are
eligible only when package diagnostics prove the demanded Offense. Passive
transformations are one step only: their typed source requirement and delivery must
both be present in the selected package.

## Enrichment contract for setup transformations

Candidate retrieval terms are search aids, not fulfillment evidence. A setup state is
usable by bounded discovery only when authoritative structured data or conservative
grammar produces a directed fact such as `inflicts(state_a)`, with outgoing enemy
scope. References to afflicted enemies, effect or duration scaling, consumption, and
prevention remain non-applicative.

Compound consume-to-produce clauses materialize both sides of their causal contract:

```text
setup skill -> inflicts state A
supported skill -> consumes state A
supported skill -> produces Offense B (requires_any_mechanics: [state A])
```

The conditional requirement prevents the output from masquerading as an unconditional
Offense source. Recommendation-v3 may then compose the provider and transformer within
its existing two-active/two-required-support bound, and optionally attach one explicit
payoff. This applies to the grammar class generally; it is not an entity-pair recipe.
