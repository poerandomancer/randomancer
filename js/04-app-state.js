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
      recommendedJewelryUniques: Array.isArray(src.recommendedJewelryUniques) ? src.recommendedJewelryUniques : [],
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

    // The only canonical standard Build state.
    currentDraw: canonicalizeDraw(),

    bindFates: {
      ascendancy: { oaths: [], abominations: [] },
      weapon:     { oaths: [], abominations: [] },
      combat:     { oaths: [], abominations: [] }
    },

  };

  async function bootstrap(){
    const { core, gems } = await ensureDataPreload();
    state.DATA = window.DATA || core || {};
    state.GEMS = gems;
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



  function exposeRuntimeData(){
    try{
      if (typeof window !== 'undefined') {
        window.DATA = state.DATA; window.SKILL_GEMS = state.GEMS;
      }
    }catch(e){ console.warn("exposeRuntimeData failed:", e); }
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
