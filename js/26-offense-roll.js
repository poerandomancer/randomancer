import { cohesionThreshold, pickByCohesion } from './06-cohesion.js';

const OFFENSE_CATEGORY_ARCHETYPE = 'Archetype';
const MIN_OFFENSE_COUNT = 1;
const MAX_OFFENSE_COUNT = 2;
const NON_ROLLABLE_OFFENSE_IDS = new Set(['critical_hits', 'critical_hit']);

function isRollableOffense(entry) {
  const ids = offenseNames(entry).map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return !ids.some((id) => NON_ROLLABLE_OFFENSE_IDS.has(id));
}

function randomOffenseCount() {
  return Math.random() < 0.5 ? MIN_OFFENSE_COUNT : MAX_OFFENSE_COUNT;
}

function normalizeOffenseCount(value) {
  const n = Number(value);
  if (n === MIN_OFFENSE_COUNT || n === MAX_OFFENSE_COUNT) return n;
  return randomOffenseCount();
}

function resolveOffenseElements(data) {
  if (Array.isArray(data?.Offense)) return data.Offense.filter(Boolean);
  if (Array.isArray(data?.OffenseInventory?.elements)) return data.OffenseInventory.elements.filter(Boolean);
  if (Array.isArray(window.DATA?.Offense)) return window.DATA.Offense.filter(Boolean);
  if (Array.isArray(window.DATA?.OffenseInventory?.elements)) return window.DATA.OffenseInventory.elements.filter(Boolean);
  return [];
}

function offenseNames(entry) {
  if (!entry) return [];
  return [entry.id, entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function matchesConfiguredName(entry, names) {
  if (!entry || !Array.isArray(names) || !names.length) return false;
  const wanted = new Set(names.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  return offenseNames(entry).some((value) => wanted.has(value.toLowerCase()));
}

function resolveOffenseEntry(data, raw) {
  const needle = String(raw?.id || raw?.name || raw || '').trim().toLowerCase();
  if (!needle) return null;
  return resolveOffenseElements(data).find((entry) =>
    offenseNames(entry).some((value) => value.toLowerCase() === needle)
  ) || null;
}

function isArchetype(entry) {
  return entry?.category === OFFENSE_CATEGORY_ARCHETYPE;
}

function randomItem(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)] || null;
}

function pickOffenseCandidate(pool, baseAttributes, threshold) {
  if (!Array.isArray(pool) || !pool.length) return null;
  return pickByCohesion(pool, baseAttributes || {}, threshold) || randomItem(pool);
}

function filterForExistingPicks(pool, picks) {
  const usedIds = new Set((picks || []).map((entry) => entry?.id || entry?.name).filter(Boolean));
  const alreadyHasArchetype = (picks || []).some(isArchetype);
  return (pool || []).filter((entry) => {
    const key = entry?.id || entry?.name;
    if (!key || usedIds.has(key)) return false;
    if (alreadyHasArchetype && isArchetype(entry)) return false;
    return true;
  });
}

function resolveCombatFates(bindFates) {
  const combat = bindFates?.combat || {};
  return {
    oaths: Array.isArray(combat.oaths) ? combat.oaths.filter(Boolean) : [],
    abominations: Array.isArray(combat.abominations) ? combat.abominations.filter(Boolean) : []
  };
}

function selectOffense(options = {}) {
  const data = options.data || window.DATA || {};
  const baseAttributes = options.baseAttributes || {};
  const threshold = Number.isFinite(options.threshold) ? Number(options.threshold) : cohesionThreshold;
  const target = Math.min(MAX_OFFENSE_COUNT, normalizeOffenseCount(options.count));
  const fates = resolveCombatFates(options.bindFates);

  const fullPool = resolveOffenseElements(data).filter(isRollableOffense);
  const allowed = fullPool.filter((entry) => !matchesConfiguredName(entry, fates.abominations));
  const oathPool = fates.oaths.length
    ? allowed.filter((entry) => matchesConfiguredName(entry, fates.oaths))
    : [];

  if (allowed.length < target) {
    return {
      picks: [],
      error: `Not enough valid Offense elements to roll ${target} with your current Oaths & Abominations.`
    };
  }

  const picks = [];

  // Existing Bind-the-Fates semantics are intentionally preserved at a high level:
  // valid Oaths are selected first, then any remaining slots are filled from the
  // wider allowed pool. Cohesion remains the actual picker inside each pool.
  while (picks.length < target && oathPool.length) {
    const pool = filterForExistingPicks(oathPool, picks);
    if (!pool.length) break;
    const next = pickOffenseCandidate(pool, baseAttributes, threshold);
    if (!next) break;
    picks.push(next);
  }

  while (picks.length < target) {
    const pool = filterForExistingPicks(allowed, picks);
    if (!pool.length) break;
    const next = pickOffenseCandidate(pool, baseAttributes, threshold);
    if (!next) break;
    picks.push(next);
  }

  if (picks.length < target) {
    return {
      picks: [],
      error: `Not enough compatible Offense elements to roll ${target} while limiting each build to one Archetype.`
    };
  }

  return { picks, error: null };
}

function buildOffenseSnapshotFields(picks) {
  const offenseSet = (picks || []).filter(Boolean);
  const offenseList = offenseSet.map((entry) => entry.name).filter(Boolean);
  const offenseTags = Array.from(new Set(offenseSet.flatMap((entry) => entry.tags || []).filter(Boolean)));
  const joined = offenseList.join(' & ');

  return {
    offense: joined,
    offenseList,
    offenseSet,
    offenseTags,

    // Transitional compatibility membrane for the current recommendation stack.
    // New code should consume offense* fields. Legacy scorers may continue to read
    // ailmentSet/tacticSet until the recommendation-engine rewrite replaces them.
    ailments: joined,
    ailmentList: offenseList.slice(),
    ailmentSet: offenseSet.slice(),
    tactics: '',
    tacticList: [],
    tacticSet: []
  };
}

function migrateLegacyMechanicsToOffense(data, snapshot) {
  const rawNames = [
    ...(Array.isArray(snapshot?.offenseList) ? snapshot.offenseList : []),
    ...(Array.isArray(snapshot?.ailmentList) ? snapshot.ailmentList : []),
    ...(Array.isArray(snapshot?.tacticList) ? snapshot.tacticList : [])
  ];

  const seen = new Set();
  const picks = [];
  for (const raw of rawNames) {
    const entry = resolveOffenseEntry(data, raw);
    const key = entry?.id || entry?.name;
    if (!entry || !key || seen.has(key)) continue;
    if (isArchetype(entry) && picks.some(isArchetype)) continue;
    seen.add(key);
    picks.push(entry);
    if (picks.length >= MAX_OFFENSE_COUNT) break;
  }
  return picks;
}

export {
  OFFENSE_CATEGORY_ARCHETYPE,
  MIN_OFFENSE_COUNT,
  MAX_OFFENSE_COUNT,
  randomOffenseCount,
  normalizeOffenseCount,
  resolveOffenseElements,
  resolveOffenseEntry,
  isArchetype,
  isRollableOffense,
  selectOffense,
  buildOffenseSnapshotFields,
  migrateLegacyMechanicsToOffense
};
