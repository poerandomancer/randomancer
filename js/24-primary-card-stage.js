import {
  BUILD_CARD_FACES,
  hideBuildCardTooltip,
  mountBuildCardSnapshot
} from './23-build-card-foundation.js';

const STAGE_ID = 'primary-build-card-stage';
const MOUNT_ID = 'primary-build-card-mount';
const SNAPSHOT_EVENT = 'randomancer:build-snapshot-change';

let pendingDraw = false;
let pendingDrawTimer = 0;
let bridgeInstalled = false;
let headerResizeObserver = null;

function isBuildMode() {
  const mode = document.body?.dataset?.mode;
  return !mode || mode === 'build';
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

function pickIntroLine() {
  const lines = Array.isArray(window.RandomancerIntroLines)
    ? window.RandomancerIntroLines.filter(Boolean)
    : [];
  if (!lines.length) return 'The Fates Await...';
  return lines[Math.floor(Math.random() * lines.length)];
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
      <p class="primary-build-card-stage__quote" data-primary-card-quote></p>
      <div id="${MOUNT_ID}" class="primary-build-card-stage__mount" aria-live="polite"></div>
    </div>
  `;
  resultsStage.prepend(stage);
  return stage;
}

function getMount() {
  createStage();
  return document.getElementById(MOUNT_ID);
}

function getStageQuote() {
  return createStage()?.querySelector('[data-primary-card-quote]') || null;
}

function renderDeck() {
  const stage = createStage();
  const mount = getMount();
  if (!stage || !mount) return;

  stage.dataset.cardState = 'empty';
  mount.dataset.cardFace = '';
  mount.classList.remove('is-dealing');
  mount.innerHTML = `
    <div class="primary-card-deck" aria-label="Face-down Randomancer card deck">
      <div class="primary-card-deck__card primary-card-deck__card--third" aria-hidden="true"></div>
      <div class="primary-card-deck__card primary-card-deck__card--second" aria-hidden="true"></div>
      <div class="primary-card-deck__card primary-card-deck__card--top">
        <span class="primary-card-deck__ornament" aria-hidden="true">✦</span>
        <span class="primary-card-deck__mark" aria-hidden="true">R</span>
        <span class="primary-card-deck__ornament primary-card-deck__ornament--bottom" aria-hidden="true">✦</span>
      </div>
    </div>
  `;

  const quote = getStageQuote();
  if (quote) {
    if (!quote.textContent.trim()) quote.textContent = pickIntroLine();
    quote.hidden = false;
  }
  requestAnimationFrame(updateStageMetrics);
}

function isSavedBuild() {
  return document.getElementById('build-actions-save')?.dataset?.saved === '1';
}

function renderCardActions() {
  const saved = isSavedBuild();
  return `
    <button type="button" class="icon-btn card-action-btn" data-card-action="poe-ninja" aria-label="Open in poe.ninja" title="Open in poe.ninja"><span aria-hidden="true">🥷</span></button>
    <button type="button" class="icon-btn card-action-btn${saved ? ' is-active' : ''}" data-card-action="save" aria-label="${saved ? 'Saved' : 'Save'}" title="${saved ? 'Saved' : 'Save'}" ${saved ? 'data-saved="1"' : ''}><span aria-hidden="true">${saved ? '★' : '☆'}</span></button>
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
  }
}

function clearDealClass(mount) {
  window.setTimeout(() => mount?.classList.remove('is-dealing'), 720);
}

function renderCurrentBuild({ animate = false } = {}) {
  const stage = createStage();
  const mount = getMount();
  if (!stage || !mount || !isBuildMode()) return;

  const snapshot = getCurrentSnapshot();
  if (!hasUsableBuild(snapshot)) {
    renderDeck();
    return;
  }

  const hadResult = stage.dataset.cardState === 'result';
  const face = mount.dataset.cardFace === BUILD_CARD_FACES.BACK
    ? BUILD_CARD_FACES.BACK
    : BUILD_CARD_FACES.FRONT;

  stage.dataset.cardState = 'result';
  const quote = getStageQuote();
  if (quote) quote.hidden = true;

  mount.classList.remove('is-dealing');
  mountBuildCardSnapshot(mount, snapshot, {
    face,
    animate: false,
    actionsHtml: renderCardActions(),
    onAction: handleCardAction
  });

  if (animate || !hadResult) {
    void mount.offsetWidth;
    mount.classList.add('is-dealing');
    clearDealClass(mount);
  }

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

function armDrawAnimation() {
  if (!isBuildMode()) return;
  pendingDraw = true;
  if (pendingDrawTimer) window.clearTimeout(pendingDrawTimer);
  pendingDrawTimer = window.setTimeout(() => {
    pendingDraw = false;
    pendingDrawTimer = 0;
  }, 5000);
}

function consumeDrawAnimation(source) {
  const stage = createStage();
  const firstResult = stage?.dataset?.cardState !== 'result';
  const shouldAnimate = pendingDraw || firstResult || source === 'replace';
  pendingDraw = false;
  if (pendingDrawTimer) {
    window.clearTimeout(pendingDrawTimer);
    pendingDrawTimer = 0;
  }
  return shouldAnimate;
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
  installSnapshotBridge();
  installHeaderObserver();

  // Run before the existing roll button's bubble handlers so the first core
  // snapshot update knows this was an intentional draw/reroll.
  document.getElementById('roll')?.addEventListener('click', armDrawAnimation, true);

  document.addEventListener(SNAPSHOT_EVENT, (event) => {
    if (!isBuildMode()) return;
    const snapshot = event.detail?.snapshot || getCurrentSnapshot();
    if (!hasUsableBuild(snapshot)) {
      renderDeck();
      return;
    }

    const source = event.detail?.source || '';
    renderCurrentBuild({ animate: consumeDrawAnimation(source) });

    // Build-code/saved-build restoration updates the hidden legacy save button
    // immediately after replaceCurrentRoll(). Refresh one frame later so the
    // card star mirrors that canonical saved state as well.
    if (source === 'replace') {
      requestAnimationFrame(() => renderCurrentBuild({ animate: false }));
    }
  });

  document.addEventListener('randomancer:mode-change', () => {
    pendingDraw = false;
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
  renderCurrentBuild,
  renderDeck,
  updateStageMetrics
};
