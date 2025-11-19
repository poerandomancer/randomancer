
/*! Randomancer v0.8.2_cleanup */
"use strict";

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

// ===== DOM helpers =====
const Dom = (() => {
  const q = (sel) => document.querySelector(sel);
  const setText = (sel, txt) => { const el = q(sel); if (el) el.textContent = txt; };
  const setHTML = (sel, html) => { const el = q(sel); if (el) el.innerHTML = html; };
  const txt = (sel) => (q(sel)?.textContent || '').trim();
  return { q, setText, setHTML, txt };
})();

// ===== Shared DOM ready / query helpers (v0.7.5 scaffolding uses these) =====
function onDomReady(fn) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // keep behavior similar to previous helpers
    setTimeout(fn, 0);
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

function getQueryParams() {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams('');
  }
}

// ===== Schema guard =====
const Schema = (() => {
  function okKeys(obj, keys){ return obj && typeof obj === 'object' && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k)); }
  function validateData(data){
    const requiredTop = ["Version","Classes","Weapons","Defense","Ailments","Tactics","DefensiveStrategies"];
    const topOk = okKeys(data, requiredTop);
    return { ok: !!topOk, missing: topOk ? [] : requiredTop.filter(k => !(k in (data||{}))) };
  }
  return { validateData };
})();

// ===== Config =====
const Config = (() => {
  const defaults = Object.freeze({
    synergy: {
      tacticsWeight: 1.0,
      ailmentsWeight: 1.0,
      attributesWeight: 1.0,
      normalization: "legacy",
      useNewScorer: true, // enabled by default in 0.7.2_beta
    },
    rules: {
      strictEnforcement: true,
      capsAgnostic: true,
      useEnginePostValidator: false,
      enableDeflectionDefenseRule: true,
      deflectionRequiresEvasion: ["Evasion", "Armour & Evasion", "Evasion & Energy Shield"],
      enableMinionsWeaponRule: true,
      minionsRequiresWeapon: ["Sceptre"],
      enableBlockOffhandRule: true,
      blockRequiresOffhand: ["Shield","Buckler"],
      enableOneHandedOffhandCombos: true,
      twoHandedWeapons: ["Bow","Staff","Spear","Two-Handed Axe","Two-Handed Sword","Two-Handed Mace"],
      allowedOffhandsForOneHanded: ["Shield","Buckler"],
      blockedOffhandsForTwoHanded: ["Shield","Buckler"],
    },
  });
  function resolve(data){
    try {
      const fromData = (data && data.Config) ? data.Config : {};
      const merged = JSON.parse(JSON.stringify(defaults));
      if (fromData.synergy) Object.assign(merged.synergy, fromData.synergy);
      if (fromData.rules) Object.assign(merged.rules, fromData.rules);
      return Object.freeze(merged);
    } catch (e) {
      console.warn("[Config.resolve] Using defaults due to error:", e);
      return defaults;
    }
  }
  return { resolve };
})();

// ===== RulesEngine (parity scaffold) =====
const RulesEngine = (() => {
  const lc = (s) => (s||"").toLowerCase();
  function snapshot() {
    
    return {
      defense: firstText(Selectors.defense),
      defstrat: firstText(Selectors.defstrat),
      weapons: firstText(Selectors.weapon),
      offhand: firstText(Selectors.offhands),
      tactics: firstText(Selectors.tactics),
      ailments: firstText(Selectors.ailments)
    };
  }
  function evaluate(cfg, s) {
    const v = [];
    if (cfg.rules.enableDeflectionDefenseRule && lc(s.defstrat)==='deflection'){
      const ok = (cfg.rules.deflectionRequiresEvasion||[]).map(lc).includes(lc(s.defense));
      if (!ok) v.push('Deflection requires evasion-based defense');
    }
    if (cfg.rules.enableMinionsWeaponRule && lc(s.tactics).includes('minions')){
      const ok = (cfg.rules.minionsRequiresWeapon||[]).map(lc).includes(lc(s.weapons));
      if (!ok) v.push('Minions requires Sceptre');
    }
    if (cfg.rules.enableBlockOffhandRule && lc(s.defstrat)==='block'){
      const ok = (cfg.rules.blockRequiresOffhand||[]).map(lc).includes(lc(s.offhand));
      if (!ok) v.push('Block requires Shield/Buckler');
    }
    if (cfg.rules.enableOneHandedOffhandCombos){
      const twoHands = (cfg.rules.twoHandedWeapons||[]).map(lc);
      const is2H = twoHands.includes(lc(s.weapons)) || lc(s.weapons).includes('two-handed');
      const allowed1H = (cfg.rules.allowedOffhandsForOneHanded||[]).map(lc);
      const blocked2H = (cfg.rules.blockedOffhandsForTwoHanded||[]).map(lc);
      if (is2H){
        if (blocked2H.includes(lc(s.offhand))) v.push('Two-handed cannot equip this off-hand');
      } else {
        if (allowed1H.length && !allowed1H.includes(lc(s.offhand))) v.push('One-handed requires allowed off-hand');
      }
    }
    return v;
  }
  function enforce(cfg, maxAttempts=25){
    let i=0;
    while (i<maxAttempts){
      const v = evaluate(cfg, snapshot());
      if (v.length===0) return true;
      i++;
      if (typeof window.rollBuild === 'function') window.rollBuild(window.App?.state?.cohesionMode ?? 1);
      else { const btn = document.querySelector('#roll'); if (btn) btn.click(); }
    }
    console.warn('[RulesEngine.enforce] attempts exhausted');
    return false;
  }
  return { snapshot, evaluate, enforce };
})();

// ===== App API =====
const App = window.App = (() => {
  const state = {
    DATA:   null,
    GEMS:   null,
    SKILLS: null,
    CONFIG: null,

    // 0=strict,1=cohesive,2=chaotic,3=madness
    cohesionMode: 1,

    // canonical current roll snapshot
    currentRoll: {
      defense:   '',
      defStrat:  '',
      weapon:    '',
      offhand:   '',
      tactics:   '',
      ailments:  '',
      buildName: '',
      flavor:    ''
    },

    // dev toggle for “single-entry” behavior
    singleEntryMode: true
  };

    async function bootstrap(){
		// Reuse the same preload pipeline the UI uses
		const { core, gems } = await ensureDataPreload();
	
		// loadData() stores the merged/enriched dataset on window.DATA
		const data =
		  (typeof window !== 'undefined' && window.DATA) ||
		  core ||
		  {};
	
		// Sanity check against the canonical schema
		const chk = Schema.validateData(data);
		if (!chk.ok) {
		  console.warn("[schema] missing keys:", chk.missing);
		}
	
		// Hydrate App state from the same data the rest of the app uses
		state.DATA   = data;
		state.GEMS   = gems;                 // enriched gems returned by loadData()
		state.SKILLS = data.skills || null;  // raw skills saved by loadData()
		state.CONFIG = Config.resolve(data);
	  }

  function setCohesion(mode){
	  const n = parseInt(mode, 10);
	  // Default to 1 (cohesive) only if we get something weird/NaN
	  state.cohesionMode = Number.isNaN(n) ? 1 : n;
	}

  function legacyInit(){
    try{
      if (typeof window !== 'undefined') {
        window.DATA = state.DATA; window.SKILL_GEMS = state.GEMS; window.SKILLS = state.SKILLS;
      }
    }catch(e){ console.warn("legacyInit exposure failed:", e); }
  }

  // Post-roll validator: thin wrapper over RulesEngine.enforce
  function validateAndFix(config){
    // Prefer an explicit config, then App.state.CONFIG, then a fresh resolve
    const cfg =
      config ||
      state.CONFIG ||
      (state.DATA ? Config.resolve(state.DATA) : null);

    if (!cfg || !cfg.rules) return;

    try {
      // Single canonical validation path
      RulesEngine.enforce(cfg, 25);
    } catch (e) {
      console.warn('[validateAndFix] error during enforcement', e);
    }
  }
  
  // Expose validator for v0.7.5 scaffolding and other callers
  if (typeof window !== 'undefined') {
    window.validateAndFix = validateAndFix;
  }

  function roll(mode){
    // Trigger the legacy generator
    if (typeof window.rollBuild === "function") {
      window.rollBuild(state.cohesionMode || (mode || 1));
    } else {
      const rollBtn = Dom.q('#roll');
      if (rollBtn) rollBtn.click();
    }

    // Use cached CONFIG when available
    let cfg = state.CONFIG;
    if (!cfg && state.DATA) {
      cfg = Config.resolve(state.DATA);
      state.CONFIG = cfg;
    }

    if (cfg) {
      validateAndFix(cfg);
    }

    // Indicate that we initiated a roll
    return true;
  }

  function captureCurrentRollFromDOM(){
    try{
      const offhand = firstText(['#offhand','#off_hand','#off','#offHand']);

      state.currentRoll = {
        defense:   firstText('#defense'),
        defStrat:  firstText('#defstrat'),
        weapon:    firstText('#weapons'),
        offhand,
        tactics:   firstText('#tactics'),
        ailments:  firstText('#ailments'),
        buildName: firstText('#build-name'),
        flavor:    firstText('#flavor')
      };

      return state.currentRoll;
    } catch (e) {
      return {};
    }
  }

  return { state, bootstrap, setCohesion, legacyInit, roll, captureCurrentRollFromDOM, modules: { Config, RulesEngine } };
})();

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
    cats.tactics = new Set((ctx.tacticSet||[]).flatMap(t=>t?.tags||[]).map(normTagPlus));
    cats.ailments= new Set((ctx.ailmentSet||[]).flatMap(a=>a?.tags||[]).map(normTagPlus));
    addAll(cats.tactics, ROLLED_WEIGHTS.tactics);
    addAll(cats.ailments, ROLLED_WEIGHTS.ailments);
    addAll(defensePseudoTags(ctx.defense?.name), ROLLED_WEIGHTS.defense);
    addAll([ctx.defStrat?.name], ROLLED_WEIGHTS.defStrat);
    addAll([ctx.weapon, ctx.offhand], ROLLED_WEIGHTS.weapon);
    return { profile: prof, cats };
  }
  function deriveWeaponHints(weapon, offhand){
    const set = new Set(); const name = (s)=> String(s||'').toLowerCase();
    const addIf = (src, tag)=>{ const n=name(src); if(n.includes(tag)) set.add(tag); };
    [weapon,offhand].forEach((w)=>{ ['bow','wand','buckler','shield','sceptre','sword','axe','mace','staff','spear','focus','quiver'].forEach(t=>addIf(w,t)); });
    return set;
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
  function quantile(arr, q){ if(!arr || !arr.length) return 0; const xs = arr.slice().sort((a,b)=>a-b); const idx=Math.max(0, Math.min(xs.length-1, Math.floor((xs.length-1)*q))); return xs[idx]; }
  function normalizeSynergy(raw, scored){
    if(!scored || !scored.length) return 0; const raws = scored.map(x=>x.raw).filter(x=>isFinite(x));
    const maxRaw = Math.max(...raws, 0); const p95 = quantile(raws, 0.95);
    const denom = Math.max(p95, maxRaw*0.9, 1e-6); const num = Math.log1p(Math.max(0, raw)); const den = Math.log1p(denom);
    return Math.round(100 * Math.min(1, num / (den || 1)));
  }

  // Capture legacy scorer if present
  const LEGACY = {
    scoreGemSynergy: window.scoreGemSynergy,
    normalizeSynergy: window.normalizeSynergy
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
      window.normalizeSynergy = (raw, scored) => normalizeSynergy(raw, scored);
      window.__NEW_SCORER = { scoreGemSynergy: window.scoreGemSynergy, normalizeSynergy: window.normalizeSynergy };
    } catch(e){ console.warn('[Scorer.installNewScorer] failed', e); }
  }

})();

