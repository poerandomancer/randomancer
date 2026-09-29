# Build Leads prototype

Build Leads reframes the recommendation surface as a set of optional discoveries,
not a complete build prescription. The existing v3 package solver remains available
on the snapshot as a temporary diagnostics and compatibility boundary; its package is
no longer adapted into the player-facing recommendations.

## Result shape

`selectBuildLeads()` returns a `build-leads-v1.1.0` object with the selection seed,
the normalized Fate axes, and a sparse `categories` object. Categories with no lead
above the threshold do not exist. Each entity lead contains its catalog identity,
content type, semantic role, score, number of matched axes, deterministic explanation,
and the typed facts used as evidence. A mechanical connection instead contains the
ordered entity names and the shared causal mechanic.

The provisional semantic categories and all presentation copy are centralized in
`BUILD_LEAD_COPY`: Direct Fits, Ways to Enable, Payoffs, Useful Tools, and Mechanical
Connections. Entity type is separate metadata (`Skill`, `Support`, `Unique`, `Passive`,
`Keystone`, `Ascendancy Passive`, or `Granted Skill`) and is displayed beside the name.

## Selection and roles

The selector first builds a legal graph from the enriched v3 catalog. Content, access,
weapon/equipment, granted-source, passive-tree, ascendancy, and contradiction checks
are hard gates. Relevance is evaluated only after those gates. Exact or strong typed
facts create graph edges; retrieval tags never establish relevance.

Applicability and relevance are separate passes. The applicability pass first asks
whether an entity can belong to the rolled Fate:

* Active skills must appear in the existing v3 cell analyzer's direct pool. This
  reuses granted access, current-content, crafting-pool, equipment delivery, and
  martial/caster boundaries. A conversion neighborhood cannot promote another skill.
* Support gems must target at least one primary-eligible v3 skill in the rolled weapon
  ecosystem and satisfy their typed prerequisites on that carrier.
* Unique weapons must resolve to the exact canonical rolled weapon family. Other
  uniques retain shared content, access, equipment, and contradiction checks.
* Ascendancy passives require exact ownership. Ordinary passives and keystones retain
  class overrides, tree-start locality, and passive weapon requirements.
* Granted skills use the shared v3 compatibility evaluator, so an ascendancy source
  must match and a unique-granted skill is not independently available unless its
  provider is actually present in the snapshot.

Only this applicable entity set becomes graph input. Connections also use that set,
so a valid semantic edge cannot legalize an invalid endpoint.

* **Direct Fits** have explicit rolled-weapon evidence plus direct Offense identity or
  production. They can be skills, matching unique weapons, or granted-skill providers.
* **Ways to Enable** apply or provide the Offense, or explicitly convert another
  mechanic into it. They establish a route that was not already present.
* **Payoffs** have `requires` or `consumes` evidence. They use an established state and
  are deliberately classified after, rather than as, first-step enablers.
* **Useful Tools** modify the rolled mechanic or a close native neighbor, or are a
  weapon-native option opened by a real conversion source. They remain below direct
  fits and strong enablers.

The graph starts at the rolled Offense. Native typed affinities such as Cold → Chill /
Freeze are distance one. An exact/strong outgoing `converts` or `replaces` edge into a
distance-zero/one mechanic may expose its source at distance two. This permits a real
Fire → Cold converter to make a Fire Mace option discoverable without arbitrarily
expanding through every tag. `provides`, `creates`, `generates`, `inflicts`, `grants`,
`enables`, `requires`, `consumes`, `modifies`, and `has_property` edges are then scored
according to semantic role and path distance.

Scoring uses absolute, role-specific minimums. Direct multi-axis identity and
application score highest, transformations and application mechanisms establish
enablers, downstream requirements establish payoffs, and modifiers qualify as useful
tools at a lower threshold. Weapon and owned-ascendancy axes add bonuses, while each
semantic hop incurs a penalty.

There are no minimum counts, winner-relative bands, or fallback fillers. Every item is
first tested against its role's absolute minimum. Per-category maximums constrain only
display density. Seeded randomness breaks exact-score ties after qualification; a high
winner cannot remove another independently qualified lead. Consequently a category can
contain one lead, several leads, or be absent altogether.

## Mechanical connections

A connection is formed from the broader legal graph when one entity has exact/strong
`creates`/`provides`/`generates`/`inflicts` evidence and another qualified entity has
exact/strong `requires`/`consumes` evidence for the same normalized mechanic. The
result is a two-entity causal edge, not a package. Conversion connections also join an
explicit converter to a weapon-native entity on its source side. Connection endpoints
do not both need to clear individual display thresholds.

## Current data observations

With the current release catalog and a fixed reporting seed:

* **Chronomancer + Mace + Cold** produces three item Direct Fits (Twisted Empyrean,
  Seeing Stars, and Frostbreath), six Ways to Enable, seven Useful Tools, and four
  connections. It surfaces no active skills: Firestorm and Skeletal Brute are excluded
  by the v3 skill applicability boundary.
* **Deadeye + Bow + Poison** produces four Direct Fits (Vine Arrow, Poisonburst Arrow,
  Gas Arrow, and Toxic Growth), six enablers, three payoffs, seven tools, and five
  causal connections.
* **Invoker + Quarterstaff + Freeze** produces Wave of Frost as a Direct Fit, Ice
  Strike and Shattering Palm as applicable active enablers, the owned
  `I am the Blizzard...` hook, tools, and causal connections.
* **Warbringer + Mace + Electrocute** surfaces no active skills, but retains six
  enablers, seven tools, and two explicit connections.
* **Chronomancer + Mace + Totems** surfaces Ancestral Warrior Totem and Shockwave Totem
  as the two applicable active-skill enablers, plus seven useful tools.

Remaining limitations are data-visible rather than papered over: some facts use broad
damage types where a specific Chill/Freeze fact would improve precision; Minion facts
remain substantially sparser than Totem facts; and the committed Twisted Empyrean
entity does not currently carry the `kalguuran` provenance tag consumed by the shared
release filter. The selector continues to call that filter and adds no replacement
availability assumption or hard-coded benchmark substitution.
