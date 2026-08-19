import {
  BUILD_CARD_FACES,
  ensureBuildCardUniqueData,
  hideBuildCardTooltip,
  mountBuildCardSnapshot
} from './23-build-card-foundation.js';

const STAGE_ID = 'primary-build-card-stage';
const MOUNT_ID = 'primary-build-card-mount';
const SNAPSHOT_EVENT = 'randomancer:build-snapshot-change';
const INITIAL_LIFT_MS = 190;
const INITIAL_REVEAL_MS = 620;
const REROLL_ADVANCE_MS = 390;
const REROLL_REVEAL_MS = 380;
const SAME_IDENTITY_FALLBACK_MS = 1200;
const ROLL_TIMEOUT_MS = 5000;

let bridgeInstalled = false;
let headerResizeObserver = null;
let uniqueHydrationKey = '';
let pendingRoll = null;
let pendingRollTimer = 0;
let revealTimer = 0;
let transitionCleanupTimer = 0;

function isBuildMode() {
  const mode = document.body?.dataset?.mode;
  return !mode || mode === 'build';
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function getCurrentSnapshot() {
  return window.App?.state?.currentRoll || window.CURRENT_ROLL || null;
}

function hasUsableBuild(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  return !!(
    snapshot.className ||
    snapshot.ascendancy ||
    snapshot.buildName ||
    snapshot.weapon
  );
}

function getBuildIdentity(snapshot) {
  if (!hasUsableBuild(snapshot)) return '';
  const s = snapshot || {};
  return JSON.stringify([
    s.buildName || '',
    s.className || '',
    s.ascendancy || '',
    s.weapon || '',
    s.offhand || '',
    s.weapon2 || '',
    s.offhand2 || '',
    Array.isArray(s.ailmentList) ? s.ailmentList : [],
    Array.isArray(s.tacticList) ? s.tacticList : [],
    s.defense || '',
    s.defStrat || ''
  ]);
}

function createStage() {
  let stage = document.getElementById(STAGE_ID);
  if (stage) return stage;

  const resultsStage = document.getElementById('results-stage');
  if (!resultsStage) return null;

  stage = document.createElement('section');
  stage.id = STAGE_ID;
  stage.className = 'primary-build-card-stage';
  stage.setAttribute('aria-label', 'Randomized Build Card');
  stage.innerHTML = `
    <div class="primary-build-card-stage__inner">
      <div class="primary-build-card-stage__slot">
        <div id="${MOUNT_ID}" class="primary-build-card-stage__mount" aria-live="polite"></div>
        <div class="primary-build-card-stage__transition-back" data-primary-transition-back aria-hidden="true"></div>
      </div>
    </div>
  `;
  resultsStage.prepend(stage);
  return stage;
}

function positionRollCluster() {
  const stage = document.getElementById(STAGE_ID);
  const resultsStage = document.getElementById('results-stage');
  const cluster = document.getElementById('roll')?.closest('.roll-sticky');
  if (!stage || !resultsStage || !cluster) return;

  if (isBuildMode()) {
    const slot = stage.querySelector('.primary-build-card-stage__slot');
    if (slot && cluster.parentElement !== stage.querySelector('.primary-build-card-stage__inner')) {
      slot.before(cluster);
    }
    return;
  }

  if (cluster.parentElement !== resultsStage) {
    stage.after(cluster);
  }
}

function getMount() {
  createStage();
  return document.getElementById(MOUNT_ID);
}

function renderDeck() {
  const stage = createStage();
  const mount = getMount();
  if (!stage || !mount) return;

  clearTransitionClasses();
  stage.dataset.cardState = 'empty';
  mount.dataset.cardFace = '';
  mount.classList.remove('is-dealing');
  mount.innerHTML = `
    <div class="primary-card-deck" aria-label="Face-down Randomancer card deck">
      <div class="primary-card-deck__card primary-card-deck__card--third" aria-hidden="true"></div>
      <div class="primary-card-deck__card primary-card-deck__card--second" aria-hidden="true"></div>
      <div class="primary-card-deck__card primary-card-deck__card--top"></div>
    </div>
  `;

  requestAnimationFrame(updateStageMetrics);
}

function isSavedBuild() {
  return document.getElementById('build-actions-save')?.dataset?.saved === '1';
}

function buildStatelessBuildLink(snapshot) {
  const code = window.RandomancerEncodeSnapshot?.(snapshot);
  if (!code) return '';

  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('build', code);
    return url.toString();
  } catch {
    const base = `${window.location.origin || ''}${window.location.pathname || '/'}`;
    return `${base}?build=${encodeURIComponent(code)}`;
  }
}