function normalizeTag(s){
  return TagUtils.norm(s);
}

// ---------- gem + skill enrichment ----------
function flattenGems(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g;
  if (g.SkillGems) return Object.values(g.SkillGems);
  const list = [];
  for (const [key, val] of Object.entries(g)) {
    if (val && typeof val === "object") {
      list.push({ id: key, ...val });
    }
  }
  return list;
}

// ---------- async data loader ----------
async function loadJSON(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return await res.json();
  } catch (err) {
    console.error(`[loadJSON] ${path}`, err);
    return {};
  }
}

// ---------- safe loader wrapper ----------
async function tryLoad(paths) {
  if (!Array.isArray(paths)) paths = [paths];
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        console.log(`[Loaded] ${path}`);
        return await res.json();
      }
    } catch (err) {
      // Silently ignore missing files
    }
  }
  console.warn(`[Missing] none of ${paths.join(', ')}`);
  return {};
}


// ---------- cohesion + selection ----------
const COHESION_MODES = { strict:0.75, cohesive:0.5, chaotic:0.25, madness:0.0 };
let currentMode='cohesive';

function attributeCohesion(a,b){ const k=['strength','dexterity','intelligence']; const dot=k.reduce((s,x)=>s+(a[x]||0)*(b[x]||0),0); const ma=Math.sqrt(k.reduce((s,x)=>s+(a[x]||0)**2,0)); const mb=Math.sqrt(k.reduce((s,x)=>s+(b[x]||0)**2,0)); return dot/(ma*mb||1); }
function pickByCohesion(list, base, th){
  if(!list||!list.length) return null;
  if(th===0) return list[Math.floor(Math.random()*list.length)];
  const scored=list.map(x=>({x,score:attributeCohesion(base,x.attributes||{})}));
  const filtered=scored.filter(s=>s.score>=th);
  const pool=filtered.length?filtered:scored;
  return pool[Math.floor(Math.random()*pool.length)].x;
}

const validOffhands={"One-handed Mace":["One-handed Mace","Shield","Buckler","Focus","Sceptre"],"Spear":["Shield","Buckler","Focus","Sceptre"],"Wand":["Shield","Buckler","Focus","Sceptre"],"Sceptre":["Shield","Buckler","Focus","Wand"]};
function applyHardRestrictions(item,ctx){
  if(!item) return false;
  if(item.name==='Block' && !['Shield','Buckler'].includes(ctx.offhand)) return false;
  if(item.name==='Minions' && ctx.weapon!=='Sceptre') return false;
  if(item.name==='Deflection' && !ctx.defense.includes('Evasion')) return false;
  return true;
}

