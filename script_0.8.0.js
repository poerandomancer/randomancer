
/*! Randomancer v0.7.3_release — modular scaffold + validator + rules engine + scorer + devtools */
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

// Metrics (validator attempts)
window.__RANDOMANCER_METRICS__ = window.__RANDOMANCER_METRICS__ || { rolls:0, lastAttempts:0, emaAttempts:0 };
function recordAttempts(n){
  try{
    const m = window.__RANDOMANCER_METRICS__;
    m.rolls += 1;
    m.lastAttempts = n;
    // EMA with alpha ~ 0.2
    const alpha = 0.2;
    m.emaAttempts = m.emaAttempts ? (alpha*n + (1-alpha)*m.emaAttempts) : n;
  }catch{}
}


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

// ===== Scorer (legacy-delegating; new scorer installed below) =====
const Scorer = (() => {
  function score(state){
    if (typeof window.computeSynergyScore === "function"){
      return window.computeSynergyScore(state);
    }
    if (typeof window.scoreGemSynergy === "function"){
      // legacy style entry point
      return 1;
    }
    return 1;
  }
  function breakdown(state){
    if (typeof window.computeSynergyBreakdown === "function"){
      return window.computeSynergyBreakdown(state);
    }
    return { total: 1, parts: [] };
  }
  return { score, breakdown };
})();

// ===== App API =====
const App = (() => {
  const state = { DATA:null, GEMS:null, SKILLS:null, CONFIG:null, cohesionMode:1 };

  async function loadJSON(url){ const res = await fetch(url); if(!res.ok) throw new Error(`Failed to load ${url}`); return res.json(); }
  async function bootstrap(){
    const [core, gems, skills] = await Promise.all([
      loadJSON('data_0.8.0.json'),
      loadJSON('data/skill_gems.json'),
      loadJSON('data/skills.json')
    ]);
    const chk = Schema.validateData(core);
    if(!chk.ok) console.warn("[schema] missing keys:", chk.missing);
    state.DATA = core; state.GEMS = gems; state.SKILLS = skills; state.CONFIG = Config.resolve(core);
  }
  function setCohesion(mode){ state.cohesionMode = parseInt(mode||1,10); }
  function legacyInit(){
    try{
      if (typeof window !== 'undefined') {
        window.DATA = state.DATA; window.SKILL_GEMS = state.GEMS; window.SKILLS = state.SKILLS;
      }
    }catch(e){ console.warn("legacyInit exposure failed:", e); }
  }

  // Post-roll validator enforcing pre-established rules; non-invasive
  function validateAndFix(config){
    try {
      let __attemptsTotal = 0;
      if (config && config.rules && config.rules.useEnginePostValidator) {
        RulesEngine.enforce(config, 25);
        return;
      }
    } catch (e) { console.warn('[validateAndFix] engine mode error', e); }

    const lc = (s)=> (s||'').toLowerCase();
    // Deflection => Evasion*
    try{
      if (config.rules.enableDeflectionDefenseRule){
        const ds = lc(Dom.txt('#defstrat')); if (ds==='deflection'){
          const allowed = (config.rules.deflectionRequiresEvasion||[]).map(lc);
          let defense = lc(Dom.txt('#defense'));
          if (!allowed.includes(defense)){
            let t=0; while(t<25){ __attemptsTotal++;
              t++; if (typeof window.rollBuild==='function') window.rollBuild(state.cohesionMode); else { const b=Dom.q('#roll'); if(b) b.click(); }
              const ds2 = lc(Dom.txt('#defstrat')); defense = lc(Dom.txt('#defense'));
              if (ds2!=='deflection') break;
              if (allowed.includes(defense)) break;
            }
          }
        }
      }
    } catch(e){ console.warn('[validate:deflection]', e); }

    // Minions => Sceptre
    try{
      if (config.rules.enableMinionsWeaponRule){
        const t = lc(Dom.txt('#tactics'));
        if (t.includes('minions')){
          const allowed = (config.rules.minionsRequiresWeapon||[]).map(lc);
          let w = lc(Dom.txt('#weapons'));
          if (!allowed.includes(w)){
            let i=0; while(i<25){ __attemptsTotal++; __attemptsTotal++;
              i++; if (typeof window.rollBuild==='function') window.rollBuild(state.cohesionMode); else { const b=Dom.q('#roll'); if(b) b.click(); }
              const t2 = lc(Dom.txt('#tactics')); w = lc(Dom.txt('#weapons'));
              if (!t2.includes('minions')) break;
              if (allowed.includes(w)) break;
            }
          }
        }
      }
    } catch(e){ console.warn('[validate:minions]', e); }

    // Block => Shield/Buckler (off-hand)
    try{
      if (config.rules.enableBlockOffhandRule){
        const ds = lc(Dom.txt('#defstrat'));
        if (ds==='block'){
          const allowed = (config.rules.blockRequiresOffhand||[]).map(lc);
          let off = lc(firstText(Selectors.offhands));
          if (!allowed.includes(off)){
            let i=0; while(i<25){ __attemptsTotal++; __attemptsTotal++;
              i++; if (typeof window.rollBuild==='function') window.rollBuild(state.cohesionMode); else { const b=Dom.q('#roll'); if(b) b.click(); }
              const ds2 = lc(Dom.txt('#defstrat'));
              off = lc(firstText(Selectors.offhands));
              if (ds2!=='block') break;
              if (allowed.includes(off)) break;
            }
          }
        }
      }
    } catch(e){ console.warn('[validate:block-offhand]', e); }

    // 1H/2H combos
    try{
      if (config.rules.enableOneHandedOffhandCombos){
        const two = (config.rules.twoHandedWeapons||[]).map(lc);
        let w = lc(Dom.txt('#weapons'));
        let off = lc(firstText(Selectors.offhands));
        const is2H = two.includes(w) || w.includes('two-handed');
        if (is2H){
          const blocked = (config.rules.blockedOffhandsForTwoHanded||[]).map(lc);
          if (blocked.includes(off)){
            let i=0; while(i<25){ __attemptsTotal++; __attemptsTotal++;
              i++; if (typeof window.rollBuild==='function') window.rollBuild(state.cohesionMode); else { const b=Dom.q('#roll'); if(b) b.click(); }
              w = lc(Dom.txt('#weapons'));
              off = lc(firstText(Selectors.offhands));
              const is2H2 = two.includes(w) || w.includes('two-handed');
              if (!is2H2) break;
              if (!blocked.includes(off)) break;
            }
          }
        } else {
          const allowed = (config.rules.allowedOffhandsForOneHanded||[]).map(lc);
          if (allowed.length && !allowed.includes(off)){
            let i=0; while(i<25){ __attemptsTotal++; __attemptsTotal++;
              i++; if (typeof window.rollBuild==='function') window.rollBuild(state.cohesionMode); else { const b=Dom.q('#roll'); if(b) b.click(); }
              w = lc(Dom.txt('#weapons'));
              off = lc(firstText(Selectors.offhands));
              const is2H2 = two.includes(w) || w.includes('two-handed');
              if (is2H2) break;
              if (allowed.includes(off)) break;
            }
          }
        }
      }
    } catch(e){ console.warn('[validate:1h-2h]', e); }
      try { recordAttempts(__attemptsTotal); } catch(e) {}
  }
function roll(){
    if (typeof window.rollBuild === "function") {
      window.rollBuild(state.cohesionMode);
      const cfg = Config.resolve(state.DATA);
      validateAndFix(cfg);
      return true;
    }
    const rollBtn = Dom.q('#roll'); if (rollBtn) rollBtn.click();
    const cfg = Config.resolve(state.DATA); validateAndFix(cfg);
    return false;
  }

  function selfTest(){
    const results = [];
    const have = (k)=> (k in (state.DATA||{}));
    results.push({ name:"core schema", pass: Schema.validateData(state.DATA).ok });
    results.push({ name:"classes populated", pass: have("Classes") && Object.keys(state.DATA.Classes).length>0 });
    results.push({ name:"weapons present", pass: have("Weapons") && Object.keys(state.DATA.Weapons).length>0 });
    results.push({ name:"gems loaded", pass: Array.isArray(state.GEMS) || (state.GEMS && typeof state.GEMS === 'object') });
    results.push({ name:"skills loaded", pass: state.SKILLS && typeof state.SKILLS === 'object' });
    const ok = results.every(r => r.pass);
    console.log("[self-test] v0.7.3_release", ok ? "PASS" : "WARN", results);
    return ok;
  }

  return { state, bootstrap, setCohesion, legacyInit, roll, selfTest, modules: { Config, RulesEngine, Scorer } };
})();

