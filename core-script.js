
/*! Randomancer v0.8.2_cleanup */
import {
  pickRecommendedAscendancyNodes,
  pickRecommendedKeystones,
  pickRecommendedNotables,
} from './passivesEngine.js';

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

const COHESION_MODE_NAMES = ['strict', 'cohesive', 'chaotic', 'madness'];

// ===== DOM helpers =====
  const Dom = (() => {
    const q = (sel) => document.querySelector(sel);
    const setText = (sel, txt) => { const el = q(sel); if (el) el.textContent = txt; };
    const setHTML = (sel, html) => { const el = q(sel); if (el) el.innerHTML = html; };
    const txt = (sel) => (q(sel)?.textContent || '').trim();
    return { q, setText, setHTML, txt };
  })();

// ----- Section Locks (centralized state + UI sync) -----
const DEFAULT_LOCKS = Object.freeze({
  archetype: false,
  mechanics: false,
  survivability: false,
});

function getLockState(){
  const appState = window.App?.state;
  const existing = (appState && appState.locks) || window.__LOCK_STATE__ || {};
  const merged = { ...DEFAULT_LOCKS, ...existing };
  if (appState) {
    appState.locks = merged;
  } else {
    window.__LOCK_STATE__ = merged;
  }
  return merged;
}

function syncLockUIFromState(){
  const locks = getLockState();
  document.querySelectorAll('.section-header').forEach(header => {
    const section = header?.dataset?.section;
    if (!section) return;
    const locked = !!locks[section];
    header.dataset.locked = locked ? 'true' : 'false';
    const btn = header.querySelector('.lock-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    }
  });
}

function wireLockButton(btn){
  if (!btn || btn.__lockInit) return;
  btn.__lockInit = true;
  btn.addEventListener('click', (e) => {
    const header = e.currentTarget.closest('.section-header');
    if (!header) return;
    const section = header.dataset.section;
    if (!section) return;

    const locks = getLockState();
    const nowLocked = header.dataset.locked !== 'true';
    locks[section] = nowLocked;

    header.dataset.locked = nowLocked ? 'true' : 'false';
    e.currentTarget.setAttribute('aria-pressed', nowLocked ? 'true' : 'false');
  });
}

function initSectionLocks(){
  document.querySelectorAll('.section-header .lock-toggle').forEach(wireLockButton);
  syncLockUIFromState();
}

/* === Build Codes + Saved Builds (v0.9 preview) === */
(function(){
  const STORAGE_KEY = 'randomancer_saved_builds_v1';
  const MAX_SAVED = 10;

  const safeBtoa = (str) => {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return ''; }
  };
  const safeAtob = (str) => {
    try { return decodeURIComponent(escape(atob(str))); } catch { return ''; }
  };

  const currentSnap = () => (window.App?.state?.currentRoll) ? window.App.state.currentRoll : null;
  const savedOverlay = document.getElementById('saved-overlay');
  const savedCloseBtn = document.getElementById('saved-close');
  const savedFab = document.getElementById('saved-fab');
  let lastSavedFocus = null;

  function encodeSnapshot(snap){
    if (!snap || typeof snap !== 'object') return '';
    // TODO: include section lock state in saved snapshots once we support persisting locks
    const compact = {
      v: snap.snapshotVersion || 1,
      c: snap.className || '',
      a: snap.ascendancy || '',
      w: snap.weapon || '',
      o: snap.offhand || '',
      al: Array.isArray(snap.ailmentList) ? snap.ailmentList : [],
      tl: Array.isArray(snap.tacticList) ? snap.tacticList : [],
      d: snap.defense || '',
      ds: snap.defStrat || '',
      b: snap.buildName || '',
      f: snap.flavor || '',
      attr: snap.attributes || { strength:0, dexterity:0, intelligence:0 },
      rs: Array.isArray(snap.recommendedSkills) ? snap.recommendedSkills : [],
      pb: snap.recommendedPersistentBuff || null,
      u: Array.isArray(snap.recommendedUniques) ? snap.recommendedUniques : [],
      ss: typeof snap.synergyScore === 'number' ? snap.synergyScore : 0,
      cs: snap.cohesionStatus || 'ok',
      cm: snap.cohesionModeName || resolveCohesionMode(snap.cohesionMode ?? 1)
    };
    return safeBtoa(JSON.stringify(compact));
  }

  function decodeSnapshot(code){
    if (!code) return null;
    const json = safeAtob(code);
    if (!json) return null;
    try {
      const raw = JSON.parse(json);
      return {
        snapshotVersion: raw.v || 1,
        className: raw.c || '',
        ascendancy: raw.a || '',
        weapon: raw.w || '',
        offhand: raw.o || '',
        ailments: (raw.al || []).join(' & '),
        tactics: (raw.tl || []).join(' & '),
        ailmentList: raw.al || [],
        tacticList: raw.tl || [],
        defense: raw.d || '',
        defStrat: raw.ds || '',
        buildName: raw.b || '',
        flavor: raw.f || '',
        attributes: raw.attr || { strength:0, dexterity:0, intelligence:0 },
        recommendedSkills: raw.rs || [],
        recommendedPersistentBuff: raw.pb || null,
        recommendedUniques: raw.u || [],
        synergyScore: typeof raw.ss === 'number' ? raw.ss : 0,
        cohesionStatus: raw.cs || 'ok',
        cohesionModeName: raw.cm || resolveCohesionMode(raw.cohesionMode)
      };
    } catch (e) {
      console.warn('[build code] decode failed', e);
      return null;
    }
  }

  function setElText(sel, txt){ const el = document.querySelector(sel); if (el) el.textContent = txt || ''; }

  function showAppShell(){
    const intro = document.getElementById('intro');
    if (intro) intro.remove();
    const app = document.getElementById('app');
    if (app) app.classList.remove('hidden');
  }

  function renderAttributesFromSnapshot(attr){
    if (!attr) return;
    const S = Number(attr.strength) || 0;
    const D = Number(attr.dexterity) || 0;
    const I = Number(attr.intelligence) || 0;
    const bar = document.getElementById('balance-bar');
    const grad=`linear-gradient(90deg, rgba(176,48,48,1) 0%, rgba(176,48,48,1) ${S*100}%, rgba(45,122,45,1) ${S*100}%, rgba(45,122,45,1) ${(S+D)*100}%, rgba(47,79,157,1) ${(S+D)*100}%, rgba(47,79,157,1) 100%)`;
    if (bar) {
      bar.style.setProperty('--balance-gradient', grad);
      bar.classList.add('glow');
    }
    setElText('#balance-text', `Strength ${Math.round(S*100)}%  |  Dexterity ${Math.round(D*100)}%  | Intelligence ${Math.round(I*100)}%`);
  }

  function lookupGem(dict, entry){
    const key = entry?.id || entry?.name || '';
    if (!key) return null;
    return dict[key] || dict[key.toLowerCase()] || null;
  }

    function renderSkillsFromSnapshot(snap){
      const grid = document.getElementById('skills-grid');
      if (!grid) return;
      grid.innerHTML = '';

    document.querySelectorAll('#persistent-buff-section').forEach(el => el.remove());

    const gems = (window.DATA && window.DATA.gems) || [];
    const gemDict = buildGemDictionary(gems);

    const entries = [];

    (snap.recommendedSkills || []).forEach(entry => {
      const g = lookupGem(gemDict, entry) || lookupGem(gemDict, { id: entry.name });
      if (!g) return;
      const supports = Array.isArray(entry.recommended_supports) && entry.recommended_supports.length
        ? entry.recommended_supports
        : g.recommended_supports;

      entries.push({ gem: g, supports, role: 'Active Skill' });
    });

    if (snap.recommendedPersistentBuff) {
      const buffGem = lookupGem(gemDict, snap.recommendedPersistentBuff);
      if (buffGem) {
        entries.push({ gem: buffGem, supports: buffGem.recommended_supports, role: 'Persistent Buff' });
      }
    }

    if (!entries.length) return;

    if (entries.length === 1) {
      const { gem, supports, role } = entries[0];
      grid.appendChild(createSkillCard(gem, gemDict, supports, role, null));
      return;
    }

    const stack = document.createElement('div');
    stack.className = 'card-stack js-card-stack';

    entries.forEach(({ gem, supports, role }) => {
      stack.appendChild(createSkillCard(gem, gemDict, supports, role, null));
    });

    grid.appendChild(stack);

    const indicator = document.createElement('div');
    indicator.className = 'card-stack-indicator js-card-stack-indicator';
    indicator.textContent = `1 / ${entries.length}`;
    grid.appendChild(indicator);

    initCardStacks(grid);
  }

  function renderSnapshotToDom(snap){
    if (!snap) return;
    setElText('#class', snap.className || '');
    setElText('#ascendancy', snap.ascendancy || '');
    updateAscArt(snap.ascendancy || '');
    const weaponsTxt = snap.offhand ? `${snap.weapon || ''} & ${snap.offhand}` : (snap.weapon || '');
    setElText('#weapons', weaponsTxt);
    setElText('#defense', snap.defense || '');
    setElText('#defstrat', snap.defStrat || '');
    setElText('#ailments', Array.isArray(snap.ailmentList) ? snap.ailmentList.join(' & ') : (snap.ailments || ''));
    setElText('#tactics', Array.isArray(snap.tacticList) ? snap.tacticList.join(' & ') : (snap.tactics || ''));
    const ailments = Array.isArray(snap.ailmentList)
      ? snap.ailmentList
      : (snap.ailments ? snap.ailments.split(/\s*&\s*/).filter(Boolean) : []);
    updateAilmentOverlay(ailments);
    setElText('#build-name', snap.buildName || '');
    setElText('#build-subtext', snap.flavor || '');
    renderAttributesFromSnapshot(snap.attributes);
    renderSkillsFromSnapshot(snap);
    renderPassiveRecommendations((window.App && window.App.state && window.App.state.currentRoll) || snap, window.DATA);

    if (Array.isArray(snap.recommendedUniques) && snap.recommendedUniques.length && window.RandomancerRenderUniquesFromNames) {
      window.RandomancerRenderUniquesFromNames(snap.recommendedUniques);
    }
  }

  function lookupByName(collection, name){
    if (!collection || !name) return null;
    return (collection || []).find(item => item?.name === name) || null;
  }

  function computeSynergyFromSnapshot(snap){
    try {
      const data = window.DATA || {};
      const cls = data.Classes?.[snap.className] || {};
      const baseAttrs = cls.attributes || {};
      const weapons = data.Weapons || {};
      const weaponPool = [].concat(weapons['Two-Handed'] || [], weapons['One-Handed'] || []);
      const offhands = weapons['Off-Hand'] || [];
      const defenses = data.Defense || [];
      const defStrats = data.DefensiveStrategies || [];
      const ailments = data.Ailments || [];
      const tactics = data.Tactics || [];

      const weapon = lookupByName(weaponPool, snap.weapon);
      const offhand = lookupByName(offhands, snap.offhand);
      const defense = lookupByName(defenses, snap.defense);
      const defStrat = lookupByName(defStrats, snap.defStrat);
      const ailmentSet = (snap.ailmentList || []).map(n => lookupByName(ailments, n)).filter(Boolean);
      const tacticSet = (snap.tacticList || []).map(n => lookupByName(tactics, n)).filter(Boolean);

      return computeSynergyScore(baseAttrs, { weapon, offhand, defense, defStrat, ailments: ailmentSet, tactics: tacticSet });
    } catch (e) {
      console.warn('[snapshot] failed to compute synergy score', e);
      return 0;
    }
  }

  async function applyBuildCode(code){
    const snap = decodeSnapshot(code);
    if (!snap) return false;
    await ensureDataPreload();
    showAppShell();

    const synergyScore = typeof snap.synergyScore === 'number'
      ? snap.synergyScore
      : computeSynergyFromSnapshot(snap);
    const modeName = snap.cohesionModeName || resolveCohesionMode(snap.cohesionMode ?? window.App?.state?.cohesionMode ?? currentMode);
    const cohesionStatus = snap.cohesionStatus || 'ok';
    const rollPayload = { ...snap, synergyScore, cohesionStatus, cohesionModeName: modeName };

    if (window.App?.mergeCurrentRoll) {
      window.App.mergeCurrentRoll(rollPayload);
    }

    renderSnapshotToDom(rollPayload);
    if (window.App?.state) {
      refreshCohesionUI({ ...window.App.state, synergyScore, cohesionStatus, cohesionModeName: modeName });
    } else {
      refreshCohesionUI({ synergyScore, cohesionStatus, cohesionModeName: modeName });
    }
    updateCodeUI(code);
    return true;
  }

  function loadSaved(){
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
  }
  function persistSaved(list){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); } catch {}
  }

  function syncSaveButtonState(code){
    const btn = document.getElementById('save-build');
    if (!btn) return;
    const list = loadSaved();
    const activeCode = code || (() => { const snap = currentSnap(); return encodeSnapshot(snap); })();
    const saved = !!(activeCode && list.some(e => e.code === activeCode));
    btn.textContent = saved ? '★' : '☆';
    btn.dataset.saved = saved ? '1' : '0';
    btn.setAttribute('aria-label', saved ? 'Build Saved' : 'Save Build');
    btn.setAttribute('title', saved ? 'Build Saved' : 'Save Build');
  }

  function updateCodeUI(code){
    syncSaveButtonState(code);
  }

  function openSavedOverlay(){
    if (!savedOverlay) return;
    renderSavedList();
    lastSavedFocus = document.activeElement;
    savedOverlay.hidden = false;
    (savedCloseBtn || savedOverlay.querySelector('.rm-info-dialog'))?.focus?.();
  }

  function closeSavedOverlay(){
    if (!savedOverlay) return;
    savedOverlay.hidden = true;
    if (lastSavedFocus?.focus) lastSavedFocus.focus();
  }

  function renderSavedList(){
    const list = loadSaved();
    const wrap = document.getElementById('saved-builds-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = 'No saved builds yet.';
      wrap.appendChild(empty);
      return;
    }
    list.forEach(entry => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'saved-item';
      btn.innerHTML = `<span class="name">${entry.name || 'Saved Build'}</span><span class="meta">${entry.meta || ''}</span>`;
      btn.addEventListener('click', async () => {
        const ok = await applyBuildCode(entry.code);
        if (ok) closeSavedOverlay();
      });
      wrap.appendChild(btn);
    });
  }

  function saveCurrentBuild(){
    const snap = currentSnap();
    if (!snap) return;
    const code = encodeSnapshot(snap);
    if (!code) return;

    const list = loadSaved();
    const existingIndex = list.findIndex(e => e.code === code);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
      persistSaved(list);
    } else {
      const entry = {
        code,
        name: snap.buildName || `${snap.className} ${snap.ascendancy}`.trim(),
        meta: [snap.ascendancy, snap.offhand ? `${snap.weapon} & ${snap.offhand}` : snap.weapon].filter(Boolean).join(' • ')
      };
      const existing = list.filter(e => e.code !== code);
      existing.unshift(entry);
      persistSaved(existing);
    }
    renderSavedList();
    updateCodeUI(code);
    syncSaveButtonState(code);
  }

  function bindUI(){
    const copyBtn = document.getElementById('copy-build-link');
    const saveBtn = document.getElementById('save-build');
    const savedListFab = savedFab;

    copyBtn?.addEventListener('click', () => {
      const snap = currentSnap();
      const code = encodeSnapshot(snap);
      if (!code) return;
      const url = new URL(location.href);
      url.searchParams.set('build', code);
      const text = url.toString();
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
      updateCodeUI(code);
    });

    saveBtn?.addEventListener('click', saveCurrentBuild);
    savedListFab?.addEventListener('click', openSavedOverlay);
    savedCloseBtn?.addEventListener('click', closeSavedOverlay);
    savedOverlay?.addEventListener('click', (e) => {
      const t = e.target;
      if (t?.dataset?.close) closeSavedOverlay();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && savedOverlay && !savedOverlay.hidden) closeSavedOverlay();
    });
  }

  function autoLoadFromQuery(){
    const q = getQueryParams();
    const code = q.get('build') || q.get('buildCode');
    if (code) applyBuildCode(code);
  }

  function subscribeToRolls(){
    if (window.App && typeof window.App.onRoll === 'function') {
      window.App.onRoll(() => {
        const snap = currentSnap();
        const code = encodeSnapshot(snap);
        updateCodeUI(code);
      });
    }
  }

  onDomReady(() => {
    bindUI();
    renderSavedList();
    subscribeToRolls();
    syncSaveButtonState();
    autoLoadFromQuery();
  });

  window.RandomancerEncodeSnapshot = encodeSnapshot;
  window.RandomancerApplyBuildCode = applyBuildCode;
  window.RandomancerUpdateBuildCodeUI = () => {
    const snap = currentSnap();
    const code = encodeSnapshot(snap);
    updateCodeUI(code);
    return code;
  };
})();