// ---------- overlay + ascendancy art ----------
function updateAscArt(asc){
  const el = document.getElementById('asc-art');
  if (!el) return;
  const path = `images/ascendancies/${asc.toLowerCase().replace(/\s+/g,'-')}.webp`;

  // Avoid redundant work if we're already showing this art
  if (el.dataset.ascPath === path && el.classList.contains('show')) return;
  el.dataset.ascPath = path;

  // Fade out current art
  el.classList.remove('show');

  // Preload the new image before fading it in
  const img = new Image();
  img.onload = () => {
    // If another roll changed the target meanwhile, bail
    if (el.dataset.ascPath !== path) return;
    el.style.setProperty('--asc-img', `url('${path}')`);
    // Next frame, fade in the new art
    requestAnimationFrame(() => {
      el.classList.add('show');
    });
  };
  img.src = path;
}
const AIL_COLORS = {
  ignite:"rgba(255, 80, 0, 0.08)",
  freeze:"rgba(90, 160, 255, 0.08)",
  shock:"rgba(220, 220, 80, 0.07)",
  poison:"rgba(90, 255, 120, 0.08)",
  bleed:"rgba(255, 60, 60, 0.08)"
};
function updateAilmentOverlay(ailments){
  const panel=document.querySelector('.panel'); if(!panel) return;
  const names = (Array.isArray(ailments) ? ailments.map(a => String(a.name||a).toLowerCase()) : []);
  if(names.length===0){
    panel.style.setProperty('--overlay-gradient','linear-gradient(135deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)'); return;
  }
  const c1 = AIL_COLORS[names[0]] || 'rgba(255,255,255,0.0)';
  if(names.length>1){
    const c2 = AIL_COLORS[names[1]] || 'rgba(255,255,255,0.0)';
    panel.style.setProperty('--overlay-gradient', `linear-gradient(135deg, ${c1} 0%, ${c2} 70%, rgba(0,0,0,0.85) 100%)`);
  }else{
    panel.style.setProperty('--overlay-gradient', `linear-gradient(135deg, ${c1} 0%, rgba(0,0,0,0.85) 100%)`);
  }
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


// --- Synergy chip normalization helpers ---
function quantile(arr, q){
  if(!arr.length) return 0;
  const xs = arr.slice().sort((a,b)=>a-b);
  const idx = Math.max(0, Math.min(xs.length-1, Math.floor((xs.length-1)*q)));
  return xs[idx];
}
function normalizeSynergy(raw, scored){
  if(!scored || !scored.length) return 0;
  const raws = scored.map(x=>x.raw).filter(x=>isFinite(x));
  const maxRaw = Math.max(...raws, 0);
  const p95 = quantile(raws, 0.95);
  // pick a softer denominator to avoid constant 100%s
  const denom = Math.max(p95, maxRaw*0.9, 1e-6);
  // sublinear transform for nicer spread
  const num = Math.log1p(Math.max(0, raw));
  const den = Math.log1p(denom);
  return Math.round(100 * Math.min(1, num / (den || 1)));
}
// ---------- helpers ----------
function dominantAttr(attrs){ const e=Object.entries(attrs||{}).sort((a,b)=>b[1]-a[1]); const k=(e[0]?.[0]||'int'); return {strength:'str',dexterity:'dex',intelligence:'int'}[k]||k.slice(0,3); }
function pickUnique2(list){
  if(!list || list.length<2) return list||[];
  const a = list[Math.floor(Math.random()*list.length)];
  let b = list[Math.floor(Math.random()*list.length)];
  let guard = 0;
  while(b.name===a.name && guard<20){ b = list[Math.floor(Math.random()*list.length)]; guard++; }
  if(b.name===a.name){ return [a]; }
  return [a,b];
}
function sample(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
const NAME_TITLES={
  Warrior:["Ember-Forged","Ironclad","Warborn","Stonebound"],
  Ranger:["Shadowstalker","Silent Arrow","Thorned","Windswift"],
  Witch:["Veil-Touched","Hexbound","Soulweaver","Ashen"],
  Sorceress:["Storm-Wreathed","Starbound","Auric","Umbral"],
  Monk:["Storm-Wreathed","Inner Flame","Tranquil","Sage of Steel"],
  Huntress:["Moonstalker","Wildbloom","Nightsong","Fangstep"],
  Mercenary:["Oathbreaker","Gallowglass","Bloodhired","Black Banner"]
};
const NAME_SUFFIX={
  "Titan":["Vanguard","Colossus","Juggernaut"],
  "Warbringer":["Harbinger","Bloodcaller","War Herald"],
  "Smith of Kitava":["Forgehand","Anvil-Keeper","Brandwright"],
  "Blood Mage":["Hemomancer","Crimson Saint","Veincaller"],
  "Spellblade":["Aetherduelist","Edge of Thought","Mindcarver"],
  "Stormweaver":["Tempest","Skybrand","Thunder-Palm"]
};
function generateBuildName(cls, asc){ const t = sample(NAME_TITLES[cls]||["Nameless"]); const s = sample(NAME_SUFFIX[asc]||["Wanderer"]); return `The ${t} ${s}`; }
const FLAVOR={
  Warrior:["Born of war, bound by honor.","Strength tempered by flame."],
  Ranger:["Swift as shadow, silent as dusk.","The hunt never ends."],
  Witch:["Wisdom is a double-edged curse.","Power whispers, and she listens."],
  Sorceress:["Lightning is a prayer with teeth.","Stars remember those who dare."],
  Monk:["Every strike, a meditation.","Balance through battle."],
  Huntress:["The wild answers in kind.","Footfalls like falling leaves."],
  Mercenary:["Gold buys blades, not mercy.","No banner, only resolve."]
};
function generateFlavorLine(cls, asc){ const arr = FLAVOR[cls] || ["Conjure the impossible. Defy the meta."]; return sample(arr); }
function isDevPlaceholderGem(g){
  const s = (g?.name || g?.base_item?.display_name || g?.id || '').toString();
  return /(\bDNT\b|\bUNUSED\b|Coming\s*Soon)/i.test(s);
}


function weaponsToTypes(weapon, offhand){
  const arr = [];
  if(weapon && weapon.name) arr.push(weapon.name);
  if(offhand && offhand.name) arr.push(offhand.name);
  return arr.map(x=>String(x).toLowerCase());
}

function isGemWeaponCompatible(g, rolledTypesLower){
  const req = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
    ? g.required_weapon_types
    : (Array.isArray(g.crafting_types) ? g.crafting_types : []);
  if(!req.length) return true;
  const reqLower = req.map(x => String(x).toLowerCase());
  const hasOccult = reqLower.includes("occult");
  const hasElemental = reqLower.includes("elemental");
  const hasMaceGeneric = reqLower.includes("mace");
  
  if ((hasOccult || hasElemental) && rolledTypesLower.some(r => r === "sceptre")) return true;
  if (hasElemental && rolledTypesLower.some(r => ["wand", "staff"].includes(r))) return true;
  
  
    if (hasMaceGeneric && rolledTypesLower.some(r => r.includes('mace'))) return true;
  return reqLower.some(r => rolledTypesLower.includes(r));
}

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
  const addIf = (name, key) => { if(name.includes(key)) set.add(key); };
  [w,o].forEach(name=>{
    addIf(name,'sceptre'); addIf(name,'wand'); addIf(name,'staff'); addIf(name,'bow'); addIf(name,'spear');
    addIf(name,'axe'); addIf(name,'sword'); addIf(name,'mace'); addIf(name,'dagger'); addIf(name,'hammer');
    addIf(name,'shield'); addIf(name,'buckler'); addIf(name,'focus'); addIf(name,'quiver');
  });
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
  const cats = { tactics: new Set(), ailments: new Set() };
  const add = (arr, w=1, sink=null) => {
    (arr||[]).forEach(x=>{
      const k = normTagPlus(x);
      if(!k) return;
      prof.set(k, (prof.get(k)||0) + w);
      if(sink) sink.add(k);
    });
  };
  add(ctx.tacticsTags, ROLLED_WEIGHTS.tactics, cats.tactics);
  add(ctx.ailmentsTags, ROLLED_WEIGHTS.ailments, cats.ailments);
  add(ctx.defStratTags, ROLLED_WEIGHTS.defStrat);
  add(ctx.defensePseudoTags, ROLLED_WEIGHTS.defense);
  add(ctx.weaponPseudoTags, ROLLED_WEIGHTS.weapon);
  return { profile: prof, cats };
}

function cosineSim(a,b){
  const k = ['strength','dexterity','intelligence'];
  const dot = k.reduce((s,x)=>s+(a?.[x]||0)*(b?.[x]||0),0);
  const na = Math.sqrt(k.reduce((s,x)=>s+(a?.[x]||0)**2,0));
  const nb = Math.sqrt(k.reduce((s,x)=>s+(b?.[x]||0)**2,0));
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

// map cohesion mode to alpha/beta/noise
function synergyTunings(){
  const m = (typeof currentMode!=='undefined'? currentMode : 'cohesive');
  if(m==='strict') return {alpha:1.15, beta:0.45, noise:0.00};
  if(m==='cohesive') return {alpha:1.00, beta:0.35, noise:0.02};
  if(m==='chaotic') return {alpha:0.80, beta:0.25, noise:0.05};
  return {alpha:0.60, beta:0.15, noise:0.08}; // madness
}
// ---------- support gems renderer ----------
function renderSupportCards(supportEntries, gemDict){
  const items=[];
  (supportEntries||[]).forEach(n=>{
    const g = lookupGem(gemDict, n);
    const title = g ? (g?.base_item?.display_name || g?.support_name || g?.name || String(n)) : String(n);
    const desc  = g ? (g?.support_text || g?.description || (g?.granted_effect && g?.granted_effect.description) || '') : '';
    const cls   = g ? dominantAttr(g.requirement_weights||g.attributes||{}) : 'int';
    if (g) {
      items.push(`<div class="support-item ${cls}"><div class="support-title">${title}</div>${desc?`<p class="support-desc">${desc}</p>`:''}</div>`);
    } else {
      // Minimal graceful fallback
      items.push(`<div class="support-item ${cls}"><div class="support-title">${title}</div></div>`);
    }
  });
  return items.join('');

}

// ---------- skill cards (with Grants + Req. Weapon) ----------

function isPersistentBuffGem(g){
  if (!g) return false;
  const tags = Array.isArray(g.tags) ? g.tags.map(normalizeTag) : [];
  const set = new Set(tags);
  return set.has('buff') && set.has('persistent');
}

function rollRecommendedSkills(dataWrap, baseAttrs, picked, rollCtx){
  try{
    const rolledTypesLower = weaponsToTypes(picked.weapon, picked.offhand);
    const gems = (window.DATA && window.DATA.gems) ? window.DATA.gems : (dataWrap.gems || []);
    const actives = gems.filter(g =>
      g.type === 'active' &&
      Array.isArray(g.crafting_types) && g.crafting_types.length > 0 &&
      !isDevPlaceholderGem(g)
    );

    // Separate persistent buff skills from general pool
    const persistentPool = actives.filter(g => isPersistentBuffGem(g) && isGemWeaponCompatible(g, rolledTypesLower));
    const eligible = actives.filter(g =>
      isGemWeaponCompatible(g, rolledTypesLower) &&
      !isPersistentBuffGem(g)
    );

    // Build/ensure global IDF
    if(!window.TAG_IDF){
      window.TAG_IDF = buildTagIDF(actives);
    }

    // Build rolled profile context
    const ctx = rollCtx || window.CURRENT_ROLL || {};
    const rolledProfile = buildRolledTagProfileCtx({
      tacticsTags: (ctx.tacticSet||[]).flatMap(t=>t?.tags||[]),
      ailmentsTags: (ctx.ailmentSet||[]).flatMap(a=>a?.tags||[]),
      defStratTags: (ctx.defStrat?.tags)||[],
      defensePseudoTags: defensePseudoTags(ctx.defense?.name),
      weaponPseudoTags: Array.from(deriveWeaponHints(picked.weapon, picked.offhand))
    });

    // Scoring knobs from cohesion mode
    const knobs = synergyTunings();
    knobs.rollAttr = ctx.rollAttr || baseAttrs || {strength:0.33,dexterity:0.33,intelligence:0.33};
    knobs.weaponHints = deriveWeaponHints(picked.weapon, picked.offhand);

    // Score all eligibles for main recommended skills
    const scored = eligible.map(g => {
      const s = scoreGemSynergy(g, rolledProfile, window.TAG_IDF, knobs);
      return { item:g, score:s.score, raw:s.raw };
    }).sort((a,b)=>b.score - a.score);

    // Pick two with diversity
    const picks = pickTwoDiverse(scored, 0.7);

    const grid = document.getElementById('skills-grid');
    if(!grid){ return; }
    grid.innerHTML = '';

    // Small helper to render grant line
    const grantLine = (g) => {
      const list = Array.isArray(g.granted_skills_full) ? g.granted_skills_full : [];
      if(!list.length) return '';
      const first = list[0];
      const desc = first?.description || g.grant_description || '';
      const dn = first?.display_name || g.grant_display || '';
      if(!dn && !desc) return '';
      return `
        <div class="grant-wrap">
          <div class="grants-label">Grants</div>
          <div class="grant">
            <div class="grant-title">${dn || ''}</div>
            <div class="grant-desc">${desc || ''}</div>
          </div>
        </div>
      `;
    };

    const gemDict = buildGemDictionary(gems);

    // Render main recommended skills
    picks.forEach(g => {
      const card = document.createElement('div');
      card.className = 'skill-card';

      const reqBlock = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
        ? `<div class="req-block"><span class="req-label">Requires</span> <span class="req-text">${g.required_weapon_types.map(x=>x[0].toUpperCase()+x.slice(1)).join(', ')}</span></div>`
        : '';

      const allTags = Array.isArray(g.tags)? g.tags.slice(): [];
      const br = Array.isArray(g.bracket_tags)? g.bracket_tags: [];
      const rest = allTags.filter(t=>!br.includes(t));
      const displayTags = [...br, ...rest].slice(0,10);

      // mark matched tags
      const matched = new Set();
      for(const t of displayTags){
        const k = normTagPlus(t);
        if(rolledProfile.profile.has(k)) matched.add(k);
      }
      const pills = displayTags.map(t=>{
        const k = normTagPlus(t);
        const cls = matched.has(k) ? 'tag-pill matched' : 'tag-pill';
        return `<span class="${cls}">${t}</span>`;
      }).join('');

      // compute synergy percent
      const sc = scored.find(x=>x.item===g);
      const synergyPct = sc? normalizeSynergy(sc.raw, scored) : 0;

      card.innerHTML = `
        <div class="skill-title">
          ${g.name||'(Unnamed Gem)'}
          <span class="synergy-chip">Synergy ${synergyPct}%</span>
        </div>
        ${reqBlock}
        ${grantLine(g)}
        <div class="skill-tags">${pills}</div>
        <div class="supports-label">Recommended Supports</div>
        <div class="supports">
          ${renderSupportCards(g.recommended_supports, gemDict)}
        </div>
      `;
      applyGemBorderFromReqWeights(card, g.requirement_weights);
      grid.appendChild(card);
    });

    // Render a dedicated persistent buff skill section (single card, full-width)
    renderPersistentBuffSkill(persistentPool, rolledProfile, window.TAG_IDF, knobs, gems);
  }catch(e){
    console.error("[skills] render error", e);
  }
  }


function renderPersistentBuffSkill(persistentPool, rolledProfile, tagIDF, knobs, gems){
  try {
    // Clear any previous persistent buff section
    document.querySelectorAll('#persistent-buff-section').forEach(el => el.remove());

    if (!Array.isArray(persistentPool) || !persistentPool.length) return;

    const actives = persistentPool.filter(g => g && g.type === 'active');
    if (!actives.length) return;

    // Score persistent buff candidates with the same synergy engine
    const scoredPB = actives.map(g => {
      const s = scoreGemSynergy(g, rolledProfile, tagIDF, knobs);
      return { item:g, score:s.score, raw:s.raw };
    }).sort((a,b) => b.score - a.score);

    const top = scoredPB[0];
    if (!top || !isFinite(top.raw)) return;

    const skillsGrid = document.getElementById('skills-grid');
    const skillsSect = skillsGrid ? skillsGrid.closest('.sect') : null;
    const main = document.querySelector('main') || document.body;
    const parent = (skillsSect && skillsSect.parentNode) || main;

    // Build section container
    const wrap = document.createElement('div');
    wrap.id = 'persistent-buff-section';
    wrap.className = 'sect';
    wrap.innerHTML = `
      <div class="sect-head">
        <h3>Recommended Persistent Buff</h3>
        <div class="underline"></div>
        <p class="sub">A long-lasting buff skill that supports this build</p>
      </div>
      <div id="persistent-buff-grid" class="grid persistent-buff-grid"></div>
    `;

    if (skillsSect) {
      skillsSect.insertAdjacentElement('afterend', wrap);
    } else {
      parent.appendChild(wrap);
    }

    const grid = wrap.querySelector('#persistent-buff-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const g = top.item;
    const gemDict = buildGemDictionary(gems || []);
    const card = document.createElement('div');
    card.className = 'skill-card persistent-buff-card';

    const reqBlock = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
      ? `<div class="req-block"><span class="req-label">Requires</span> <span class="req-text">${g.required_weapon_types.map(x=>x[0].toUpperCase()+x.slice(1)).join(', ')}</span></div>`
      : '';

    const allTags = Array.isArray(g.tags)? g.tags.slice(): [];
    const br = Array.isArray(g.bracket_tags)? g.bracket_tags: [];
    const rest = allTags.filter(t=>!br.includes(t));
    const displayTags = [...br, ...rest].slice(0,10);

    const matched = new Set();
    for(const t of displayTags){
      const k = normTagPlus(t);
      if(rolledProfile.profile.has(k)) matched.add(k);
    }
    const pills = displayTags.map(t=>{
      const k = normTagPlus(t);
      const cls = matched.has(k) ? 'tag-pill matched' : 'tag-pill';
      return `<span class="${cls}">${t}</span>`;
    }).join('');

    const synergyPct = normalizeSynergy(top.raw, scoredPB);

    card.innerHTML = `
      <div class="skill-title">
        ${g.name||'(Unnamed Gem)'}
        <span class="synergy-chip">Synergy ${synergyPct}%</span>
      </div>
      ${reqBlock}
      <div class="skill-tags">${pills}</div>
      <div class="supports-label">Recommended Supports</div>
      <div class="supports">
        ${renderSupportCards(g.recommended_supports, gemDict)}
      </div>
    `;
    applyGemBorderFromReqWeights(card, g.requirement_weights);
    grid.appendChild(card);
  } catch (e) {
    console.error('[persistent buff] render error', e);
  }
}

// ---- Active gem border color from requirement_weights ----
function applyGemBorderFromReqWeights(el, weights){
  if(!el) return;
  const w = weights||{};
  const s = Number(w.strength||0), d = Number(w.dexterity||0), i = Number(w.intelligence||0);
  const max = Math.max(s,d,i);
  const colors = [];
  if(s===max && max>0) colors.push('rgba(176,48,48,0.9)');
  if(d===max && max>0) colors.push('rgba(45,122,45,0.9)');
  if(i===max && max>0) colors.push('rgba(47,79,157,0.9)');
  if(colors.length<=1){
    const c = colors[0] || 'rgba(200,200,200,0.35)';
    el.style.border = '1px solid ' + c;
    el.style.boxShadow = '0 0 8px rgba(255,255,255,0.06)';
    return;
  }
  // gradient for ties
  el.style.border = '1px solid transparent';
  el.style.borderImage = `linear-gradient(90deg, ${colors.join(', ')}) 1`;
  el.style.boxShadow = '0 0 10px rgba(255,255,255,0.06)';
}

// ---------- data preload helper ----------
let dataPromise = null;
let dataReady = false;
/**
 * Ensure the core + skill datasets start loading as early as possible.
 * Returns a shared promise reused by all roll triggers.
 */
function ensureDataPreload(){
  if (!dataPromise) {
    dataPromise = loadData().then(result => {
      dataReady = true;
      return result;
    }).catch(err => {
      console.error("[Randomancer] Data preload failed", err);
      dataReady = false;
      dataPromise = null; // allow retry on next click
      throw err;
    });
  }
  return dataPromise;
}

// ---------- wireup ----------
document.addEventListener('DOMContentLoaded', ()=>{
  const slider = document.getElementById('cohesionRange');
	if (slider) {
	  const modeMap = ['strict','cohesive','chaotic','madness'];
	  slider.addEventListener('input', e => {
		const idx = Number(e.target.value) || 0;
		currentMode = modeMap[idx] || 'cohesive';
	
		// Keep App.state.cohesionMode in step with the UI slider
		if (window.App && typeof window.App.setCohesion === 'function') {
		  window.App.setCohesion(idx);
		}
	  });
	}

    // Kick off preloading while the intro screen is up and hydrate App.state from it
	  if (window.App && typeof window.App.bootstrap === 'function') {
		window.App.bootstrap().catch(err => {
		  console.error("[Randomancer] App bootstrap failed", err);
		});
	  } else {
		// Fallback: just preload data as before
		ensureDataPreload().catch(err => {
		  console.error("[Randomancer] Preload on DOMContentLoaded failed", err);
		});
	  }

  const rollBtn = document.getElementById('roll');
  if (rollBtn) {
    const statusEl = rollBtn.querySelector('.roll-status');
    rollBtn.addEventListener('click', async () => {
      // Tiny loading hint if data is still warming up
      rollBtn.classList.add('is-loading');
      if (statusEl && !dataReady) {
        statusEl.textContent = 'Preparing the fates…';
      }

      try {
        const data = await ensureDataPreload();
        rollBuild(data);
      } catch (err) {
        console.error('[Randomancer] roll failed:', err);
        if (statusEl) {
          statusEl.textContent = 'Something went wrong. Try again.';
        }
      } finally {
        // Clear the loading state once data has loaded or failed
        setTimeout(() => {
          rollBtn.classList.remove('is-loading');
          if (statusEl && dataReady) {
            statusEl.textContent = '';
          }
        }, 120);
      }
    });
  }
});

function rollBuild(dataWrap){
  // Accept either the { core, gems } wrapper or fall back to global DATA
  let data = null;

  if (dataWrap && typeof dataWrap === 'object' && dataWrap.core) {
    // Canonical path: called from ensureDataPreload() -> { core, gems }
    data = dataWrap.core;
  } else if (typeof window !== 'undefined' && window.DATA) {
    // Fallback: use globally-initialized DATA (set by loadData / App.bootstrap)
    data = window.DATA;
  }

  if (!data) {
    console.error('[rollBuild] No data available for roll');
    return;
  }

  const th = COHESION_MODES[currentMode];
  const classes = Object.entries(data.Classes);
  const [clsName, clsData] = classes[Math.floor(Math.random() * classes.length)];
  const base = clsData.attributes;

  document.getElementById('class')?.replaceChildren(document.createTextNode(clsName));
  const asc=clsData.ascendancies[Math.floor(Math.random()*clsData.ascendancies.length)];
  document.getElementById('ascendancy')?.replaceChildren(document.createTextNode(asc));
  updateAscArt(asc);

  const weaponPool=data.Weapons['Two-Handed'].concat(data.Weapons['One-Handed']);
  const weapon=pickByCohesion(weaponPool,base,th);

  let offhand=null;
  if(weapon && Object.keys(validOffhands).includes(weapon.name)){
    const offPool=data.Weapons['Off-Hand'].filter(o=>validOffhands[weapon.name].includes(o.name));
    offhand=pickByCohesion(offPool,base,th);
  }
  document.getElementById('weapons')?.replaceChildren(document.createTextNode(offhand?`${weapon.name} & ${offhand.name}`:weapon.name));

  const defense=pickByCohesion(data.Defense,base,th);
  document.getElementById('defense')?.replaceChildren(document.createTextNode(defense.name));

  const dsPool=data.DefensiveStrategies.filter(ds=>applyHardRestrictions(ds,{defense:defense.name,weapon:weapon.name,offhand:offhand?.name||''}));
  const defStrat=pickByCohesion(dsPool,base,th);
  document.getElementById('defstrat')?.replaceChildren(document.createTextNode(defStrat?.name||''));

  function filterTacticsByStrictRules(allTactics, weapon, offhand){
  const w = String(weapon?.name||'').toLowerCase();
  const o = String(offhand?.name||'').toLowerCase();
  const hasSceptre = (w.includes('sceptre') || o.includes('sceptre'));
  return allTactics.filter(t => {
    const tn = String(t?.name||'').toLowerCase();
    if(tn==='minions' && !hasSceptre) return false;
    return true;
  });
}

// Ailments/Tactics roll (with duplicate prevention)
  let ailmentSet=[], tacticSet=[]; const r=Math.random();
  if(r<0.6){ ailmentSet=[data.Ailments[Math.floor(Math.random()*data.Ailments.length)]]; tacticSet=[filterTacticsByStrictRules(data.Tactics, weapon, offhand)[Math.floor(Math.random()*filterTacticsByStrictRules(data.Tactics, weapon, offhand).length)]]; }
  else if(r<0.8){ const a1=data.Ailments[Math.floor(Math.random()*data.Ailments.length)], a2=data.Ailments.filter(x=>x.name!==a1.name)[Math.floor(Math.random()*(data.Ailments.length-1))]; ailmentSet=[a1,a2]; }
  else { const _pool=filterTacticsByStrictRules(data.Tactics, weapon, offhand); const t1=_pool[Math.floor(Math.random()*_pool.length)]; const t2=_pool.filter(x=>x.name!==t1.name)[Math.floor(Math.random()*Math.max(1,_pool.length-1))]; tacticSet=[t1,t2]; }

  document.getElementById('ailments')?.replaceChildren(document.createTextNode((ailmentSet.filter(Boolean).map(a=>a.name).join(' & ')||'')));
  document.getElementById('tactics')?.replaceChildren(document.createTextNode((tacticSet.filter(Boolean).map(t=>t.name).join(' & ')||'')));
  updateAilmentOverlay(ailmentSet.filter(Boolean));

  // Balance aggregation
  const add=(a,b)=>({strength:(a.strength||0)+(b.strength||0), dexterity:(a.dexterity||0)+(b.dexterity||0), intelligence:(a.intelligence||0)+(b.intelligence||0)});
  const norm=(a)=>{ const t=(a.strength||0)+(a.dexterity||0)+(a.intelligence||0)||1e-6; return {strength:(a.strength||0)/t, dexterity:(a.dexterity||0)/t, intelligence:(a.intelligence||0)/t}; };
  const sumParts = [ norm(base), norm(weapon?.attributes||{}), norm(offhand?.attributes||{}), norm(defense?.attributes||{}), norm(defStrat?.attributes||{}) ].reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0});
  const ailAvg = (ailmentSet.filter(Boolean).map(a=>a.attributes||{}).map(norm).reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0}));
  const tacAvg = (tacticSet.filter(Boolean).map(a=>a.attributes||{}).map(norm).reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0}));
  const total = {strength: sumParts.strength+ailAvg.strength+tacAvg.strength, dexterity: sumParts.dexterity+ailAvg.dexterity+tacAvg.dexterity, intelligence: sumParts.intelligence+ailAvg.intelligence+tacAvg.intelligence};
  const T = (total.strength+total.dexterity+total.intelligence)||1e-6;
  const S=total.strength/T, D=total.dexterity/T, I=total.intelligence/T;
  const bar=document.getElementById('balance-bar');
  const grad=`linear-gradient(90deg, rgba(176,48,48,1) 0%, rgba(176,48,48,1) ${S*100}%, rgba(45,122,45,1) ${S*100}%, rgba(45,122,45,1) ${(S+D)*100}%, rgba(47,79,157,1) ${(S+D)*100}%, rgba(47,79,157,1) 100%)`;
  bar.style.setProperty('--balance-gradient', grad);
  bar.classList.add('glow');
  document.getElementById('balance-text').textContent = `Strength ${Math.round(S*100)}%  |  Dexterity ${Math.round(D*100)}%  |  Intelligence ${Math.round(I*100)}%`;


  // Build name + flavor (restored)
  document.getElementById('build-name').textContent = generateBuildName(clsName, asc);
  document.getElementById('build-subtext').textContent = generateFlavorLine(clsName, asc);


  // Stash the roll context for synergy scorer
  window.CURRENT_ROLL = {
	  ailmentSet: ailmentSet.filter(Boolean),
	  tacticSet: tacticSet.filter(Boolean),
	  defense: defense,
	  defStrat: defStrat,
	  weapon: weapon?.name || '',
	  offhand: offhand?.name || '',
	  rollAttr: { strength: S, dexterity: D, intelligence: I }
	};

  // Skills (weapon-limited + synergy scoring)
  rollRecommendedSkills(dataWrap, base, {weapon, offhand}, window.CURRENT_ROLL);
  
  // Uniques: trigger the synergy engine directly using the current roll snapshot
  try {
    if (typeof window.RandomancerRefreshUniques === 'function') {
      window.RandomancerRefreshUniques(window.CURRENT_ROLL);
    }
  } catch (e) {
    console.warn('[Randomancer] uniques refresh failed', e);
  }

}


