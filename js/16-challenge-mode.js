import { ensureDataPreload } from './08-data-load.js';
import { generateChallengeContract, loadChallengeLibrary } from './15-challenge-engine.js';

const MODE_KEY = 'randomancer_mode';
const MODES = {
  STANDARD: 'standard',
  CHALLENGE: 'challenge'
};

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
  return next;
}

function setChallengeVisibility(active) {
  const standardControls = document.getElementById('standard-controls');
  const challengeControls = document.getElementById('challenge-controls');

  standardControls?.classList.toggle('is-hidden', active);
  challengeControls?.classList.toggle('is-hidden', !active);
}

function setChallengePanels(active) {
  const challengePanel = document.getElementById('challenge-panel');
  const buildBanner = document.getElementById('build-roll-banner');
  const buildPanel = document.getElementById('build-panel');
  const skillsPanel = document.getElementById('skills-panel');
  const uniquesPanel = document.getElementById('uniques-panel');
  const passivesPanel = document.getElementById('passives-panel');

  challengePanel?.classList.toggle('is-hidden', !active);
  buildBanner?.classList.toggle('is-hidden', active);
  buildPanel?.classList.toggle('is-hidden', active);
  skillsPanel?.classList.toggle('is-hidden', active);
  uniquesPanel?.classList.toggle('is-hidden', active);
  passivesPanel?.classList.toggle('is-hidden', active);
}

function renderChallengeContract(contract) {
  const appEl = document.getElementById('app');
  const emptyState = document.getElementById('empty-state');

  const title = document.getElementById('challenge-contract-title');
  const subtitle = document.getElementById('challenge-contract-subtitle');
  const list = document.getElementById('challenge-contract-lines');

  if (title) title.textContent = contract.title;
  if (subtitle) subtitle.textContent = contract.subtitle;
  if (list) {
    list.innerHTML = '';
    contract.tasks.forEach(task => {
      const li = document.createElement('li');
      li.textContent = task.line;
      list.appendChild(li);
    });
  }

  if (appEl) appEl.dataset.hasRoll = 'true';
  if (emptyState) emptyState.classList.add('is-hidden');

  setChallengePanels(true);
}

async function handleChallengeRoll({ rollBtn, statusEl }) {
  const count = Number(document.getElementById('challenge-task-count')?.value || 2);
  const severity = document.getElementById('challenge-severity')?.value || 'cruel';

  await ensureDataPreload();
  const contract = await generateChallengeContract({ taskCount: count, severity });

  renderChallengeContract(contract);
  if (statusEl) statusEl.textContent = '';
  return true;
}

function syncMode(mode) {
  const isChallenge = mode === MODES.CHALLENGE;
  setChallengeVisibility(isChallenge);
  setChallengePanels(isChallenge);

  const emptyState = document.getElementById('empty-state');
  if (emptyState) {
    if (isChallenge) {
      emptyState.classList.add('is-hidden');
    } else {
      const hasRoll = document.getElementById('app')?.dataset?.hasRoll === 'true';
      emptyState.classList.toggle('is-hidden', hasRoll);
    }
  }

  document.querySelectorAll('input[name="randomancer-mode"]').forEach(radio => {
    radio.checked = radio.value === mode;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const radios = Array.from(document.querySelectorAll('input[name="randomancer-mode"]'));
  const initialMode = getMode();

  syncMode(initialMode);

  radios.forEach(radio => {
    radio.addEventListener('change', event => {
      const nextMode = setMode(event.target?.value || MODES.STANDARD);
      syncMode(nextMode);
    });
  });

  try {
    await loadChallengeLibrary();
  } catch {}
});

window.RandomancerHandleRollOverride = async ({ rollBtn, statusEl }) => {
  if (getMode() !== MODES.CHALLENGE) return false;

  try {
    if (statusEl) statusEl.textContent = 'Forging your contract…';
    await handleChallengeRoll({ rollBtn, statusEl });
  } catch (err) {
    console.error('[Randomancer][Challenge] roll failed', err);
    if (statusEl) statusEl.textContent = 'Challenge generation failed. Try again.';
  }
  return true;
};