// App metadata
const APP_VERSION = '0.8.2_passives';

window.RANDOMANCER = window.RANDOMANCER || {};
window.RANDOMANCER.version = APP_VERSION;

onDomReady(() => {
  const el = document.querySelector('.version');
  if (el) {
    el.textContent = `Randomancer v${APP_VERSION}`;
  }
});



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
    cohesionModeName: 'cohesive',
    synergyScore: 0,
    cohesionStatus: 'ok',

    // canonical current roll snapshot
    currentRoll: {
      className: '',
      ascendancy: '',
      ascendancyId: null,
      defense:   '',
      defStrat:  '',
      defStratObj: null,
      weapon:    '',
      offhand:   '',
      tactics:   '',
      ailments:  '',
      ailmentList: [],
      tacticList: [],
      tacticSet: [],
      ailmentSet: [],
      buildName: '',
      flavor:    '',
      attributes: { strength: 0, dexterity: 0, intelligence: 0 },
      rollAttr: { strength: 0, dexterity: 0, intelligence: 0 },
      defenseObj: null,
      recommendedSkills: [],
      recommendedPersistentBuff: null,
      recommendedUniques: [],
      tagProfile: null,
      synergyScore: 0,
      cohesionStatus: 'ok',
      snapshotVersion: 1
    },

    locks: { ...DEFAULT_LOCKS },

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
          state.cohesionModeName = COHESION_MODE_NAMES[state.cohesionMode] || 'cohesive';
          try {
            currentMode = state.cohesionModeName;
          } catch {
            // ignore if currentMode is not yet initialized
          }
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

  function mergeCurrentRoll(partial){
    try {
      state.currentRoll = { ...state.currentRoll, ...partial };
      if (typeof partial?.synergyScore === 'number') {
        state.synergyScore = partial.synergyScore;
      } else if (typeof state.currentRoll.synergyScore === 'number') {
        state.synergyScore = state.currentRoll.synergyScore;
      }
      if (partial?.cohesionStatus) {
        state.cohesionStatus = partial.cohesionStatus;
      } else if (state.currentRoll.cohesionStatus) {
        state.cohesionStatus = state.currentRoll.cohesionStatus;
      }
      if (partial?.cohesionModeName) {
        state.cohesionModeName = partial.cohesionModeName;
      }
      if (typeof window !== 'undefined') {
        window.__LAST_ROLL_META = { ...state.currentRoll };
      }
      return state.currentRoll;
    } catch (e) {
      return state.currentRoll;
    }
  }

  function captureCurrentRollFromDOM(){
    try{
      const offhand = firstText(['#offhand','#off_hand','#off','#offHand']);

      const meta = (typeof window !== 'undefined' && window.__LAST_ROLL_META) ? window.__LAST_ROLL_META : {};

      state.currentRoll = {
        ...state.currentRoll,
        ...meta,
        defense:   firstText('#defense'),
        defStrat:  firstText('#defstrat'),
        weapon:    firstText('#weapons'),
        offhand,
        tactics:   firstText('#tactics'),
        ailments:  firstText('#ailments'),
        ailmentList: (meta.ailmentList && meta.ailmentList.length) ? meta.ailmentList : firstText('#ailments').split(/\s*&\s*/).filter(Boolean),
        tacticList: (meta.tacticList && meta.tacticList.length) ? meta.tacticList : firstText('#tactics').split(/\s*&\s*/).filter(Boolean),
        buildName: firstText('#build-name') || meta.buildName || '',
        flavor:    firstText(['#build-subtext','#flavor']) || meta.flavor || ''
      };

      return state.currentRoll;
    } catch (e) {
      return {};
    }
  }

  return { state, bootstrap, setCohesion, legacyInit, roll, captureCurrentRollFromDOM, mergeCurrentRoll, modules: { Config, RulesEngine } };
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