function normalizeGem(g){
  const o = Object.assign({}, g);
  o.id = o.id || o.base_item?.id || o.base_item?.display_name || o.name || o.skill_name || o.support_name || '';
  o.name = o.name || o.base_item?.display_name || o.skill_name || o.support_name || null;
  o.type = (o.type || o.gem_type || (o.support_text ? 'support' : 'active') || '').toLowerCase();
  o.tags = Array.isArray(o.tags) ? o.tags : [];
  o.crafting_types = Array.isArray(g.crafting_types) ? g.crafting_types.slice() : [];
  return o;
}


function enrichGems(gemData, skillsData){
  const flat = flattenGems(gemData);
  const skills = skillsData || {};
  const skillIndex = skills; // assume data/skills.json already keyed by id

  const merged = flat.map(g0 => {
    const g = normalizeGem(g0);

    // Exclude invalid / dev placeholders / missing crafting types
    if (!g.base_item || !g.base_item.display_name) return null;
    if (isDevPlaceholderGem(g)) return null;
    if (!Array.isArray(g.crafting_types) || g.crafting_types.length === 0) return null;

    // Set required weapon types (lowercased)
    g.required_weapon_types = g.crafting_types.map(x => String(x).toLowerCase());
    
    let grantName = null, grantDesc = '';
const grantsArr = Array.isArray(g.grants_skills) ? g.grants_skills : [];
const granted_list = [];
const allGrantBracketTags = [];
for(const gid of grantsArr){
  const sk = skills[gid];
  if(sk && sk.active_skill){
    const dn = sk.active_skill.display_name || '';
    const dd = sk.active_skill.description || '';
    if(!grantName && dn) grantName = dn;
    if(!grantDesc && dd) grantDesc = dd;
    granted_list.push({ id: gid, display_name: dn, description: dd });
    extractBracketTags(dd).forEach(t => { if(!allGrantBracketTags.includes(t)) allGrantBracketTags.push(t); });
  }
}
g.granted_skills_full = granted_list;
const gemDesc = g.description || g.support_text || '';
    const composedDesc = (gemDesc ? gemDesc + (grantDesc ? ' ' + grantDesc : '') : grantDesc);
    g.description = composedDesc || gemDesc || grantDesc || '';

    // Attach a friendly requirement line
    let req_line = '';
    if (g.required_weapon_types && g.required_weapon_types.length){
      const cap = g.required_weapon_types.map(t => t.charAt(0).toUpperCase() + t.slice(1));
      req_line = `Requires ${cap.join(' or ')}`;
    }

    // Description: prefer gem.description/support_text, augment with active_skill.description if short
    const firstSkillId = Array.isArray(g.grants_skills) ? g.grants_skills[0] : null;
    const s = firstSkillId ? skillIndex[firstSkillId] || null : null;
    let description = g.description || g.support_text || '';
    if ((!description || description.length < 50) && s && s.active_skill && s.active_skill.description){
      description = description ? (description + ' ' + s.active_skill.description) : s.active_skill.description;
    }

    // Tags: gem tags + skill types + [bracketed] tokens from description
    const baseTags = Array.isArray(g.tags) ? g.tags.map(normalizeTag) : [];
    const skillTypes = Array.isArray(s?.active_skill?.types) ? s.active_skill.types.map(normalizeTag) : [];
    const bracketTags = allGrantBracketTags;
    const desc = (s?.active_skill?.description || '') + ' ' + (g.description || g.support_text || '');
    const bracket = desc.match(/\[[^\]]+\]/g) || [];
    const descTags = [];
    bracket.forEach(b => {
      const inner = b.slice(1,-1);
      const token = inner.split('|')[0];
      const clean = normalizeTag(token);
      if (clean && !descTags.includes(clean)) descTags.push(clean);
    });
    g.bracket_tags = bracketTags;
    const mergedTags = Array.from(new Set([...baseTags, ...skillTypes, ...descTags, ...bracketTags].filter(Boolean)));

	if(grantName){
      g.grant_display = grantName;
      g.grant_description = grantDesc || '';
    }

    return {
      ...g,
      description,
      req_text: req_line,
      tags: mergedTags
    };
  }).filter(Boolean);

  console.log("[Skill Enrichment]", merged.length, "enriched skill entries.");
  return merged;
}


