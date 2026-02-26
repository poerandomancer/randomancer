const prefersReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  isRevealing: false,
  timers: new Set(),
  maxWaitTimer: null,
  tracerEl: null,
  triggerEl: null,
  activeNodes: []
};

function isReducedMotion() {
  return !!prefersReduceMotion.matches;
}

function wait(ms) {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      state.timers.delete(id);
      resolve();
    }, ms);
    state.timers.add(id);
  });
}

function clearTimers() {
  state.timers.forEach((id) => clearTimeout(id));
  state.timers.clear();
}

function getRevealNodes(mode) {
  if (mode === 'challenge') {
    return [
      document.querySelector('#challenge-panel .build-title-block'),
      document.getElementById('challenge-contract-lines')
    ].filter(Boolean);
  }
  return [
    document.querySelector('#build-panel [data-reveal="title"]'),
    document.querySelector('#build-panel [data-reveal="archetype"]'),
    document.querySelector('#build-panel [data-reveal="mechanics"]'),
    document.querySelector('#build-panel [data-reveal="defenses"]'),
    document.getElementById('skills-panel'),
    document.getElementById('passives-panel'),
    document.getElementById('uniques-panel')
  ].filter((node) => node && !node.classList.contains('hidden'));
}

function createTracer(triggerEl) {
  if (!triggerEl) return;
  const rect = triggerEl.getBoundingClientRect();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'roll-btn-tracer');
  svg.setAttribute('viewBox', `0 0 ${Math.max(rect.width, 120)} ${Math.max(rect.height, 42)}`);

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const cx = Math.max(rect.width, 120) / 2;
  const cy = Math.max(rect.height, 42) / 2;
  const r = Math.max(14, Math.min(cx, cy) - 3);
  const len = 2 * Math.PI * r;
  svg.style.setProperty('--ring-length', `${len}`);
  circle.setAttribute('cx', `${cx}`);
  circle.setAttribute('cy', `${cy}`);
  circle.setAttribute('r', `${r}`);
  svg.appendChild(circle);
  triggerEl.appendChild(svg);
  state.tracerEl = svg;
}

function shouldScroll(anchor) {
  if (!anchor) return false;
  const rect = anchor.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.top > vh * 0.35 || rect.bottom < 0;
}

async function scrollToResults() {
  const anchor = document.getElementById('buildTop') || document.getElementById('build-panel');
  if (!anchor || !shouldScroll(anchor)) return;

  if (isReducedMotion()) {
    anchor.scrollIntoView({ behavior: 'auto', block: 'start' });
    return;
  }

  anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await wait(420);
}

function finalizeReveal() {
  const app = document.getElementById('app');
  app?.classList.remove('is-revealing');

  state.activeNodes.forEach((node) => {
    node.classList.remove('reveal-hidden', 'reveal-in', 'reveal-shuffle');
  });

  const title = document.querySelector('.build-title-block');
  title?.classList.remove('reveal-flourish');

  if (state.tracerEl) {
    state.tracerEl.remove();
    state.tracerEl = null;
  }

  state.isRevealing = false;
  state.triggerEl = null;
}

function skipReveal() {
  if (!state.isRevealing) return false;
  clearTimers();
  finalizeReveal();
  return true;
}

async function startReveal({ triggerEl, mode = 'build' } = {}) {
  if (state.isRevealing) return;
  const app = document.getElementById('app');
  state.isRevealing = true;
  state.triggerEl = triggerEl || null;
  state.activeNodes = getRevealNodes(mode);

  if (isReducedMotion()) {
    await scrollToResults();
    finalizeReveal();
    return;
  }

  app?.classList.add('is-revealing');
  createTracer(triggerEl);

  state.activeNodes.forEach((node) => {
    node.classList.add('reveal-hidden');
    node.classList.add('reveal-shuffle');
  });

  await scrollToResults();
  if (!state.isRevealing) return;

  await wait(320);
  if (!state.isRevealing) return;

  state.activeNodes.forEach((node) => node.classList.remove('reveal-shuffle'));

  const base = 170;
  state.activeNodes.forEach((node, idx) => {
    const id = setTimeout(() => {
      state.timers.delete(id);
      node.classList.remove('reveal-hidden');
      node.classList.add('reveal-in');
    }, idx * base);
    state.timers.add(id);
  });

  const total = state.activeNodes.length * base + 280;
  await wait(total);
  if (!state.isRevealing) return;

  const title = document.querySelector(mode === 'challenge' ? '#challenge-panel .build-title-block' : '#build-panel .build-title-block');
  title?.classList.add('reveal-flourish');
  await wait(220);
  title?.classList.remove('reveal-flourish');
  finalizeReveal();
}

function handleSkipInput(event) {
  if (!state.isRevealing) return;
  if (event.code !== 'Space') return;
  event.preventDefault();
  skipReveal();
}

document.addEventListener('keydown', handleSkipInput, { passive: false });

window.RandomancerRevealController = {
  startReveal,
  skipReveal,
  isRevealing: () => state.isRevealing,
  isReducedMotion
};

function syncActionBarOffset() {
  const bar = document.getElementById('actionBar');
  if (!bar) return;
  const h = Math.ceil(bar.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--action-bar-offset', `${h}px`);
}

document.addEventListener('DOMContentLoaded', () => {
  syncActionBarOffset();
  window.addEventListener('resize', syncActionBarOffset, { passive: true });
});
