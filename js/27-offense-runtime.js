import { ensureDataPreload } from './08-data-load.js';
import {
  buildOffenseSnapshotFields,
  isArchetype,
  isRollableOffense,
  migrateLegacyMechanicsToOffense,
  randomOffenseCount,
  resolveOffenseElements,
  resolveOffenseEntry
} from './26-offense-roll.js';

const ARCHETYPE_WEIGHT = 3;
const PRIMARY_CARD_STAGE_ID = 'primary-build-card-stage';

let coreRef = null;
let savedLegacyPools = null;
let poolsProjected = false;
let snapshotUpgradeInProgress = false;
let cardLabelObserver = null;
let cardLabelObserverRetry = 0;
let currentOffenseCount = 1;

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
  const rollableElements = elements.filter(isRollableOffense);
  const projected = rollableElements.filter((entry) => !isArchetype(entry));
  const archetype = chooseProjectedArchetype(rollableElements, combatFates);

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

  // During a fresh roll, the legacy engine writes the new result into
  // ailment*/tactic*. The previous canonical offense* fields can still remain on
  // App.state.currentRoll until normalization completes. Treat those sources as
  // mutually exclusive: fresh legacy fields win, and canonical fields are only
  // a fallback for already-normalized/directly-loaded snapshots. Mixing them can
  // resurrect a stale second Offense element after a one-element roll.
  const legacyRaw = [
    ...(Array.isArray(current.ailmentSet) ? current.ailmentSet : []),
    ...(Array.isArray(current.tacticSet) ? current.tacticSet : []),
    ...(Array.isArray(current.ailmentList) ? current.ailmentList : []),
    ...(Array.isArray(current.tacticList) ? current.tacticList : [])
  ];
  const canonicalRaw = [
    ...(Array.isArray(current.offenseSet) ? current.offenseSet : []),
    ...(Array.isArray(current.offenseList) ? current.offenseList : [])
  ];
  const raw = legacyRaw.length ? legacyRaw : canonicalRaw;

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

function retireStandardBuildControls(){
  const weaponSet2Toggle = document.getElementById('weapon-set2-toggle');
  if (weaponSet2Toggle) weaponSet2Toggle.checked = false;

  const mechanicsButton = document.getElementById('mechanics-count-btn');
  const retiredGroup = weaponSet2Toggle?.closest('.control-item.weapon-set2-control')
    || mechanicsButton?.closest('.control-item.weapon-set2-control');
  retiredGroup?.remove();

  // Remove obsolete persisted count state so an older session cannot silently
  // dictate future Offense rolls after the control itself has been retired.
  try {
    localStorage.removeItem('randomancer_offense_count');
    localStorage.removeItem('randomancer_mechanics_count');
  } catch {}

  // The legacy roll engine still asks for a mechanics count. During this
  // migration, expose the Fate-selected Offense count through that seam.
  window.getOffenseCount = () => currentOffenseCount;
  window.getCombatMechanicsCount = () => currentOffenseCount;
  try { delete window.setOffenseCount; } catch {}
  try { delete window.setCombatMechanicsCount; } catch {}
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
  const elements = resolveOffenseElements(window.DATA || {}).filter(isRollableOffense);

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

  let html = lede.innerHTML;
  html = html.replace(
    /Toggle <strong>Weapon Set II<\/strong> for an additional weapon set, and choose <strong>Combat Mechanics<\/strong>: 1-3 for ailment\/tactic depth\./i,
    'Each roll chooses one weapon set and one or two core <strong>Offense</strong> elements.'
  );
  html = html.replace(
    /Toggle <strong>Weapon Set II<\/strong> for an additional weapon set, and choose <strong>Offense<\/strong>: 1[–-]2 core offensive elements\./i,
    'Each roll chooses one weapon set and one or two core <strong>Offense</strong> elements.'
  );
  html = html.replace(
    /choose <strong>Combat Mechanics<\/strong>: 1-3 for ailment\/tactic depth\./i,
    'let fate choose one or two core <strong>Offense</strong> elements.'
  );
  lede.innerHTML = html;
}

function patchCardOffenseLabel(){
  document.querySelectorAll('.rc-card--front .rc-print-row__label').forEach((label) => {
    if (String(label.textContent || '').trim() === 'Combat') label.textContent = 'Offense';
  });
}

function installCardLabelObserver(){
  if (cardLabelObserver) return;
  const stage = document.getElementById(PRIMARY_CARD_STAGE_ID);
  if (!stage) {
    if (!cardLabelObserverRetry) {
      cardLabelObserverRetry = window.setTimeout(() => {
        cardLabelObserverRetry = 0;
        installCardLabelObserver();
      }, 50);
    }
    return;
  }

  cardLabelObserver = new MutationObserver(() => patchCardOffenseLabel());
  cardLabelObserver.observe(stage, { childList: true, subtree: true });
  patchCardOffenseLabel();
}

function installLifecycleHooks(){
  if (window.__randomancerOffenseLifecycleInstalled) return;
  window.__randomancerOffenseLifecycleInstalled = true;

  const previousPrepare = window.RandomancerPrepareBuildRoll;
  window.RandomancerPrepareBuildRoll = (...args) => {
    previousPrepare?.(...args);
    currentOffenseCount = randomOffenseCount();
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
    patchCardOffenseLabel();
  };

  window.addEventListener('error', restoreLegacyPools);
  window.addEventListener('unhandledrejection', restoreLegacyPools);
}

function installPresentationHooks(){
  document.addEventListener('randomancer:build-snapshot-change', (event) => {
    const snapshot = event.detail?.snapshot || window.App?.state?.currentRoll || null;
    upgradeLegacySnapshot(snapshot);
    patchCardOffenseLabel();
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
  retireStandardBuildControls();
  installLifecycleHooks();
  installPresentationHooks();
  installCardLabelObserver();
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
