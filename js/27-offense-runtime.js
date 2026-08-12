import { ensureDataPreload } from './08-data-load.js';
import {
  buildOffenseSnapshotFields,
  isArchetype,
  migrateLegacyMechanicsToOffense,
  resolveOffenseElements,
  resolveOffenseEntry
} from './26-offense-roll.js';

const OFFENSE_COUNT_KEY = 'randomancer_offense_count';
const LEGACY_COUNT_KEY = 'randomancer_mechanics_count';
const DEFAULT_OFFENSE_COUNT = 2;
const ARCHETYPE_WEIGHT = 3;
const CARD_LABEL_SETTLE_MS = 850;

let coreRef = null;
let savedLegacyPools = null;
let poolsProjected = false;
let snapshotUpgradeInProgress = false;
let cardLabelTimer = 0;

function getMode(){
  return window.RandomancerGetMode?.() || 'standard';
}

function getBindFates(){
  return window.App?.getBindFates?.() || {};
}

function canonicalizeName(raw){
  return resolveOffenseEntry(window.DATA || {}, raw)?.name || null;
}

function canonicalizeCombatFates(){
  const bind = getBindFates();
  const combat = bind?.combat || {};
  const normalize = (values) => {
    const out = [];
    const seen = new Set();
    for (const raw of (Array.isArray(values) ? values : [])) {
      const name = canonicalizeName(raw);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  };

  const next = {
    oaths: normalize(combat.oaths),
    abominations: normalize(combat.abominations)
  };

  const prevOaths = Array.isArray(combat.oaths) ? combat.oaths : [];
  const prevAboms = Array.isArray(combat.abominations) ? combat.abominations : [];
  const changed = JSON.stringify(prevOaths) !== JSON.stringify(next.oaths)
    || JSON.stringify(prevAboms) !== JSON.stringify(next.abominations);

  if (changed) window.App?.setBindFatesCategory?.('combat', next);
  return next;
}

function rememberLegacyPools(){
  if (!coreRef || savedLegacyPools) return;
  savedLegacyPools = {
    ailments: Array.isArray(coreRef.Ailments) ? coreRef.Ailments.slice() : [],
    tactics: Array.isArray(coreRef.Tactics) ? coreRef.Tactics.slice() : []
  };
}

function chooseProjectedArchetype(elements, combatFates){
  const aboms = new Set(combatFates.abominations || []);
  const oaths = new Set(combatFates.oaths || []);
  const allowed = elements.filter((entry) => isArchetype(entry) && !aboms.has(entry.name));
  if (!allowed.length) return null;
  const oathArchetypes = allowed.filter((entry) => oaths.has(entry.name));
  const pool = oathArchetypes.length ? oathArchetypes : allowed;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function projectOffenseIntoLegacyPools(){
  if (!coreRef) return;
  rememberLegacyPools();

  const elements = resolveOffenseElements(window.DATA || {});
  if (!elements.length) return;

  const combatFates = canonicalizeCombatFates();
  const projected = elements.filter((entry) => !isArchetype(entry));
  const archetype = chooseProjectedArchetype(elements, combatFates);

  // The legacy roll engine still sees Ailments/Tactics for this migration pass.
  // Put the entire canonical Offense vocabulary into one legacy pool so its old
  // category weighting cannot bias Damage Type vs Ailment vs Scaling. Include
  // only one Archetype candidate per roll, repeated to preserve the aggregate
  // selection weight of the three canonical Archetypes while making a double-
  // Archetype result impossible.
  if (archetype) {
    for (let i = 0; i < ARCHETYPE_WEIGHT; i++) projected.push(archetype);
  }

  if (!Array.isArray(coreRef.Ailments)) coreRef.Ailments = [];
  if (!Array.isArray(coreRef.Tactics)) coreRef.Tactics = [];
  coreRef.Ailments.splice(0, coreRef.Ailments.length, ...projected);
  coreRef.Tactics.splice(0, coreRef.Tactics.length);
  poolsProjected = true;
}

function restoreLegacyPools(){
  if (!coreRef || !savedLegacyPools || !poolsProjected) return;
  if (!Array.isArray(coreRef.Ailments)) coreRef.Ailments = [];
  if (!Array.isArray(coreRef.Tactics)) coreRef.Tactics = [];
  coreRef.Ailments.splice(0, coreRef.Ailments.length, ...savedLegacyPools.ailments);
  coreRef.Tactics.splice(0, coreRef.Tactics.length, ...savedLegacyPools.tactics);
  poolsProjected = false;
}

function collectRolledOffense(explicitSnapshot){
  const current = explicitSnapshot || window.App?.state?.currentRoll || window.CURRENT_ROLL || {};
  const raw = [
    ...(Array.isArray(current.offenseSet) ? current.offenseSet : []),
    ...(Array.isArray(current.ailmentSet) ? current.ailmentSet : []),
    ...(Array.isArray(current.tacticSet) ? current.tacticSet : []),
    ...(Array.isArray(current.offenseList) ? current.offenseList : []),
    ...(Array.isArray(current.ailmentList) ? current.ailmentList : []),
    ...(Array.isArray(current.tacticList) ? current.tacticList : [])
  ];

  const picks = [];
  const seen = new Set();
  for (const item of raw) {
    const entry = resolveOffenseEntry(window.DATA || {}, item);
    const key = entry?.id || entry?.name;
    if (!entry || !key || seen.has(key)) continue;
    if (isArchetype(entry) && picks.some(isArchetype)) continue;
    seen.add(key);
    picks.push(entry);
    if (picks.length >= 2) break;
  }
  return picks;
}

function applyOffenseFields(picks){
  const fields = buildOffenseSnapshotFields(picks);
  if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
    Object.assign(window.CURRENT_ROLL, fields);
  }
  window.App?.mergeCurrentRoll?.(fields);
  return fields;
}

function canonicalizeCurrentRoll(){
  const snapshot = window.App?.state?.currentRoll || window.CURRENT_ROLL || {};
  const picks = collectRolledOffense(snapshot);
  if (!picks.length) return null;
  return applyOffenseFields(picks);
}

function upgradeLegacySnapshot(snapshot){
  if (snapshotUpgradeInProgress || getMode() !== 'standard') return false;
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (Array.isArray(snapshot.offenseList)) return false;
  if (!resolveOffenseElements(window.DATA || {}).length) return false;

  const hasLegacyMechanics = Array.isArray(snapshot.ailmentList)
    || Array.isArray(snapshot.tacticList)
    || Array.isArray(snapshot.ailmentSet)
    || Array.isArray(snapshot.tacticSet);
  if (!hasLegacyMechanics) return false;

  const picks = migrateLegacyMechanicsToOffense(window.DATA || {}, snapshot);
  snapshotUpgradeInProgress = true;
  try {
    applyOffenseFields(picks);
  } finally {
    snapshotUpgradeInProgress = false;
  }
  return true;
}

function loadOffenseCount(){
  let raw = null;
  try { raw = Number(localStorage.getItem(OFFENSE_COUNT_KEY)); } catch {}
  if (raw !== 1 && raw !== 2) {
    try { raw = Number(localStorage.getItem(LEGACY_COUNT_KEY)); } catch {}
  }
  return raw === 1 ? 1 : DEFAULT_OFFENSE_COUNT;
}

function installOffenseCountControl(){
  const button = document.getElementById('mechanics-count-btn');
  if (!button || button.dataset.offenseCountBound === '1') return;
  button.dataset.offenseCountBound = '1';

  const label = button.querySelector('.rm-dotstep__label');
  if (label) label.textContent = 'Offense';

  const dots = Array.from(button.querySelectorAll('.rm-dotstep__dot'));
  if (dots[2]) dots[2].hidden = true;
  let count = loadOffenseCount();

  const paint = () => {
    dots.forEach((dot, index) => dot.classList.toggle('is-on', index < count && index < 2));
    button.setAttribute('aria-label', `Offense elements: ${count}`);
    button.title = `Offense: roll ${count} element${count === 1 ? '' : 's'}`;
  };

  const setCount = (value) => {
    count = Number(value) === 1 ? 1 : 2;
    try {
      localStorage.setItem(OFFENSE_COUNT_KEY, String(count));
      localStorage.setItem(LEGACY_COUNT_KEY, String(count));
    } catch {}
    paint();
    return count;
  };

  window.getOffenseCount = () => count;
  window.setOffenseCount = setCount;
  // Compatibility boundary: the legacy roll engine still asks this question.
  window.getCombatMechanicsCount = () => count;
  window.setCombatMechanicsCount = setCount;

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setCount(count === 1 ? 2 : 1);
  }, true);

  paint();
}

