import { defensePseudoTags, deriveWeaponHints, normTagPlus } from './05-tags-and-scorer.js';
import {
  COHESION_WEIGHT_STRENGTH,
  attributeOverlap,
  normalizeAffinity,
  cohesionSelectionWeight,
  pickByWeightedCohesion,
  pickByRingCohesion
} from './06a-cohesion-selection.js';
import { validOffhands, applyHardRestrictions } from './06b-build-compatibility.js';

// ---------- cohesion + selection ----------
// Cohesion is a continuous [0,1] control. Most domains use soft probabilistic
// affinity weighting. Primary Defense is the deliberate exception: its six
// passive-tree directions use a hard ring radius plus soft distance weighting.
const COHESION_TIER_ANCHORS = [
  { name: 'strict',   v: 1.0 },
  { name: 'cohesive', v: 2/3 },
  { name: 'chaotic',  v: 1/3 },
  { name: 'madness',  v: 0.0 }
];

const PRIMARY_DEFENSE_RING = Object.freeze([
  'Armour',
  'Armour & Evasion',
  'Evasion',
  'Evasion & Energy Shield',
  'Energy Shield',
  'Armour & Energy Shield'
]);

const PRIMARY_DEFENSE_DIRECTIONS = Object.freeze([
  { strength: 1, dexterity: 0, intelligence: 0 },
  { strength: 0.5, dexterity: 0.5, intelligence: 0 },
  { strength: 0, dexterity: 1, intelligence: 0 },
  { strength: 0, dexterity: 0.5, intelligence: 0.5 },
  { strength: 0, dexterity: 0, intelligence: 1 },
  { strength: 0.5, dexterity: 0, intelligence: 0.5 }
]);

const PRIMARY_DEFENSE_NAMES = new Set(PRIMARY_DEFENSE_RING);

// App default (matches the current UI default). The legacy variable/function
// names remain for compatibility even though this is no longer globally a threshold.
let cohesionThreshold = 3/4;

function setCohesionThreshold(threshold){
  let t = Number(threshold);
  if (!Number.isFinite(t)) return;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  cohesionThreshold = t;
}

function cohesionTierFromThreshold(threshold){
  const t = Number(threshold);
  if (!Number.isFinite(t)) return 'cohesive';

  let best = 'cohesive';
  let bestDist = Infinity;
  for (const a of COHESION_TIER_ANCHORS) {
    const d = Math.abs(t - a.v);
    if (d < bestDist) { bestDist = d; best = a.name; }
  }
  return best;
}

// Slider is 0–100, with 0 = Strict (1.0) → 100 = Madness (0.0)
function sliderValueToThreshold(v){
  const raw = Number(v);
  if (!Number.isFinite(raw)) return cohesionThreshold;
  const clamped = Math.max(0, Math.min(100, raw));
  const t = 1 - clamped / 100;
  return Math.round(t * 100) / 100;
}

function thresholdToSliderValue(t){
  const raw = Number(t);
  if (!Number.isFinite(raw)) return 25;
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round((1 - clamped) * 100);
}

function isPrimaryDefensePool(list){
  return Array.isArray(list)
    && list.length > 0
    && list.every((item) => PRIMARY_DEFENSE_NAMES.has(String(item?.name || '')));
}

function primaryDefenseHomeIndex(base){
  const normalized = normalizeAffinity(base);
  const total = normalized.strength + normalized.dexterity + normalized.intelligence;
  if (!(total > 0)) return null;

  const scores = PRIMARY_DEFENSE_DIRECTIONS.map((direction) => attributeOverlap(normalized, direction));
  const best = Math.max(...scores);
  const winners = scores
    .map((score, index) => ({ score, index }))
    .filter((entry) => Math.abs(entry.score - best) < 1e-9);

  // Ambiguous anchors (for example a perfectly neutral 1/3 split) should not
  // be forced onto an arbitrary point of the ring. Fall back to soft affinity.
  return winners.length === 1 ? winners[0].index : null;
}

function pickByCohesion(list, base, th){
  const t = Number.isFinite(Number(th)) ? Number(th) : cohesionThreshold;

  if (isPrimaryDefensePool(list)) {
    const homeIndex = primaryDefenseHomeIndex(base);
    if (Number.isInteger(homeIndex)) {
      const picked = pickByRingCohesion(list, PRIMARY_DEFENSE_RING, homeIndex, t);
      if (picked) return picked;
    }
  }

  return pickByWeightedCohesion(list, base, t);
}

function normalizeAttributesForSynergy(attrs){
  return normalizeAffinity(attrs);
}

