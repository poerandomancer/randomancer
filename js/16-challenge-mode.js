import { ensureDataPreload } from './08-data-load.js';
import { generateChallengeContract, loadChallengeLibrary } from './15-challenge-engine.js';

const MODE_KEY = 'randomancer_mode';
const MODES = {
  STANDARD: 'standard',
  CHALLENGE: 'challenge'
};
const SEVERITY_ORDER = ['mild', 'cruel', 'diabolical'];
let challengeHasRoll = false;
let challengeTaskCount = 2;
let challengeSeverity = 'cruel';

const STANDARD_LEDE_HTML = 'Tune <strong>Cohesion</strong> for tighter themes or wilder chaos. Use <strong>Bind the Fates</strong> to favor or ban certain options. Toggle <strong>Weapon Set II</strong> for an additional weapon set, and choose <strong>Combat Mechanics</strong>: 1-3 for ailment/tactic depth.<br><strong>---</strong><br>Click <strong>Roll Your Fate</strong> to begin.';
const CHALLENGE_LEDE_TEXT = '<strong>Challenge Mode</strong> rolls a <strong>Contract</strong>, not a build. Choose 1–3 <strong>Tasks</strong>, set <strong>Severity</strong> (Mild–Diabolical), then <strong>Roll Your Fate</strong> to receive a stacked set of constraints to overcome.<br><strong>---</strong><br>Click <strong>Roll Your Fate</strong> to begin.';

function stabilizeLedeHeight() {
  const lede = document.getElementById('app-lede');
  if (!lede) return;

  const previous = lede.innerHTML;
  const previousMinHeight = lede.style.minHeight;
  lede.style.minHeight = '';

  lede.innerHTML = STANDARD_LEDE_HTML;
  const standardHeight = lede.offsetHeight;

  lede.innerHTML = CHALLENGE_LEDE_TEXT;
  const challengeHeight = lede.offsetHeight;

  lede.innerHTML = previous;
  const targetHeight = Math.max(standardHeight, challengeHeight);
  lede.style.minHeight = `${targetHeight}px`;

  if (previousMinHeight && Number.parseFloat(previousMinHeight) > targetHeight) {
    lede.style.minHeight = previousMinHeight;
  }
}

function getMode() {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === MODES.CHALLENGE) return MODES.CHALLENGE;
  } catch {}
  return MODES.STANDARD;
}

function setMode(mode) {
  const next = mode === MODES.CHALLENGE ? MODES.CHALLENGE : MODES.STANDARD;
  try { localStorage.setItem(MODE_KEY, next); } catch {}
  try { document.dispatchEvent(new CustomEvent('randomancer:mode-change', { detail: { mode: next } })); } catch {}
  return next;
}

function setChallengeVisibility(active) {
  const standardControls = document.getElementById('standard-controls');
  const challengeControls = document.getElementById('challenge-controls');

  standardControls?.classList.toggle('is-hidden', active);
  challengeControls?.classList.toggle('is-hidden', !active);
}

function setHeaderLede(mode) {
  const lede = document.getElementById('app-lede');
  if (!lede) return;
  if (mode === MODES.CHALLENGE) {
    lede.innerHTML = CHALLENGE_LEDE_TEXT;
  } else {
    lede.innerHTML = STANDARD_LEDE_HTML;
  }
}

function setChallengePanels(active) {
  const challengePanel = document.getElementById('challenge-panel');
  const challengeDivider = document.getElementById('challenge-empty-divider');
  const challengeFlavor = document.getElementById('challenge-empty-flavor');
  const buildBanner = document.getElementById('build-roll-banner');
  const buildPanel = document.getElementById('build-panel');
  const skillsPanel = document.getElementById('skills-panel');
  const uniquesPanel = document.getElementById('uniques-panel');
  const passivesPanel = document.getElementById('passives-panel');
  const emptyState = document.getElementById('empty-state');
  const hasStandardRoll = document.getElementById('app')?.dataset?.hasRoll === 'true';

  const showChallengeEmpty = active && !challengeHasRoll;
  const showChallengePanel = active && challengeHasRoll;
  const showStandardEmpty = !active && !hasStandardRoll;

  challengePanel?.classList.toggle('is-hidden', !showChallengePanel);
  challengeDivider?.classList.toggle('is-hidden', !showChallengeEmpty);
  challengeFlavor?.classList.toggle('is-hidden', !showChallengeEmpty);
  buildBanner?.classList.toggle('is-hidden', active);
  buildPanel?.classList.toggle('is-hidden', active);
  skillsPanel?.classList.toggle('is-hidden', active);
  uniquesPanel?.classList.toggle('is-hidden', active);
  passivesPanel?.classList.toggle('is-hidden', active);

  if (emptyState) {
    emptyState.classList.toggle('is-hidden', !showStandardEmpty);
  }
}

function setChallengeFlavorLine() {
  const challengeFlavor = document.getElementById('challenge-empty-flavor');
  if (!challengeFlavor) return;
  const pool = Array.isArray(window.RandomancerIntroLines) ? window.RandomancerIntroLines : [];
  if (!pool.length) return;
  challengeFlavor.textContent = pool[Math.floor(Math.random() * pool.length)];
}