// ---------- passives helpers ----------
function buildPassiveIndex(passivesData) {
  const index = {
    byAscendancyName: new Map(),
    keystones: [],
    notables: [],
    ascendancyNodes: []
  };

  try {
    const nodes = Array.isArray(passivesData?.nodes) ? passivesData.nodes : [];
    for (const node of nodes) {
      if (!node || !node.type) continue;
      if (node.type === 'ascendancy' && node.ascendancy) {
        index.ascendancyNodes.push(node);
        const key = String(node.ascendancy);
        if (!index.byAscendancyName.has(key)) index.byAscendancyName.set(key, []);
        index.byAscendancyName.get(key).push(node);
      }
      if (node.type === 'keystone') index.keystones.push(node);
      if (node.type === 'notable') index.notables.push(node);
    }
  } catch (err) {
    console.error('[passives] failed to build index', err);
  }

  return index;
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

// ---------- passive UI renderer ----------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
}

function resolvePassiveIcon(iconPath) {
  if (!iconPath) return 'images/dice.png';
  const file = iconPath.split('/').pop() || '';
  const base = file.replace(/\.dds$/i, '') || 'default';
  return `images/passives/${base}.png`;
}

function renderPassiveRow(rowEl, nodes, type, buildTagSet) {
  if (!rowEl) return;
  const group = rowEl.closest('.passives-group');
  rowEl.innerHTML = '';

  if (!nodes || !nodes.length) {
    group?.classList.add('is-empty', 'hidden');
    return;
  }

  group?.classList.remove('is-empty', 'hidden');

  const pool = Array.isArray(nodes) ? nodes.slice() : [];
  const rows = [];
  const plans = {
    ascendancy: [2],
    keystone: [2],
    notable: [3, 2, 3],
  };
  const plan = plans[type] || [3];

  plan.forEach((take) => {
    if (!pool.length) return;
    const slice = pool.splice(0, Math.min(take, pool.length));
    if (slice.length) rows.push(slice);
  });

  while (pool.length) {
    const take = Math.min(3, pool.length);
    if (take === 1 && rows.length) {
      rows[rows.length - 1].push(pool.shift());
      continue;
    }
    rows.push(pool.splice(0, take));
  }

  rows.forEach((rowSet) => {
    const rowLine = document.createElement('div');
    rowLine.className = 'passives-row-line';
    rowSet.forEach((node, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = `passive-node passive-node--${type}`;

      const iconSrc = resolvePassiveIcon(node?.icon);
      const name = node?.name || 'Unknown Passive';
      const lines = Array.isArray(node?.lines) ? node.lines.filter(Boolean) : [];
      const tags = Array.isArray(node?.tags) ? node.tags.filter(Boolean) : [];
      const linesHtml = lines.length
        ? `<div class="passive-node__lines">${lines.map(l => escapeHtml(l)).join('<br>')}</div>`
        : '';
      const tagsHtml = tags.length
        ? `<div class="passive-node__tags">${tags
            .map((t) => {
              const norm = normTagPlus(t);
              const matched = buildTagSet?.has(norm);
              return `<span class="passive-tag${matched ? ' is-match' : ''}">${escapeHtml(t)}</span>`;
            })
            .join('')}</div>`
        : '';

      wrapper.innerHTML = `
        <div class="passive-node__orb">
          <div class="passive-node__orb-inner">
            <img class="passive-node__icon" src="${iconSrc}" alt="${escapeHtml(name)}">
          </div>
        </div>
        <div class="passive-node__text">
          <div class="passive-node__name">${escapeHtml(name)}</div>
          ${linesHtml}
          ${tagsHtml}
        </div>
      `;

      const img = wrapper.querySelector('.passive-node__icon');
      if (img) {
        img.addEventListener('error', () => {
          img.src = 'images/dice.png';
        }, { once: true });
      }

      rowLine.appendChild(wrapper);

      if (index < rowSet.length - 1) {
        const link = document.createElement('div');
        link.className = 'passive-link';
        rowLine.appendChild(link);
      }
    });

    rowEl.appendChild(rowLine);
  });
}

