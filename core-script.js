/*! Randomancer */
"use strict";

/**
 * Runtime modules and their current responsibilities:
 * - metadata/DOM readiness and snapshot/save/build-code compatibility;
 * - summary overlays, canonical App state, equipment and recommendation context;
 * - passive/skill presentation, data preload, Bind the Fates, and direct Build draws;
 * - current unique presentation, information/feedback controls, Challenge, and Codex;
 * - Build Ideas card rendering, animation, tooltips, and canonical Offense handling.
 *
 * Public window exports used by current cross-module and inline UI integration:
 * window.App, window.drawBuild, window.scheduleSummaryRefresh, window.RandomancerEncodeSnapshot,
 * window.RandomancerApplyBuildCode, window.RandomancerUpdateBuildCodeUI,
 * window.RandomancerRefreshUniques, window.RandomancerRenderUniquesFromNames,
 * window.RandomancerInfo, window.RandomancerBuildCard.
 */

import './js/01-meta-and-domready.js';
import './js/00-locks-and-snapshots.js';
import './js/02-summary-view.js';
import './js/04-app-state.js';
import './js/06-equipment.js';
import './js/06-build-context.js';
import './js/07-skills-render.js';
import './js/08-data-load.js';
import './js/09-bind-fates-ui.js';
import './js/10-roll-engine.js';
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