async function copyCurrentBuildLink() {
  const snapshot = getCurrentSnapshot();
  const url = buildStatelessBuildLink(snapshot);
  if (!url) {
    window.RandomancerShowToast?.('Build link could not be created.');
    return false;
  }

  const copied = await window.RandomancerCopyTextToClipboard?.(url);
  window.RandomancerShowToast?.(copied ? 'Build link copied.' : 'Could not copy build link.');
  return !!copied;
}

function renderCardActions() {
  const saved = isSavedBuild();
  return `
    <button type="button" class="icon-btn card-action-btn" data-card-action="poe-ninja" aria-label="Open in poe.ninja" title="Open in poe.ninja"><span aria-hidden="true">🥷</span></button>
    <button type="button" class="icon-btn card-action-btn${saved ? ' is-active' : ''}" data-card-action="save" aria-label="${saved ? 'Saved' : 'Save'}" title="${saved ? 'Saved' : 'Save'}" ${saved ? 'data-saved="1"' : ''}><span aria-hidden="true">${saved ? '★' : '☆'}</span></button>
    <button type="button" class="icon-btn card-action-btn" data-card-action="copy-link" aria-label="Copy Build Link" title="Copy Build Link"><span aria-hidden="true">🔗</span></button>
  `;
}

function handleCardAction(action) {
  if (action === 'poe-ninja') {
    document.getElementById('build-actions-poe')?.click();
    return;
  }
  if (action === 'save') {
    document.getElementById('build-actions-save')?.click();
    requestAnimationFrame(() => renderCurrentBuild({ animate: false }));
    return;
  }
  if (action === 'copy-link') {
    copyCurrentBuildLink();
  }
}

function retireLegacyBuildShareLauncher() {
  document.getElementById('build-open-card')?.remove();
}

function clearDealClass(mount) {
  window.setTimeout(() => mount?.classList.remove('is-dealing'), 720);
}

function getUniqueDataKey(snapshot) {
  const names = Array.isArray(snapshot?.recommendedUniques)
    ? snapshot.recommendedUniques
        .map((entry) => typeof entry === 'string' ? entry : entry?.name)
        .filter(Boolean)
        .slice(0, 3)
    : [];
  if (!names.length) return '';
  return [snapshot?.buildName || '', snapshot?.ascendancy || '', ...names].join('|');
}

function hydrateUniqueTooltips(snapshot) {
  const key = getUniqueDataKey(snapshot);
  if (!key || key === uniqueHydrationKey) return;
  uniqueHydrationKey = key;

  ensureBuildCardUniqueData().then((items) => {
    if (!items?.length || !isBuildMode() || pendingRoll) return;
    const current = getCurrentSnapshot();
    if (getUniqueDataKey(current) !== key) return;
    renderCurrentBuild({ animate: false });
  }).catch(() => {});
}

function renderCurrentBuild({ animate = false, forceFront = false, snapshot = null, suppressDeal = false } = {}) {
  const stage = createStage();
  const mount = getMount();
  if (!stage || !mount || !isBuildMode()) return;

  const current = snapshot || getCurrentSnapshot();
  if (!hasUsableBuild(current)) {
    renderDeck();
    return;
  }

  const hadResult = stage.dataset.cardState === 'result';
  const face = forceFront
    ? BUILD_CARD_FACES.FRONT
    : (mount.dataset.cardFace === BUILD_CARD_FACES.BACK ? BUILD_CARD_FACES.BACK : BUILD_CARD_FACES.FRONT);

  stage.dataset.cardState = 'result';
  const quote = getStageQuote();
  if (quote) quote.hidden = true;

  mount.classList.remove('is-dealing');
  mountBuildCardSnapshot(mount, current, {
    face,
    animate: false,
    actionsHtml: renderCardActions(),
    onAction: handleCardAction
  });

  if (!suppressDeal && (animate || !hadResult)) {
    void mount.offsetWidth;
    mount.classList.add('is-dealing');
    clearDealClass(mount);
  }

  hydrateUniqueTooltips(current);
  requestAnimationFrame(updateStageMetrics);
}

function emitSnapshotChanged(snapshot, source) {
  try {
    document.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT, {
      detail: { snapshot, source }
    }));
  } catch {}
}

function installSnapshotBridge() {
  if (bridgeInstalled) return true;
  const App = window.App;
  if (!App || App.__primaryCardStageSnapshotBridgeInstalled) return false;

  const originalMerge = typeof App.mergeCurrentRoll === 'function'
    ? App.mergeCurrentRoll.bind(App)
    : null;
  const originalReplace = typeof App.replaceCurrentRoll === 'function'
    ? App.replaceCurrentRoll.bind(App)
    : null;

  if (originalMerge) {
    App.mergeCurrentRoll = function mergeCurrentRollWithPrimaryCardSignal(partial) {
      const result = originalMerge(partial);
      emitSnapshotChanged(result, 'merge');
      return result;
    };
  }

  if (originalReplace) {
    App.replaceCurrentRoll = function replaceCurrentRollWithPrimaryCardSignal(snapshot) {
      const result = originalReplace(snapshot);
      emitSnapshotChanged(result, 'replace');
      return result;
    };
  }

  App.__primaryCardStageSnapshotBridgeInstalled = true;
  bridgeInstalled = true;
  return true;
}