function renderPassiveRecommendations(currentRoll, dataWrap) {
  const panel = document.getElementById('passives-panel');
  const ascRow = document.querySelector('.passives-row--ascendancy');
  const keyRow = document.querySelector('.passives-row--keystones');
  const noteRow = document.querySelector('.passives-row--notables');

  const hideAll = () => {
    [ascRow, keyRow, noteRow].forEach(row => { if (row) row.innerHTML = ''; });
    document.querySelectorAll('.passives-group').forEach(g => g.classList.add('hidden', 'is-empty'));
    if (panel) panel.classList.add('hidden');
  };

  const passivesData = dataWrap?.passivesEnriched || (window.DATA && window.DATA.passivesEnriched);
  const hasPassiveData = passivesData && Array.isArray(passivesData.nodes);
  if (!panel || !hasPassiveData || !currentRoll || !currentRoll.passives) {
    hideAll();
    return;
  }

  panel.classList.remove('hidden');
  const passives = currentRoll.passives || {};
  const ctx = buildBuildContext(currentRoll);
  const buildTagSet = new Set();
  (ctx?.tags || []).forEach((t) => buildTagSet.add(normTagPlus(t)));
  (ctx?.defenseTags || []).forEach((t) => buildTagSet.add(normTagPlus(t)));

  renderPassiveRow(ascRow, passives.ascendancyNodes || [], 'ascendancy', buildTagSet);
  renderPassiveRow(keyRow, passives.keystones || [], 'keystone', buildTagSet);
  renderPassiveRow(noteRow, passives.notables || [], 'notable', buildTagSet);

  const anyVisible = [ascRow, keyRow, noteRow].some(row => {
    const g = row?.closest('.passives-group');
    return g && !g.classList.contains('hidden');
  });
  if (panel) panel.classList.toggle('hidden', !anyVisible);
}


// ---------- cohesion + selection ----------
const COHESION_MODES = { strict:0.75, cohesive:0.5, chaotic:0.25, madness:0.0 };
const COHESION_EXPECTATIONS = {
  strict:   { min: 70 },
  cohesive: { min: 50 },
  chaotic:  { min: 0 },
  madness:  { min: 0 },
};
let currentMode='cohesive';

function resolveCohesionMode(mode){
  if (typeof mode === 'string') return mode;
  const idx = Number(mode);
  if (!Number.isNaN(idx) && COHESION_MODE_NAMES[idx]) return COHESION_MODE_NAMES[idx];
  return currentMode || 'cohesive';
}

function attributeCohesion(a,b){ const k=['strength','dexterity','intelligence']; const dot=k.reduce((s,x)=>s+(a[x]||0)*(b[x]||0),0); const ma=Math.sqrt(k.reduce((s,x)=>s+(a[x]||0)**2,0)); const mb=Math.sqrt(k.reduce((s,x)=>s+(b[x]||0)**2,0)); return dot/(ma*mb||1); }
function pickByCohesion(list, base, th){
  if(!list||!list.length) return null;
  if(th===0) return list[Math.floor(Math.random()*list.length)];
  const scored=list.map(x=>({x,score:attributeCohesion(base,x.attributes||{})}));
  const filtered=scored.filter(s=>s.score>=th);
  const pool=filtered.length?filtered:scored;
  return pool[Math.floor(Math.random()*pool.length)].x;
}

