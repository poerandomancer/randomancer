# Randomancer Architecture (Refactor Notes)

## Module Map (current layout)

**JavaScript (single entry: `core-script.js`)**
1. **`js/01-meta-and-domready.js`** — selectors, DOM helpers, onDomReady, shared helpers, smoke check.
2. **`js/00-locks-and-snapshots.js`** — lock state, build code encode/decode, saved builds overlay.
3. **`js/02-summary-view.js`** — summary toggle, summary render, auto-refresh hooks.
4. **`js/03-config-and-schema.js`** — data schema guard, config resolution, rules enforcement scaffold.
5. **`js/04-app-state.js`** — `window.App` state container, bootstrap, cohesion setters, state capture.
6. **`js/05-tags-and-scorer.js`** — tag normalization, scorer install, IDF setup helpers, dictionaries.
7. **`js/06-cohesion.js`** — cohesion modes, thresholds, build context helpers.
8. **`js/07-skills-render.js`** — passives constellation render, skills cards, persistent buff render.
9. **`js/08-data-load.js`** — JSON loaders + preload pipeline.
10. **`js/09-bind-fates-ui.js`** — bind-fates modal + cohesion slider wiring.
11. **`js/10-roll-engine.js`** — rollBuild + weapon set II + roll button wiring.
12. **`js/11-pre-gate-and-sync.js`** — pre-gate + state→DOM sync + IDF cache.
13. **`js/12-uniques-engine.js`** — uniques synergy engine.
14. **`js/13-info-lightbox.js`** — info lightbox controller.
15. **`js/14-feedback-menu.js`** — feedback link + mobile header menu.

**CSS (split into ordered layers, aggregated by `styles.css`)**
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
1. `core-script.js` loads and registers helpers, state, and UI wiring.
2. `onDomReady` hooks wire UI events, bind fates modal, and saved builds overlay.
3. Data preloading begins via `ensureDataPreload()` and `loadData()` when needed.
4. `window.App.bootstrap()` hydrates app state and config, then rolls/builds as requested.
5. Roll flows update DOM, summary view, and build code UI in-place.

## Public API Contract (window)
The following globals are part of the contract and must remain intact:
- `window.App` (state + methods)
- `window.rollBuild`
- `window.scheduleSummaryRefresh`
- `window.RandomancerEncodeSnapshot`
- `window.RandomancerApplyBuildCode`
- `window.RandomancerUpdateBuildCodeUI`
- `window.RandomancerRefreshUniques`
- `window.RandomancerRenderUniquesFromNames`
- `window.RandomancerInfo`
- `window.getOrBuildIDF`
- `window.__LOCK_STATE__` handling (`getLockState`/`setLockState`/`DEFAULT_LOCKS` behavior)

## Data Sources (loaded at runtime)
- `data/core-data.json`
- `data/enriched/passives_enriched.json`
- `data/enriched/skills_enriched.json`
- `data/enriched/uniques_enriched.json`

## localStorage Keys
- `rm_view_mode`
- `randomancer_saved_builds_v1`
- `randomancer_single_entry`
