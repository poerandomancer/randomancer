// === v0.7.3 selector helpers & metrics ===
const Selectors = {
  weapon: '#weapons',
  offhands: ['#offhand', '#off_hand', '#off', '#offHand'],
  defense: '#defense',
  defstrat: '#defstrat',
  tactics: '#tactics',
  ailments: '#ailments'
};
function firstText(selectors){
  if (typeof selectors === 'string') return (document.querySelector(selectors)?.textContent || '').trim();
  for (const s of selectors){ const el = document.querySelector(s); if (el && el.textContent) return el.textContent.trim(); }
  return '';
}
function lc(s){ return (s||'').toLowerCase(); }

// ===== Simple RNG utils (for internal use; not global Math.random) =====
const RNG = (() => ({
  next: () => Math.random(),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  int: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
}))();

const COHESION_MODE_NAMES = ['strict', 'cohesive', 'chaotic', 'madness'];

// ===== DOM helpers =====
const Dom = (() => {
  const q = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = q(sel); if (el) el.textContent = txt; };
  const setHTML = (sel, html) => { const el = q(sel); if (el) el.innerHTML = html; };
  const txt = (sel) => (q(sel)?.textContent || '').trim();
  return { q, setText, setHTML, txt };
})();

// App metadata
const APP_VERSION = '0.8.4.1';

const SUPPORT = Object.freeze({
  poe2Patch: "0.4.0",
  league: {
    name: "Fate of the Vaal",
    poeNinjaSlug: "vaal",
  },
});

window.RANDOMANCER = window.RANDOMANCER || {};
window.RANDOMANCER.version = APP_VERSION;
window.RANDOMANCER.support = SUPPORT;

// ===== Shared DOM ready / query helpers (v0.7.5 scaffolding uses these) =====
function onDomReady(fn) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // keep behavior similar to previous helpers
    setTimeout(fn, 0);
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

onDomReady(() => {
  const el = document.querySelector('.version');
  if (el) {
    el.textContent = `Randomancer v${APP_VERSION}`;
  }
});

function formatWeaponLine(weapon, offhand){
  const w = (weapon || '').trim();
  const o = (offhand || '').trim();

  // Bow builds always imply a Quiver (even if offhand is not explicitly set in data)
  if (w && /^bow$/i.test(w)) {
    const q = 'Quiver';
    if (!o || /quiver/i.test(o) === false) return `${w} & ${q}`;
    return `${w} & ${o}`;
  }

  if (w && o) return `${w} & ${o}`;
  return w || o || '';
}

function hasSecondaryWeaponSet(snap){
  return !!(snap && (snap.weapon2 || snap.offhand2));
}

function renderOathAwareText(el, values, oathSet, separator = ' & '){
  if (!el) return;
  const list = Array.isArray(values)
    ? values.filter(Boolean)
    : (values ? [values] : []);
  if (!list.length) {
    el.replaceChildren(document.createTextNode(''));
    return;
  }

  const nodes = [];
  list.forEach((val, idx) => {
    const span = document.createElement('span');
    span.textContent = val;
    if (oathSet && typeof oathSet.has === 'function' && oathSet.has(val)) {
      span.classList.add('oath-hit');
    }
    nodes.push(span);
    if (idx < list.length - 1) nodes.push(document.createTextNode(separator));
  });

  el.replaceChildren(...nodes);
}

function renderSecondaryWeaponLine(values, oathSet){
  const el = document.getElementById('weapons-set2');
  if (!el) return;
  if (!values || !values.length) {
    el.replaceChildren(document.createTextNode(''));
    return;
  }
  if (oathSet) {
    renderOathAwareText(el, values, oathSet);
  } else {
    el.textContent = values.filter(Boolean).join(' & ');
  }
}

function setSkillsTabsAvailability(hasSet2){
  const tabs = document.getElementById('skills-tabs');
  const tab2 = tabs?.querySelector('[data-skill-tab="2"]');
  if (tabs) tabs.hidden = !hasSet2;
  if (tab2) {
    tab2.hidden = !hasSet2;
    tab2.disabled = !hasSet2;
  }
  if (!hasSet2) {
    setActiveSkillsTab('1');
  }
}

function setActiveSkillsTab(tabId){
  const tabKey = String(tabId || '1');
  const tabs = document.querySelectorAll('.skills-tabs .skills-tab');
  const grid1 = document.getElementById('skills-grid');
  const grid2 = document.getElementById('skills-grid-2');
  tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.skillTab === tabKey));
  if (grid1) {
    grid1.classList.toggle('hidden', tabKey === '2');
    grid1.hidden = (tabKey === '2');
    grid1.style.display = (tabKey === '2') ? 'none' : 'grid';
  }
  if (grid2) {
    grid2.classList.toggle('hidden', tabKey !== '2');
    grid2.hidden = (tabKey !== '2');
    grid2.style.display = (tabKey !== '2') ? 'none' : 'grid';
  }
}

function getQueryParams() {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams('');
  }
}

// Optional runtime smoke check (warnings only).
const DEBUG_SMOKE_CHECK = false;
function runSmokeCheck(){
  const requiredExports = [
    'App',
    'rollBuild',
    'scheduleSummaryRefresh',
    'RandomancerEncodeSnapshot',
    'RandomancerApplyBuildCode',
    'RandomancerUpdateBuildCodeUI',
    'RandomancerRefreshUniques',
    'RandomancerRenderUniquesFromNames',
    'RandomancerInfo',
    'getOrBuildIDF'
  ];
  const missingExports = requiredExports.filter((key) => typeof window[key] === 'undefined');
  if (missingExports.length) {
    console.warn('[smoke-check] Missing window exports:', missingExports);
  }

  const requiredNodes = {
    rollButton: '#roll',
    cohesionSlider: '#cohesionRange',
    summaryToggle: '#view-toggle',
    bindFatesModal: '#bind-fates-modal',
    savedOverlay: '#saved-overlay',
    infoOverlay: '#rm-info-overlay'
  };
  Object.entries(requiredNodes).forEach(([label, selector]) => {
    if (!document.querySelector(selector)) {
      console.warn(`[smoke-check] Missing DOM node: ${label} (${selector})`);
    }
  });
}

onDomReady(() => {
  const params = getQueryParams();
  const shouldRun = DEBUG_SMOKE_CHECK || params.get('debug') === '1';
  if (shouldRun) runSmokeCheck();
});

export {
  Selectors,
  firstText,
  lc,
  RNG,
  COHESION_MODE_NAMES,
  Dom,
  APP_VERSION,
  SUPPORT,
  onDomReady,
  formatWeaponLine,
  hasSecondaryWeaponSet,
  renderOathAwareText,
  renderSecondaryWeaponLine,
  setSkillsTabsAvailability,
  setActiveSkillsTab,
  getQueryParams
};
