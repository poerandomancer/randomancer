# agent.md

## Project: The Randomancer (Path of Exile 2 Build Randomizer)

You are an AI coding assistant working on **The Randomancer**, a single-page web app that generates themed, semi-cohesive Path of Exile 2 builds. It is a front-end–only project (HTML/CSS/JS + JSON data files). File names are no longer versioned; the app uses a single user-visible APP_VERSION string.

Core principles:
- **Fun and inspirational** (not a simulator)
- **Smart but lightweight rules** to avoid obviously broken combos
- **Maintainable code** that supports rapid iteration without breaking UX

---

## Key UX Controls (current)

- **Cohesion**: a **continuous threshold [0..1]** that biases rolls toward tighter synergy or wilder combinations.
  - Internally, the roll pipeline may use a “relax restrictions” safety-net to avoid dead ends while still respecting cohesion intent.

- **Bind the Fates**: modal control to **Oath** (prefer) or **Abominate** (ban) options for the **next roll**.

Standard Build mode no longer exposes a second equipment set or an Offense-count control.

- **Primary equipment family**: each standard roll selects exactly one broad family and does not prescribe handedness or an offhand. Unarmed is part of the family vocabulary but intentionally has a lower base frequency and a provisional DEX/INT affinity that must be load-tested.
  - `js/28-primary-equipment-runtime.js` derives the family vocabulary from current game data, temporarily supplies a hidden concrete configuration to legacy systems, and removes that hidden configuration from the authoritative Build snapshot.

- **Offense (1–2, Fate-selected)** defines the core offensive premise.
  - Offense is sourced from `data/offense-inventory.json`.
  - Categories are Damage Type, Ailment, Scaling, and Archetype.
  - A build may roll at most one Archetype.
  - Cohesion, rather than pairwise compatibility gates, is the primary governor of conventional versus unusual Offense combinations.

Important: user controls are **“next roll” controls** — build snapshots/build codes represent the **build outcome**, not control settings.

---

## Build Snapshot / Build Code

Build codes are **snapshot-style**:
- They encode the rolled build (class/ascendancy, primary equipment family, defenses, Offense, recommendations, etc.).
- New standard rolls store the broad family in `weapon` / `weaponFamily` and leave the old explicit offhand/secondary-set fields empty.
- Canonical Offense state uses `offense`, `offenseList`, `offenseSet`, and `offenseTags`.
- Legacy mechanic and explicit-hand fields remain readable as compatibility boundaries for current recommendations and old build codes.
- They **do not** encode user control states such as cohesion or Bind-the-Fates settings.
- Loading a build code should render the build without modifying current control settings.

---

## Codebase Overview

**HTML**
- `index.html` defines the single-page layout, header controls, roll button, sections, modals, and placeholders.

**CSS**
- `styles.css` aggregates the layered CSS files under `/css/`.

**JavaScript**
- `core-script.js` imports modules under `/js/` and establishes the app runtime.
- `js/26-offense-roll.js` owns the canonical Offense selection/snapshot helpers.
- `js/27-offense-runtime.js` is the transitional adapter that lets the legacy recommendation stack consume canonical Offense until that stack is replaced.
- `js/28-primary-equipment-runtime.js` adapts broad primary equipment families through the legacy roll boundary, expands family-level poe.ninja searches, and normalizes new standard snapshots back to one family.

**Data**
- `data/core-data.json` — core build components and legacy rules.
- `data/offense-inventory.json` — canonical Build Offense vocabulary.
- `data/enriched/*.json` — enriched skills/passives/uniques used by the runtime.
- `data/datamined/*` — reference sources used for enrichment and future updates.

---

## Major-refactor follow-up docket

- **Attribute/cohesion matching review**: after the equipment-family contract settles, evaluate replacing cosine + hard threshold/relaxation with normalized attribute-distribution overlap and cohesion-controlled weighted probability. Keep base result frequency, affinity, and cohesion strength as distinct concepts.
- **Defense viability audit + load test**: review defensive taxonomy/combinations and run high-volume samples across cohesion thresholds. Reassess hard equipment dependencies now that the offhand configuration is player-selected rather than rolled.
- **Recommendation engine rewrite**: replace the current compatibility layer with variable, solution-oriented Build Ideas that help make the rolled Fate work.

---

## Working Style (how to contribute)

- **Preserve user-facing behavior** unless explicitly asked to change it.
- Prefer **targeted, diff-friendly patches** over rewrites.
- Keep roll pipeline deterministic within a roll and robust to missing data.
- When removing features, remove the full stack when safe; preserve narrow compatibility readers where old saved/shared data still needs them.