function normalizeAttributesForSynergy(attrs){
  const S = Number(attrs?.strength) || 0;
  const D = Number(attrs?.dexterity) || 0;
  const I = Number(attrs?.intelligence) || 0;
  const total = S + D + I;
  if (!total) return { strength: 0, dexterity: 0, intelligence: 0 };
  return { strength: S / total, dexterity: D / total, intelligence: I / total };
}

function computeSynergyScore(baseAttrs, picks){
  const base = normalizeAttributesForSynergy(baseAttrs || {});
  const pools = [];
  const pushAttr = (src) => {
    if (!src) return;
    const attrs = src.attributes || src;
    pools.push(normalizeAttributesForSynergy(attrs));
  };

  pushAttr(picks?.weapon);
  pushAttr(picks?.offhand);
  pushAttr(picks?.defense);
  pushAttr(picks?.defStrat);
  (picks?.ailments || []).forEach(pushAttr);
  (picks?.tactics || []).forEach(pushAttr);

  const scores = pools
    .map(p => attributeCohesion(base, p))
    .filter(n => Number.isFinite(n));
  const avg = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : 0;
  const clamped = Math.max(0, Math.min(1, avg));
  return Math.round(clamped * 100);
}

function evaluateCohesionStatus(buildState){
  if (!buildState) return 'ok';

  const modeName = resolveCohesionMode(
    buildState.cohesionModeName ?? buildState.cohesionMode ?? currentMode
  );
  const score = typeof buildState.synergyScore === 'number'
    ? buildState.synergyScore
    : typeof buildState.currentRoll?.synergyScore === 'number'
      ? buildState.currentRoll.synergyScore
      : 0;
  const expectation = COHESION_EXPECTATIONS[modeName] || { min: 0 };
  const shouldWarn = (modeName === 'strict' || modeName === 'cohesive')
    && typeof expectation.min === 'number'
    && score < expectation.min;

  const status = shouldWarn ? 'constrained' : 'ok';
  buildState.cohesionStatus = status;
  buildState.synergyScore = score;
  buildState.cohesionModeName = modeName;
  if (buildState.currentRoll) {
    buildState.currentRoll.cohesionStatus = status;
    buildState.currentRoll.synergyScore = score;
    buildState.currentRoll.cohesionModeName = modeName;
  }
  return status;
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

function renderCohesionStatus(buildState){
  const el = document.querySelector('.cohesion-status');
  if (!el) return;

  const status = buildState?.cohesionStatus || 'ok';
  const modeName = resolveCohesionMode(buildState?.cohesionModeName ?? buildState?.cohesionMode ?? currentMode);
  const score = Math.round(buildState?.synergyScore || 0);
  el.dataset.status = status;

  if (status !== 'constrained' || (modeName !== 'strict' && modeName !== 'cohesive')) {
    el.textContent = '';
    return;
  }

  if (modeName === 'strict') {
    el.textContent = `⚠ Strict cohesion constrained by your current locks — best achieved: ${score}%.`;
  } else if (modeName === 'cohesive') {
    el.textContent = `⚠ Cohesive mode is limited by your current build locks — current synergy: ${score}%.`;
  } else {
    el.textContent = '';
  }
}

function updateCohesionBarDecoration(buildState){
  const wrapper = document.querySelector('.cohesion-bar-wrapper');
  if (!wrapper) return;
  const status = buildState?.cohesionStatus || 'ok';
  const modeName = resolveCohesionMode(buildState?.cohesionModeName ?? buildState?.cohesionMode ?? currentMode);
  const constrained = (modeName === 'strict' || modeName === 'cohesive') && status === 'constrained';
  wrapper.dataset.cohesionConstrained = constrained ? 'true' : 'false';
}

function refreshCohesionUI(buildState){
  if (!buildState) return;
  evaluateCohesionStatus(buildState);
  renderCohesionStatus(buildState);
  updateCohesionBarDecoration(buildState);
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

  function createSkillCard(g, gemDict, supportsOverride, roleLabel, matchProfile){
    const card = document.createElement('div');
    card.className = 'skill-card';

    const requiresSubtitle = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
      ? `<div class="skill-subtitle">${g.required_weapon_types.map(x => x[0].toUpperCase() + x.slice(1)).join(', ')}</div>`
      : '';

    const allTags = Array.isArray(g.tags) ? g.tags.slice() : [];
    const br = Array.isArray(g.bracket_tags) ? g.bracket_tags : [];
    const rest = allTags.filter(t => !br.includes(t));
    const displayTags = [...br, ...rest].slice(0, 10);
    const pills = displayTags.map(t => {
      const norm = normTagPlus(t);
      const cls = matchProfile && matchProfile.has && matchProfile.has(norm) ? 'tag-pill matched' : 'tag-pill';
      return `<span class="${cls}">${t}</span>`;
    }).join('');

    const supports = Array.isArray(supportsOverride) && supportsOverride.length
      ? supportsOverride
      : g.recommended_supports;

    const role = roleLabel ? `<div class="skill-role-badge">${roleLabel}</div>` : '';

    card.innerHTML = `
      ${role}
      <div class="skill-title">${g.name || '(Unnamed Gem)'}</div>
      ${requiresSubtitle}
      <div class="skill-divider"></div>
      ${grantLine(g)}
      <div class="skill-tags">${pills}</div>
      <div class="supports-label">Recommended Supports</div>
      <div class="supports">${renderSupportCards(supports, gemDict)}</div>
    `;
    applyGemBorderFromReqWeights(card, g.requirement_weights);
    return card;
  }

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

    if (rollCtx && typeof rollCtx === 'object') {
      rollCtx.tagProfile = rolledProfile;
    }

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

    const gemDict = buildGemDictionary(gems);

    const cards = picks.map(g => createSkillCard(g, gemDict, g.recommended_supports, 'Active Skill', rolledProfile?.profile));

    const persistent = pickPersistentBuffSkill(persistentPool, rolledProfile, window.TAG_IDF, knobs, gems);
    if (persistent) {
      cards.push(createSkillCard(persistent, gemDict, persistent.recommended_supports, 'Persistent Buff', rolledProfile?.profile));
    }

    if (cards.length <= 1) {
      cards.forEach(card => grid.appendChild(card));
    } else {
      const stack = document.createElement('div');
      stack.className = 'card-stack js-card-stack';
      cards.forEach(card => stack.appendChild(card));

      grid.appendChild(stack);

      const indicator = document.createElement('div');
      indicator.className = 'card-stack-indicator js-card-stack-indicator';
      indicator.textContent = `1 / ${cards.length}`;
      grid.appendChild(indicator);

      initCardStacks(grid);
    }

    return {
      tagProfile: rolledProfile,
      skills: picks.map(g => ({
        id: g.id || g.base_item?.id || g.name || '',
        name: g.name || '',
        recommended_supports: Array.isArray(g.recommended_supports) ? g.recommended_supports.slice(0, 6) : []
      })),
      persistentBuff: persistent ? {
        id: persistent.id || persistent.base_item?.id || persistent.name || '',
        name: persistent.name || ''
      } : null
    };
  }catch(e){
    console.error("[skills] render error", e);
  }
  }


