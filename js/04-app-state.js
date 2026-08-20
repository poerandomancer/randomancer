import { Config, RulesEngine, Schema } from './03-config-and-schema.js';
import { ensureDataPreload } from './08-data-load.js';

// ===== App API =====
const App = window.App = (() => {
  function cloneJsonSafe(value){
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {}
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function canonicalizeDraw(input = {}) {
    const src = (input && typeof input === 'object') ? input : {};
    const attrs = (src.attributes && typeof src.attributes === 'object') ? src.attributes : {};
    return {
      schema: src.schema === 'randomancer-draw-v1' ? src.schema : 'randomancer-draw-v1',
      className: src.className || '',
      ascendancy: src.ascendancy || '',
      weaponFamily: src.weaponFamily || src.weapon || '',
      weapon: src.weaponFamily || src.weapon || '',
      offense: src.offense || '',
      offenseList: Array.isArray(src.offenseList) ? src.offenseList : [],
      offenseSet: Array.isArray(src.offenseSet) ? src.offenseSet : [],
      offenseTags: Array.isArray(src.offenseTags) ? src.offenseTags : [],
      buildName: src.buildName || '',
      flavor: src.flavor || '',
      attributes: {
        strength: Number(attrs.strength) || 0,
        dexterity: Number(attrs.dexterity) || 0,
        intelligence: Number(attrs.intelligence) || 0
      },
      recommendedSkills: Array.isArray(src.recommendedSkills) ? src.recommendedSkills : [],
      synergySupports: Array.isArray(src.synergySupports) ? src.synergySupports : [],
      recommendedPersistentBuff: src.recommendedPersistentBuff ?? null,
      recommendedUniques: Array.isArray(src.recommendedUniques) ? src.recommendedUniques : [],
      passives: src.passives && typeof src.passives === 'object' ? src.passives : null,
      recommendationPackage: src.recommendationPackage && typeof src.recommendationPackage === 'object'
        ? src.recommendationPackage
        : null,
      snapshotVersion: 2
    };
  }

  const state = {
    DATA:   null,
    GEMS:   null,
    SKILLS: null,
    CONFIG: null,

    // The only canonical standard Build state.
    currentDraw: canonicalizeDraw(),

    bindFates: {
      ascendancy: { oaths: [], abominations: [] },
      weapon:     { oaths: [], abominations: [] },
      combat:     { oaths: [], abominations: [] }
    },

    // Challenge-mode equivalent of Bind the Fates.
    challengeFates: {
      anchors: { favor: [], ban: [] },
      twistCategories: { favor: [], ban: [] }
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

  function getBindFates(){
    return state.bindFates;
  }

  function setBindFatesCategory(category, next){
    if (!state.bindFates[category]) return;
    const safe = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
    state.bindFates[category] = {
      oaths: safe(next?.oaths),
      abominations: safe(next?.abominations)
    };
  }

  function getChallengeFates(){
    return state.challengeFates;
  }

  function setChallengeFatesCategory(category, next){
    if (!state.challengeFates[category]) return;
    const safe = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
    state.challengeFates[category] = {
      favor: safe(next?.favor),
      ban: safe(next?.ban)
    };
  }

  function setChallengeFates(next){
    const src = next && typeof next === 'object' ? next : {};
    setChallengeFatesCategory('anchors', src.anchors);
    setChallengeFatesCategory('twistCategories', src.twistCategories);
  }


  function exposeRuntimeData(){
    try{
      if (typeof window !== 'undefined') {
        window.DATA = state.DATA; window.SKILL_GEMS = state.GEMS; window.SKILLS = state.SKILLS;
      }
    }catch(e){ console.warn("exposeRuntimeData failed:", e); }
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

  function replaceCurrentDraw(nextSnapshot){
    try {
      const safe = cloneJsonSafe(nextSnapshot);
      state.currentDraw = canonicalizeDraw(safe || {});
      return state.currentDraw;
    } catch (e) {
      return state.currentDraw;
    }
  }


  return {
    state,
    bootstrap,
    exposeRuntimeData,
    replaceCurrentDraw,
    getBindFates,
    setBindFatesCategory,
    getChallengeFates,
    setChallengeFatesCategory,
    setChallengeFates,
    modules: { Config, RulesEngine }
  };
})();

function getBindFatesFromApp(){
  const App = window.App;
  return (App && App.state && App.state.bindFates) || {
    ascendancy: { oaths: [], abominations: [] },
    weapon:     { oaths: [], abominations: [] },
    defensiveStrategy: { oaths: [], abominations: [] },
    combat:     { oaths: [], abominations: [] }
  };
}

export { getBindFatesFromApp };

// ---------- Tag utilities (shared normalizer + alias map) ----------