// ---------- data initialization ----------
async function loadData() {
  try {
    const core = await loadJSON('data_0.8.2_cleanup.json');
    const gemsRaw = await tryLoad(['data/skill_gems.json', 'gems.json']);
    const skillsRaw = await tryLoad(['data/skills.json']);
    const enr = enrichGems(gemsRaw, skillsRaw);
    console.log(`[Skill Enrichment] ${enr.length} enriched skill entries.`);

    window.DATA = {
      ...core,
      gems: enr,
      skills: skillsRaw,
      skill_gems: gemsRaw
    };
    console.log("[Global DATA initialized]", window.DATA);

    return { core, gems: enr };
  } catch (err) {
    console.error("[loadData] Failed to load core data:", err);
    return { core: {}, gems: [] };
  }
}

function extractBracketTags(description){
    const found = [];
    const matches = String(description||'').match(/\[([^\]]+)\]/g) || [];
    matches.forEach(m => {
      const inner = m.replace(/[\[\]]/g, '');
      inner.split('|').map(x => x.trim()).filter(Boolean).map(normalizeTag).forEach(t => {
        if(t && !found.includes(t)) found.push(t);
      });
    });
    return found;
  }


// === v0.7.3 TAG_IDF cache ===
(function(){
  function simpleHash(str){
    let h=2166136261>>>0;
    for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h>>>0).toString(16);
  }
  function buildKeyFromGems(gems){
    try{
      const parts = [];
      if (Array.isArray(gems)){
        for (const g of gems){
          const id = g.id || g._id || g.name || JSON.stringify(g).slice(0,64);
          const tags = (g.tags||[]).join('|');
          parts.push(id + '#' + tags);
        }
      } else if (gems && typeof gems === 'object'){
        for (const [k,g] of Object.entries(gems)){
          const id = g.id || g._id || g.name || k;
          const tags = (g.tags||[]).join('|');
          parts.push(id + '#' + tags);
        }
      }
      return 'idf_' + simpleHash(parts.join('~'));
    }catch(e){ return 'idf_' + Date.now(); }
  }
  function getActiveGems(gems){
    if (Array.isArray(gems)) return gems.filter(g => String(g.type||g.gem_type||'').toLowerCase().includes('active'));
    if (gems && typeof gems === 'object') return Object.values(gems).filter(g => String(g.type||g.gem_type||'').toLowerCase().includes('active'));
    return [];
  }
  window.__IDF_CACHE__ = window.__IDF_CACHE__ || {};
  window.getOrBuildIDF = function(state){
    try{
      const actives = getActiveGems(state?.GEMS||[]);
      const key = buildKeyFromGems(actives);
      if (window.__IDF_CACHE__[key]) return window.__IDF_CACHE__[key];
      const idf = (typeof buildTagIDF === 'function') ? buildTagIDF(actives) : new Map();
      window.__IDF_CACHE__[key] = idf;
      return idf;
    }catch(e){ console.warn('[idf cache] failed', e); return new Map(); }
  };
})();