function pickPersistentBuffSkill(persistentPool, rolledProfile, tagIDF, knobs, gems){
  try {
    document.querySelectorAll('#persistent-buff-section').forEach(el => el.remove());

    if (!Array.isArray(persistentPool) || !persistentPool.length) return null;

    const actives = persistentPool.filter(g => g && g.type === 'active');
    if (!actives.length) return null;

    const scoredPB = actives.map(g => {
      const s = scoreGemSynergy(g, rolledProfile, tagIDF, knobs);
      return { item:g, score:s.score, raw:s.raw };
    }).sort((a,b) => b.score - a.score);

    const top = scoredPB[0];
    if (!top || !isFinite(top.raw)) return null;

    // ensure any referenced supports exist in the gem dictionary
    if (!top.item.recommended_supports && Array.isArray(gems)) {
      const gemDict = buildGemDictionary(gems || []);
      const fallback = lookupGem(gemDict, top.item) || top.item;
      top.item.recommended_supports = fallback.recommended_supports;
    }

    return top.item;
  } catch (e) {
    console.error('[persistent buff] selection error', e);
    return null;
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

// Initialize stacked card decks for recommended skills + uniques
function initCardStacks(root = document) {
  const stacks = root.querySelectorAll('.js-card-stack');

  stacks.forEach(stack => {
    const cards = Array.from(stack.querySelectorAll('.skill-card, .unique-card'));

    if (cards.length <= 1) {
      stack.style.height = '';
      if (cards[0]) delete cards[0].dataset.offset;
      return;
    }

    let topIndex = 0;
    const indicator = stack.parentElement?.querySelector('.js-card-stack-indicator');

    let measuredHeight = null;
    const measureHeight = () => {
      if (measuredHeight !== null) return measuredHeight;

      let maxHeight = 0;

      cards.forEach(card => {
        const h = card.scrollHeight || card.offsetHeight || 0;
        maxHeight = Math.max(maxHeight, h);
      });

      const minFromStyle = parseFloat(getComputedStyle(stack).minHeight) || 0;
      measuredHeight = Math.max(maxHeight, minFromStyle);

      if (measuredHeight) {
        stack.style.minHeight = `${measuredHeight}px`;
        stack.style.height = `${measuredHeight}px`;
      }

      return measuredHeight;
    };

    function render() {
      const total = cards.length;

      cards.forEach((card, i) => {
        const offset = (i - topIndex + total) % total;
        card.dataset.offset = offset;
      });

      if (indicator) {
        indicator.textContent = `${topIndex + 1} / ${total}`;
      }
    }

    measureHeight();
    requestAnimationFrame(() => {
      measuredHeight = null;
      measureHeight();
    });

    function advance() {
      topIndex = (topIndex + 1) % cards.length;
      render();
    }

    render();

    stack.addEventListener('click', advance);
    stack.setAttribute('tabindex', '0');
    stack.addEventListener('keydown', evt => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        advance();
      }
    });
  });
}

