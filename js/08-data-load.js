import { buildPassiveIndex } from './07-skills-render.js';
import { buildSkillFamilyIndex, resolveSkillFamily } from './17-skill-family-utils.js';
import {
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3,
  validateRecommendationGrantedSkillAccessV3,
  validateRecommendationSkillCraftingV3,
  validateRecommendationCatalogV3
} from './30-recommendation-v3-selector.js';

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
    // The package selector is the standard recommendation workflow, so its
    // supporting data is always loaded with the core application data.
    const recommendationCatalogPromise = tryLoad('data/enriched/recommendation_catalog_v3.json');
    const recommendationSkillCraftingPromise = tryLoad('data/enriched/recommendation_skill_crafting_v3.json');
    const recommendationCriticalProfilesPromise = tryLoad('data/config/recommendation_critical_profiles_v3.json');
    const recommendationGrantedSkillAccessPromise = tryLoad('data/enriched/recommendation_granted_skill_access_v3.json');
    const core = await loadJSON('data/core-data.json');

    // Canonical Build Offense vocabulary. Keep it separate on disk from the
    // legacy Ailments/Tactics pools while exposing a convenient runtime view.
    const offenseInventoryRaw = await tryLoad('data/offense-inventory.json');
    const offenseInventory = (
      offenseInventoryRaw &&
      typeof offenseInventoryRaw === 'object' &&
      !Array.isArray(offenseInventoryRaw) &&
      Array.isArray(offenseInventoryRaw.elements)
    ) ? offenseInventoryRaw : { version: null, categories: [], elements: [] };
    core.OffenseInventory = offenseInventory;
    core.Offense = offenseInventory.elements;

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

    const challengePoolsRaw = await tryLoad('data/enriched/challenge_generated_pools.json');
    const challengePools = (challengePoolsRaw && typeof challengePoolsRaw === 'object' && !Array.isArray(challengePoolsRaw))
      ? challengePoolsRaw
      : {};

    // Skill Families (Challenge Mode)
    const skillFamilyLibRaw = await tryLoad('data/skill_families.json');
    const skillFamilyLib = (skillFamilyLibRaw && typeof skillFamilyLibRaw === 'object' && !Array.isArray(skillFamilyLibRaw))
      ? skillFamilyLibRaw
      : null;
    
    const skillFamilyIndex = skillFamilyLib ? buildSkillFamilyIndex(gems, skillFamilyLib) : null;
    
    // Pre-resolve family matches for instant pickers/tooltips
    const skillFamilyByName = Object.create(null);
    const skillFamilyById = Object.create(null);
    const skillFamilyResolved = new Map(); // name -> Set(skillId)
    const skillFamilyCounts = Object.create(null);
    const skillFamilyOptions = [];
    
    if (skillFamilyLib && Array.isArray(skillFamilyLib.families) && skillFamilyIndex) {
      for (const fam of skillFamilyLib.families) {
    if (!fam || !fam.name) continue;
    skillFamilyByName[fam.name] = fam;
    if (fam.id) skillFamilyById[fam.id] = fam;
    
    const matchIds = resolveSkillFamily(fam, skillFamilyIndex, skillFamilyLib);
    const count = matchIds ? matchIds.size : 0;
    skillFamilyCounts[fam.name] = count;
    skillFamilyResolved.set(fam.name, matchIds || new Set());
    if (count > 0) skillFamilyOptions.push(fam.name);
      }
      // Stable sort for UI
      skillFamilyOptions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      console.log(`[Skill Families] Loaded ${skillFamilyOptions.length}/${skillFamilyLib.families.length} families with matches.`);
    } else {
      console.warn('[Skill Families] Library missing or index build failed; Skill Family pickers/tooltips will be disabled.');
    }
    

    const ascendancyCatalogRaw = await tryLoad('data/datamined/ascendancy.json');
    const ascendancyCatalog = Array.isArray(ascendancyCatalogRaw) ? ascendancyCatalogRaw : [];
    const ascendancyByName = Object.create(null);
    ascendancyCatalog.forEach((row) => {
      const name = row?.Name;
      if (!name || String(name).startsWith('[DNT-UNUSED]')) return;
      ascendancyByName[name] = {
        name,
        className: row.Character || null,
        description: row.FlavourText || null,
        uiArt: row.UIArt || null
      };
    });

    const recommendationCatalogRaw = await recommendationCatalogPromise;
    const recommendationSkillCraftingRaw = await recommendationSkillCraftingPromise;
    const recommendationCriticalProfilesRaw = await recommendationCriticalProfilesPromise;
    const recommendationGrantedSkillAccessRaw = await recommendationGrantedSkillAccessPromise;
    const recommendationSkillCraftingValidation = validateRecommendationSkillCraftingV3(recommendationSkillCraftingRaw);
    const recommendationCatalogWithCrafting = recommendationSkillCraftingValidation.ok
      ? mergeRecommendationSkillCraftingV3(recommendationCatalogRaw, recommendationSkillCraftingRaw)
      : recommendationCatalogRaw;
    const recommendationCatalogValidation = validateRecommendationCatalogV3(recommendationCatalogWithCrafting);
    const recommendationGrantedSkillAccessValidation = validateRecommendationGrantedSkillAccessV3(recommendationGrantedSkillAccessRaw);
    const recommendationGrantedSkillAccessV3 = recommendationGrantedSkillAccessValidation.ok
      ? recommendationGrantedSkillAccessRaw
      : null;
    const recommendationCatalogV3 = recommendationCatalogValidation.ok && recommendationSkillCraftingValidation.ok
      ? mergeRecommendationGrantedSkillAccessV3(recommendationCatalogWithCrafting, recommendationGrantedSkillAccessV3)
      : null;
    if (!recommendationCatalogValidation.ok) {
      console.warn(`[Recommendation v3] Catalog unavailable: ${recommendationCatalogValidation.reason}`);
    }
    if (!recommendationSkillCraftingValidation.ok) {
      console.warn(`[Recommendation v3] Skill crafting map unavailable: ${recommendationSkillCraftingValidation.reason}`);
    }
    if (!recommendationGrantedSkillAccessValidation.ok) {
      console.warn(`[Recommendation v3] Granted skill access unavailable: ${recommendationGrantedSkillAccessValidation.reason}`);
    }

    window.DATA = {
      ...core,
      gems,
      passivesEnriched,
      passiveIndex,
      skillFamilyLib,
      skillFamilyIndex,
      skillFamilyByName,
      skillFamilyById,
      skillFamilyResolved,
      skillFamilyCounts,
      skillFamilyOptions,
      ascendancyCatalog,
      ascendancyByName,
      challengePools,
      recommendationCatalogV3,
      recommendationGrantedSkillAccessV3,
      recommendationCriticalProfilesV3: recommendationCriticalProfilesRaw || {}
    };
    console.log("[Global DATA initialized]", window.DATA);

    return {
      core,
      gems,
      passivesEnriched,
      passiveIndex,
      offenseInventory,
      recommendationCatalogV3,
      recommendationGrantedSkillAccessV3,
      recommendationCriticalProfilesV3: recommendationCriticalProfilesRaw || {}
    };
  } catch (err) {
    console.error("[loadData] Failed to load core data:", err);
    return { core: {}, gems: [], offenseInventory: { version: null, categories: [], elements: [] } };
  }
}

export { dataReady, ensureDataPreload };
