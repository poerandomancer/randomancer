import { formatWeaponLine, getQueryParams, onDomReady, setSkillsTabsAvailability } from './01-meta-and-domready.js';
import { renderSummaryFromSnapshot } from './02-summary-view.js';
import { buildTagIDF } from './05-tags-and-scorer.js';

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
		  set('#weapons',  formatWeaponLine(s.weapon, s.offhand));
		  set('#offhand',  s.offhand);
                  set('#tactics',  s.tactics);
                  set('#ailments', s.ailments);
                  set('#build-name', s.buildName);
                  set('#build-subtext', s.flavor);
		  const weapons2El = document.querySelector('#weapons-set2');
		  if (weapons2El) {
		    const weapons2Txt = formatWeaponLine(s.weapon2, s.offhand2);
		    weapons2El.textContent = weapons2Txt;
		    weapons2El.hidden = !weapons2Txt;
		  }
		  setSkillsTabsAvailability(!!(s.weapon2 || s.offhand2));
			  try { renderSummaryFromSnapshot(s); } catch (e) {}
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
        try{ window.rollBuild(App.state?.DATA || window.DATA); }catch(e){}
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
            try{ window.rollBuild(App.state?.DATA || window.DATA); }catch(e){}
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
      try { if (window.scheduleSummaryRefresh) window.scheduleSummaryRefresh(); } catch {}
      
      // notify listeners that a roll has completed
      try { notifyRoll(); } catch (e) {}
      
      return true;
    };
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