function clearTransitionClasses() {
  const stage = createStage();
  stage?.classList.remove(
    'is-drawing',
    'is-rerolling',
    'is-revealing-first',
    'is-revealing-next'
  );
}

function clearPendingRoll() {
  pendingRoll = null;
  clearTransitionClasses();
  if (pendingRollTimer) {
    window.clearTimeout(pendingRollTimer);
    pendingRollTimer = 0;
  }
  if (revealTimer) {
    window.clearTimeout(revealTimer);
    revealTimer = 0;
  }
  if (transitionCleanupTimer) {
    window.clearTimeout(transitionCleanupTimer);
    transitionCleanupTimer = 0;
  }
}

function startRerollAdvance() {
  const stage = createStage();
  if (!pendingRoll || !stage || !pendingRoll.hadResult) return;
  stage.classList.add('is-rerolling');
  pendingRoll.advanceStartedAt = performance.now();
  maybeRevealPendingRoll();
}

function armDrawAnimation() {
  if (!isBuildMode()) return;

  if (pendingRoll) clearPendingRoll();
  hideBuildCardTooltip();

  const stage = createStage();
  const snapshot = getCurrentSnapshot();
  const hadResult = stage?.dataset?.cardState === 'result' && hasUsableBuild(snapshot);
  const now = performance.now();

  pendingRoll = {
    startedAt: now,
    startIdentity: getBuildIdentity(snapshot),
    latestSnapshot: null,
    latestSource: '',
    hadResult,
    advanceStartedAt: 0
  };

  if (prefersReducedMotion()) {
    pendingRoll.advanceStartedAt = now;
  } else if (!hadResult) {
    stage?.classList.add('is-drawing');
  } else {
    // Preserve whichever face the user is actually viewing. The outgoing card
    // simply tilts/recedes as-is; only the incoming card performs a reveal flip.
    startRerollAdvance();
  }

  pendingRollTimer = window.setTimeout(() => {
    if (!pendingRoll) return;
    const fallback = pendingRoll.latestSnapshot || getCurrentSnapshot();
    if (hasUsableBuild(fallback)) {
      revealPendingRoll(fallback);
    } else {
      clearPendingRoll();
    }
  }, ROLL_TIMEOUT_MS);
}

function pendingRollHasFreshSnapshot() {
  if (!pendingRoll || !hasUsableBuild(pendingRoll.latestSnapshot)) return false;
  const latestIdentity = getBuildIdentity(pendingRoll.latestSnapshot);
  if (latestIdentity && latestIdentity !== pendingRoll.startIdentity) return true;
  return (performance.now() - pendingRoll.startedAt) >= SAME_IDENTITY_FALLBACK_MS;
}

function minimumRevealAt() {
  if (!pendingRoll) return 0;
  if (prefersReducedMotion()) return pendingRoll.startedAt;
  if (!pendingRoll.hadResult) return pendingRoll.startedAt + INITIAL_LIFT_MS;
  const advanceAt = pendingRoll.advanceStartedAt || pendingRoll.startedAt;
  return advanceAt + REROLL_ADVANCE_MS;
}

function maybeRevealPendingRoll() {
  if (!pendingRoll || !pendingRollHasFreshSnapshot()) return;
  if (pendingRoll.hadResult && !prefersReducedMotion() && !pendingRoll.advanceStartedAt) return;

  const delay = Math.max(0, minimumRevealAt() - performance.now());
  if (revealTimer) window.clearTimeout(revealTimer);
  revealTimer = window.setTimeout(() => {
    revealTimer = 0;
    if (!pendingRoll || !pendingRollHasFreshSnapshot()) return;
    revealPendingRoll(pendingRoll.latestSnapshot);
  }, delay);
}

