# Randomancer Architecture (Refactor Notes)

## Module Map (current layout)

**JavaScript (single entry: `core-script.js`)**
1. **Locks + Build Codes + Saved Builds** — lock state, build code encode/decode, saved builds overlay.
2. **Summary View** — summary toggle, summary render, auto-refresh hooks.
3. **Config + Schema + Rules Engine** — data schema guard, config resolution, rules enforcement scaffold.
4. **App State** — `window.App` state container, bootstrap, cohesion setters, state capture.
5. **Tags + Scoring Helpers** — tag normalization, scorer install, IDF setup helpers.
6. **Passives + Skills Render** — passives constellation render, skills cards, persistent buff render.
7. **Data Load + Bind Fates UI** — JSON loaders, preloading, bind-fates modal wiring.
8. **Roll Engine + Sync** — roll pipeline, UI sync, pre-gate state wrapper.
9. **Uniques + Info/Feedback** — uniques synergy engine, info lightbox, feedback/menu UI.

**CSS (split into ordered layers, aggregated by `styles.css`)**
- `css/00-base.css`
- `css/10-header.css`
- `css/20-controls.css`
- `css/30-sections.css`
- `css/40-skills.css`
- `css/60-uniques.css`
- `css/50-passives.css`
- `css/90-mobile.css`
- `css/70-modals.css`
- `css/80-summary.css`

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

## localStorage Keys
- `rm_view_mode`
- `randomancer_saved_builds_v1`
- `randomancer_single_entry`