function cycleBindOption(button){
  if (button.classList.contains('is-oath')) {
    button.classList.remove('is-oath');
    button.classList.add('is-abomination');
  } else if (button.classList.contains('is-abomination')) {
    button.classList.remove('is-abomination');
  } else {
    button.classList.add('is-oath');
  }
}

function renderOffenseBindFates(){
  if (getMode() === 'challenge') return;
  const section = document.querySelector('[data-category="combat"]');
  const list = document.getElementById('bind-fates-list-combat');
  if (!section || !list) return;

  const heading = section.querySelector('h4');
  const hint = section.querySelector('.bind-fates-hint');
  if (heading) heading.textContent = 'Offense';
  if (hint) hint.textContent = 'Favor core offensive identities, or name those that fate will never grant.';

  const combat = canonicalizeCombatFates();
  const oaths = new Set(combat.oaths || []);
  const aboms = new Set(combat.abominations || []);
  const elements = resolveOffenseElements(window.DATA || {});

  list.innerHTML = '';
  elements.forEach((entry) => {
    if (!entry?.name) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bind-option';
    button.dataset.name = entry.name;
    button.dataset.kind = 'offense';
    if (oaths.has(entry.name)) button.classList.add('is-oath');
    else if (aboms.has(entry.name)) button.classList.add('is-abomination');
    button.textContent = entry.name;
    button.addEventListener('click', () => cycleBindOption(button));
    list.appendChild(button);
  });
}