function lookupAscendancyIdByName(name) {
  if (!name) return null;
  try {
    const asc = (typeof window !== 'undefined' && window.DATA && window.DATA.passivesEnriched)
      ? window.DATA.passivesEnriched.ascendancies
      : null;
    if (!asc || typeof asc !== 'object') return null;
    const lower = String(name).toLowerCase();
    const match = Object.values(asc).find(entry => String(entry?.name || '').toLowerCase() === lower);
    const idNum = Number(match?.id);
    return Number.isFinite(idNum) ? idNum : null;
  } catch (err) {
    console.warn('[passives] ascendancy id lookup failed', err);
    return null;
  }
}

/**
 * @typedef {'strict'|'cohesive'|'chaotic'|'madness'} CohesionMode
 * @typedef {Object} BuildContext
 * @property {number|null} ascendancyId
 * @property {string|null} ascendancyName
 * @property {string[]} tags
 * @property {string[]} defenseTags
 * @property {{strength:number, dexterity:number, intelligence:number}} attributes
 * @property {CohesionMode} cohesionMode
 */

function buildBuildContext(explicitSnapshot){
  try {
    if (explicitSnapshot && typeof explicitSnapshot === 'object') {
      return buildBuildContextFromSnapshot(explicitSnapshot);
    }

    if (window.App && window.App.state && window.App.state.currentRoll) {
      const built = buildBuildContextFromSnapshot(window.App.state.currentRoll);
      if (built) return built;
    }

    if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
      return buildBuildContextFromSnapshot(window.CURRENT_ROLL);
    }
  } catch (err) {
    console.warn('[buildBuildContext] failed', err);
  }

  return null;
}

function buildBuildContextFromSnapshot(snap){
  if (!snap || typeof snap !== 'object') return null;

  const ascendancyName = snap.ascendancyName || snap.ascendancy || null;
  const ascendancyId = Number.isFinite(snap.ascendancyId)
    ? Number(snap.ascendancyId)
    : lookupAscendancyIdByName(ascendancyName);

  const rollAttr = snap.rollAttr || snap.attributes || {};
  const attributes = normalizeAttributesForSynergy(rollAttr);

  const tagSet = new Set();
  const defenseSet = new Set();
  const addTag = (t, sink = tagSet) => { const k = normTagPlus(t); if (k) sink.add(k); };
  const addTags = (arr, sink) => (arr || []).forEach(t => addTag(t, sink));

  if (snap.tagProfile && snap.tagProfile.profile instanceof Map) {
    snap.tagProfile.profile.forEach((_, k) => addTag(k));
  }
  if (snap.tagProfile && snap.tagProfile.cats) {
    addTags(Array.from(snap.tagProfile.cats.tactics || []));
    addTags(Array.from(snap.tagProfile.cats.ailments || []));
  }

  addTags(snap.offenseTags || []);
  addTags((snap.offenseSet || []).flatMap(entry => entry?.tags || []));
  addTags((snap.tacticSet || []).flatMap(t => t?.tags || []));
  addTags((snap.ailmentSet || []).flatMap(a => a?.tags || []));

  const defPseudo = defensePseudoTags(snap.defense?.name);
  addTags(defPseudo);
  addTags(defPseudo, defenseSet);
  addTags(snap.defStratObj?.tags || snap.defStrat?.tags || []);
  addTags(Array.from(deriveWeaponHints({ name: snap.weapon }, { name: snap.offhand }) || []));

  const defenseKeywords = ['life','energyshield','armour','evasion','block','ward','guard','resist','regen','leech'];
  tagSet.forEach(t => {
    const lower = String(t).toLowerCase();
    if (defenseKeywords.some(k => lower.includes(k))) defenseSet.add(t);
  });

  const t =
    (Number.isFinite(snap.cohesionThreshold) ? Number(snap.cohesionThreshold) :
     (Number.isFinite(window.App?.state?.cohesionThreshold) ? Number(window.App.state.cohesionThreshold) :
      cohesionThreshold));

  const cohesionMode = cohesionTierFromThreshold(t);

  return {
    ascendancyId: Number.isFinite(ascendancyId) ? ascendancyId : null,
    ascendancyName: ascendancyName || null,
    tags: Array.from(tagSet).sort(),
    defenseTags: Array.from(defenseSet).sort(),
    attributes,
    cohesionMode
  };
}

export {
  COHESION_WEIGHT_STRENGTH,
  PRIMARY_DEFENSE_RING,
  cohesionThreshold,
  setCohesionThreshold,
  sliderValueToThreshold,
  thresholdToSliderValue,
  attributeOverlap,
  cohesionSelectionWeight,
  pickByCohesion,
  isPrimaryDefensePool,
  primaryDefenseHomeIndex,
  normalizeAttributesForSynergy,
  lookupAscendancyIdByName,
  buildBuildContext,
  buildBuildContextFromSnapshot,
  validOffhands,
  applyHardRestrictions
};

// ---------- overlay + ascendancy art ----------