function renderChallengeContract(contract) {
  if (!contract || typeof contract !== 'object') return;
  const title = document.getElementById('challenge-contract-title');
  const subtitle = document.getElementById('challenge-contract-subtitle');
  const list = document.getElementById('challenge-contract-lines');

  if (title) title.textContent = contract.title;
  if (subtitle) subtitle.textContent = contract.subtitle;
  if (list) {
    list.innerHTML = '';
    contract.tasks.forEach(task => {
      const row = document.createElement('div');
      row.className = 'summary-row';

      const label = document.createElement('span');
      label.className = 'summary-label';
      label.textContent = String(task.shortLabel || task.role || 'Clause').toUpperCase();

      const dash = document.createElement('span');
      dash.textContent = ' — ';

      const content = document.createElement('span');
      content.className = 'summary-content';
      content.textContent = task.line;

      row.append(label, dash, content);
      list.appendChild(row);
    });
  }

  challengeHasRoll = true;
  window.CURRENT_CHALLENGE_CONTRACT = contract;
  try { document.dispatchEvent(new CustomEvent('randomancer:challenge-rendered')); } catch {}

  setChallengePanels(true);
}

function updateChallengeTaskButton() {
  const btn = document.getElementById('challenge-task-count-btn');
  if (!btn) return;
  btn.setAttribute('aria-label', `Tasks: ${challengeTaskCount}`);
  btn.querySelectorAll('.rm-dotstep__dot').forEach(dot => {
    const n = Number(dot.dataset.dot || 0);
    dot.classList.toggle('is-on', n <= challengeTaskCount);
  });
}

function titleCaseSeverity(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function updateChallengeSeverityButton() {
  const btn = document.getElementById('challenge-severity-btn');
  const text = document.getElementById('challenge-severity-value');
  if (btn) btn.setAttribute('aria-label', `Severity: ${titleCaseSeverity(challengeSeverity)}`);
  if (text) text.textContent = titleCaseSeverity(challengeSeverity);
}

function bindChallengeControls() {
  const taskBtn = document.getElementById('challenge-task-count-btn');
  const severityBtn = document.getElementById('challenge-severity-btn');

  taskBtn?.addEventListener('click', () => {
    challengeTaskCount = challengeTaskCount >= 3 ? 1 : challengeTaskCount + 1;
    updateChallengeTaskButton();
  });

  severityBtn?.addEventListener('click', () => {
    const idx = SEVERITY_ORDER.indexOf(challengeSeverity);
    challengeSeverity = SEVERITY_ORDER[(idx + 1) % SEVERITY_ORDER.length];
    updateChallengeSeverityButton();
  });

  updateChallengeTaskButton();
  updateChallengeSeverityButton();
}

async function handleChallengeRoll({ statusEl }) {
  await ensureDataPreload();
  const contract = await generateChallengeContract({ taskCount: challengeTaskCount, severity: challengeSeverity });

  renderChallengeContract(contract);
  if (statusEl) statusEl.textContent = '';
  return true;
}

function syncMode(mode) {
  const isChallenge = mode === MODES.CHALLENGE;
  const modeToggle = document.getElementById('randomancer-mode-toggle');
  const modeToggleControl = document.getElementById('randomancer-mode-control');
  const app = document.getElementById('app');

  document.body?.classList.toggle('challenge-mode', isChallenge);
  setHeaderLede(mode);
  setChallengeVisibility(isChallenge);
  setChallengePanels(isChallenge);

  if (app) {
    app.classList.remove('mode-content-fade');
    void app.offsetWidth;
    app.classList.add('mode-content-fade');
  }

  if (modeToggle) modeToggle.checked = isChallenge;
  modeToggleControl?.classList.toggle('is-challenge', isChallenge);
}

document.addEventListener('DOMContentLoaded', async () => {
  const modeToggle = document.getElementById('randomancer-mode-toggle');
  const initialMode = getMode();

  stabilizeLedeHeight();
  setChallengeFlavorLine();
  bindChallengeControls();
  syncMode(initialMode);
  try { document.dispatchEvent(new CustomEvent('randomancer:mode-change', { detail: { mode: initialMode } })); } catch {}

  window.addEventListener('resize', stabilizeLedeHeight);

  modeToggle?.addEventListener('change', event => {
    const nextMode = setMode(event.target?.checked ? MODES.CHALLENGE : MODES.STANDARD);
    syncMode(nextMode);
  });

  try {
    await loadChallengeLibrary();
  } catch {}
});

window.RandomancerHandleRollOverride = async ({ statusEl }) => {
  if (getMode() !== MODES.CHALLENGE) return false;

  try {
    if (statusEl) statusEl.textContent = 'Forging your contract…';
    await handleChallengeRoll({ statusEl });
  } catch (err) {
    console.error('[Randomancer][Challenge] roll failed', err);
    if (statusEl) statusEl.textContent = 'Challenge generation failed. Try again.';
  }
  return true;
};

window.RandomancerRenderChallengeContract = (contract) => {
  renderChallengeContract(contract);
};

window.RandomancerSetMode = (mode) => {
  const next = setMode(mode);
  syncMode(next);
  return next;
};