// ===== Dev toggles & seed sweep =====
(function(){
  function getParam(name){ try { return new URLSearchParams(window.location.search).get(name); } catch { return null; } }
  const wantEngine = getParam('engine');
  const wantDebug  = getParam('debug');
  document.addEventListener('DOMContentLoaded', () => {
    if (wantEngine !== null) localStorage.setItem('randomancer_engine', (wantEngine==='1')?'1':'0');
    if (wantDebug  !== null) localStorage.setItem('randomancer_debug',  (wantDebug==='1') ?'1':'0');
  });
  const _ready = () => typeof window.App !== 'undefined' && window.App.state && window.App.state.CONFIG;
  function postReady(fn){ if (_ready()) return fn(); document.addEventListener('DOMContentLoaded', () => setTimeout(() => _ready() && fn(), 50)); }
  postReady(() => {
    const App = window.App;
    function setEngine(on){
      try {
        App.state.CONFIG = App.state.CONFIG || { rules: {} };
        App.state.CONFIG.rules = App.state.CONFIG.rules || {};
        App.state.CONFIG.rules.useEnginePostValidator = !!on;
        localStorage.setItem('randomancer_engine', on ? '1' : '0');
        console.log('[dev] Engine mode:', on ? 'ON' : 'OFF');
      } catch(e){ console.warn('[dev.setEngine] ', e); }
    }
    function getEngine(){ return !!(App.state.CONFIG && App.state.CONFIG.rules && App.state.CONFIG.rules.useEnginePostValidator); }
    async function seedSweep(N=100){
      const stats = { adhocValid:0, adhocInvalid:0, engineValid:0, engineInvalid:0 };
      // Ad-hoc pass
      setEngine(false);
      for (let i=0;i<N;i++){
        try{
          if (typeof window.rollBuild === 'function') window.rollBuild(App.state.cohesionMode);
          const snap = RulesEngine.snapshot();
          const v = RulesEngine.evaluate(App.state.CONFIG, snap);
          if (v.length === 0) stats.adhocValid++; else stats.adhocInvalid++;
        } catch(e){ stats.adhocInvalid++; }
      }
      // Engine pass
      setEngine(true);
      for (let i=0;i<N;i++){
        try{
          if (typeof window.rollBuild === 'function') window.rollBuild(App.state.cohesionMode);
          RulesEngine.enforce(App.state.CONFIG, 25);
          const snap = RulesEngine.snapshot();
          const v = RulesEngine.evaluate(App.state.CONFIG, snap);
          if (v.length === 0) stats.engineValid++; else stats.engineInvalid++;
        } catch(e){ stats.engineInvalid++; }
      }
      console.table(stats);
      return stats;
    }
    App.dev = Object.assign({}, App.dev||{}, { setEngine, getEngine, seedSweep });
    console.log('[dev] App.dev ready — use App.dev.setEngine(true|false) and App.dev.seedSweep(N)');
  });
})();

// ===== New Scorer install + toggles + A/B compare =====
(function(){
  // Helpers re-implemented here (parity)
  function normalizeTag(s){ return String(s||'').trim().toLowerCase(); }
  function normTagPlus(s){
    const base = normalizeTag(s);
    if (window.TAG_ALIASES instanceof Map && window.TAG_ALIASES.has(base)) return window.TAG_ALIASES.get(base);
    return base;
  }
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

  // Dev toggles + A/B compare (per-seed deterministic RNG)
  (function(){
    function seededRandom(seed){ let x=(seed|0)||88675123; return function(){ x^=x<<13; x^=x>>17; x^=x<<5; return ((x>>>0)/4294967296); }; }
    function withSeed(seed, fn){ const orig=Math.random; Math.random=seededRandom(seed); try{ return fn(); } finally { Math.random=orig; } }
    function extractPicks(){
      const grid=document.querySelector('#skills-grid'); if(!grid) return [];
      const cards=Array.from(grid.querySelectorAll('.skill-card, .gem-card, .card')).slice(0,2);
      return cards.map(card=>{
        const titleEl = card.querySelector('.title, h3, h4, .name, strong') || card;
        const name=(titleEl.textContent||'').trim().split('\\n')[0];
        const pctEl=card.querySelector('.synergy-chip, .synergy, .syn, .synergy-percent, .chip');
        const pctTxt=(pctEl?pctEl.textContent:card.textContent)||''; const m=pctTxt.match(/(\\d{1,3})\\s*%/); const pct=m?parseInt(m[1],10):null;
        return {name, pct};
      });
    }
    function rollOnce(){
      if (typeof window.rollBuild==='function') window.rollBuild(window.App?.state?.cohesionMode ?? 1);
      else { const btn=document.querySelector('#roll'); if(btn) btn.click(); }
    }
    function setScorer(on){ if (window.App?.dev?.setScorer) window.App.dev.setScorer(on); }
    async function compareScorer(N=50){
      const results=[];
      for(let i=1;i<=N;i++){
        setScorer(false); withSeed(i,()=>rollOnce()); const legacyPicks=extractPicks();
        setScorer(true);  withSeed(i,()=>rollOnce()); const newPicks=extractPicks();
        results.push({ seed:i, legacy:legacyPicks, newer:newPicks });
      }
      try{
        const rows = results.map(r => ({
          seed:r.seed,
          legacy1:r.legacy?.[0]?.name||'', legacy1_pct:r.legacy?.[0]?.pct??'',
          legacy2:r.legacy?.[1]?.name||'', legacy2_pct:r.legacy?.[1]?.pct??'',
          new1:r.newer?.[0]?.name||'',   new1_pct:r.newer?.[0]?.pct??'',
          new2:r.newer?.[1]?.name||'',   new2_pct:r.newer?.[1]?.pct??'',
        }));
        console.table(rows);
      }catch{}
      return results;
    }
    document.addEventListener('DOMContentLoaded', ()=>{
      const App=window.App; if(!App) return;
      App.dev = Object.assign({}, App.dev||{}, {
        setScorer: (on)=>{
          if (!App.state.CONFIG) App.state.CONFIG={};
          App.state.CONFIG.synergy=App.state.CONFIG.synergy||{};
          App.state.CONFIG.synergy.useNewScorer=!!on;
          localStorage.setItem('randomancer_scorer', on?'1':'0');
          if (on) installNewScorer(App.state); else {
            if (LEGACY.scoreGemSynergy) window.scoreGemSynergy = LEGACY.scoreGemSynergy;
            if (LEGACY.normalizeSynergy) window.normalizeSynergy = LEGACY.normalizeSynergy;
          }
          console.log('[dev] Scorer mode:', on?'NEW':'LEGACY');
        },
        getScorer: ()=> !!(App.state.CONFIG && App.state.CONFIG.synergy && App.state.CONFIG.synergy.useNewScorer),
        compareScorer
      });
      // Init from config/storage
      const url = new URLSearchParams(window.location.search);
      const want = url.get('scorer');
      if (want!==null) localStorage.setItem('randomancer_scorer', (want==='1')?'1':'0');
      const fromStore = localStorage.getItem('randomancer_scorer')==='1';
      const fromConfig = !!(App.state.CONFIG && App.state.CONFIG.synergy && App.state.CONFIG.synergy.useNewScorer);
      const enable = fromStore || fromConfig;
      if (enable) installNewScorer(App.state);
    });
  })();
})();