function patchStandardLede(){
  if (getMode() !== 'standard') return;
  const lede = document.getElementById('app-lede');
  if (!lede) return;
  const html = lede.innerHTML;
  if (!/Combat Mechanics/i.test(html)) return;
  lede.innerHTML = html.replace(
    /choose <strong>Combat Mechanics<\/strong>: 1-3 for ailment\/tactic depth\./i,
    'choose <strong>Offense</strong>: 1–2 core offensive elements.'
  );
}

function patchCardOffenseLabel(){
  document.querySelectorAll('.rc-card--front .rc-print-row__label').forEach((label) => {
    if (String(label.textContent || '').trim() === 'Combat') label.textContent = 'Offense';
  });
}

function scheduleCardOffenseLabelPatch(){
  requestAnimationFrame(patchCardOffenseLabel);
  if (cardLabelTimer) clearTimeout(cardLabelTimer);
  cardLabelTimer = window.setTimeout(() => {
    cardLabelTimer = 0;
    patchCardOffenseLabel();
  }, CARD_LABEL_SETTLE_MS);
}

function installLifecycleHooks(){
  if (window.__randomancerOffenseLifecycleInstalled) return;
  window.__randomancerOffenseLifecycleInstalled = true;

  const previousPrepare = window.RandomancerPrepareBuildRoll;
  window.RandomancerPrepareBuildRoll = (...args) => {
    previousPrepare?.(...args);
    projectOffenseIntoLegacyPools();
  };

  const previousAfter = window.RandomancerAfterBuildRoll;
  window.RandomancerAfterBuildRoll = (...args) => {
    try {
      canonicalizeCurrentRoll();
    } finally {
      restoreLegacyPools();
    }
    previousAfter?.(...args);
    scheduleCardOffenseLabelPatch();
  };

  window.addEventListener('error', restoreLegacyPools);
  window.addEventListener('unhandledrejection', restoreLegacyPools);
}

function installPresentationHooks(){
  document.addEventListener('randomancer:build-snapshot-change', (event) => {
    const snapshot = event.detail?.snapshot || window.App?.state?.currentRoll || null;
    upgradeLegacySnapshot(snapshot);
    scheduleCardOffenseLabelPatch();
  });

  document.addEventListener('randomancer:mode-change', () => {
    setTimeout(() => {
      if (getMode() !== 'standard') restoreLegacyPools();
      patchStandardLede();
      renderOffenseBindFates();
    }, 0);
  });

  document.addEventListener('click', (event) => {
    if (!event.target?.closest?.('.bind-fates-toggle')) return;
    setTimeout(renderOffenseBindFates, 0);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  installOffenseCountControl();
  installLifecycleHooks();
  installPresentationHooks();
  patchStandardLede();

  try {
    const data = await ensureDataPreload();
    coreRef = data?.core || null;
    canonicalizeCombatFates();
    upgradeLegacySnapshot(window.App?.state?.currentRoll || null);
    renderOffenseBindFates();
  } catch (error) {
    console.error('[Offense] failed to initialize canonical Offense runtime', error);
  }
});

export {
  canonicalizeCurrentRoll,
  projectOffenseIntoLegacyPools,
  restoreLegacyPools,
  renderOffenseBindFates,
  upgradeLegacySnapshot
};
