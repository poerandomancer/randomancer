import { COHESION_MODE_NAMES } from './01-meta-and-domready.js';
import { defensePseudoTags, deriveWeaponHints, normTagPlus } from './05-tags-and-scorer.js';

// ---------- cohesion + selection ----------
// Named presets still exist, but we now treat cohesion as a continuous threshold [0,1]
const COHESION_MODES = {
  strict: 1.0,
  cohesive: 2/3,   // ≈0.67
  chaotic: 1/3,    // ≈0.33
  madness: 0.0
};

// currentMode is the *nearest* named preset; used mainly for display / metadata
let currentMode = 'cohesive';

// cohesionThreshold is the actual continuous value used by rollBuild()
let cohesionThreshold = COHESION_MODES[currentMode];

function setCohesionState(threshold){
  cohesionThreshold = threshold;
  currentMode = cohesionNameForThreshold(threshold);
}

function cohesionNameForThreshold(threshold){
  const t = Number(threshold);
  if (!Number.isFinite(t)) return currentMode || 'cohesive';

  let bestName = 'cohesive';
  let bestDist = Infinity;

  for (const name of COHESION_MODE_NAMES) {
    const val = COHESION_MODES[name];
    if (typeof val !== 'number') continue;
    const dist = Math.abs(t - val);
    if (dist < bestDist) {
      bestDist = dist;
      bestName = name;
    }
  }
  return bestName;
}

// Slider is 0–100, with 0 = Strict (1.0) → 100 = Madness (0.0)
function sliderValueToThreshold(v){
  const raw = Number(v);
  if (!Number.isFinite(raw)) return cohesionThreshold;
  const clamped = Math.max(0, Math.min(100, raw));
  const t = 1 - clamped / 100;
  // snap to 0.01 steps so the number matches the UI feel
  return Math.round(t * 100) / 100;
}

function thresholdToSliderValue(t){
  const raw = Number(t);
  if (!Number.isFinite(raw)) return 25; // default near cohesive
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round((1 - clamped) * 100);
}

// Very plain, explicit hints about what the current threshold does
function getCohesionHint(t){
  const v = Number(t);
  if (!Number.isFinite(v)) return '';

  if (v === 0) {
    return 'No cohesion: fully random rolls; attributes are ignored.';
  }
  if (v >= 0.90) {
    return 'Pure & near-pure builds only (very high cohesion).';
  }
  if (v >= 0.70) {
    return 'Pure + aligned hybrids; off-stat options are mostly filtered out.';
  }
  if (v >= 0.58) {
    return 'Hybrid & tri-split builds allowed; hard opposites still blocked.';
  }
  if (v >= 0.35) {
    return 'Loose cohesion: hybrids and off-stat picks show up regularly.';
  }
  return 'Very loose cohesion: almost anything goes except direct opposites.';
}

// Resolve legacy numbers / names into a canonical mode name
function resolveCohesionMode(mode){
  // Already a named mode
  if (typeof mode === 'string') {
    if (Object.prototype.hasOwnProperty.call(COHESION_MODES, mode)) return mode;

    const maybeNum = Number(mode);
    if (!Number.isNaN(maybeNum)) {
      return cohesionNameForThreshold(maybeNum);
    }
    return currentMode || 'cohesive';
  }

  // Numeric: int in [0,3] = legacy index, otherwise treat as threshold
  if (typeof mode === 'number') {
    if (Number.isInteger(mode) &&
        mode >= 0 &&
        mode < COHESION_MODE_NAMES.length) {
      return COHESION_MODE_NAMES[mode];
    }
    return cohesionNameForThreshold(mode);
  }

  return currentMode || 'cohesive';
}