function normalizeTag(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
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
  const el=document.getElementById('asc-art'); if(!el) return;
  const path=`images/ascendancies/${asc.toLowerCase().replace(/\s+/g,'-')}.webp`;
  el.style.setProperty('--asc-img', `url('${path}')`);
  el.classList.add('show');
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

// Alias map for a few common synonyms
const TAG_ALIASES = new Map([
  ['critical','crit'], ['heavystun','heavystun'], ['damageovertime','dot'],
  ['marks','mark'], ['armourbreak','armourbreak']
]);

function normTagPlus(s){
  const base = normalizeTag(s);
  if (TAG_ALIASES.has(base)) return TAG_ALIASES.get(base);
  return base;
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

function rollRecommendedSkills(dataWrap, baseAttrs, picked, rollCtx){
  try{
    const rolledTypesLower = weaponsToTypes(picked.weapon, picked.offhand);
    const gems = (window.DATA && window.DATA.gems) ? window.DATA.gems : (dataWrap.gems || []);
    const actives = gems.filter(g =>
      g.type === 'active' &&
      Array.isArray(g.crafting_types) && g.crafting_types.length > 0 &&
      !isDevPlaceholderGem(g)
    );
    const eligible = actives.filter(g => isGemWeaponCompatible(g, rolledTypesLower));

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

    // Score all eligibles
    const scored = eligible.map(g => {
      const s = scoreGemSynergy(g, rolledProfile, window.TAG_IDF, knobs);
      return { item:g, score:s.score, raw:s.raw };
    }).sort((a,b)=>b.score - a.score);

    // Pick two with diversity
    const picks = pickTwoDiverse(scored, 0.7);

    // For synergy % chip, compute max raw among candidates to normalize
    const maxRaw = scored.length? Math.max(...scored.map(x=>x.raw)) : 0.0001;

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
    picks.forEach(g => {
      const card = document.createElement('div');
      card.className = 'skill-card';

      const reqBlock = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
        ? `<div class="req-block"><span class="req-label">Requires:</span> <span class="req-text">${g.required_weapon_types.map(x=>x[0].toUpperCase()+x.slice(1)).join(', ')}</span></div>`
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
  }catch(e){
    console.error("[skills] render error", e);
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

// ---------- wireup ----------
document.addEventListener('DOMContentLoaded', ()=>{
  const slider=document.getElementById('cohesionRange');
  if(slider){ const modeMap=['strict','cohesive','chaotic','madness']; slider.addEventListener('input', e=> currentMode = modeMap[e.target.value]); }
  const rollBtn=document.getElementById('roll');
  if(rollBtn){ rollBtn.addEventListener('click', async ()=>{ const data = await loadData(); rollBuild(data); }); }
});

function rollBuild(dataWrap){
  const data=dataWrap.core; const th=COHESION_MODES[currentMode];
  const classes=Object.entries(data.Classes); const [clsName, clsData]=classes[Math.floor(Math.random()*classes.length)];
  const base=clsData.attributes;

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
    rollAttr: { strength:S, dexterity:D, intelligence:I }
  };

  // Skills (weapon-limited + synergy scoring)
  rollRecommendedSkills(dataWrap, base, {weapon, offhand}, window.CURRENT_ROLL);

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
    const core = await loadJSON('data_0.8.0.json');
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

// function extractBracketTags(description){
//   const out = [];
//   const desc = String(description||'');
//   const matches = desc.match(/\[[^\]]+\]/g) || [];
//   for(const m of matches){
//     const inner = m.slice(1,-1);
//     const key = inner.split('|')[0]; //only taking the first tag within the brackets?
//     const tag = normalizeTag(key);
//     if(tag && !out.includes(tag)) out.push(tag);
//   }
//   return out;
// }

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


// === v0.7.3 Debug Overlay (optional) ===
(function(){
  function wantDebug(){
    try{
      const url = new URLSearchParams(window.location.search);
      if (url.get('debug') === '1') return true;
      return localStorage.getItem('randomancer_debug') === '1';
    }catch{ return false; }
  }
  function ensureOverlay(){
    let el = document.getElementById('dev-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dev-overlay';
    el.style.cssText = 'position:fixed; right:12px; bottom:12px; z-index:9999; background:rgba(0,0,0,0.66); color:#eee; font:12px/1.35 monospace; padding:8px 10px; border:1px solid rgba(255,255,255,0.2); border-radius:8px; pointer-events:none;';
    el.innerHTML = '<div><b>Randomancer Dev</b></div><div id=\"dev-overlay-body\">loading…</div>';
    document.body.appendChild(el);
    return el;
  }
  function updateOverlay(){
    try{
      const m = window.__RANDOMANCER_METRICS__ || {rolls:0,lastAttempts:0,emaAttempts:0};
      const body = document.getElementById('dev-overlay-body');
      if (!body) return;
      body.innerHTML = 'rolls: '+m.rolls+'<br>validator attempts (last): '+m.lastAttempts+'<br>validator attempts (EMA): '+(m.emaAttempts||0).toFixed(2);
    }catch{}
  }
  if (wantDebug()){
    document.addEventListener('DOMContentLoaded', () => {
      ensureOverlay();
      updateOverlay();
      // Update after each 'Roll' (listen to clicks and also periodic refresh during testing)
      const btn = document.querySelector('#roll');
      if (btn) btn.addEventListener('click', () => setTimeout(updateOverlay, 80));
      setInterval(updateOverlay, 2000);
    });
  }
})();



// ===== v0.7.5_release — Safe scaffolding (no behavior changes by default) =====
(function(){
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return setTimeout(fn, 0);
    document.addEventListener('DOMContentLoaded', fn);
  }
  function txt(sel){
    const el = document.querySelector(sel);
    return (el && el.textContent || '').trim();
  }
  function anyText(arr){
    for (const s of arr){ const el = document.querySelector(s); if (el && el.textContent) return el.textContent.trim(); }
    return '';
  }

  // State-first snapshot (reads from DOM for now, until generator emits state)
  ready(() => {
    if (!window.App) window.App = { state:{} };
    const st = (window.App.state = window.App.state || {});
    st.currentRoll = st.currentRoll || {};
    window.App.captureCurrentRollFromDOM = function(){
      try{
        const offhand = anyText(['#offhand','#off_hand','#off','#offHand']);
        window.App.state.currentRoll = {
          defense: txt('#defense'),
          defStrat: txt('#defstrat'),
          weapon: txt('#weapons'),
          offhand,
          tactics: txt('#tactics'),
          ailments: txt('#ailments'),
          buildName: txt('#build-name'),
          flavor: txt('#flavor')
        };
        return window.App.state.currentRoll;
      }catch(e){ return {}; }
    };
  });

  // Unified programmatic entry: App.roll() delegates to legacy rollBuild, then validates and snapshots
  ready(() => {
    if (!window.App) window.App = { state:{} };
    const App = window.App;
    App.roll = function(mode){
      // legacy roll
      if (typeof window.rollBuild === 'function'){
        try { window.rollBuild(App.state?.cohesionMode ?? (mode||1)); } catch(e){ console.warn('[App.roll] legacy rollBuild failed', e); }
      } else {
        const btn = document.querySelector('#roll');
        if (btn) btn.click();
      }
      // post: optional validator + snapshot
      try {
        // try dev.validate if available (keeps metrics moving in debug)
        if (App.dev && typeof App.dev.validate === 'function') App.dev.validate();
        if (typeof window.validateAndFix === 'function') {
          const cfg = App.state?.CONFIG || null;
          if (cfg) try { window.validateAndFix(cfg); } catch(e){}
        }
      } catch(e){}
      try { App.captureCurrentRollFromDOM(); } catch(e){}
      return true;
    };

    // Optional: funnel legacy global to App.roll (debug/opt-in only)
    App.dev = App.dev || {};
    App.dev.setSingleEntry = function(on){
      try{
        if (on && !window.__rollBuildOriginal && typeof window.rollBuild === 'function'){
          window.__rollBuildOriginal = window.rollBuild;
          window.rollBuild = function(){ return App.roll(); };
        } else if (!on && window.__rollBuildOriginal){
          window.rollBuild = window.__rollBuildOriginal;
          delete window.__rollBuildOriginal;
        }
        localStorage.setItem('randomancer_single_entry', on ? '1' : '0');
        console.log('[dev] single-entry funnel', on ? 'ON' : 'OFF');
      }catch(e){ console.warn('[dev.setSingleEntry]', e); }
    };
    // Honor stored preference
    try { if (localStorage.getItem('randomancer_single_entry') === '1') App.dev.setSingleEntry(true); } catch{}
  });

  // Pre-gate scaffold (disabled by default): compiles basic constraints; apply later when enabled
  (function(){
    function lc(s){ return (s||'').toLowerCase(); }
    function compile(cfg){
      const twoHands = (cfg.rules?.twoHandedWeapons||[]).map(lc);
      const blocked2H = (cfg.rules?.blockedOffhandsForTwoHanded||[]).map(lc);
      const allowed1H = (cfg.rules?.allowedOffhandsForOneHanded||[]).map(lc);
      return {
        isTwoHanded: (weaponName) => {
          const w = lc(weaponName);
          return twoHands.includes(w) || w.includes('two-handed');
        },
        allowedOffhandsFor: (weaponName) => {
          return (twoHands.includes(lc(weaponName)) || lc(weaponName).includes('two-handed'))
            ? []
            : allowed1H;
        },
        blockedOffhandsFor: (weaponName) => {
          return (twoHands.includes(lc(weaponName)) || lc(weaponName).includes('two-handed'))
            ? blocked2H
            : [];
        }
      };
    }
    // expose scaffold for later use
    ready(() => {
      if (!window.App) window.App = { state:{} };
      window.App.preGate = { compile };
      // Optional URL enable (no-op by default)
      const qs = new URLSearchParams(location.search);
      if (qs.get('pregate') === '1') { console.log('[pregate] scaffold ready (no filtering applied yet)'); }
    });
  })();

  // Debug-only overlay counters: increment rolls and estimate attempts (non-invasive)
  ready(() => {
    const qs = new URLSearchParams(location.search);
    const debugOn = (qs.get('debug') === '1') || (localStorage.getItem('randomancer_debug') === '1');
    if (!debugOn) return;
    function ensureMetrics(){
      window.__RANDOMANCER_METRICS__ = window.__RANDOMANCER_METRICS__ || { rolls:0, lastAttempts:0, emaAttempts:0 };
      return window.__RANDOMANCER_METRICS__;
    }
    function record(n){
      const m = ensureMetrics();
      m.rolls += 1;
      m.lastAttempts = n|0;
      m.emaAttempts = m.emaAttempts ? (0.2*n + 0.8*m.emaAttempts) : n;
    }
    function estimateAttempts(){
      try{
        // single evaluation: if violation exists, report 1 else 0 (non-invasive)
        const App = window.App||{};
        const cfg = App.state?.CONFIG || null;
        if (!cfg || !window.RulesEngine || !window.RulesEngine.snapshot || !window.RulesEngine.evaluate) return 0;
        const v = window.RulesEngine.evaluate(cfg, window.RulesEngine.snapshot()) || [];
        return (v && v.length) ? 1 : 0;
      }catch(e){ return 0; }
    }
    const btn = document.querySelector('#roll');
    if (btn && !btn.__debugOverlayHook){
      btn.__debugOverlayHook = true;
      btn.addEventListener('click', () => {
        setTimeout(() => { try { record(estimateAttempts()); } catch{} }, 0);
      }, true);
    }
  });
})();



// ===== v0.7.5_release — Opt‑in Pre‑Gate + State→DOM sync (no end‑user behavior change by default) =====
(function(){
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return setTimeout(fn, 0);
    document.addEventListener('DOMContentLoaded', fn, { once:false });
  }
  const QS = (()=>{ try{ return new URLSearchParams(location.search); }catch{ return new URLSearchParams(''); } })();

  // Ensure App exists
  ready(()=>{ if (!window.App) window.App = { state:{} }; });

  // State→DOM sync: keeps DOM in line with App.state.currentRoll (non-invasive)
  ready(()=>{
    const App = window.App; App.state = App.state || {};
    App.syncDOMFromState = function(){
      try{
        const s = App.state.currentRoll || {};
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

  // Helper: snapshot from DOM (fallback path remains)
  function txt(sel){ const el = document.querySelector(sel); return (el && el.textContent || '').trim(); }
  function anyText(arr){ for(const s of arr){ const el = document.querySelector(s); if (el && el.textContent) return el.textContent.trim(); } return ''; }
  ready(()=>{
    const App = window.App; App.state = App.state || {};
    App.captureCurrentRollFromDOM = function(){
      try{
        const offhand = anyText(['#offhand','#off_hand','#off','#offHand']);
        App.state.currentRoll = {
          defense: txt('#defense'),
          defStrat: txt('#defstrat'),
          weapon: txt('#weapons'),
          offhand,
          tactics: txt('#tactics'),
          ailments: txt('#ailments'),
          buildName: txt('#build-name'),
          flavor: txt('#flavor')
        };
        return App.state.currentRoll;
      }catch(e){ return {}; }
    };
  });

  // Pre‑Gate core: evaluate snapshot and decide if valid
  function snapshot(){ try { return (window.RulesEngine && window.RulesEngine.snapshot) ? window.RulesEngine.snapshot() : {}; } catch{ return {}; } }
  function evaluate(cfg, snap){ try { return (window.RulesEngine && window.RulesEngine.evaluate) ? window.RulesEngine.evaluate(cfg, snap) : []; } catch{ return ['no-engine']; } }

  // Unify programmatic roll with optional pre‑gate loop
  ready(()=>{
    const App = window.App; App.state = App.state || {};
    const wantPreGate = () => {
      try {
        if (QS.get('pregate') === '1') return true;
        return !!(App.state.CONFIG && App.state.CONFIG.rules && App.state.CONFIG.rules.enablePreGate);
      } catch { return false; }
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
      return true;
    };

    // If pregate is ON, funnel the Roll button to App.roll (capture phase) to ensure pre‑gate path
    document.addEventListener('DOMContentLoaded', () => {
      if (!wantPreGate()) return;
      const btn = document.querySelector('#roll');
      if (btn && !btn.__pregate){
        btn.__pregate = true;
        btn.addEventListener('click', (e) => {
          e.stopImmediatePropagation();
          e.preventDefault();
          App.roll();
        }, true);
        console.log('[pregate] enabled (capture-phase funnel active)');
      }
    });
  });
})();



// ===== v0.7.5_release — Default pre‑gate ON + state‑first snapshot wrapper =====
(function(){
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return setTimeout(fn, 0);
    document.addEventListener('DOMContentLoaded', fn);
  }

  // 1) Wrap RulesEngine.snapshot to prefer App.state.currentRoll (fallback to original)
  ready(() => {
    try{
      const App = window.App || {};
      if (window.RulesEngine && !window.RulesEngine.__stateFirst){
        const orig = window.RulesEngine.snapshot;
        window.RulesEngine.snapshot = function(){
          try{
            const s = App.state && App.state.currentRoll ? App.state.currentRoll : null;
            if (s && (s.defense || s.defStrat || s.weapon || s.offhand || s.tactics || s.ailments)){
              return {
                defense:  s.defense  || '',
                defstrat: s.defStrat || '',
                weapons:  s.weapon   || '',
                offhand:  s.offhand  || '',
                tactics:  s.tactics  || '',
                ailments: s.ailments || ''
              };
            }
          }catch(e){/* ignore and fallback */}
          return typeof orig === 'function' ? orig() : {};
        };
        window.RulesEngine.__stateFirst = true;
      }
    }catch(e){}
  });

})();



// ===== v0.7.5_release — Single-entry wrapper (opt-in, safe) =====
(function(){
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return setTimeout(fn, 0);
    document.addEventListener('DOMContentLoaded', fn);
  }
  function qs(){ try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } }

  ready(() => {
    if (!window.App) window.App = { state:{} };
    const App = window.App;
    App.dev = App.dev || {};

    // Preserve original roll function once
    if (typeof window.rollBuild === 'function' && !window.__rollBuildOriginal){
      window.__rollBuildOriginal = window.rollBuild;
    }

    // Guard flag to prevent recursive forwarding
    window.__inAppRoll = false;

    // Ensure App.roll uses the ORIGINAL rollBuild during pre-gate to avoid wrapper recursion
    const ensureOrigCall = (mode) => {
      const fn = (typeof window.__rollBuildOriginal === 'function') ? window.__rollBuildOriginal : window.rollBuild;
      if (typeof fn === 'function'){
        try { fn(App.state?.cohesionMode ?? (mode||1)); } catch(e){ /* no-op */ }
      } else {
        const btn = document.querySelector('#roll'); if (btn) btn.click();
      }
    };

    // Wrap App.roll to set/clear the recursion guard
    if (typeof App.roll === 'function' && !App.roll.__wrapped){
      const prev = App.roll;
      App.roll = function(mode){
        window.__inAppRoll = true;
        try { return prev.call(this, mode); }
        finally { window.__inAppRoll = false; }
      };
      App.roll.__wrapped = true;
    }

    // Single-entry wrapper around window.rollBuild (opt-in)
    function installSingleEntryWrapper(){
      if (!window.__rollBuildOriginal && typeof window.rollBuild === 'function'){
        window.__rollBuildOriginal = window.rollBuild;
      }
      if (window.__rollBuildWrapped) return;
      const orig = window.__rollBuildOriginal || window.rollBuild;
      if (typeof orig !== 'function') return;

      window.rollBuild = function(mode){
        // If App.roll is already executing, call ORIGINAL directly (avoid loop)
        if (window.__inAppRoll){
          try { return orig.call(this, mode); } catch(e){ return; }
        }
        // Otherwise, unify via App.roll
        try { return (App && typeof App.roll === 'function') ? App.roll(mode) : orig.call(this, mode); }
        catch(e){ try { return orig.call(this, mode); } catch(_) { return; } }
      };
      window.__rollBuildWrapped = true;
      console.log('[single-entry] wrapper installed');
    }

    function uninstallSingleEntryWrapper(){
      if (window.__rollBuildWrapped && typeof window.__rollBuildOriginal === 'function'){
        window.rollBuild = window.__rollBuildOriginal;
        delete window.__rollBuildWrapped;
        console.log('[single-entry] wrapper removed');
      }
    }

    // Dev toggle + persistence
    App.dev.setSingleEntry = function(on){
      try{
        if (on) installSingleEntryWrapper(); else uninstallSingleEntryWrapper();
        localStorage.setItem('randomancer_single_entry', on ? '1' : '0');
      }catch(e){ console.warn('[setSingleEntry]', e); }
    };
    App.dev.getSingleEntry = function(){
      try { return localStorage.getItem('randomancer_single_entry') === '1'; } catch { return false; }
    };

    // Initial preference via URL or localStorage (default OFF for beta1)
    const q = qs();
    if (q.get('single') === '1' || App.dev.getSingleEntry()){
      App.dev.setSingleEntry(true);
    } else if (q.get('single') === '0'){
      App.dev.setSingleEntry(false);
    }
  });
})();



// ===== v0.7.5_release — defaults: single-entry ON, plus state capture/sync wrapper =====
(function(){
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return setTimeout(fn, 0);
    document.addEventListener('DOMContentLoaded', fn);
  }
  function qs(){ try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } }

  ready(() => {
    if (!window.App) window.App = { state:{} };
    const App = window.App;
    App.dev = App.dev || {};

    // Provide capture & sync utilities if missing
    if (!App.captureCurrentRollFromDOM){
      App.captureCurrentRollFromDOM = function(){
        const q = (sel) => (document.querySelector(sel)?.textContent || '').trim();
        App.state.currentRoll = {
          defense: q('#defense'),
          defStrat: q('#defstrat'),
          weapon: q('#weapons'),
          offhand: q('#offhand') || q('#off_hand') || q('#offHand') || q('#off'),
          tactics: q('#tactics'),
          ailments: q('#ailments'),
          buildName: q('#build-name'),
          flavor: q('#flavor'),
        };
        return App.state.currentRoll;
      };
    }
    if (!App.syncDOMFromState){
      App.syncDOMFromState = function(){
        const s = App.state?.currentRoll || {};
        const set = (sel, val) => { const el = document.querySelector(sel); if (el && typeof val === 'string') el.textContent = val; };
        set('#defense',  s.defense);
        set('#defstrat', s.defStrat);
        set('#weapons',  s.weapon);
        set('#offhand',  s.offhand);
        set('#tactics',  s.tactics);
        set('#ailments', s.ailments);
        set('#build-name', s.buildName);
        set('#flavor', s.flavor);
      };
    }

    // Wrap App.roll to always do capture->sync after it completes
    if (typeof App.roll === 'function' && !App.roll.__postSync){
      const prev = App.roll;
      App.roll = function(mode){
        const r = prev.call(this, mode);
        setTimeout(() => { try { App.captureCurrentRollFromDOM(); App.syncDOMFromState(); } catch {} }, 0);
        return r;
      };
      App.roll.__postSync = true;
    }

    // Single-entry defaults
    try {
      // If query explicitly sets single, respect it
      const q = qs();
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
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return setTimeout(fn, 0);
    document.addEventListener('DOMContentLoaded', fn);
  }
  ready(() => {
    try{
      const App = window.App || {};
      if (window.RulesEngine){
        const orig = window.RulesEngine.snapshot;
        window.RulesEngine.snapshot = function(){
          try{
            const s = App.state && App.state.currentRoll ? App.state.currentRoll : null;
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



// ===== v0.7.6_beta5: Hybrid Uniques Recommender (max discovery + graceful generic fallback) =====
(function(){
  const UNIQUE_SOURCES = [
    'Uniques/amulet.json','Uniques/axe.json','Uniques/belt.json','Uniques/body.json','Uniques/boots.json',
    'Uniques/bow.json','Uniques/claw.json','Uniques/crossbow.json','Uniques/dagger.json','Uniques/focus.json',
    'Uniques/flail.json','Uniques/flask.json','Uniques/gloves.json','Uniques/helmet.json','Uniques/jewel.json',
    'Uniques/mace.json','Uniques/quiver.json','Uniques/ring.json','Uniques/sceptre.json','Uniques/shield.json',
    'Uniques/soulcore.json','Uniques/spear.json','Uniques/staff.json','Uniques/sword.json','Uniques/tincture.json',
    'Uniques/traptool.json','Uniques/wand.json'
  ];
  const UNIQUE_CATALOG_FALLBACK = 'uniques_enriched_0.8.0.json';
  const WEIGHTS = { Ailment: 1.0, Tactic: 1.3, DefensiveStrategy: 1.1 };
  let TAG_LEXICON = null;
  let NAME_TAGS = null;
  let KNOWN_NAMES = null;

  function makeTagRegex(raw) {
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${esc}\\b`, 'i');
  }
  function buildTagLexicon(DATA) {
    const map = new Map();
    const add = (arr, category) => arr.forEach(obj => {
      const canonical = obj.name;
      (obj.tags || []).forEach(t => map.set(String(t).toLowerCase(), { canonical, category }));
    });
    add(window.DATA.Ailments, 'Ailment');
    add(window.DATA.Tactics, 'Tactic');
    add(window.DATA.DefensiveStrategies, 'DefensiveStrategy');
    return map;
  }
  function buildNameTags(DATA) {
    const m = new Map();
    const ingest = (arr=[]) => arr.forEach(o => m.set(o.name, (o.tags||[]).map(t=>String(t).toLowerCase())));
    ingest(window.DATA.Ailments);
    ingest(window.DATA.Tactics);
    ingest(window.DATA.DefensiveStrategies);
    return m;
  }
  function buildKnownNames(DATA){
    const s = new Set();
    [window.DATA.Ailments, window.DATA.Tactics, window.DATA.DefensiveStrategies].forEach(arr => {
      (arr||[]).forEach(o => s.add(o.name));
    });
    return s;
  }
  async function fetchJSONSafe(url) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return await r.json(); }
    catch {
      try { const r2 = await fetch('./' + url); if (!r2.ok) throw new Error(`${r2.status}`); return await r2.json(); }
      catch { return null; }
    }
  }

  // ===== Rolled tag discovery =====
  function listify(x){ return Array.isArray(x) ? x : (x ? [x] : []); }
  function normalizeToNames(arr) {
    const out = [];
    for (const it of arr) {
      if (it == null) continue;
      if (typeof it === 'string') out.push(it);
      else if (typeof it.name === 'string') out.push(it.name);
      else if (typeof it === 'object' && 'Name' in it && typeof it.Name === 'string') out.push(it.Name);
    }
    return out;
  }
  function tryKnownSlots(state){
    const picks = [];
    const tryKeys = [
      'ailmentsSelected','selectedAilments','AilmentsSelected','rolledAilments','rollAilments','ailments',
      'tacticsSelected','selectedTactics','TacticsSelected','rolledTactics','rollTactics','tactics',
      'defensiveStrategySelected','selectedDefensiveStrategy','DefensiveStrategySelected','defensiveStrategy','rolledDefensiveStrategy'
    ];
    for (const k of tryKeys) {
      if (state && k in state) picks.push(...normalizeToNames(listify(state[k])));
    }
    return picks;
  }
  function deepScanForNames(root, knownNames) {
    const seen = new WeakSet(); const found = new Set();
    const stack = [root]; let safety = 0;
    while (stack.length && safety++ < 20000) {
      const cur = stack.pop();
      if (!cur) continue;
      const t = Object.prototype.toString.call(cur);
      if (t === '[object Map]') { for (const [k,v] of cur) { if (typeof k === 'string' && knownNames.has(k)) found.add(k); stack.push(v); } continue; }
      if (t === '[object Set]') { for (const v of cur) stack.push(v); continue; }
      if (typeof cur === 'object') {
        if (seen.has(cur)) continue; seen.add(cur);
        if (Array.isArray(cur)) { cur.forEach(v => stack.push(v)); }
        else {
          for (const [k,v] of Object.entries(cur)) {
            if (k === 'name' && typeof v === 'string' && knownNames.has(v)) found.add(v);
            else if (typeof v === 'string' && knownNames.has(v)) found.add(v);
            if (v && (typeof v === 'object')) stack.push(v);
          }
        }
      }
    }
    return [...found];
  }
  function getRolledRawTags(state) {
    // 0) Try explicit arrays on App?
    let names = [];
    if (window.App) {
      const s = window.App.state || {};
      names = names.concat(tryKnownSlots(s));
    }
    // 1) Try the state argument directly
    if (!names.length) names = names.concat(tryKnownSlots(state || {}));
    // 2) Deep scan App then state
    if (!names.length && window.App) names = names.concat(deepScanForNames(window.App, KNOWN_NAMES));
    if (!names.length) names = names.concat(deepScanForNames(state, KNOWN_NAMES));
    names = [...new Set(names)];
    // Map names -> raw tags
    const raw = new Set();
    names.forEach(n => { const tags = NAME_TAGS.get(n); if (tags) tags.forEach(t => raw.add(t)); });
    // 3) DOM fallback: look for pills already rendered (data-pill / .pill) and map to known names or raw tags
    if (!raw.size) {
      const pills = Array.from(document.querySelectorAll('[data-pill],[data-tag],.pill'));
      const seenText = new Set();
      for (const el of pills) {
        const txt = (el.getAttribute('data-pill') || el.getAttribute('data-tag') || el.textContent || '').trim();
        if (!txt) continue;
        const low = txt.toLowerCase().replace(/\s+/g,'');
        seenText.add(txt);
        // If it's a known name
        if (KNOWN_NAMES.has(txt)) {
          const tags = NAME_TAGS.get(txt); if (tags) tags.forEach(t => raw.add(t));
        }
        // If it's a raw tag token (e.g., 'criticalhit', 'shock')
        if (TAG_LEXICON.has(low)) raw.add(low);
      }
      if (raw.size) console.debug('[uniques] DOM pill fallback picked from:', [...seenText]);
    }
    return [...raw];
  }

  function canonSetFromRaw(rawList) {
    const s = new Set();
    rawList.forEach(r => { const info = TAG_LEXICON.get(r); if (info) s.add(info.canonical); });
    return s;
  }
  function weaponSlotsFromState(state) {
    const slots = new Set();
    const w = (state && state.weaponsText || (window.App && window.App.state && window.App.state.weaponsText) || '').toLowerCase();
    if (w.includes('staff')) slots.add('staff');
    if (w.includes('sword')) slots.add('sword');
    if (w.includes('mace')) slots.add('mace');
    if (w.includes('wand')) slots.add('wand');
    if (w.includes('sceptre')) slots.add('sceptre');
    if (w.includes('bow')) slots.add('bow');
    if (w.includes('crossbow')) slots.add('crossbow');
    if (w.includes('shield') || w.includes('buckler')) slots.add('shield');
    return slots;
  }

  async function loadUniquesFromFolder() {
    const results = await Promise.all(UNIQUE_SOURCES.map(async url => {
      const arr = await fetchJSONSafe(url);
      if (!Array.isArray(arr)) return [];
      const slot = url.split('/').pop().replace('.json','');
      return arr.filter(x => typeof x === 'string').map(entry => {
        const lines = entry.split('\n').map(s => s.trim()).filter(Boolean);
        return { slot, name: lines[0] || 'Unknown Unique', base: lines[1] || '', lines, text: entry };
      });
    }));
    return results.flat();
  }
  async function loadUniquesFromEnriched() {
    const data = await fetchJSONSafe(UNIQUE_CATALOG_FALLBACK);
    if (!data) return [];
    const arr = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(arr)) return [];
    return arr.map(item => ({
      slot: item.slot, name: item.name, base: item.base || '', lines: item.lines || [],
      tagsRaw: (item.tags && item.tags.raw) || []
    }));
  }

  function scoreUniqueLive(unique, rolledRawList, rolledCanonSet, weaponSlotsSet) {
    let score = 0; const matchedCanon = new Set(); const matchedLines = [];
    for (const raw of rolledRawList) {
      const info = TAG_LEXICON.get(raw);
      if (!info) continue;
      const rx = makeTagRegex(raw);
      if (rx.test(unique.text)) {
        if (!matchedCanon.has(info.canonical)) { matchedCanon.add(info.canonical); score += WEIGHTS[info.category] ?? 1.0; }
        const lineHit = (unique.lines || []).find(l => rx.test(l));
        if (lineHit) matchedLines.push(lineHit.replace(rx, m => `<span class="hit">${m}</span>`));
      }
    }
    if (weaponSlotsSet.has(unique.slot)) score += 0.6;
    return { score, matchedCanon: [...matchedCanon], matchedLines };
  }
  function scoreUniquePreEnriched(unique, rolledCanonSet, weaponSlotsSet) {
    let score = 0; const matchedCanon = new Set(); const matchedLines = [];
    for (const raw of (unique.tagsRaw || [])) {
      const info = TAG_LEXICON.get(raw.toLowerCase());
      if (!info) continue;
      if (rolledCanonSet.has(info.canonical) && !matchedCanon.has(info.canonical)) {
        matchedCanon.add(info.canonical); score += WEIGHTS[info.category] ?? 1.0;
        const rx = makeTagRegex(raw);
        const lineHit = (unique.lines || []).find(l => rx.test(l));
        if (lineHit) matchedLines.push(lineHit.replace(rx, m => `<span class="hit">${m}</span>`));
      }
    }
    if (weaponSlotsSet.has(unique.slot)) score += 0.6;
    return { score, matchedCanon: [...matchedCanon], matchedLines };
  }

  function genericTopByAnyTags(catalog, limit=5) {
    // No rolled tags — pick items that mention many lexicon tags (broadly interesting)
    const scores = [];
    const raws = [...TAG_LEXICON.keys()].slice(0, 500); // keep it bounded
    const rxCache = new Map();
    raws.forEach(r => rxCache.set(r, makeTagRegex(r)));
    for (const u of catalog) {
      let sc = 0; const seenCanon = new Set();
      for (const r of raws) {
        const info = TAG_LEXICON.get(r); const rx = rxCache.get(r);
        if (rx && rx.test(u.text || u.lines?.join(' ') || '')) {
          if (!seenCanon.has(info.canonical)) { seenCanon.add(info.canonical); sc += 1; }
        }
      }
      if (sc > 0) scores.push({u, score: sc, matchedCanon: [...seenCanon], matchedLines: []});
    }
    scores.sort((a,b)=>b.score-a.score);
    return scores.slice(0, limit).map(s => ({ item: s.u, matchedCanon: s.matchedCanon, matchedLines: s.matchedLines }));
  }

  function ensureUniquesSection() {
    const headings = Array.from(document.querySelectorAll('h3'));
    let skillsH3 = headings.find(h => h.textContent.trim().toLowerCase() === 'recommended skills');
    let anchorSect = skillsH3 ? skillsH3.closest('.sect') : null;
    const fallbackAnchor = document.querySelector('#results') || document.querySelector('main') || document.body;
    if (!document.getElementById('uniques-section')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'sect';
      wrapper.id = 'uniques-section';
      wrapper.innerHTML = `<div class="sect-head">
        <h3>Recommended Uniques</h3>
        <div class="underline"></div>
        <p class="sub">3–5 items that synergize with your roll</p>
      </div>
      <div id="uniques-grid" class="grid two"></div>`;
      if (anchorSect && anchorSect.parentNode) anchorSect.after(wrapper);
      else fallbackAnchor.appendChild(wrapper);
    }
    return document.getElementById('uniques-grid');
  }

  async function recommendUniquesHybrid(DATA, state, limit=5) {
    if (!TAG_LEXICON) TAG_LEXICON = buildTagLexicon(DATA);
    if (!NAME_TAGS)  NAME_TAGS  = buildNameTags(DATA);
    if (!KNOWN_NAMES) KNOWN_NAMES = buildKnownNames(DATA);

    const rolledRaw = getRolledRawTags(state);
    const rolledCanon = new Set(rolledRaw.map(r => (TAG_LEXICON.get(r)||{}).canonical).filter(Boolean));
    const weaponSlotsSet = weaponSlotsFromState(state);
    console.debug('[uniques] rolled raw tags:', rolledRaw, 'canon:', [...rolledCanon]);

    const liveEntries = await loadUniquesFromFolder();
    if (Array.isArray(liveEntries) && liveEntries.length > 0) {
      if (!rolledRaw.length) {
        const generic = genericTopByAnyTags(liveEntries, limit);
        console.debug('[uniques] live generic picks:', generic.length);
        return generic;
      }
      const scored = liveEntries.map(u => ({ u, ...scoreUniqueLive(u, rolledRaw, rolledCanon, weaponSlotsSet) }))
                                .filter(x => x.score > 0)
                                .sort((a,b) => b.score - a.score);
      console.debug('[uniques] live entries:', liveEntries.length, 'scored:', scored.length);
      const chosen = []; const perSlot = new Map();
      for (const s of scored) { const c = perSlot.get(s.u.slot) || 0; if (c >= 2) continue; chosen.push(s); perSlot.set(s.u.slot, c+1); if (chosen.length >= limit) break; }
      return chosen.map(s => ({ item: s.u, matchedCanon: s.matchedCanon, matchedLines: s.matchedLines }));
    }

    const enriched = await loadUniquesFromEnriched();
    if (!rolledRaw.length) {
      // We can approximate generic picks using tagsRaw cardinality
      const scored = enriched.map(u => ({ u, sc: (u.tagsRaw||[]).length }))
                             .filter(x => x.sc > 0).sort((a,b)=>b.sc-a.sc).slice(0, limit);
      console.debug('[uniques] enriched generic picks:', scored.length);
      return scored.map(s => ({ item: s.u, matchedCanon: [], matchedLines: [] }));
    }
    const scored = enriched.map(u => ({ u, ...scoreUniquePreEnriched(u, rolledCanon, weaponSlotsSet) }))
                           .filter(x => x.score > 0)
                           .sort((a,b) => b.score - a.score);
    console.debug('[uniques] enriched entries:', enriched.length, 'scored:', scored.length);
    const chosen = []; const perSlot = new Map();
    for (const s of scored) { const c = perSlot.get(s.u.slot) || 0; if (c >= 2) continue; chosen.push(s); perSlot.set(s.u.slot, c+1); if (chosen.length >= limit) break; }
    return chosen.map(s => ({ item: s.u, matchedCanon: s.matchedCanon, matchedLines: s.matchedLines }));
  }

  function renderUniques(recs) {
    const grid = ensureUniquesSection();
    if (!grid) return;
    grid.innerHTML = recs.map(({item, matchedCanon, matchedLines}) => {
      const pills = (matchedCanon||[]).map(t => `<span class="pill">${t}</span>`).join(' ');
      const lines = (matchedLines || []).slice(0,3).map(l => `<div>${l}</div>`).join('');
      return `<div class="unique-card">
        <h4 class="unique-title">${item.name}</h4>
        <div class="unique-sub">${item.slot} • ${item.base || ''}</div>
        <div class="unique-tags">${pills}</div>
        <div class="unique-lines">${lines}</div>
      </div>`;
    }).join('');
  }

  function stateSignature(state){
    try { return JSON.stringify({
      cls: state?.classSelected?.name || state?.ClassName || '',
      asc: state?.ascendancySelected?.name || state?.AscendancyName || '',
      wep: state?.weaponsText || '',
      ail: (state?.ailmentsSelected||state?.selectedAilments||[]).map(x=>x.name||x).sort(),
      tac: (state?.tacticsSelected||state?.selectedTactics||[]).map(x=>x.name||x).sort(),
      def: state?.defensiveStrategySelected?.name || state?.selectedDefensiveStrategy?.name || ''
    }); } catch { return ''; }
  }

  let lastSig = null;
  setInterval(async () => {
    const state = (window.App && window.App.state) ? window.App.state : null;
    if (!state || !window.DATA) return;
    const sig = stateSignature(state);
    if (sig && sig !== lastSig) {
      lastSig = sig;
      try { const recs = await recommendUniquesHybrid(window.DATA, state, 5); renderUniques(recs); }
      catch (e) { console.error('[uniques] recommend error', e); }
    }
  }, 600);

  console.debug('[uniques] hybrid recommender installed (beta5)');
})();
// ===== end uniques module =====


// ===== v0.7.6_beta6: Uniques recommender — slot gating, bronze cards, full lines, tag pills =====


/* === Uniques Synergy — v0.7.6_beta8i FIX (single, baked) === */
(function(){
  const TOKEN = 'u8i_fix_'+Date.now();
  window.__uniquesToken = TOKEN;
  const active = () => window.__uniquesToken === TOKEN;

  const ENRICHED_URL = 'uniques_enriched_0.8.0.json';
  const ALWAYS_OK = new Set(['amulet','belt','ring','jewel','body','boots','gloves','helmet','flask','tincture']);

  // ---- helpers ----
  const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const rx   = s => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'ig');

  function q(id){ return document.getElementById(id); }
  function textOf(id){ const el = q(id); return (el && (el.textContent||'').trim()) || ''; }

  function splitNames(s){
    if(!s) return [];
    return s.split(/[,\u2022]/).map(x=>x.trim()).filter(Boolean);
  }

  function dataIndex(){
    const DATA = window.DATA||{};
    const out = new Map(); // name -> tags[]
    (DATA.Tactics||[]).forEach(o => out.set(String(o.name), (o.tags||[])));
    (DATA.Ailments||[]).forEach(o => out.set(String(o.name), (o.tags||[])));
    (DATA.DefensiveStrategies||[]).forEach(o => out.set(String(o.name), (o.tags||[])));
    return out;
  }

  function rolledByCategory(){
    const index = dataIndex();
    const tactics = splitNames(textOf('tactics')).flatMap(n => index.get(n)||[]);
    const ailments = splitNames(textOf('ailments')).flatMap(n => index.get(n)||[]);
    const defstr = splitNames(textOf('defstrat')).flatMap(n => index.get(n)||[]);
    const N = a => [...new Set(a.map(norm))];
    return { tactics: N(tactics), ailments: N(ailments), def: N(defstr) };
  }

  function allowedSlots(){
    const wtxt = textOf('weapons').toLowerCase();
    const allow = new Set([...ALWAYS_OK]);
    const has = s => wtxt.includes(s);
    const add = s => allow.add(s);

    // primary
    if (has('bow')) { add('bow'); add('quiver'); }
    if (has('crossbow')) { add('crossbow'); /* no quiver */ }
    if (has('staff')) add('staff');
    if (has('spear')) add('spear');
    if (has('sword')) add('sword');
    if (has('mace')) add('mace');
    if (has('axe')) add('axe');
    if (has('claw')) add('claw');
    if (has('wand')) add('wand');
    if (has('sceptre')) add('sceptre');

    // off-hands mentioned in text
    if (has('shield')) add('shield');
    if (has('buckler')) add('buckler');
    if (has('focus')) add('focus');
    if (has('soulcore')) add('soulcore');
    if (has('trap tool') || has('traptool')) add('traptool');

    return allow;
  }

  // ---- load uniques ----
  let ENRICHED_CACHE = null;
  async function loadUniques(){
    if (ENRICHED_CACHE) return ENRICHED_CACHE;
    const r = await fetch(ENRICHED_URL, {cache:'no-store'});
    if (!r.ok) throw new Error('uniques_enriched not found');
    ENRICHED_CACHE = await r.json();
    return ENRICHED_CACHE;
  }

  // ---- scoring ----
  const W = { Tactic: 3.0, Ailment: 1.7, Def: 1.2 };
  function scoreItem(item, rolled, slotAllow){
    const raw = (item.tags && item.tags.raw) || [];
    const canon = (item.tags && item.tags.canonical) || [];
    const allRaw = new Set(raw.map(norm));
    const allCanon = new Set(canon.map(norm));

    let score = 0, matches=[];
    for (const t of rolled.tactics){ if (allRaw.has(t) || allCanon.has(t)) { score += W.Tactic; matches.push(t); } }
    for (const t of rolled.ailments){ if (allRaw.has(t) || allCanon.has(t)) { score += W.Ailment; matches.push(t); } }
    for (const t of rolled.def){ if (allRaw.has(t) || allCanon.has(t)) { score += W.Def; matches.push(t); } }

    // weapon compatibility bonus
    if (slotAllow.has(item.slot)) score += 0.6;

    return { score, matches:[...new Set(matches)] };
  }

  function pickRecommendations(items, rolled, slotAllow, limitMax=5, perSlotCap=2){
    const scored = items
      .filter(it => slotAllow.has(it.slot) || ALWAYS_OK.has(it.slot))
      .map(it => ({ it, ...scoreItem(it, rolled, slotAllow) }))
      .filter(x => x.score > 0)
      .sort((a,b)=> b.score - a.score);

    const out = [], per = new Map();
    for (const s of scored){
      const c = per.get(s.it.slot)||0; if (c>=perSlotCap) continue;
      per.set(s.it.slot, c+1);
      out.push(s);
      if (out.length>=limitMax) break;
    }
    // If nothing scored, fallback to first few non-weapon trinkets to avoid empty UI
    if (!out.length){
      for (const it of items){
        if (ALWAYS_OK.has(it.slot)){ out.push({it, score:0, matches:[]}); if (out.length>=3) break; }
      }
    }
    return out;
  }

  // ---- render ----
  function ensureSection(){
    // clear previous
    document.querySelectorAll('#uniques-section').forEach(el=>el.remove());
    const anchor = document.querySelector('#skills-grid')?.closest('.sect') || document.querySelector('main') || document.body;

    const wrap = document.createElement('div');
    wrap.id = 'uniques-section';
    wrap.className = 'sect';

    const head = document.createElement('div');
    head.className = 'sect-head';
    head.innerHTML = '<h3>Unique Items</h3><div class="underline"></div><p class="sub">Curated by tactics → ailments → defense</p>';

    const grid = document.createElement('div');
    grid.id = 'uniques-grid';
    grid.className = 'grid two uniques-grid';

    wrap.appendChild(head); wrap.appendChild(grid);
    // insert after anchor
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    return grid;
  }

  function render(recs, rolledSet){
    const grid = ensureSection();
    const pillsFor = (item) => {
      const raw = (item.tags && item.tags.raw) || [];
      const canon = (item.tags && item.tags.canonical) || [];
      const tags = [...new Set([...raw, ...canon].map(norm))];
      return tags.map(t => `<span class="tag-pill pill${rolledSet.has(t)?' matched':''}" data-tag="${t}">${t}</span>`).join('');
    };
    const highlight = (s) => {
      let out = s;
      rolledSet.forEach(r => { try{ out = out.replace(rx(r), m=>`<span class="hit">${m}</span>`); }catch{} });
      return out;
    };

    grid.innerHTML = recs.map(({it}) => {
      const name = it.name, base = it.base;
      const lines = (it.lines||[]).slice(2).map(L => `<div>${highlight(L)}</div>`).join('');
      const pills = pillsFor(it);
      return `<div class="unique-card">
        <div class="unique-title">${name}</div>
        <div class="unique-base">${base}</div>
        <div class="unique-tags">${pills}</div>
        <div class="unique-lines">${lines}</div>
      </div>`;
    }).join('');
  }

  // ---- main orchestrator ----
  async function refresh(){
    if (!active()) return;
    try {
      const data = await loadUniques();
      const items = data.items || [];
      const rolled = rolledByCategory();
      const rolledSet = new Set([...rolled.tactics, ...rolled.ailments, ...rolled.def]);
      const allowed = allowedSlots();
      const picks = pickRecommendations(items, rolled, allowed, 5, 2);
      render(picks, rolledSet);
    } catch(e){
      console.error('[uniques] refresh error', e);
    }
  }

  // Watch for state changes by polling a signature of visible texts
  let lastSig = '';
  function sig(){
    return [textOf('tactics'), textOf('ailments'), textOf('defstrat'), textOf('weapons')].join('|');
  }
  setInterval(()=>{
    if (!active()) return;
    const s = sig();
    if (s!==lastSig){ lastSig = s; refresh(); }
  }, 600);

  // Also refresh once on load
  setTimeout(refresh, 50);
})();


/* === Randomancer: Uniques Synergy (merged) — v0.7.8_release === */
(function(){
  const TOKEN = 'uniques_078r_' + Date.now();
  window.__uniquesToken = TOKEN;
  const active = () => window.__uniquesToken === TOKEN;

  // ---------- helpers ----------
  const aliasMap = new Map([
    ['armorbreak','armourbreak'] // US -> UK
  ]);
  const norm = s => {
    const t = String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    return aliasMap.get(t) || t;
  };
  const q = id => document.getElementById(id);
  const textOf = id => (q(id)?.textContent||'').trim();

  function splitNames(s){
    if(!s) return [];
    return String(s)
      .replace(/\u00B7/g, '•')
      .split(/\s*(?:,|•|&|\band\b|\/|\+|;)\s*/i)
      .map(x => x.replace(/^['"]|['"]$/g, '').trim())
      .filter(Boolean);
  }

  // Index (name -> tags) from global DATA
  function dataIndex(){
    const DATA = window.DATA||{};
    const byName = new Map(), byNorm = new Map();
    const add = arr => (arr||[]).forEach(o => {
      const name = String(o?.name||'').trim(); if(!name) return;
      const tags = Array.from(new Set((o?.tags||[]).map(norm))).filter(Boolean);
      byName.set(name, tags); byNorm.set(norm(name), tags);
    });
    add(DATA.Tactics); add(DATA.Ailments); add(DATA.DefensiveStrategies);
    return { get: (name) => byName.get(name) || byNorm.get(norm(name)) || [] };
  }

  // Expand composite tags like "slow/maim/hinder" into atomic tokens
  function expandTags(arr){
    const out = new Set();
    for (let t of (arr||[])){
      if (!t) continue;
      const raw = String(t);
      const parts = raw.split(/\s*(?:\/|&|\band\b|\+)\s*/i).map(p=>norm(p)).filter(Boolean);
      if (parts.length > 1){ parts.forEach(p=>out.add(p)); continue; }
      const n = norm(raw);
      if (n === 'slowmaimhinder'){ out.add('slow'); out.add('maim'); out.add('hinder'); continue; }
      out.add(n);
    }
    return Array.from(out);
  }

  // Derive tags from item text (covers missing dataset tags)
  function deriveExtraTags(lines){
    const txt = (lines||[]).slice(2).join('\n').toLowerCase(); // skip name/base
    const out = [];
    // Armour Break (various phrasings)
    if (/(?:break|broken|breaks)\s+armou?r/.test(txt) || /armou?r\s*(?:break|broken)/.test(txt)) out.push('armourbreak');
    if (/(armou?r.*shatter|shatter.*armou?r)/.test(txt)) out.push('armourbreak');
    // Slow/Maim/Hinder variants
    if (/\bhinder(?:ed|ing|s)?\b|\bhindrance\b/.test(txt)) out.push('hinder');
    if (/\bslow(?:ed|ing|s)?\b|\bslowing\b/.test(txt)) out.push('slow');
    if (/\bmaim(?:ed|ing|s)?\b/.test(txt)) out.push('maim');
    return out;
  }

  // Evidence-based filter for suspicious canonical tags
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
    Minions: /\bminion(s)?\b/i,
    Summon: /\bsummon(s|ed|ing)?\b/i,
    Totem: /\btotem(s)?\b/i,
    Trap: /\btrap(s|ping)?\b/i,
    Mark: /\b[a-z]+'s\s+mark\b|\bmark\b/i,
    'Block Recovery': /\bblock\s+recovery\b|\bstun\s+and\s+block\s+recovery\b/i,
  };
  function filterCanonicalsByEvidence(item){
    const canon = (item.tags && item.tags.canonical) || [];
    if (!canon.length) return canon;
    const text = (item.lines||[]).slice(2).join('\\n');
    return canon.filter(lbl => {
      const r = RX[lbl];
      if (!r) return true; // unknown label -> keep
      return r.test(text);
    });
  }

  function rolledByCategory(){
    const idx = dataIndex();
    const rawT = (document.getElementById('tactics')?.textContent||'').trim();
    const rawA = (document.getElementById('ailments')?.textContent||'').trim();
    const rawD = (document.getElementById('defstrat')?.textContent||'').trim();

    const namesT = Array.from(new Set([...splitNames(rawT), rawT].filter(Boolean)));
    const namesA = Array.from(new Set([...splitNames(rawA), rawA].filter(Boolean)));
    const namesD = Array.from(new Set([...splitNames(rawD), rawD].filter(Boolean)));

    const tagsT = expandTags(namesT.flatMap(n => idx.get(n)));
    const tagsA = expandTags(namesA.flatMap(n => idx.get(n)));
    const tagsD = expandTags(namesD.flatMap(n => idx.get(n)));

    const out = { tactics:tagsT, ailments:tagsA, def:tagsD };
    console.debug('[uniques] names', {namesT, namesA, namesD});
    console.debug('[uniques] tags', out);
    return out;
  }

  function allowedSlots(){
    const wtxt = (document.getElementById('weapons')?.textContent||'').toLowerCase();
    const allow = new Set(['amulet','belt','ring','jewel','body','boots','gloves','helmet','flask','tincture']);
    const has = s => wtxt.includes(s), add = s => allow.add(s);
    if (has('bow')) { add('bow'); add('quiver'); }
    if (has('crossbow')) add('crossbow');
    if (has('staff')) add('staff');
    if (has('spear')) add('spear');
    if (has('sword')) add('sword');
    if (has('mace')) add('mace');
    if (has('axe')) add('axe');
    if (has('claw')) add('claw');
    if (has('wand')) add('wand');
    if (has('sceptre')) add('sceptre');
    if (has('shield')) add('shield');
    if (has('buckler')) add('buckler');
    if (has('focus')) add('focus');
    if (has('soulcore')) add('soulcore');
    if (has('trap tool') || has('traptool')) add('traptool');
    return allow;
  }

  // Load enriched uniques (release filename; accept array or {items:[]})
  async function loadUniques(){
    const url = 'uniques_enriched_0.8.0.json?v=' + Date.now();
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    return Array.isArray(data) ? data : (data.items||[]);
  }

  // Scoring
  const W = { Tactic: 3.0, Ailment: 1.7, Def: 1.2, Slot: 0.6 };
  function scoreItem(item, rolled, slotAllow){
    const raw = (item.tags&&item.tags.raw)||[];
    const canon = filterCanonicalsByEvidence(item);
    const derived = deriveExtraTags(item.lines||[]);
    const all = new Set([...raw, ...canon, ...derived].map(norm));
    let s = 0;
    for (const t of rolled.tactics)  if (all.has(t)) s += W.Tactic;
    for (const t of rolled.ailments) if (all.has(t)) s += W.Ailment;
    for (const t of rolled.def)      if (all.has(t)) s += W.Def;
    if (slotAllow.has(item.slot)) s += W.Slot;
    return s;
  }

  function pickRecommendations(items, rolled, slotAllow, limitMax=5, perSlotCap=2){
    const scored = items.map(it => ({it, s: scoreItem(it, rolled, slotAllow)}))
                        .filter(x => x.s > 0) // quality-first
                        .sort((a,b)=>b.s-a.s);
    const out=[], per=new Map();
    for (const row of scored){
      const c = per.get(row.it.slot)||0; if (c>=perSlotCap) continue;
      per.set(row.it.slot, c+1);
      out.push(row.it);
      if (out.length>=limitMax) break;
    }
    return out;
  }

  // Render
  function ensureSection(){
    document.querySelectorAll('#uniques-section').forEach(el=>el.remove());
    const anchor = document.querySelector('#skills-grid')?.closest('.sect') || document.querySelector('main') || document.body;
    const wrap = document.createElement('div'); wrap.id='uniques-section'; wrap.className='sect';
    wrap.innerHTML = '<div class="sect-head"><h3>Recommended Uniques</h3><div class="underline"></div><p class="sub">Quality-first: tactics → ailments → defense</p></div><div class="sect-body"><div id="uniques-grid" class="grid two uniques-grid"></div></div>';
    (anchor.parentNode||document.body).insertBefore(wrap, anchor.nextSibling);
    return document.getElementById('uniques-grid');
  }

  function pillsFor(item, rolledSet){
    const raw = (item.tags&&item.tags.raw)||[];
    const canon = filterCanonicalsByEvidence(item);
    const derived = deriveExtraTags(item.lines||[]);
    const tags = Array.from(new Set([...raw, ...canon, ...derived].map(norm)));
    return tags.map(t=>`<span class="tag-pill pill${rolledSet.has(t)?' matched':''}" data-tag="${t}">${t}</span>`).join('');
  }

  function highlight(lines, rolledSet){
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    let out = (lines||[]).slice(2).join('\\n'); // skip name/base
    rolledSet.forEach(t => { const rx=new RegExp(esc(t),'ig'); out = out.replace(rx, m=>`<span class="hit">${m}</span>`); });
    return out.split('\\n').map(L=>`<div>${L}</div>`).join('');
  }

  function render(items, rolledSet){
    const grid = ensureSection();
    grid.innerHTML = items.map(it=>{
      return `<div class="unique-card">
        <div class="unique-title">${it.name}</div>
        <div class="unique-base">${it.base}</div>
        <div class="unique-tags">${pillsFor(it, rolledSet)}</div>
        <div class="unique-lines">${highlight(it.lines, rolledSet)}</div>
      </div>`;
    }).join('');
    console.debug('[uniques] rendered cards:', items.length);
  }

  async function refresh(){
    if(!active()) return;
    try{
      const items = await loadUniques();
      const rolled = rolledByCategory();
      const rolledSet = new Set([...rolled.tactics, ...rolled.ailments, ...rolled.def]);
      const allow = allowedSlots();
      const picks = pickRecommendations(items, rolled, allow, 5, 2);
      render(picks, rolledSet);
    }catch(e){ console.error('[uniques] refresh error', e); }
  }

  // Stabilize initial roll via observers + debounce (fallback poll)
  let lastSig='', debounce;
  const sig = () => [textOf('tactics'), textOf('ailments'), textOf('defstrat'), textOf('weapons')].join('|');
  function scheduleRefresh(){
    clearTimeout(debounce);
    debounce = setTimeout(()=>{ const s=sig(); if(s!==lastSig){ lastSig=s; refresh(); } }, 180);
  }
  ;['tactics','ailments','defstrat','weapons'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    try{ new MutationObserver(scheduleRefresh).observe(el, {childList:true, subtree:true, characterData:true}); }catch(e){}
  });
  setTimeout(()=>{ const s=sig(); lastSig=s; if (s) refresh(); }, 280);
  setInterval(()=>{ const s=sig(); if(s!==lastSig){ lastSig=s; refresh(); } }, 800);
})();


/* === Randomancer: Uniques Synergy v0.7.9_beta2m (isolated) === */
(function(){
  const TOKEN = 'u79b2m_' + Date.now();
  window.__u79_active = TOKEN; // last-wins flag

  const alias = new Map([
    ['armorbreak','armourbreak'],
    ['heavy stun','heavystun'],
    ['life regeneration','liferegeneration'],
    ['culling strike','cullingstrike'],
    ['block recovery','blockrecovery'],
  ]);
  const norm = (s) => {
    const t = String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    return alias.get(t) || t;
  };
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

  function rolledByCategory(){
    const idx = dataIndex();
    const rawT = (document.getElementById('tactics')?.textContent||'').trim();
    const rawA = (document.getElementById('ailments')?.textContent||'').trim();
    const rawD = (document.getElementById('defstrat')?.textContent||'').trim();
    const namesT = Array.from(new Set([...splitNames(rawT), rawT].filter(Boolean)));
    const namesA = Array.from(new Set([...splitNames(rawA), rawA].filter(Boolean)));
    const namesD = Array.from(new Set([...splitNames(rawD), rawD].filter(Boolean)));
    const tagsT = expandTags(namesT.flatMap(n => idx.get(n)));
    const tagsA = expandTags(namesA.flatMap(n => idx.get(n)));
    const tagsD = expandTags(namesD.flatMap(n => idx.get(n)));
    return { tactics:tagsT, ailments:tagsA, def:tagsD };
  }

  function allowedSlots(){
    const wtxt = (document.getElementById('weapons')?.textContent||'').toLowerCase();
    const allow = new Set(['amulet','belt','ring','jewel','body','boots','gloves','helmet','flask','tincture']);
    const has = s => wtxt.includes(s), add = s => allow.add(s);
    if (has('bow')) { add('bow'); add('quiver'); }
    if (has('crossbow')) add('crossbow');
    if (has('staff')) add('staff');
    if (has('spear')) add('spear');
    if (has('sword')) add('sword');
    if (has('mace')) add('mace');
    if (has('axe')) add('axe');
    if (has('claw')) add('claw');
    if (has('wand')) add('wand');
    if (has('sceptre')) add('sceptre');
    if (has('shield')) add('shield');
    if (has('buckler')) add('buckler');
    if (has('focus')) add('focus');
    if (has('soulcore')) add('soulcore');
    if (has('trap tool') || has('traptool')) add('traptool');
    return allow;
  }

  async function loadUniquesM(){
    const url = 'uniques_enriched_0.8.0.json?v=' + Date.now();
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    return Array.isArray(data) ? data : (data.items||[]);
  }

  function getItemTagSet(item){
    const raw = (item.tags&&item.tags.raw)||[];
    const canon = filterCanonicalsByEvidence(item);
    const derived = deriveExtraTags(item.lines||[]);
    return new Set([...raw, ...canon, ...derived].map(norm));
  }
  function scoreItem(it, rolled, slotAllow){
    const all = getItemTagSet(it);
    let s = 0;
    for (const t of rolled.tactics)  if (all.has(t)) s += 3.0;
    for (const t of rolled.ailments) if (all.has(t)) s += 1.7;
    for (const t of rolled.def)      if (all.has(t)) s += 1.2;
    if (slotAllow.has(it.slot)) s += 0.6;
    return s;
  }
  function pick(items, rolled, allow, limitMax=5, perSlotCap=2){
    const MIN = 2.8;
    const scored = items.map(it=>({it, s:scoreItem(it, rolled, allow)}))
                        .filter(x=>x.s>=MIN)
                        .sort((a,b)=>b.s-a.s);
    const out=[], per=new Map();
    for (const row of scored){
      const c = per.get(row.it.slot)||0; if (c>=perSlotCap) continue;
      per.set(row.it.slot, c+1);
      out.push(row.it);
      if (out.length>=limitMax) break;
    }
    return out;
  }

  function ensureUniqueSection(){
    // Remove previous instances to avoid drift
    document.querySelectorAll('.unique-divider').forEach(el=>el.remove());
    document.querySelectorAll('#uniques-section').forEach(el=>el.remove());

    // Anchor after Skills section
    const skillsGrid = document.querySelector('#skills-grid');
    const skillsSect = skillsGrid ? skillsGrid.closest('.sect') : null;
    const main = document.querySelector('main') || document.body;
    const parent = (skillsSect && skillsSect.parentNode) || main;

    if (!skillsSect) return null; // try later

    // Insert divider
    const divider = document.createElement('div');
    divider.className = 'ornate-divider gold unique-divider';
    skillsSect.insertAdjacentElement('afterend', divider);

    // Insert Uniques section
    const wrap = document.createElement('div');
    wrap.id = 'uniques-section';
    wrap.className = 'sect';
    wrap.innerHTML = '<div class="sect-head"><h3>Recommended Uniques</h3><div class="underline"></div><p class="sub">Quality-first: tactics → ailments → defense</p></div><div class="sect-body"><div id="uniques-grid" class="grid two uniques-grid"></div></div>';
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

  async function refreshUniques(){
    if (window.__u79_active !== TOKEN) return; // last-wins
    try{
      const items = await loadUniquesM();
      const rolled = rolledByCategory();
      const rolledSet = new Set([...rolled.tactics, ...rolled.ailments, ...rolled.def]);
      const allow = allowedSlots();
      const picks = pick(items, rolled, allow, 5, 2);
      renderUniques(picks, rolledSet);
    }catch(e){ console.error('[u79b2m] refresh error', e); }
  }

  // Observe changes to re-render
  let lastSig='', debounce;
  const sig = () => [
    (document.getElementById('tactics')?.textContent||'').trim(),
    (document.getElementById('ailments')?.textContent||'').trim(),
    (document.getElementById('defstrat')?.textContent||'').trim(),
    (document.getElementById('weapons')?.textContent||'').trim()
  ].join('|');
  function schedule(){ clearTimeout(debounce); debounce=setTimeout(()=>{ const s=sig(); if(s!==lastSig){ lastSig=s; refreshUniques(); } }, 180); }
  ;['tactics','ailments','defstrat','weapons'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    try{ new MutationObserver(schedule).observe(el, {childList:true, subtree:true, characterData:true}); }catch(e){}
  });
  setTimeout(()=>{ const s=sig(); lastSig=s; if (s) refreshUniques(); }, 300);
  setInterval(()=>{ const s=sig(); if(s!==lastSig){ lastSig=s; refreshUniques(); } }, 900);
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

