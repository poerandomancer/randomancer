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

- **Weapon Set II**: a toggle that, when enabled, rolls an **alternate weapon setup** and a second recommended-skills tab.

- **Offense (1–2)**: controls how many canonical Offense elements define the core build premise.
  - Offense is sourced from `data/offense-inventory.json`.
  - Categories are Damage Type, Ailment, Scaling, and Archetype.
  - A build may roll at most one Archetype (`Minions/Companions`, `Totems`, or `Thorns`).
  - Cohesion, rather than pairwise compatibility gates, is the primary governor of conventional versus unusual Offense combinations.

Important: these controls are **“next roll” controls** — build snapshots/build codes represent the **build outcome**, not control settings.

---

## Build Snapshot / Build Code

Build codes are **snapshot-style**:
- They encode the rolled build (class/ascendancy, weapons, defenses, Offense, recommendations, etc.).
- Canonical Offense state uses `offense`, `offenseList`, `offenseSet`, and `offenseTags`.
- Legacy `ailment*` / `tactic*` snapshot fields remain temporarily populated as a compatibility boundary for the current recommendation engine and older build codes.
- They **do not** encode user control states (cohesion slider, Offense count, weapon-set toggle, bind-fates settings).
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

**Data**
- `data/core-data.json` — core build components and legacy rules.
- `data/offense-inventory.json` — canonical Build Offense vocabulary.
- `data/enriched/*.json` — enriched skills/passives/uniques used by the runtime.
- `data/datamined/*` — reference sources used for enrichment and future updates.

---

## Working Style (how to contribute)

- **Preserve user-facing behavior** unless explicitly asked to change it.
- Prefer **targeted, diff-friendly patches** over rewrites.
- Keep roll pipeline deterministic within a roll and robust to missing data.
- When removing features, remove the full stack (HTML/CSS/JS) and update docs accordingly.