function attributeCohesion(a,b){ const k=['strength','dexterity','intelligence']; const dot=k.reduce((s,x)=>s+(a[x]||0)*(b[x]||0),0); const ma=Math.sqrt(k.reduce((s,x)=>s+(a[x]||0)**2,0)); const mb=Math.sqrt(k.reduce((s,x)=>s+(b[x]||0)**2,0)); return dot/(ma*mb||1); }
function pickByCohesion(list, base, th){
  if (!list || !list.length) return null;

  // Madness: ignore attributes completely
  if (th === 0) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Clamp to [0,1] just in case
  let currentTh = (typeof th === 'number') ? Math.max(0, Math.min(1, th)) : 0;

  const scored = list.map(x => ({
    x,
    score: attributeCohesion(base, x.attributes || {})
  }));

  // First attempt using the requested threshold
  let filtered = scored.filter(s => s.score >= currentTh);

  // If nothing passes, gradually relax the threshold in 0.10 steps
  // until we find something, or we bottom out at 0.
  while (!filtered.length && currentTh > 0) {
    currentTh = Math.max(0, currentTh - 0.10);
    filtered = scored.filter(s => s.score >= currentTh);
  }

  // If we somehow still have nothing (e.g. every score was 0), fall back to everyone.
  const pool = filtered.length ? filtered : scored;

  return pool[Math.floor(Math.random() * pool.length)].x;
}


function normalizeAttributesForSynergy(attrs){
  const S = Number(attrs?.strength) || 0;
  const D = Number(attrs?.dexterity) || 0;
  const I = Number(attrs?.intelligence) || 0;
  const total = S + D + I;
  if (!total) return { strength: 0, dexterity: 0, intelligence: 0 };
  return { strength: S / total, dexterity: D / total, intelligence: I / total };
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
    // 1) Explicit snapshot
    if (explicitSnapshot && typeof explicitSnapshot === 'object') {
      return buildBuildContextFromSnapshot(explicitSnapshot);
    }

    // 2) App-level state snapshot
    if (window.App && window.App.state && window.App.state.currentRoll) {
      const built = buildBuildContextFromSnapshot(window.App.state.currentRoll);
      if (built) return built;
    }

    // 3) Fallback to global CURRENT_ROLL
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

  // Prefer existing tag profile if present
  if (snap.tagProfile && snap.tagProfile.profile instanceof Map) {
    snap.tagProfile.profile.forEach((_, k) => addTag(k));
  }
  if (snap.tagProfile && snap.tagProfile.cats) {
    addTags(Array.from(snap.tagProfile.cats.tactics || []));
    addTags(Array.from(snap.tagProfile.cats.ailments || []));
  }

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

  const cohesionMode = resolveCohesionMode(
    snap.cohesionModeName ?? snap.cohesionMode ?? currentMode
  );

  return {
    ascendancyId: Number.isFinite(ascendancyId) ? ascendancyId : null,
    ascendancyName: ascendancyName || null,
    tags: Array.from(tagSet).sort(),
    defenseTags: Array.from(defenseSet).sort(),
    attributes,
    cohesionMode
  };
}

const validOffhands={"One-handed Mace":["One-handed Mace","Shield","Buckler","Focus","Sceptre"],"Spear":["Shield","Buckler","Focus","Sceptre"],"Wand":["Shield","Buckler","Focus","Sceptre"],"Sceptre":["Shield","Buckler","Focus","Wand"]};
function applyHardRestrictions(item,ctx){
  if(!item) return false;
  if(item.name==='Block' && !['Shield','Buckler'].includes(ctx.offhand)) return false;
  if(item.name==='Minions' && ctx.weapon!=='Sceptre') return false;
  if(item.name==='Deflection' && !ctx.defense.includes('Evasion')) return false;
  return true;
}

export {
  COHESION_MODES,
  currentMode,
  cohesionThreshold,
  setCohesionState,
  cohesionNameForThreshold,
  sliderValueToThreshold,
  thresholdToSliderValue,
  getCohesionHint,
  resolveCohesionMode,
  pickByCohesion,
  normalizeAttributesForSynergy,
  lookupAscendancyIdByName,
  buildBuildContext,
  buildBuildContextFromSnapshot,
  validOffhands,
  applyHardRestrictions
};

// ---------- overlay + ascendancy art ----------