// Small helper to render grant line (shared by main skills + persistent buff)
const grantLine = (g) => {
  const list = Array.isArray(g.granted_skills_full) ? g.granted_skills_full : [];
  if (!list.length) return '';
  const first = list[0];
  const desc = first?.description || g.grant_description || '';
  const dn   = first?.display_name || g.grant_display || '';
  if (!dn && !desc) return '';
  return `
    <div class="grant-wrap">
      <div class="grant">
        <div class="grant-title">${dn || ''}</div>
        <div class="grant-desc">${desc || ''}</div>
      </div>
    </div>
  `;
};


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

                if (window.App && window.App.state) {
                  refreshCohesionUI(window.App.state);
                }
          });
        }

  initSectionLocks();

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
  const locks = getLockState();
  const current = window.App?.state?.currentRoll || {};

  const findByName = (arr, name) => (arr || []).find(item => item?.name === name) || null;

  // --- Archetype ---
  const canReuseClass = locks.archetype && current.className && data.Classes[current.className];
  const archetype = canReuseClass
    ? [current.className, data.Classes[current.className]]
    : classes[Math.floor(Math.random() * classes.length)];
  const [clsName, clsData] = archetype;
  const base = clsData?.attributes || {};

  const asc = canReuseClass
    ? (current.ascendancy || clsData?.ascendancies?.[0] || '')
    : clsData.ascendancies[Math.floor(Math.random() * clsData.ascendancies.length)];

  const ascendancyId = lookupAscendancyIdByName(asc);

  document.getElementById('class')?.replaceChildren(document.createTextNode(clsName || ''));
  document.getElementById('ascendancy')?.replaceChildren(document.createTextNode(asc || ''));
  updateAscArt(asc);

  const weaponPool = data.Weapons['Two-Handed'].concat(data.Weapons['One-Handed']);
  const pickWeapon = () => pickByCohesion(weaponPool, base, th);
  let weapon = locks.archetype ? findByName(weaponPool, current.weapon) : null;
  if (!locks.archetype || !weapon) {
    weapon = pickWeapon();
  }

  let offhand = null;
  if (locks.archetype && current.offhand) {
    offhand = findByName(data.Weapons['Off-Hand'], current.offhand);
  }
  if (!locks.archetype || (!offhand && weapon && Object.keys(validOffhands).includes(weapon.name))) {
    if (weapon && Object.keys(validOffhands).includes(weapon.name)) {
      const offPool = data.Weapons['Off-Hand'].filter(o => validOffhands[weapon.name].includes(o.name));
      offhand = offhand || pickByCohesion(offPool, base, th);
    }
  }
  const weaponText = offhand ? `${weapon?.name || ''} & ${offhand.name}` : (weapon?.name || '');
  document.getElementById('weapons')?.replaceChildren(document.createTextNode(weaponText));

  // --- Survivability ---
  const defense = (locks.survivability && current.defense)
    ? findByName(data.Defense, current.defense)
    : null;
  const pickedDefense = defense || pickByCohesion(data.Defense, base, th);
  document.getElementById('defense')?.replaceChildren(document.createTextNode(pickedDefense?.name || ''));

  const dsPool = data.DefensiveStrategies.filter(ds => applyHardRestrictions(ds, { defense: pickedDefense?.name || '', weapon: weapon?.name || '', offhand: offhand?.name || '' }));
  const defStrat = (locks.survivability && current.defStrat)
    ? (findByName(dsPool, current.defStrat) || findByName(data.DefensiveStrategies, current.defStrat))
    : null;
  const pickedDefStrat = defStrat || pickByCohesion(dsPool, base, th);
  document.getElementById('defstrat')?.replaceChildren(document.createTextNode(pickedDefStrat?.name || ''));

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
  const mechanicsLocked = locks.mechanics && ((current.ailmentList && current.ailmentList.length) || (current.tacticList && current.tacticList.length));
  if (mechanicsLocked){
    ailmentSet = (current.ailmentList || []).map(n => findByName(data.Ailments, n)).filter(Boolean);
    tacticSet = (current.tacticList || []).map(n => findByName(data.Tactics, n)).filter(Boolean);
  }
  if(!mechanicsLocked || (!ailmentSet.length && !tacticSet.length)){
    if(r<0.6){ ailmentSet=[data.Ailments[Math.floor(Math.random()*data.Ailments.length)]]; tacticSet=[filterTacticsByStrictRules(data.Tactics, weapon, offhand)[Math.floor(Math.random()*filterTacticsByStrictRules(data.Tactics, weapon, offhand).length)]]; }
    else if(r<0.8){ const a1=data.Ailments[Math.floor(Math.random()*data.Ailments.length)], a2=data.Ailments.filter(x=>x.name!==a1.name)[Math.floor(Math.random()*(data.Ailments.length-1))]; ailmentSet=[a1,a2]; }
    else { const _pool=filterTacticsByStrictRules(data.Tactics, weapon, offhand); const t1=_pool[Math.floor(Math.random()*_pool.length)]; const t2=_pool.filter(x=>x.name!==t1.name)[Math.floor(Math.random()*Math.max(1,_pool.length-1))]; tacticSet=[t1,t2]; }
  }

  document.getElementById('ailments')?.replaceChildren(document.createTextNode((ailmentSet.filter(Boolean).map(a=>a.name).join(' & ')||'')));
  document.getElementById('tactics')?.replaceChildren(document.createTextNode((tacticSet.filter(Boolean).map(t=>t.name).join(' & ')||'')));
  updateAilmentOverlay(ailmentSet.filter(Boolean));

  // Balance aggregation
  const add=(a,b)=>({strength:(a.strength||0)+(b.strength||0), dexterity:(a.dexterity||0)+(b.dexterity||0), intelligence:(a.intelligence||0)+(b.intelligence||0)});
  const norm=(a)=>{ const t=(a.strength||0)+(a.dexterity||0)+(a.intelligence||0)||1e-6; return {strength:(a.strength||0)/t, dexterity:(a.dexterity||0)/t, intelligence:(a.intelligence||0)/t}; };
  const sumParts = [ norm(base), norm(weapon?.attributes||{}), norm(offhand?.attributes||{}), norm(pickedDefense?.attributes||{}), norm(pickedDefStrat?.attributes||{}) ].reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0});
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
  const buildName = generateBuildName(clsName, asc);
  const buildFlavor = generateFlavorLine(clsName, asc);
  document.getElementById('build-name').textContent = buildName;
  document.getElementById('build-subtext').textContent = buildFlavor;

  const synergyScore = computeSynergyScore(base, {
    weapon,
    offhand,
    defense: pickedDefense,
    defStrat: pickedDefStrat,
    ailments: ailmentSet.filter(Boolean),
    tactics: tacticSet.filter(Boolean)
  });
  const cohesionModeName = resolveCohesionMode(window.App?.state?.cohesionMode ?? currentMode);

  const baseSnapshot = {
    snapshotVersion: 1,
    className: clsName,
    ascendancy: asc || '',
    ascendancyName: asc || '',
    ascendancyId: ascendancyId ?? null,
    defense: pickedDefense?.name || '',
    defStrat: pickedDefStrat?.name || '',
    defStratObj: pickedDefStrat || null,
    weapon: weapon?.name || '',
    offhand: offhand?.name || '',
    tactics: tacticSet.filter(Boolean).map(t=>t.name).join(' & '),
    ailments: ailmentSet.filter(Boolean).map(a=>a.name).join(' & '),
    ailmentList: ailmentSet.filter(Boolean).map(a=>a.name),
    tacticList: tacticSet.filter(Boolean).map(t=>t.name),
    tacticSet: tacticSet.filter(Boolean),
    ailmentSet: ailmentSet.filter(Boolean),
    buildName,
    flavor: buildFlavor,
    attributes: { strength: S, dexterity: D, intelligence: I },
    rollAttr: { strength: S, dexterity: D, intelligence: I },
    defenseObj: pickedDefense || null,
    synergyScore,
    cohesionStatus: 'ok',
    cohesionModeName
  };

  if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
    window.App.mergeCurrentRoll(baseSnapshot);
  } else if (typeof window !== 'undefined') {
    window.__LAST_ROLL_META = { ...baseSnapshot };
  }


  // Stash the roll context for synergy scorer
  window.CURRENT_ROLL = {
          ascendancy: asc || '',
          ascendancyName: asc || '',
          ascendancyId: ascendancyId ?? null,
          ailmentSet: ailmentSet.filter(Boolean),
          tacticSet: tacticSet.filter(Boolean),
          defense: pickedDefense,
          defStrat: pickedDefStrat,
          weapon: weapon?.name || '',
          offhand: offhand?.name || '',
          rollAttr: { strength: S, dexterity: D, intelligence: I },
          tagProfile: null,
          synergyScore,
          cohesionModeName
        };

  // Skills (weapon-limited + synergy scoring)
  const skillSnapshot = rollRecommendedSkills(dataWrap, base, {weapon, offhand}, window.CURRENT_ROLL) || {};
  if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
    window.App.mergeCurrentRoll({
      recommendedSkills: skillSnapshot.skills || [],
      recommendedPersistentBuff: skillSnapshot.persistentBuff || null,
      tagProfile: skillSnapshot.tagProfile || window.CURRENT_ROLL.tagProfile || null
    });
  }

  // Passive recommendations (pure, cohesion-aware)
  const passiveCtx = buildBuildContext();
  const passivesData = (dataWrap && dataWrap.passivesEnriched) || (window.DATA && window.DATA.passivesEnriched) || null;
  const passiveIndex = (dataWrap && dataWrap.passiveIndex) || (window.DATA && window.DATA.passiveIndex) || null;
  if (passiveCtx && passivesData && Array.isArray(passivesData.nodes)) {
    const ascendancyNodes = pickRecommendedAscendancyNodes(passivesData, passiveIndex, passiveCtx, 2);
    const keystones = pickRecommendedKeystones(passivesData, passiveIndex, passiveCtx, 2);
    const notables = pickRecommendedNotables(passivesData, passiveIndex, passiveCtx, 8);
    const passiveBundle = { ascendancyNodes, keystones, notables };

    if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
      window.App.mergeCurrentRoll({ passives: passiveBundle });
    }
    if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
      window.CURRENT_ROLL.passives = passiveBundle;
    }
  }

  renderPassiveRecommendations(window.CURRENT_ROLL, dataWrap);

  // Uniques: trigger the synergy engine directly using the current roll snapshot
  try {
    if (!locks.uniques) {
      if (typeof window.RandomancerRefreshUniques === 'function') {
        window.RandomancerRefreshUniques(window.CURRENT_ROLL);
      }
    } else {
      ensureUniqueSection();
      if (Array.isArray(current.recommendedUniques) && current.recommendedUniques.length && typeof window.RandomancerRenderUniquesFromNames === 'function') {
        window.RandomancerRenderUniquesFromNames(current.recommendedUniques);
      }
    }
  } catch (e) {
    console.warn('[Randomancer] uniques refresh failed', e);
  }

  if (window.App && window.App.state) {
    refreshCohesionUI(window.App.state);
  } else {
    refreshCohesionUI({ cohesionModeName, synergyScore, cohesionStatus: 'ok' });
  }

  syncLockUIFromState();

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
    const core = await loadJSON('data/core-data.json');
    const gemsRaw = await tryLoad(['data/skill_gems.json', 'gems.json']);
    const skillsRaw = await tryLoad(['data/skills.json']);
    const passivesEnriched = await tryLoad(['data/enriched/passives_enriched.json']);
    if (!passivesEnriched || !passivesEnriched.nodes) {
      console.warn('[loadData] Passive data missing or incomplete');
    }
    const passiveIndex = buildPassiveIndex(passivesEnriched);
    const enr = enrichGems(gemsRaw, skillsRaw);
    console.log(`[Skill Enrichment] ${enr.length} enriched skill entries.`);

    window.DATA = {
      ...core,
      gems: enr,
      skills: skillsRaw,
      skill_gems: gemsRaw,
      passivesEnriched,
      passiveIndex
    };
    console.log("[Global DATA initialized]", window.DATA);

    return { core, gems: enr, passivesEnriched, passiveIndex };
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
                  set('#build-subtext', s.flavor);
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
    const url = 'data/enriched/uniques_enriched.json?v=' + Date.now();
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

    // Anchor after Skills section
    const skillsGrid = document.querySelector('#skills-grid');
    const skillsSect = skillsGrid ? skillsGrid.closest('.sect') : null;
    const main = document.querySelector('main') || document.body;
    const parent = (skillsSect && skillsSect.parentNode) || main;

    if (!skillsSect) return null; // try later

    const anchor = skillsSect;

    // Insert divider
    const divider = document.createElement('div');
    divider.className = 'ornate-divider gold unique-divider';
    anchor.insertAdjacentElement('afterend', divider);

    // Insert Uniques section
    const wrap = document.createElement('div');
    wrap.id = 'uniques-section';
    wrap.className = 'sect';
    wrap.innerHTML = `
          <div class="sect-head">
                <h3 class="section-title">Recommended Uniques</h3>
                <div class="underline"></div>
                <p class="sub">Unique items tuned to the ailments, tactics, and defenses of this roll.</p>
          </div>
          <div id="uniques-grid" class="grid two uniques-grid"></div>
        `;

    divider.insertAdjacentElement('afterend', wrap);

    const lockBtn = wrap.querySelector('.lock-toggle');
    if (lockBtn) wireLockButton(lockBtn);
    syncLockUIFromState();

    return document.getElementById('uniques-grid');
  }

  function pillsFor(item, rolledSet){
    const tags = Array.from(getItemTagSet(item)).sort();
    return tags.map(t=>`<span class="tag-pill pill${rolledSet.has(t)?' matched':''}" data-tag="${t}">${t}</span>`).join('');
  }
  function highlight(lines, rolledSet){
	  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	  // Skip the first 2 lines (name + base) – they’re in the header
	  let out = (lines || []).slice(2).join('\n');
	
	  // Highlight any text that matches the rolled profile tags
	  rolledSet.forEach(t => {
		if (!t) return;
		const rx = new RegExp(esc(String(t)), 'ig');
		out = out.replace(rx, m => `<span class="hit">${m}</span>`);
	  });
	
	  return out
		.split('\n')
		.map(L => L.trim())
		.filter(L => L.length) // drop empty lines
		.map(L => `<div class="unique-line">${L}</div>`)
		.join('');
	}
	
	function buildUniqueReason(it, rolledSet) {
	  if (!it) return '';
	
	  // Use the same tag logic as scoring + pill rendering
	  const tagSet = getItemTagSet(it);        // returns a Set of normalized tags
	  const tags = Array.from(tagSet);
	  if (!tags.length) return '';
	
	  const hasRolled =
		rolledSet &&
		typeof rolledSet.has === 'function' &&
		rolledSet.size > 0;
	
	  const matched = [];
	  const unmatched = [];
	
	  for (const t of tags) {
		if (!t) continue;
	
		// rolledSet already holds normalized tags (from rolledByCategory/expandTags)
		if (hasRolled && rolledSet.has(t)) {
		  matched.push(t);
		} else {
		  unmatched.push(t);
		}
	  }
	
	  // Prefer tags that actually match the rolled profile; otherwise just
	  // describe the item by its own tags.
	  const source = (hasRolled && matched.length) ? matched : tags;
	  const main = source.slice(0, 3); // up to 3 tags
	
	  if (!main.length) return '';
	
	  const humanList = (arr) => {
		const pretty = (s) => {
		  s = String(s || '').trim();
		  if (!s) return s;
		  return s[0].toUpperCase() + s.slice(1);
		};
		const p = arr.map(pretty);
		if (p.length === 1) return p[0];
		if (p.length === 2) return `${p[0]} and ${p[1]}`;
		return `${p[0]}, ${p[1]} and ${p[2]}`;
	  };
	
	  const list = humanList(main);
	
	  if (hasRolled && matched.length) {
		return `Synergizes with your ${list} focus.`;
	  }
	  return `Adds ${list} to your build.`;
	}


  function renderUniques(items, rolledSet){
          const grid = ensureUniqueSection();
          if (!grid) {
                setTimeout(() => renderUniques(items, rolledSet), 120);
                return;
          }

          grid.innerHTML = '';

          if (!items || !items.length) return;

          const buildCard = (it) => {
                const pills = pillsFor(it, rolledSet);
                const lines = highlight(it.lines, rolledSet);
                const reason = buildUniqueReason(it, rolledSet);

                const card = document.createElement('div');
                card.className = 'unique-card';
                card.innerHTML = `
                        <div class="unique-header">
                          <div class="unique-name">${it.name}</div>
                          <div class="unique-base">${it.base}</div>
                        </div>
                        <div class="tags-row">
                          ${pills}
                        </div>
                        <div class="unique-lines">
                          ${reason ? `<div class="unique-highlights">${reason}</div>` : ''}
                          ${lines}
                        </div>
                `;
                return card;
          };

          if (items.length <= 1) {
                items.forEach(it => {
                  grid.appendChild(buildCard(it));
                });
                return;
          }

          const stack = document.createElement('div');
          stack.className = 'card-stack js-card-stack';

          items.forEach(it => {
                stack.appendChild(buildCard(it));
          });

          grid.appendChild(stack);

          const indicator = document.createElement('div');
          indicator.className = 'card-stack-indicator js-card-stack-indicator';
          indicator.textContent = `1 / ${items.length}`;
          grid.appendChild(indicator);

          initCardStacks(grid);
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

                if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
                  window.App.mergeCurrentRoll({ recommendedUniques: picks.map(p => p.name) });
                }
                if (typeof window.RandomancerUpdateBuildCodeUI === 'function') {
                  window.RandomancerUpdateBuildCodeUI();
                }

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

    async function renderUniquesFromNames(names){
          if (!Array.isArray(names) || !names.length) {
                ensureUniqueSection()?.replaceChildren();
                return;
          }

          try {
                const items = await loadUniquesM();
                const byName = new Map(items.map(it => [it.name, it]));
                const ordered = names.map(n => byName.get(n)).filter(Boolean);
                renderUniques(ordered, new Set());
          } catch (e) {
                console.warn('[u79b2m] renderUniquesFromNames failed', e);
          }
    }

    window.RandomancerRenderUniquesFromNames = renderUniquesFromNames;


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

