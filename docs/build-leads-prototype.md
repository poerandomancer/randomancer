# Build Leads prototype

Build Leads reframes the recommendation surface as a set of optional discoveries,
not a complete build prescription. The existing v3 package solver remains available
on the snapshot as a temporary diagnostics and compatibility boundary; its package is
no longer adapted into the player-facing recommendations.

## Result shape

`selectBuildLeads()` returns a `build-leads-v1.0.0` object with the selection seed,
the normalized Fate axes, and a sparse `categories` object. Categories with no lead
above the threshold do not exist. Each entity lead contains its catalog identity,
content type, semantic role, score, number of matched axes, deterministic explanation,
and the typed facts used as evidence. A mechanical connection instead contains the
ordered entity names and the shared causal mechanic.

The provisional categories and all presentation copy are centralized in
`BUILD_LEAD_COPY`: Direct Fits, Ways to Enable, Mechanical Connections, Unique Tools,
Support Ideas, Passive Leads, Ascendancy Hooks, and Payoffs.

## Selection and roles

The selector starts with the enriched v3 catalog and preserves its content, access,
weapon/equipment, passive-tree, ascendancy, and contradiction gates. Exact or strong
typed facts are required. Generic retrieval tags do not establish relevance.

* **Direct Fits** are active skills with explicit rolled-weapon evidence and an action
  fact (`fulfills`, `inflicts`, `creates`, `provides`, or `generates`) for the Offense.
* **Ways to Enable** apply or provide the Offense, or explicitly convert another
  mechanic into it. They establish a route that was not already present.
* **Payoffs** have `requires` or `consumes` evidence. They use an established state and
  are deliberately classified after, rather than as, first-step enablers.
* **Supporting tools** use explicit modification/property evidence. Uniques, passives,
  and owned ascendancy nodes retain type-specific presentation categories.

Scores reward an additional 30 points for each rolled axis beyond Offense, 38 for an
explicit conversion, 30 for application/provision, 24 for a payoff, and 12 for an
amplifier. This makes explicit Weapon + Offense evidence outrank a generic one-axis
modifier. The current display threshold is 42.

There are no minimum counts or fallback fillers. Per-category maximums only constrain
display density and differ by category. Selection randomness is seed-stable and is
only used to order already-qualified candidates inside an eight-point quality band.
Consequently a category can contain one lead, several leads, or be absent altogether.

## Mechanical connections

A connection is formed only when one qualified entity has exact/strong
`creates`/`provides`/`generates`/`inflicts` evidence and another qualified entity has
exact/strong `requires`/`consumes` evidence for the same normalized mechanic. The
result is a two-entity causal edge, not a package. It may coexist with its endpoint
entities when both remain useful independently.

## Current data observations

With the current release catalog and a fixed reporting seed:

* **Chronomancer + Mace + Cold** produces no Direct Fits or Ascendancy Hooks. It does
  surface Cold enablers, Frostbreath and Seeing Stars as Unique Tools, several payoffs,
  and typed producer-to-payoff connections. This appropriately exposes that the
  catalog currently has weak direct Cold/Mace and Chronomancer evidence rather than
  manufacturing a primary skill.
* **Deadeye + Bow + Poison** produces four Direct Fits (Vine Arrow, Poisonburst Arrow,
  Gas Arrow, and Toxic Growth), multiple explicit Poison enablers, six qualified
  Unique Tools, a payoff, and causal connections.
* **Invoker + Quarterstaff + Freeze** produces Wave of Frost as a Direct Fit, several
  Freeze enablers, four Unique Tools, the owned `I am the Blizzard...` hook, payoffs,
  and causal connections.
* **Infernalist + Sceptre + Minions** currently produces no qualified categories. This
  reveals a catalog limitation: much Minion data describes actors, delivery, or broad
  tags without exact/strong facts directly naming the rolled `minion` mechanic.

The benchmark also shows that some catalog facts use a broad damage type where a more
specific Chill/Freeze fact would improve explanations and role precision. The
prototype intentionally does not infer through those gaps or hard-code benchmark
entities.
