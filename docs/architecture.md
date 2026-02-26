# Randomancer Architecture

## Module Map (current layout)

**JavaScript (single entry: `core-script.js`)**
1. **`js/01-meta-and-domready.js`** — DOM helpers, selectors, formatting utilities, onDomReady.
2. **`js/00-locks-and-snapshots.js`** — build snapshot encode/decode, build-code apply, saved builds overlay.
3. **`js/02-summary-view.js`** — summary mode toggle + render + refresh hooks.
4. **`js/03-config-and-schema.js`** — schema guard, config resolution, lightweight rules enforcement hooks.
5. **`js/04-app-state.js`** — `window.App` state container, bootstrap, bind-fates storage.
6. **`js/05-tags-and-scorer.js`** — tag normalization + synergy scoring helpers.
7. **`js/06-cohesion.js`** — continuous cohesion threshold + “relax restrictions” safety net + build context helpers.
8. **`js/07-skills-render.js`** — skills render + passive recommendation rendering helpers.
9. **`js/08-data-load.js`** — JSON loaders + preload pipeline.
10. **`js/09-bind-fates-ui.js`** — bind-fates modal + cohesion slider wiring.
11. **`js/10-roll-engine.js`** — rollBuild pipeline + Weapon Set II (toggle-driven) generation + UI wiring.
12. **`js/11-pre-gate-and-sync.js`** — optional pre-gate loop + state→DOM sync helpers + IDF cache.
13. **`js/12-uniques-engine.js`** — uniques synergy engine + render helpers.
14. **`js/13-info-lightbox.js`** — info overlay controller.
15. **`js/14-feedback-menu.js`** — feedback + mobile header menu.

**CSS (split layers, aggregated by `styles.css`)**
- `css/00-base.css`
- `css/10-header.css`
- `css/20-controls.css`
- `css/30-sections.css`
- `css/40-skills.css`
- `css/50-passives.css`
- `css/60-uniques.css`
- `css/70-modals.css`
- `css/80-summary.css`
- `css/90-mobile.css`

## Initialization Flow
1. `core-script.js` imports all feature modules.
2. UI wiring happens via `onDomReady` hooks (controls, modals, menus).
3. Data preloading begins lazily via `ensureDataPreload()` and is shared across roll triggers.
4. Rolling updates DOM + summary view + saved-build/build-code UI.

## Public API Contract (window)
These globals are relied on by the app and should remain stable:
- `window.App`
- `window.rollBuild`
- `window.scheduleSummaryRefresh`
- `window.RandomancerEncodeSnapshot`
- `window.RandomancerApplyBuildCode`
- `window.RandomancerUpdateBuildCodeUI`
- `window.RandomancerRefreshUniques`
- `window.RandomancerRenderUniquesFromNames`
- `window.RandomancerInfo`
- `window.getOrBuildIDF`

## Data Sources
Runtime-loaded:
- `data/core-data.json`
- `data/enriched/passives_enriched.json`
- `data/enriched/skills_enriched.json`
- `data/enriched/uniques_enriched.json`

Reference / datamined (not necessarily used directly at runtime):
- `data/datamined/*`

## localStorage Keys
- `rm_view_mode`
- `randomancer_saved_builds_v1`
- `randomancer_single_entry`
