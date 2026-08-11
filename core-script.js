/*! Randomancer */
"use strict";

/**
 * Module Map + Public API
 * 1) 01-meta-and-domready: selectors, DOM helpers, onDomReady, shared helpers, smoke check.
 * 2) 00-locks-and-snapshots: snapshots/build codes/saved builds.
 * 3) 02-summary-view: legacy card overlay + public share behavior.
 * 4) 03-config-and-schema: Schema/Config/RulesEngine scaffolding.
 * 5) 04-app-state: window.App, bootstrap, cohesion state helpers.
 * 6) 05-tags-and-scorer: tag normalization + scorer glue + dictionary builders.
 * 7) 06-cohesion: continuous threshold + relax safety net.
 * 8) 07-skills-render: passives + skills render helpers.
 * 9) 08-data-load: JSON loaders + preload pipeline.
 * 10) 09-bind-fates-ui: bind fates modal + cohesion slider wiring.
 * 11) 10-roll-engine: rollBuild + WS2 toggle plumbing.
 * 12) 11-pre-gate-and-sync: pre-gate + state→DOM sync + IDF cache.
 * 13) 12-uniques-engine: uniques synergy engine.
 * 14) 13-info-lightbox: info overlay controller.
 * 15) 14-feedback-menu: feedback + mobile header menu.
 * 16) 17-skill-family-utils: skill family library resolver + tag-query helpers.
 * 17) 15-challenge-engine: challenge contract generation + compatibility rules.
 * 18) 16-challenge-mode: mode toggle, challenge roll routing, contract rendering.
 * 19) 22-recommendation-contract: simplified Build recommendation boundary.
 * 20) 23-build-card-foundation: reusable Build Card model/render/flip/tooltip layer.
 *
 * Public window exports (must remain available):
 * window.App, window.rollBuild, window.scheduleSummaryRefresh, window.RandomancerEncodeSnapshot,
 * window.RandomancerApplyBuildCode, window.RandomancerUpdateBuildCodeUI,
 * window.RandomancerRefreshUniques, window.RandomancerRenderUniquesFromNames,
 * window.RandomancerInfo, window.getOrBuildIDF, window.RandomancerBuildCard,
 */

import './js/01-meta-and-domready.js';
import './js/00-locks-and-snapshots.js';
import './js/02-summary-view.js';
import './js/03-config-and-schema.js';
import './js/04-app-state.js';
import './js/05-tags-and-scorer.js';
import './js/06-cohesion.js';
import './js/07-skills-render.js';
import './js/08-data-load.js';
import './js/09-bind-fates-ui.js';
import './js/10-roll-engine.js';
import './js/11-pre-gate-and-sync.js';
import './js/12-uniques-engine.js';
import './js/13-info-lightbox.js';
import './js/14-feedback-menu.js';
import './js/17-skill-family-utils.js';
import './js/15-challenge-engine.js';
import './js/16-challenge-mode.js';
import './js/18-codex-mode.js';
import './js/21-legacy-mode.js';
import './js/22-recommendation-contract.js';
import './js/23-build-card-foundation.js';

import './js/20-trending-cards.js';
