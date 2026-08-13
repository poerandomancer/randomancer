import { defensePseudoTags, deriveWeaponHints, normTagPlus } from './05-tags-and-scorer.js';
import {
  COHESION_WEIGHT_STRENGTH,
  attributeOverlap,
  normalizeAffinity,
  cohesionSelectionWeight,
  pickByWeightedCohesion
} from './06a-cohesion-selection.js';
import { validOffhands, applyHardRestrictions } from './06b-build-compatibility.js';

// ---------- cohesion + selection ----------
// Cohesion remains a continuous [0,1] control, but now scales selection
// probability instead of acting as a hard eligibility threshold.
const COHESION_TIER_ANCHORS = [
  { name: 'strict',   v: 1.0 },
  { name: 'cohesive', v: 2/3 },
  { name: 'chaotic',  v: 1/3 },
  { name: 'madness',  v: 0.0 }
];

// App default (matches the current UI default). The legacy variable/function
// names remain for compatibility even though this is no longer a threshold.
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

function pickByCohesion(list, base, th){
  const t = Number.isFinite(Number(th)) ? Number(th) : cohesionThreshold;
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
  cohesionThreshold,
  setCohesionThreshold,
  sliderValueToThreshold,
  thresholdToSliderValue,
  attributeOverlap,
  cohesionSelectionWeight,
  pickByCohesion,
  normalizeAttributesForSynergy,
  lookupAscendancyIdByName,
  buildBuildContext,
  buildBuildContextFromSnapshot,
  validOffhands,
  applyHardRestrictions
};

// ---------- overlay + ascendancy art ----------