// ===== v0.7.5_release — Opt‑in Pre‑Gate + State→DOM sync (no end‑user behavior change by default) =====
(function(){
  // Lightweight roll listeners (for uniques, metrics, etc.)
  const rollListeners = new Set();

  function notifyRoll() {
    try {
      const App = window.App;
      if (!App || !App.state || !App.state.currentRoll) return;
      const snap = { ...App.state.currentRoll };
      rollListeners.forEach(fn => {
        try { fn(snap); } catch (e) {
          console.warn('[App.onRoll listener]', e);
        }
      });
    } catch (e) {
      console.warn('[App.notifyRoll]', e);
    }
  }

  // Expose subscribe API on App once it's ready
	onDomReady(() => {
	  const App = window.App;
	  if (!App) return;
	
	  App.onRoll = function(fn){
		if (typeof fn === 'function') rollListeners.add(fn);
		return () => rollListeners.delete(fn);
	  };
	  App.offRoll = function(fn){
		if (fn) rollListeners.delete(fn);
	  };
	});

  // State→DOM sync: keeps DOM in line with App.state.currentRoll (non-invasive)
	onDomReady(() => {
	  const App = window.App;
	  if (!App) return;
	
	  App.syncDOMFromState = function(){
		try{
		  const s = App.state.currentRoll;
		  const set = (sel, txt)=>{ const el = document.querySelector(sel); if(el && (typeof txt==='string')) el.textContent = txt; };
		  set('#defense',  s.defense);
		  set('#defstrat', s.defStrat);
		  set('#weapons',  s.weapon);
		  set('#offhand',  s.offhand);
		  set('#tactics',  s.tactics);
		  set('#ailments', s.ailments);
		  set('#build-name', s.buildName);
		  set('#flavor', s.flavor);
		}catch(e){ /*no-op*/ }
	  };
	});


  // Pre‑Gate core: evaluate snapshot and decide if valid
  function snapshot(){ try { return (window.RulesEngine && window.RulesEngine.snapshot) ? window.RulesEngine.snapshot() : {}; } catch{ return {}; } }
  function evaluate(cfg, snap){ try { return (window.RulesEngine && window.RulesEngine.evaluate) ? window.RulesEngine.evaluate(cfg, snap) : []; } catch{ return ['no-engine']; } }

  // Unify programmatic roll with optional pre‑gate loop
  onDomReady(() => {
	  const App = window.App;
	  if (!App) return;
	
	  const wantPreGate = () => {
		try {
		  const q = getQueryParams();
		  if (q.get('pregate') === '1') return true;
		  return !!(App.state.CONFIG && App.state.CONFIG.rules && App.state.CONFIG.rules.enablePreGate);
		} catch {
		  return false;
		}
	  };
	
	  const maxPreAttempts = 25;

    // Patch App.roll to include optional pre‑gate
    const prevRoll = App.roll || function(mode){
      if (typeof window.rollBuild === 'function'){
        try{ window.rollBuild(App.state?.cohesionMode ?? (mode||1)); }catch(e){}
      } else {
        const btn = document.querySelector('#roll'); if (btn) btn.click();
      }
      return true;
    };
    App.roll = function(mode){
      const cfg = App.state?.CONFIG || null;
      // If pregate is ON, loop until valid before running any post‑validator
      if (wantPreGate() && cfg){
        let attempts = 0, ok = false;
        while (attempts < maxPreAttempts){
          attempts++;
          // trigger a roll via legacy path
          if (typeof window.rollBuild === 'function'){
            try{ window.rollBuild(App.state?.cohesionMode ?? (mode||1)); }catch(e){}
          } else {
            const btn = document.querySelector('#roll'); if (btn) btn.click();
          }
          // evaluate immediately
          const v = evaluate(cfg, snapshot());
          if (!v || v.length === 0){ ok = true; break; }
        }
        try {
          // metrics (debug only overlay reads this)
          window.__RANDOMANCER_METRICS__ = window.__RANDOMANCER_METRICS__ || { rolls:0, lastAttempts:0, emaAttempts:0 };
          const m = window.__RANDOMANCER_METRICS__;
          m.rolls += 1;
          m.lastAttempts = attempts|0;
          m.emaAttempts = m.emaAttempts ? (0.2*attempts + 0.8*m.emaAttempts) : attempts;
        } catch {}
        // guard: still run validateAndFix as safety
        try { if (typeof window.validateAndFix === 'function' && cfg) window.validateAndFix(cfg); } catch {}
      } else {
        // default legacy behavior
        prevRoll(mode);
        try { if (typeof window.validateAndFix === 'function' && App.state?.CONFIG) window.validateAndFix(App.state.CONFIG); } catch {}
      }

      // capture → sync
      try { App.captureCurrentRollFromDOM(); App.syncDOMFromState(); } catch {}
      
      // notify listeners that a roll has completed
      try { notifyRoll(); } catch (e) {}
      
      return true;
    };

    // Funnel the Roll button to App.roll (capture phase) so every roll uses the unified pipeline
	document.addEventListener('DOMContentLoaded', () => {
	  const btn = document.querySelector('#roll');
	  if (btn && !btn.__appRollHooked){
		btn.__appRollHooked = true;
		btn.addEventListener('click', (e) => {
		  e.stopImmediatePropagation();
		  e.preventDefault();
		  try {
			// Prefer the unified App.roll entrypoint
			if (window.App && typeof window.App.roll === 'function') {
			  window.App.roll();
			} else if (typeof window.rollBuild === 'function') {
			  // Fallback: legacy behavior if App.roll isn't ready for some reason
			  window.rollBuild();
			}
		  } catch (err) {
			console.warn('[App.roll hook] click handler error', err);
		  }
		}, true);
		console.log('[App.roll] capture-phase funnel active');
	  }
	});

  });
})();

