# Canonical Offense inventory

`data/offense-inventory.json` is the sole vocabulary for the standard Build draw's Offense axis. A draw chooses one rollable entry. Critical Hits, Heavy Stun, and Armour Break are canonical build identities alongside the existing damage, ailment, and archetype entries.

Bind the Fates stores canonical names in its `combat` category. Oaths are selected first and Abominations are removed. Selection is uniform within the applicable pool; relationship metadata informs recommendations rather than draw eligibility.

The canonical draw stores `offenseList`, `offenseSet`, and `offenseTags`. It does not project entries into the unrelated historical Ailment or Tactic catalogs.

The recommendation solver distinguishes mere capability from investment. Critical Hits uses explicit critical interactions and base-critical profiles; Heavy Stun and Armour Break require typed generation evidence. Once the rolled state is fulfilled, a bounded payoff pass may attach one legal support that explicitly requires or consumes that state. It does not follow generic tag overlap or unbounded mechanic graphs.
