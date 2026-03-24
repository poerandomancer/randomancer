import { Dom, firstText } from './01-meta-and-domready.js';
import { Config, RulesEngine, Schema } from './03-config-and-schema.js';
import { setCohesionThreshold } from './06-cohesion.js';
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

  function canonicalizeRollSnapshot(input = {}) {
    const src = (input && typeof input === 'object') ? input : {};
    const attrs = (src.attributes && typeof src.attributes === 'object') ? src.attributes : {};
    const rollAttrs = (src.rollAttr && typeof src.rollAttr === 'object') ? src.rollAttr : {};
    return {
      className: src.className || '',
      ascendancy: src.ascendancy || '',
      ascendancyId: src.ascendancyId ?? null,
      defense: src.defense || '',
      defStrat: src.defStrat || '',
      defStratObj: src.defStratObj ?? null,
      weapon: src.weapon || '',
      offhand: src.offhand || '',
      weapon2: src.weapon2 || '',
      offhand2: src.offhand2 || '',
      tactics: src.tactics || '',
      ailments: src.ailments || '',
      ailmentList: Array.isArray(src.ailmentList) ? src.ailmentList : [],
      tacticList: Array.isArray(src.tacticList) ? src.tacticList : [],
      tacticSet: Array.isArray(src.tacticSet) ? src.tacticSet : [],
      ailmentSet: Array.isArray(src.ailmentSet) ? src.ailmentSet : [],
      buildName: src.buildName || '',
      flavor: src.flavor || '',
      attributes: {
        strength: Number(attrs.strength) || 0,
        dexterity: Number(attrs.dexterity) || 0,
        intelligence: Number(attrs.intelligence) || 0
      },
      rollAttr: {
        strength: Number(rollAttrs.strength) || 0,
        dexterity: Number(rollAttrs.dexterity) || 0,
        intelligence: Number(rollAttrs.intelligence) || 0
      },
      defenseObj: src.defenseObj ?? null,
      recommendedSkills: Array.isArray(src.recommendedSkills) ? src.recommendedSkills : [],
      recommendedSkills2: Array.isArray(src.recommendedSkills2) ? src.recommendedSkills2 : [],
      synergySupports: Array.isArray(src.synergySupports) ? src.synergySupports : [],
      synergySupports2: Array.isArray(src.synergySupports2) ? src.synergySupports2 : [],
      recommendedPersistentBuff: src.recommendedPersistentBuff ?? null,
      recommendedUniques: Array.isArray(src.recommendedUniques) ? src.recommendedUniques : [],
      passives: src.passives && typeof src.passives === 'object' ? src.passives : null,
      tagProfile: src.tagProfile ?? null,
      snapshotVersion: Number(src.snapshotVersion) || 1
    };
  }

  const state = {
    DATA:   null,
    GEMS:   null,
    SKILLS: null,
    CONFIG: null,

    // Cohesion slider: continuous [0..1], but we still track the nearest preset index + name
    // 0=strict,1=cohesive,2=chaotic,3=madness (legacy index for saved builds)
    cohesionThreshold: 3/4,


    // canonical current roll snapshot
    currentRoll: canonicalizeRollSnapshot(),

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

	function setCohesion(raw){
	  let threshold = Number(raw);
	  if (!Number.isFinite(threshold)) return;
	
	  if (threshold < 0) threshold = 0;
	  if (threshold > 1) threshold = 1;
	
	  state.cohesionThreshold = threshold;
	  setCohesionThreshold(threshold);
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
      window.rollBuild(state.DATA || window.DATA);
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
	
		if (typeof window !== 'undefined') {
		  window.__LAST_ROLL_META = { ...state.currentRoll };
		}
		return state.currentRoll;
	  } catch (e) {
		return state.currentRoll;
	  }
	}

  function replaceCurrentRoll(nextSnapshot){
    try {
      const safe = cloneJsonSafe(nextSnapshot);
      state.currentRoll = canonicalizeRollSnapshot(safe || {});
      if (typeof window !== 'undefined') {
        window.__LAST_ROLL_META = cloneJsonSafe(state.currentRoll) || { ...state.currentRoll };
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

  return {
    state,
    bootstrap,
    setCohesion,
    legacyInit,
    roll,
    captureCurrentRollFromDOM,
    mergeCurrentRoll,
    replaceCurrentRoll,
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
    combat:     { oaths: [], abominations: [] }
  };
}

export { getBindFatesFromApp };

// ---------- Tag utilities (shared normalizer + alias map) ----------