// ===== v0.7.5_release — defaults: single-entry ON, plus state capture/sync wrapper =====
(function(){

  onDomReady(() => {
    const App = window.App;
    if (!App) return;

    App.dev = App.dev || {};

    if (!App.dev.setSingleEntry){
      App.dev.setSingleEntry = function(on){
        try {
          App.state.singleEntryMode = !!on;
          localStorage.setItem('randomancer_single_entry', on ? '1' : '0');
        } catch(e){}
      };
    }
  });

  onDomReady(() => {
    const App = window.App;
    if (!App) return;

    App.dev = App.dev || {};
    // Determine default single-entry flag on startup
    try {
      const q = getQueryParams();

      // If query explicitly sets single, respect it
      if (q.get('single') === '1'){ App.dev.setSingleEntry(true); }
      else if (q.get('single') === '0'){ App.dev.setSingleEntry(false); }
      else {
        // Otherwise, prefer ON unless localStorage explicitly disabled
        const pref = localStorage.getItem('randomancer_single_entry');
        App.dev.setSingleEntry(pref !== '0');
      }
    } catch(e){}
  });
})();


// === v0.7.5_release: strictly state-driven snapshot for RulesEngine ===
(function(){
  onDomReady(() => {
    try{
      const App = window.App || {};
      if (window.RulesEngine){
        const orig = window.RulesEngine.snapshot;
        window.RulesEngine.snapshot = function(){
          try{
            const s = App.state.currentRoll;
            return {
              defense:  (s && s.defense)  || '',
              defstrat: (s && s.defStrat) || '',
              weapons:  (s && s.weapon)   || '',
              offhand:  (s && s.offhand)  || '',
              tactics:  (s && s.tactics)  || '',
              ailments: (s && s.ailments) || ''
            };
          }catch(e){ return { defense:'', defstrat:'', weapons:'', offhand:'', tactics:'', ailments:'' }; }
        };
        window.RulesEngine.__stateOnly = true;
      }
    }catch(e){}
  });
})();

