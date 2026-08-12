import { defensePseudoTags, deriveWeaponHints, normTagPlus } from './05-tags-and-scorer.js';

// ---------- cohesion + selection ----------
// Cohesion is a continuous threshold [0,1]. No named modes, no UI hints.
// We do keep an internal tier mapping ONLY for subsystems that still want a coarse tier (e.g. passives).
const COHESION_TIER_ANCHORS = [
  { name: 'strict',   v: 1.0 },
  { name: 'cohesive', v: 2/3 },
  { name: 'chaotic',  v: 1/3 },
  { name: 'madness',  v: 0.0 }
];

// App default (matches your current UI default)
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
  // snap to 0.01 steps so the number matches the UI feel
  return Math.round(t * 100) / 100;
}

function thresholdToSliderValue(t){
  const raw = Number(t);
  if (!Number.isFinite(raw)) return 25; // default near cohesive
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round((1 - clamped) * 100);
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

  // Prefer existing tag profile if present.
  if (snap.tagProfile && snap.tagProfile.profile instanceof Map) {
    snap.tagProfile.profile.forEach((_, k) => addTag(k));
  }
  if (snap.tagProfile && snap.tagProfile.cats) {
    addTags(Array.from(snap.tagProfile.cats.tactics || []));
    addTags(Array.from(snap.tagProfile.cats.ailments || []));
  }

  // Canonical Offense is first-class. Legacy Ailment/Tactic tags remain as a
  // compatibility fallback until the recommendation engine is rewritten.
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

const validOffhands={"One-handed Mace":["One-handed Mace","Shield","Buckler","Focus","Sceptre"],"Spear":["Shield","Buckler","Focus","Sceptre"],"Wand":["Shield","Buckler","Focus","Sceptre"],"Sceptre":["Shield","Buckler","Focus","Wand"]};
function applyHardRestrictions(item,ctx){
  if(!item) return false;
  if(item.name==='Block' && !['Shield','Buckler'].includes(ctx.offhand)) return false;
  if(item.name==='Deflection' && !ctx.defense.includes('Evasion')) return false;
  return true;
}

export {
  cohesionThreshold,
  setCohesionThreshold,
  sliderValueToThreshold,
  thresholdToSliderValue,
  pickByCohesion,
  normalizeAttributesForSynergy,
  lookupAscendancyIdByName,
  buildBuildContext,
  buildBuildContextFromSnapshot,
  validOffhands,
  applyHardRestrictions
};

// ---------- overlay + ascendancy art ----------