function revealPendingRoll(snapshot) {
  const stage = createStage();
  const mount = getMount();
  if (!stage || !mount || !hasUsableBuild(snapshot)) {
    clearPendingRoll();
    return;
  }

  const wasReroll = !!pendingRoll?.hadResult;
  const reduced = prefersReducedMotion();

  if (pendingRollTimer) {
    window.clearTimeout(pendingRollTimer);
    pendingRollTimer = 0;
  }
  if (revealTimer) {
    window.clearTimeout(revealTimer);
    revealTimer = 0;
  }

  pendingRoll = null;
  stage.classList.remove('is-drawing');

  if (reduced) {
    stage.classList.remove('is-rerolling', 'is-revealing-first', 'is-revealing-next');
    renderCurrentBuild({ animate: false, forceFront: true, snapshot });
    return;
  }

  if (!wasReroll) {
    // The top deck card has already lifted. Replace the deck with the generated
    // Build face without invoking the old deal animation, and use the explicit
    // transition-back sibling as the facedown reveal surface.
    stage.classList.remove('is-rerolling', 'is-revealing-next');
    stage.classList.add('is-revealing-first');
    renderCurrentBuild({ animate: false, forceFront: true, snapshot, suppressDeal: true });

    transitionCleanupTimer = window.setTimeout(() => {
      transitionCleanupTimer = 0;
      stage.classList.remove('is-revealing-first');
    }, INITIAL_REVEAL_MS + 60);
    return;
  }

  // The outgoing card has already moved aside and the separate card-back layer
  // is now centered. Mount the new Build face edge-on beneath it, then flip the
  // back away while the generated card rotates into view.
  stage.classList.add('is-revealing-next');
  renderCurrentBuild({ animate: false, forceFront: true, snapshot });

  transitionCleanupTimer = window.setTimeout(() => {
    transitionCleanupTimer = 0;
    stage.classList.remove('is-rerolling', 'is-revealing-next');
  }, REROLL_REVEAL_MS + 60);
}

function updateStageMetrics() {
  const stage = document.getElementById(STAGE_ID);
  if (!stage || !isBuildMode()) return;
  const top = Math.max(0, stage.getBoundingClientRect().top);
  const available = Math.max(520, window.innerHeight - top - 20);
  stage.style.setProperty('--primary-card-stage-space', `${Math.round(available)}px`);
}

function installHeaderObserver() {
  if (headerResizeObserver || typeof ResizeObserver !== 'function') return;
  const header = document.getElementById('app-header');
  if (!header) return;
  headerResizeObserver = new ResizeObserver(() => updateStageMetrics());
  headerResizeObserver.observe(header);
}

function syncMode() {
  const stage = createStage();
  if (!stage) return;
  positionRollCluster();
  const buildMode = isBuildMode();
  stage.setAttribute('aria-hidden', buildMode ? 'false' : 'true');
  if (!buildMode) {
    hideBuildCardTooltip();
    return;
  }
  renderCurrentBuild({ animate: false });
  requestAnimationFrame(updateStageMetrics);
}

function install() {
  createStage();
  positionRollCluster();
  installSnapshotBridge();
  installHeaderObserver();
  retireLegacyBuildShareLauncher();

  // Capture before the existing roll handler so the currently displayed card
  // starts its transition before generation mutates the canonical snapshot.
  document.getElementById('roll')?.addEventListener('click', armDrawAnimation, true);

  document.addEventListener(SNAPSHOT_EVENT, (event) => {
    if (!isBuildMode()) return;
    const snapshot = event.detail?.snapshot || getCurrentSnapshot();
    const source = event.detail?.source || '';

    if (pendingRoll) {
      if (hasUsableBuild(snapshot)) {
        pendingRoll.latestSnapshot = snapshot;
        pendingRoll.latestSource = source;
        maybeRevealPendingRoll();
      }
      return;
    }

    if (!hasUsableBuild(snapshot)) {
      renderDeck();
      return;
    }

    const forceFront = source === 'replace';
    renderCurrentBuild({ animate: forceFront, forceFront, snapshot });

    // Build-code/saved-build restoration updates the hidden legacy save button
    // immediately after replaceCurrentRoll(). Refresh one frame later so the
    // card star mirrors that canonical saved state as well.
    if (source === 'replace') {
      requestAnimationFrame(() => renderCurrentBuild({ animate: false, forceFront: true }));
    }
  });

  document.addEventListener('randomancer:mode-change', () => {
    clearPendingRoll();
    requestAnimationFrame(syncMode);
  });

  window.addEventListener('resize', updateStageMetrics, { passive: true });

  // The recommendation-contract module normally installs before this module.
  // Keep a short retry for unusual local/hot-reload ordering.
  if (!bridgeInstalled) {
    let attempts = 0;
    const retry = window.setInterval(() => {
      attempts += 1;
      if (installSnapshotBridge() || attempts >= 20) window.clearInterval(retry);
    }, 50);
  }

  syncMode();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

export {
  STAGE_ID,
  SNAPSHOT_EVENT,
  buildStatelessBuildLink,
  copyCurrentBuildLink,
  renderCurrentBuild,
  renderDeck,
  updateStageMetrics
};
