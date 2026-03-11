// ---------- Tag utilities (shared normalizer + alias map) ----------
const TagUtils = (() => {
  function baseNormalize(s) {
    // canonical form: lowercase, strip non-alphanumerics
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Union of aliases from:
  // - v0.7 scorer helpers
  // - uniques engine extra tags
  const RAW_ALIAS = [
    // v0.7 scorer
    ['critical', 'crit'],
    ['damage over time', 'dot'],
    ['damageovertime', 'dot'],
    ['marks', 'mark'],
    ['armourbreak', 'armourbreak'],

    // uniques engine
    ['armorbreak', 'armourbreak'],
    ['heavy stun', 'heavystun'],
    ['heavystun', 'heavystun'],
    ['life regeneration', 'liferegeneration'],
    ['culling strike', 'cullingstrike'],
    ['block recovery', 'blockrecovery'],

    // build-mode unique/tag normalization expansion
    ['critical weakness', 'critical'],
    ['critical weakness', 'criticalhit'],
    ['critical damage bonus', 'critical'],
    ['critical damage bonus', 'criticalhit'],
    ['electrocution', 'shock'],
    ['decimating strike', 'cull'],
    ['decimating strike', 'cullingstrike'],
    ['culled', 'cull'],
    ['culled', 'cullingstrike'],
    ['shocked ground', 'shock'],
    ['thorns damage', 'thorns'],
    ['chance to block', 'block'],
  ];

  const alias = new Map();
  RAW_ALIAS.forEach(([from, to]) => {
    const k = baseNormalize(from);
    const v = baseNormalize(to);
    alias.set(k, v);
  });

  function norm(s) {
    const t = baseNormalize(s);
    return alias.get(t) || t;
  }

  return { norm, alias };
})();

// Expose alias map for older code that expects window.TAG_ALIASES
window.TAG_ALIASES = TagUtils.alias;

// ===== New Scorer install + toggles + A/B compare =====
(function(){
  // Shared tag normalizer
  const normTagPlus = (s) => TagUtils.norm(s);

  function defensePseudoTags(defenseName){
    const d = String(defenseName||'').toLowerCase();
    const arr = []; if(d.includes('armour')) arr.push('armour'); if(d.includes('evasion')) arr.push('evasion'); if(d.includes('energy')) arr.push('energyshield'); return arr;
  }
  function cosineSim(a,b){
    const k=['strength','dexterity','intelligence'];
    const dot = k.reduce((s,x)=>s+(a?.[x]||0)*(b?.[x]||0),0);
    const na  = Math.sqrt(k.reduce((s,x)=>s+(a?.[x]||0)**2,0));
    const nb  = Math.sqrt(k.reduce((s,x)=>s+(b?.[x]||0)**2,0));
    const denom=(na*nb)||1; return dot/denom;
  }
  function buildTagIDF(activeGems){
    const df = new Map(); const N = activeGems.length || 1;
    for(const g of activeGems){
      const S = new Set((g.tags||[]).map(normTagPlus));
      for(const t of S) df.set(t, (df.get(t)||0)+1);
    }
    const idf = new Map(); for(const [t,c] of df) idf.set(t, Math.log(N/(1+c))); return idf;
  }
  function buildRolledTagProfileCtx(ctx){
	  const prof = new Map();
	  const cats = { tactics:new Set(), ailments:new Set() };
	  const add = (k,w)=>{ if(!k) return; prof.set(k, (prof.get(k)||0)+w); };
	  const addAll = (arr,w)=> (arr||[]).forEach(t=>{ const k=normTagPlus(t); add(k,w); });
	
	  const ROLLED_WEIGHTS = { tactics:1.10, ailments:1.00, defStrat:0.70, defense:0.60, weapon:0.50 };
	
	  // --- accept new shape (tacticsTags / ailmentsTags / weaponPseudoTags) OR old (tacticSet / ailmentSet) ---
	  const tacticsArr =
		ctx?.tacticsTags ??
		(ctx?.tacticSet ? (ctx.tacticSet||[]).flatMap(t=>t?.tags||[]) : []);
	
	  const ailmentsArr =
		ctx?.ailmentsTags ??
		(ctx?.ailmentSet ? (ctx.ailmentSet||[]).flatMap(a=>a?.tags||[]) : []);
	
	  cats.tactics = new Set((tacticsArr||[]).map(normTagPlus));
	  cats.ailments= new Set((ailmentsArr||[]).map(normTagPlus));
	
	  addAll(cats.tactics, ROLLED_WEIGHTS.tactics);
	  addAll(cats.ailments, ROLLED_WEIGHTS.ailments);
	
	  const defenseArr = ctx?.defensePseudoTags ?? defensePseudoTags(ctx?.defense?.name);
	  addAll(defenseArr, ROLLED_WEIGHTS.defense);
	
	  const defStratArr = ctx?.defStratTags ?? (ctx?.defStrat?.tags ?? [ctx?.defStrat?.name]);
	  addAll(defStratArr, ROLLED_WEIGHTS.defStrat);
	
	  const weaponArr = ctx?.weaponPseudoTags ?? [ctx?.weapon, ctx?.offhand].filter(Boolean);
	  addAll(weaponArr, ROLLED_WEIGHTS.weapon);
	
	  return { profile: prof, cats };
	}

  
  function scoreGemSynergy(g, rolledCtx, idf, opts){
    const tags = (g.tags||[]).map(normTagPlus); const set = new Set(tags);
    let raw=0, cnt=0, idfSum=0;
    for(const t of tags){ if(rolledCtx.cats.tactics.has(t) || rolledCtx.cats.ailments.has(t)){ const v = idf.get(t); if(v!==undefined){ idfSum+=v; cnt++; } } }
    const idfAvg = cnt? (idfSum/cnt) : 0;
    for(const [t,w] of rolledCtx.profile){ if(set.has(t)) raw += w * (idf.get(t) ?? 0.0); }
    const attrSim = cosineSim(g.requirement_weights||{}, opts.rollAttr||{});
    const weaponHint = tags.some(t=>opts.weaponHints?.has(t)) ? 0.10 : 0;
    const combo = 0;
    let { alpha, beta, noise } = opts; alpha=Math.min(2,Math.max(0,alpha)); beta=Math.min(2,Math.max(0,beta));
    const jitter = (Math.random()-0.5) * (noise||0);
    const score = alpha*raw + beta*attrSim + weaponHint + combo + jitter;
    return { score, raw, attrSim, idfAvg, weaponHint, combo };
  }

  // Capture legacy scorer if present
  const LEGACY = {
    scoreGemSynergy: window.scoreGemSynergy
  };
  window.__LEGACY_SCORER = LEGACY;

  // New scorer installer
  function installNewScorer(state){
    try{
      if (!window.TAG_IDF) {
        const gems = state?.GEMS; let actives = [];
        if (Array.isArray(gems)) { actives = gems.filter(g => String(g.type||g.gem_type||'').toLowerCase().includes('active')); }
        else if (gems && typeof gems === 'object') { actives = Object.values(gems).filter(g => String(g.type||g.gem_type||'').toLowerCase().includes('active')); }
        if (actives.length) window.TAG_IDF = buildTagIDF(actives);
      }
      window.scoreGemSynergy = (g, rolledProfile, idf, knobs) => scoreGemSynergy(g, rolledProfile, idf, knobs);
      window.__NEW_SCORER = { scoreGemSynergy: window.scoreGemSynergy};
    } catch(e){ console.warn('[Scorer.installNewScorer] failed', e); }
  }

})();

function normalizeTag(s){
  return TagUtils.norm(s);
}

// ---------- dictionary builders (TRUE Map) ----------
function buildGemDictionary(gems){
  const m = new Map();
  const put = (k,v) => {
    if (k == null || v == null) return;
    const key = String(k);
    if (!m.has(key)) m.set(key, v);
  };
  (gems||[]).forEach(g => {
    try{
      // ids
      if (g && typeof g === 'object') {
        put(g.id, g);
        if (g.base_item && typeof g.base_item === 'object') {
          put(g.base_item.id, g);
          const disp = g.base_item.display_name || g.name || g.skill_name || g.support_name;
          if (disp) {
            put(disp, g);
            put(String(disp).toLowerCase(), g);
            put(normalizeTag(disp), g);
          }
        } else {
          const disp = g.name || g.skill_name || g.support_name;
          if (disp) {
            put(disp, g);
            put(String(disp).toLowerCase(), g);
            put(normalizeTag(disp), g);
          }
        }
        // also skill/support name keys
        if (g.skill_name) put(String(g.skill_name).toLowerCase(), g);
        if (g.support_name) put(String(g.support_name).toLowerCase(), g);
      }
    }catch(e){ /* skip malformed */ }
  });
  return m;
}
// Robust resolver for support/active gem references (ids, paths, names, objects)
function lookupGem(dict, raw){
  if (!dict) return null;
  if (raw && typeof raw === 'object') return raw;
  const key = String(raw||'').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  const normK = normalizeTag(key);
  const last = lower.includes('/') ? lower.split('/').pop() : lower;
  const lastSan = last.replace(/[^a-z0-9]+/g,'');
  const tries = [key, lower, normK, last, lastSan];
  for (const k of tries){
    const g = dict.get && dict.get(k);
    if (g) return g;
  }
  // Fallback scan by normalized display name
  if (dict instanceof Map) {
    for (const [k,g] of dict) {
      const disp = g?.base_item?.display_name || g?.name || g?.skill_name || g?.support_name;
      if (!disp) continue;
      const nd = normalizeTag(disp);
      if (nd === normK || nd === lastSan) return g;
    }
  }
  return null;
}

// ---------- helpers ----------
function dominantAttr(attrs){ const e=Object.entries(attrs||{}).sort((a,b)=>b[1]-a[1]); const k=(e[0]?.[0]||'int'); return {strength:'str',dexterity:'dex',intelligence:'int'}[k]||k.slice(0,3); }
function sample(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// ---------- v0.7 Synergy Scorer helpers ----------

// Reuse shared alias map
const TAG_ALIASES = window.TAG_ALIASES || TagUtils.alias;

function normTagPlus(s){
  return TagUtils.norm(s);
}

// derive simple weapon/offhand hint tags
function deriveWeaponHints(weapon, offhand){
  const n = (x)=>String(x?.name||'').toLowerCase();
  const w = n(weapon), o = n(offhand);
  const set = new Set();
  const add = (t)=>{ if(t) set.add(t); };

  const scan = (name)=> {
    if (!name) return;

    // specificity first to avoid substring collisions
    if (name.includes('crossbow')) add('crossbow');
    else if (name.includes('bow')) add('bow');

    if (name.includes('quarterstaff')) add('quarterstaff');
    else if (name.includes('staff')) add('staff');

    if (name.includes('sceptre') || name.includes('scepter')) add('sceptre');
    if (name.includes('wand')) add('wand');
    if (name.includes('spear')) add('spear');
    if (name.includes('flail')) add('flail');
    if (name.includes('talisman')) add('talisman');

    if (name.includes('dagger')) add('dagger');
    if (name.includes('claw')) add('claw');
    if (name.includes('sword')) add('sword');
    if (name.includes('axe')) add('axe');
    if (name.includes('mace') || name.includes('hammer')) add('mace');

    if (name.includes('buckler')) add('buckler');
    if (name.includes('shield')) add('shield');
    if (name.includes('quiver')) add('quiver');
    if (name.includes('focus')) add('focus');

    if (name.includes('unarmed')) add('unarmed');
  };

  scan(w); scan(o);
  return set;
}

// build IDF over active gem tag sets
function buildTagIDF(activeGems){
  const df = new Map();
  const N = activeGems.length || 1;
  for(const g of activeGems){
    const S = new Set((g.tags||[]).map(normTagPlus));
    for(const t of S) df.set(t, (df.get(t)||0) + 1);
  }
  const idf = new Map();
  for(const [t,c] of df) idf.set(t, Math.log(N / (1 + c)));
  return idf;
}

// build rolled tag profile and remember category sets for combo logic
const ROLLED_WEIGHTS = {
  tactics: 1.20,
  ailments: 1.10,
  defStrat: 0.70,
  defense: 0.60,
  weapon: 0.50,
};

function defensePseudoTags(defenseName){
  const d = String(defenseName||'').toLowerCase();
  const arr = [];
  if(d.includes('armour')) arr.push('armour');
  if(d.includes('evasion')) arr.push('evasion');
  if(d.includes('energy')) arr.push('energyshield');
  return arr;
}

function buildRolledTagProfileCtx(ctx){
  const prof = new Map();
  const cats = { tactics:new Set(), ailments:new Set() };
  const add = (k,w)=>{ if(!k) return; prof.set(k, (prof.get(k)||0)+w); };
  const addAll = (arr,w)=> (arr||[]).forEach(t=>{ const k=normTagPlus(t); add(k,w); });

  const ROLLED_WEIGHTS = { tactics:1.10, ailments:1.00, defStrat:0.70, defense:0.60, weapon:0.50 };

  // --- accept new shape (tacticsTags / ailmentsTags / weaponPseudoTags) OR old (tacticSet / ailmentSet) ---
  const tacticsArr =
    ctx?.tacticsTags ??
    (ctx?.tacticSet ? (ctx.tacticSet||[]).flatMap(t=>t?.tags||[]) : []);

  const ailmentsArr =
    ctx?.ailmentsTags ??
    (ctx?.ailmentSet ? (ctx.ailmentSet||[]).flatMap(a=>a?.tags||[]) : []);

  cats.tactics = new Set((tacticsArr||[]).map(normTagPlus));
  cats.ailments= new Set((ailmentsArr||[]).map(normTagPlus));

  addAll(cats.tactics, ROLLED_WEIGHTS.tactics);
  addAll(cats.ailments, ROLLED_WEIGHTS.ailments);

  const defenseArr = ctx?.defensePseudoTags ?? defensePseudoTags(ctx?.defense?.name);
  addAll(defenseArr, ROLLED_WEIGHTS.defense);

  const defStratArr = ctx?.defStratTags ?? (ctx?.defStrat?.tags ?? [ctx?.defStrat?.name]);
  addAll(defStratArr, ROLLED_WEIGHTS.defStrat);

  const weaponArr = ctx?.weaponPseudoTags ?? [ctx?.weapon, ctx?.offhand].filter(Boolean);
  addAll(weaponArr, ROLLED_WEIGHTS.weapon);

  return { profile: prof, cats };
}


function cosineSim(a,b){
  const k = ['strength','dexterity','intelligence'];
  const dot = k.reduce((s,x)=>s+(a?.[x]||0)*(b?.[x]||0),0);
  const na = Math.sqrt(k.reduce((s,x)=>s+(a?.[x]||0)**2,0));
  const nb = Math.sqrt(k.reduce((s,x)=>s+(a?.[x]||0)**2,0));
  const denom = (na*nb)||1;
  return dot/denom;
}

// combo boost for matching at least one tactics + one ailment tag
function comboBoostFor(gemTagsNorm, rolled, idf){
  let mt=0, ma=0;
  for(const t of gemTagsNorm){
    if(rolled.cats.tactics.has(t)) mt++;
    if(rolled.cats.ailments.has(t)) ma++;
  }
  if(!mt || !ma) return 0;
  mt = Math.min(mt,2); ma = Math.min(ma,2);
  let idfSum=0, cnt=0;
  for(const t of gemTagsNorm){
    if(rolled.cats.tactics.has(t) || rolled.cats.ailments.has(t)){
      const v = idf.get(t);
      if(v!==undefined){ idfSum+=v; cnt++; }
    }
  }
  const idfAvg = cnt? (idfSum/cnt) : 0;
  const delta = 0.10;
  return delta * mt * ma * idfAvg;
}

// score one gem
function scoreGemSynergy(g, rolledCtx, idf, opts){
  const tags = (g.tags||[]).map(normTagPlus);
  const set = new Set(tags);
  let raw = 0;
  for(const [t,w] of rolledCtx.profile){
    if(set.has(t)) raw += w * (idf.get(t) ?? 0.0);
  }
  const attrSim = cosineSim(g.requirement_weights||{}, opts.rollAttr||{});
  const weaponHint = tags.some(t=>opts.weaponHints?.has(t)) ? 0.10 : 0;
  const combo = comboBoostFor(tags, rolledCtx, idf);
  const jitter = (Math.random()-0.5) * (opts.noise||0);
  const score = opts.alpha*raw + opts.beta*attrSim + weaponHint + combo + jitter;
  return { score, raw, combo, attrSim };
}

// diversity pick (MMR) for the second gem
function pickTwoDiverse(sorted, lambda=0.7){
  if(sorted.length<=1) return sorted.slice(0,2).map(s=>s.item);
  const first = sorted[0];
  const S1 = new Set((first.item.tags||[]).map(normTagPlus));
  let best = -Infinity, idx1 = 0;
  for(let i=1;i<sorted.length;i++){
    const g = sorted[i].item;
    const S2 = new Set((g.tags||[]).map(normTagPlus));
    let inter=0; for(const t of S2){ if(S1.has(t)) inter++; }
    const union = new Set([...S1, ...S2]).size || 1;
    const overlap = inter/union;
    const mmr = lambda*sorted[i].score - (1-lambda)*overlap;
    if(mmr>best){ best=mmr; idx1=i; }
  }
  return [first.item, sorted[idx1].item];
}

// Fixed, mode-agnostic scoring knobs for recommendations.
// These values are a balanced default:
// - alpha: weight on tag/profile synergy
// - beta:  weight on attribute alignment
// - noise: 0 => deterministic recommendations for a given roll.
function synergyTunings(){
  return {
    alpha: 1.0,
    beta:  0.4,
    noise: 0.0
  };
}

export {
  TagUtils,
  normalizeTag,
  buildGemDictionary,
  lookupGem,
  dominantAttr,
  sample,
  TAG_ALIASES,
  normTagPlus,
  deriveWeaponHints,
  buildTagIDF,
  defensePseudoTags,
  buildRolledTagProfileCtx,
  scoreGemSynergy,
  pickTwoDiverse,
  synergyTunings
};