/* === Randomancer: Uniques Synergy — canonical engine (v0.8.2) === */
(function(){
  const TOKEN = 'u79b2m_' + Date.now();
  window.__u79_active = TOKEN; // last-wins flag

  // Use shared tag normalizer
  const norm = (s) => TagUtils.norm(s);

  const splitNames = (s) => String(s||'')
    .replace(/\u00B7/g,'•')
    .split(/\s*(?:,|•|&|\band\b|\/|\+|;)\s*/i)
    .map(x => x.replace(/^['"]|['"]$/g,'').trim())
    .filter(Boolean);

  function dataIndex(){
    const DATA = window.DATA||{};
    const byName = new Map(), byNorm = new Map();
    const add = arr => (arr||[]).forEach(o=>{
      const name = String(o?.name||'').trim(); if(!name) return;
      const tags = Array.from(new Set((o?.tags||[]).map(norm))).filter(Boolean);
      byName.set(name, tags); byNorm.set(norm(name), tags);
    });
    add(DATA.Tactics); add(DATA.Ailments); add(DATA.DefensiveStrategies);
    return { get: (name) => byName.get(name) || byNorm.get(norm(name)) || [] };
  }

  function expandTags(arr){
    const out = new Set();
    for (let t of (arr||[])){
      if(!t) continue;
      const parts = String(t).split(/\s*(?:\/|&|\band\b|\+)\s*/i).map(p=>norm(p)).filter(Boolean);
      if (parts.length>1){ parts.forEach(p=>out.add(p)); continue; }
      const n = norm(t);
      if (n==='slowmaimhinder'){ out.add('slow'); out.add('maim'); out.add('hinder'); continue; }
      out.add(n);
    }
    return Array.from(out);
  }

  function deriveExtraTags(lines){
    const txt = (lines||[]).slice(2).join('\\n').toLowerCase();
    const out = [];
    if (/(?:break|broken|breaks)\s+armou?r/.test(txt) || /armou?r\s*(?:break|broken)/.test(txt)) out.push('armourbreak');
    if (/(armou?r.*shatter|shatter.*armou?r)/.test(txt)) out.push('armourbreak');
    if (/\bhinder(?:ed|ing|s)?\b|\bhindrance\b/.test(txt)) out.push('hinder');
    if (/\bslow(?:ed|ing|s)?\b|\bslowing\b/.test(txt)) out.push('slow');
    if (/\bmaim(?:ed|ing|s)?\b/.test(txt)) out.push('maim');
    if (/\blife\s+regen(eration)?\b|\bregenerat(e|es|ed|ing|ion)\b/.test(txt)) out.push('liferegeneration');
    if (/\bleech(ed|ing|es)?\b/.test(txt)) out.push('leech');
    if (/\bcrit(ical|s|ically| chance)?\b|\bcritical\s+strike\b/.test(txt)) out.push('critical');
    return out;
  }

  const RX = {
    Ignite: /\bignite(d|s|ing)?\b/i,
    Freeze: /\bfreez(e|es|ed|ing)\b|\bchill(ed|ing|s)?\b/i,
    Shock: /\bshock(ed|ing|s)?\b/i,
    Bleed: /\bbleed(ing|s|ed)?\b/i,
    Poison: /\bpoison(ed|ing|s)?\b/i,
    'Life Regeneration': /\blife\s+regen(eration)?\b|\bregenerat(e|es|ed|ing|ion)\b/i,
    Leech: /\bleech(ed|ing|es)?\b/i,
    'Culling Strike': /\bculling\s+strike\b/i,
    'Heavy Stun': /\bstun(ned|ning|s)?\b|\bheavy\s+stun\b|\bstun\s+threshold\b/i,
    Block: /\bchance\s+to\s+block\b|\bblock(ed|ing|s)?\b/i,
  };
  function filterCanonicalsByEvidence(item){
    const canon = (item.tags && item.tags.canonical) || [];
    if (!canon.length) return canon;
    const text = (item.lines||[]).slice(2).join('\\n');
    return canon.filter(lbl => {
      const r = RX[lbl];
      if (!r) return true;
      return r.test(text);
    });
  }
  
    function getRollSnapshot(snap){
	  // 1) Explicit snapshot (from App.onRoll or direct call)
	  if (snap && typeof snap === 'object') return snap;
	
	  // 2) App.state.currentRoll (DOM-driven snapshot)
	  const App = window.App;
	  if (App && App.state && App.state.currentRoll) return App.state.currentRoll;
	
	  // 3) Fallback to global CURRENT_ROLL if we’re using that
	  if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
		return window.CURRENT_ROLL;
	  }
	
	  return null;
	}

    function rolledByCategory(snap){
	  const state = getRollSnapshot(snap);
	  if (!state) {
		return { tactics: [], ailments: [], def: [] };
	  }
	
	  // ——— PREFER ENRICHED SNAPSHOT (tacticSet / ailmentSet / defStrat objects) ———
	  const hasEnriched =
		(Array.isArray(state.tacticSet) && state.tacticSet.length) ||
		(Array.isArray(state.ailmentSet) && state.ailmentSet.length) ||
		(state.defStrat && typeof state.defStrat === 'object');
	
	  if (hasEnriched){
		const tagsT = Array.from(
		  expandTags(
			(state.tacticSet || []).flatMap(t => t?.tags || [])
		  )
		);
	
		const tagsA = Array.from(
		  expandTags(
			(state.ailmentSet || []).flatMap(a => a?.tags || [])
		  )
		);
	
		const tagsD = Array.from(
		  expandTags([
			...(state.defStrat?.tags || []),
			...defensePseudoTags(state.defense && state.defense.name)
		  ])
		);
	
		return {
		  tactics: tagsT,
		  ailments: tagsA,
		  def: tagsD,
		};
	  }
	
	  // ——— LEGACY FALLBACK (text-only snapshot: tactics / ailments / defStrat names) ———
	  const idx = dataIndex();
	
	  const rawT = String(state.tactics || '').trim();
	  const rawA = String(state.ailments || '').trim();
	  const rawD = String(state.defStrat || '').trim();
	
	  const namesT = Array.from(new Set([...splitNames(rawT), rawT].filter(Boolean)));
	  const namesA = Array.from(new Set([...splitNames(rawA), rawA].filter(Boolean)));
	  const namesD = Array.from(new Set([...splitNames(rawD), rawD].filter(Boolean)));
	
	  const tagsT = Array.from(
		expandTags(namesT.flatMap(n => idx.get(n)))
	  );
	  const tagsA = Array.from(
		expandTags(namesA.flatMap(n => idx.get(n)))
	  );
	  const tagsD = Array.from(
		expandTags([
		  ...namesD.flatMap(n => idx.get(n)),
		  ...defensePseudoTags(state.defense || state.defenseName)
		])
	  );
	
	  return {
		tactics: tagsT,
		ailments: tagsA,
		def: tagsD,
	  };
	}

    function allowedSlots(snap){
		const state = getRollSnapshot(snap);
	
		// These are always allowed regardless of weapon
		const allow = new Set(['amulet','belt','ring','jewel','body','boots','gloves','helmet','flask','tincture']);
	
		if (!state) return allow;
	
		const weaponText = String(state.weapon || '').toLowerCase();
	
		const hasWord = (s) => {
		  if (!s) return false;
		  const re = new RegExp('\\b' + s + '\\b', 'i');
		  return re.test(weaponText);
		};
		const add = s => allow.add(s);
	
		const wantsQuarterstaff = hasWord('quarterstaff');
		const wantsStaff = hasWord('staff') && !wantsQuarterstaff;
	
		const hasBow = hasWord('bow');
		const hasCrossbow = hasWord('crossbow');
	
		// primary weapon types
		if (hasBow)         { add('bow'); add('quiver'); }
		if (hasCrossbow)    add('crossbow');
		if (wantsStaff || wantsQuarterstaff) add('staff');
		if (hasWord('spear'))  add('spear');
		if (hasWord('sword'))  add('sword');
		if (hasWord('mace'))   add('mace');
		if (hasWord('axe'))    add('axe');
		if (hasWord('claw'))   add('claw');
		if (hasWord('wand'))   add('wand');
		if (hasWord('sceptre')) add('sceptre');
	
		// off-hands
		if (hasWord('shield'))   add('shield');
		if (hasWord('buckler'))  add('buckler');
		if (hasWord('focus'))    add('focus');
		if (hasWord('soulcore')) add('soulcore');
		if (hasWord('trap tool') || hasWord('traptool')) add('traptool');
	
		// expose staff vs quarterstaff intent for weaponSlotAllowed, if you still use those
		allow.__wtxt = weaponText;
		allow.__wantsQuarterstaff = wantsQuarterstaff;
		allow.__wantsStaff = wantsStaff;
	
		return allow;
	  }


async function loadUniquesM(){
    const url = 'uniques_enriched_0.8.2_cleanup.json?v=' + Date.now();
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    return Array.isArray(data) ? data : (data.items||[]);
  }

  function getItemTagSet(item){
    const raw = (item.tags && item.tags.raw) || [];
    const canon = filterCanonicalsByEvidence(item);
    const derived = deriveExtraTags(item.lines || []);
    const acc = [];

    // normalize raw + derived tags directly
    for (const t of [...raw, ...derived]){
      if (!t) continue;
      const n = norm(t);
      if (n) acc.push(n);
    }

    // expand canonical labels, including compound ones like "Slow/Maim/Hinder"
    for (const lbl of canon){
      if (!lbl) continue;
      const parts = String(lbl)
        .split(/\s*(?:\/|&|\band\b|\+)\s*/i)
        .filter(Boolean);
      if (parts.length > 1){
        for (const p of parts){
          const n = norm(p);
          if (n) acc.push(n);
        }
        continue;
      }
      const n = norm(lbl);
      if (n === 'slowmaimhinder'){
        acc.push('slow','maim','hinder');
      } else if (n){
        acc.push(n);
      }
    }

    return new Set(acc);
  }
  function scoreItem(it, rolled, slotAllow){
    const all = getItemTagSet(it);
    let s = 0;
    for (const t of rolled.tactics)  if (all.has(t)) s += 3.0;
    for (const t of rolled.ailments) if (all.has(t)) s += 1.7;
    for (const t of rolled.def)      if (all.has(t)) s += 1.2;
    if (slotAllow && slotAllow.has && slotAllow.has(it.slot)) s += 0.6;
    return s;
  }

function weaponSlotAllowed(it, slotAllow){
    if (!slotAllow || !slotAllow.has) return true;
    // Non-weapon slots just rely on presence in the allowed set
    if (!['bow','crossbow','staff','spear','sword','mace','axe','claw','wand','sceptre','shield','buckler','focus','soulcore','traptool'].includes(it.slot)) {
      return slotAllow.has(it.slot);
    }
    if (it.slot !== 'staff') {
      return slotAllow.has(it.slot);
    }
    // Staff vs Quarterstaff split
    if (!slotAllow.has('staff')) return false;
    const wantsQuarterstaff = !!slotAllow.__wantsQuarterstaff;
    const wantsStaff = !!slotAllow.__wantsStaff;
    const base = String(it.base || '').toLowerCase();
    const isQuarterstaffItem = base.includes('quarterstaff');
    if (wantsQuarterstaff && !isQuarterstaffItem) return false;
    if (wantsStaff && isQuarterstaffItem) return false;
    return true;
  }

  function pick(items, rolled, allow, limitMax=5, perSlotCap=2){
    const MIN = 2.8;
    const slotAllow = allow || new Set();
    const scored = items
      .map(it => ({ it, s: scoreItem(it, rolled, slotAllow) }))
      .filter(row => weaponSlotAllowed(row.it, slotAllow) && row.s >= MIN)
      .sort((a, b) => b.s - a.s);
    const out = [], per = new Map();
    for (const row of scored){
      const c = per.get(row.it.slot) || 0;
      if (c >= perSlotCap) continue;
      per.set(row.it.slot, c + 1);
      out.push(row.it);
      if (out.length >= limitMax) break;
    }
    return out;
  }

function ensureUniqueSection(){
    // Remove previous instances to avoid drift
    document.querySelectorAll('.unique-divider').forEach(el=>el.remove());
    document.querySelectorAll('#uniques-section').forEach(el=>el.remove());

    // Anchor after Skills section (or after persistent buff section if present)
    const skillsGrid = document.querySelector('#skills-grid');
    const skillsSect = skillsGrid ? skillsGrid.closest('.sect') : null;
    const buffSect = document.getElementById('persistent-buff-section');
    const main = document.querySelector('main') || document.body;
    const parent = (skillsSect && skillsSect.parentNode) || main;

    if (!skillsSect) return null; // try later

    const anchor = buffSect || skillsSect;

    // Insert divider
    const divider = document.createElement('div');
    divider.className = 'ornate-divider gold unique-divider';
    anchor.insertAdjacentElement('afterend', divider);

    // Insert Uniques section
    const wrap = document.createElement('div');
    wrap.id = 'uniques-section';
    wrap.className = 'sect';
    wrap.innerHTML = '<div class="sect-head"><h3>Recommended Uniques</h3><div class="underline"></div><p class="sub">Quality-first: tactics → ailments → defense → weapon hints</p></div><div id="uniques-grid" class="grid two uniques-grid"></div>';
    divider.insertAdjacentElement('afterend', wrap);

    return document.getElementById('uniques-grid');
  }

  function pillsFor(item, rolledSet){
    const tags = Array.from(getItemTagSet(item)).sort();
    return tags.map(t=>`<span class="tag-pill pill${rolledSet.has(t)?' matched':''}" data-tag="${t}">${t}</span>`).join('');
  }
  function highlight(lines, rolledSet){
    const esc = s => s.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&');
    let out = (lines||[]).slice(2).join('\\n');
    rolledSet.forEach(t=>{ const rx=new RegExp(esc(t),'ig'); out=out.replace(rx, m=>`<span class="hit">${m}</span>`); });
    return out.split('\\n').map(L=>`<div>${L}</div>`).join('');
  }
  function renderUniques(items, rolledSet){
    let grid = ensureUniqueSection();
    if(!grid){ setTimeout(()=>renderUniques(items, rolledSet), 120); return; }
    grid.innerHTML = items.map(it=>`<div class="unique-card">
      <div class="unique-title">${it.name}</div>
      <div class="unique-base">${it.base}</div>
      <div class="unique-tags">${pillsFor(it, rolledSet)}</div>
      <div class="unique-lines">${highlight(it.lines, rolledSet)}</div>
    </div>`).join('');
  }

    async function refreshUniques(snap){
	  if (window.__u79_active !== TOKEN) return; // last-wins
	
	  try{
		const items = await loadUniquesM();
		const rolled = rolledByCategory(snap);
		const rolledSet = new Set([
		  ...rolled.tactics,
		  ...rolled.ailments,
		  ...rolled.def,
		]);
		const allow = allowedSlots(snap);
		const picks = pick(items, rolled, allow, 5, 2);
	
		// Debug logging (optional, but now safe & informative)
		console.log('[u79b2m] snap', snap);
		console.log('[u79b2m] rolled', rolled);
		console.log('[u79b2m] picks', picks.length);
	
		renderUniques(picks, rolledSet);
	  }catch(e){
		console.error('[u79b2m] refresh error', e);
	  }
	}
	
	// Expose a global hook so the core roll engine can trigger uniques directly
    window.RandomancerRefreshUniques = refreshUniques;

  
      // Hook into App.roll when available (primary path for refresh)
	(function(){
	  function install(attempt){
		attempt = attempt || 0;
		if (attempt > 40) return; // ~2s max (40 * 50ms)
	
		try {
		  const App = window.App;
		  if (!App || typeof App.onRoll !== 'function') {
			// Try again shortly until App.onRoll is wired up
			setTimeout(() => install(attempt + 1), 50);
			return;
		  }
	
		  App.onRoll((snap) => {
			refreshUniques(snap);
		  });
	
		  // Optional: debug confirmation
		  // console.log('[u79b2m] App.onRoll hook installed');
		} catch (e) {
		  console.warn('[u79b2m] App.onRoll hook failed', e);
		}
	  }
	
	  if (document.readyState === 'complete' || document.readyState === 'interactive') {
		install();
	  } else {
		document.addEventListener('DOMContentLoaded', () => install());
	  }
	})();
})();

/* === Info Lightbox controller (v0.7.9_beta2m) === */
(function(){
  const $ = (sel)=>document.querySelector(sel);
  const fab = $('#info-fab');
  const overlay = $('#rm-info-overlay');
  const dialog = overlay ? overlay.querySelector('.rm-info-dialog') : null;
  const btnClose = $('#rm-info-close');
  const content = $('#rm-info-content');
  let lastFocus = null;

  function openInfo(){ if(!overlay) return; lastFocus = document.activeElement; overlay.hidden = false; (btnClose||dialog)?.focus?.(); }
  function closeInfo(){ if(!overlay) return; overlay.hidden = true; if(lastFocus && lastFocus.focus) lastFocus.focus(); }

  function onClick(e){ const t=e.target; if(t===btnClose || t?.dataset?.close) closeInfo(); }
  function onKey(e){ if(e.key==='Escape') closeInfo(); }

  fab?.addEventListener('click', openInfo);
  overlay?.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  window.RandomancerInfo = { set(html){ if(content) content.innerHTML = html; }, open: openInfo, close: closeInfo };
})();

