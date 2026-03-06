# The Randomancer — PoE2 Build Randomizer

**The Randomancer** is a single-page, front-end web app that generates themed, semi-cohesive **Path of Exile 2** build ideas. It’s designed to be **fun and inspirational**—not a simulator—using lightweight rules and synergy scoring to avoid obviously broken combinations while still embracing chaos.

Live site: https://therandomancer.com/

---

## What it does

When you click **Roll Your Fate**, The Randomancer generates a build “archetype” and supporting recommendations, including:

- Class / Ascendancy theme
- Weapon setup (optionally including a **Weapon Set II** alternate setup)
- Defensive strategy
- Combat mechanics (ailments + tactics)
- Recommended active skills + suggested supports
- Recommended passives
- Recommended uniques (when applicable)

The output is meant to inspire build concepts you can refine in-game—not to replace real planning tools.

---

## Core controls (next-roll controls)

The control panel affects your **next roll**:

- **Cohesion**  
  A continuous threshold that biases rolls toward **tighter themes** (higher cohesion) or **wilder chaos** (lower cohesion).  
  The roll engine includes a safety net that relaxes restrictions when needed to avoid dead ends.

- **Bind the Fates**  
  Oath (prefer) or Abominate (ban) options for the next roll—useful for steering the generator without hard-locking sections.

- **Weapon Set II**  
  When enabled, the generator rolls an **alternate weapon setup** and unlocks a second Skills tab for that setup.

- **Combat Mechanics (1–3)**  
  Controls how many mechanics (ailments + tactics) the build leans into.

---

## Build codes & saved builds (snapshot-only)

The Randomancer supports sharing and restoring builds via **build codes** / **saved builds**.

Important: build codes are **snapshots of the rolled build only**.  
They do **not** store or restore control settings (cohesion value, bind-fates selections, weapon set toggle state, combat mechanics setting, etc.). Loading a build code should render the build without changing your current controls.

Saved builds are stored locally in your browser (via `localStorage`).

---

## Project structure

This repo is a front-end project (no server required).

### Key files
- `index.html` — main single-page layout
- `styles.css` — aggregated styles
- `core-script.js` — main JS entrypoint that imports modules from `/js/`
- `/css/` — layered styling files
- `/js/` — modular JS system
- `/data/` — runtime JSON datasets

### Data sources
Runtime JSON:
- `data/core-data.json`
- `data/enriched/skills_enriched.json`
- `data/enriched/passives_enriched.json`
- `data/enriched/uniques_enriched.json`

Datamined/reference sources live under `data/datamined/` and are used for enrichment and future updates.

---


## Data pipeline (Phase 1)

A new staged data-pipeline scaffold is available with a single entrypoint:

- `python scripts/pipeline/run_pipeline.py`

It introduces explicit `raw -> normalized -> canonical -> enriched -> runtime` boundaries and generates pipeline/validation reports in `data/reports/` while preserving current enriched outputs for app compatibility.

See `docs/data-pipeline.md` for details and scope notes for this phase.

## Development Notes
- Preserve user-facing behavior unless intentionally changing UX.
- Prefer small, surgical patches over rewrites.
- Keep roll output robust: if cohesion or constraints make a roll too tight, the engine should degrade gracefully rather than fail.

---

## Disclaimer
Path of Exile 2 and related assets are trademarks of Grinding Gear Games.
This project is a fan-made tool and is not affiliated with or endorsed by Grinding Gear Games.