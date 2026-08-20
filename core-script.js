/*! Randomancer */
"use strict";

/**
 * Module Map + Public API
 * 1) 01-meta-and-domready: selectors, DOM helpers, onDomReady, shared helpers, smoke check.
 * 2) 00-locks-and-snapshots: snapshots/build codes/saved builds.
 * 3) 02-summary-view: Build Card overlay + public share behavior.
 * 4) 03-config-and-schema: Schema/Config/RulesEngine scaffolding.
 * 5) 04-app-state: window.App, bootstrap, and canonical draw state.
 * 6) 05-tags-and-scorer: tag normalization + scorer glue + dictionary builders.
 * 7) 06-equipment: weapon families and hard equipment compatibility.
 * 10) 07-skills-render: passives + skills render helpers.
 * 11) 08-data-load: JSON loaders + preload pipeline.
 * 12) 09-bind-fates-ui: Bind the Fates controls.
 * 13) 10-roll-engine: direct standard Build draw engine.
 * 14) 11-pre-gate-and-sync: pre-gate + state→DOM sync + IDF cache.
 * 15) 12-uniques-engine: uniques synergy engine.
 * 16) 13-info-lightbox: info overlay controller.
 * 17) 14-feedback-menu: feedback + mobile header menu.
 * 18) 17-skill-family-utils: skill family library resolver + tag-query helpers.
 * 19) 15-challenge-engine: challenge contract generation + compatibility rules.
 * 20) 16-challenge-mode: mode toggle, challenge roll routing, contract rendering.
 * 22) 23-build-card-foundation: reusable Build Card model/render/flip/tooltip layer.
 * 23) 24-primary-card-stage: persistent in-page Build deck/card presentation.
 * 24) 25-card-polish: compact copied links + primary-card tooltip polish.
 * 25) 26-offense-roll: canonical Offense selection + snapshot compatibility helpers.
 * 26) 30-recommendation-v3-selector: pure obligation and primary-skill package selector.
 *
 * Public window exports (must remain available):
 * window.App, window.drawBuild, window.scheduleSummaryRefresh, window.RandomancerEncodeSnapshot,
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
import './js/06-equipment.js';
import './js/06-build-context.js';
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
import './js/23-build-card-foundation.js';
import './js/24-primary-card-stage.js';
import './js/25-card-polish.js';
import './js/26-offense-roll.js';

import './js/20-trending-cards.js';
