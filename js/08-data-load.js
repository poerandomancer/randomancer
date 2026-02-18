import { buildPassiveIndex } from './07-skills-render.js';

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

// ---------- data initialization ----------
async function loadData() {
  try {
    const core = await loadJSON('data/core-data.json');

    // Pre-enriched passives (unchanged)
    const passivesEnriched = await tryLoad('data/enriched/passives_enriched.json');
    if (!passivesEnriched || !passivesEnriched.nodes) {
      console.warn('[loadData] Passive data missing or incomplete');
    }
    const passiveIndex = buildPassiveIndex(passivesEnriched);

    // Pre-enriched skill gems (no more runtime enrichment)
    const gemsEnriched = await tryLoad('data/enriched/skills_enriched.json');
    const gems = Array.isArray(gemsEnriched) ? gemsEnriched : [];
    if (!Array.isArray(gemsEnriched)) {
      console.warn('[loadData] Enriched skills data missing or not an array, defaulting to empty list.');
    }
    console.log(`[Skill Enrichment] ${gems.length} enriched skill entries (precomputed).`);

    // Optional keystone tooltip overrides (human-readable effect lines)
    const keystoneTooltipsRaw = await tryLoad('data/enriched/keystone_tooltips.json');
    const keystoneTooltips = (keystoneTooltipsRaw && typeof keystoneTooltipsRaw === 'object' && !Array.isArray(keystoneTooltipsRaw))
      ? keystoneTooltipsRaw
      : {};

    window.DATA = {
      ...core,
      gems,
      passivesEnriched,
      passiveIndex,
      keystoneTooltips
    };
    console.log("[Global DATA initialized]", window.DATA);

    return { core, gems, passivesEnriched, passiveIndex };
  } catch (err) {
    console.error("[loadData] Failed to load core data:", err);
    return { core: {}, gems: [] };
  }
}

export { dataReady, ensureDataPreload };
