/*
 * Build-card refactor: recommendation contract boundary.
 *
 * The primary card is now the authoritative Build presentation, so this module
 * only normalizes canonical recommendation state. The temporary legacy-panel
 * MutationObserver/presentation guard has been removed.
 */

const MAX_SKILLS_PER_WEAPON_SET = 2;
const MAX_UNIQUES = 3;
const MAX_ASCENDANCY_NODES = 2;
const MAX_NOTABLES = 3;

function cloneEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const next = { ...entry };
  // Remove the deprecated flat support field. Typed v3 support assignments
  // remain nested under recommendationV3 on the skill they actually support.
  delete next.recommended_supports;
  return next;
}

function normalizeSkillIdeas(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(Boolean)
    .slice(0, MAX_SKILLS_PER_WEAPON_SET)
    .map(cloneEntry);
}

function normalizeUniqueIdeas(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const key = String(name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_UNIQUES) break;
  }
  return out;
}

function normalizePassiveIdeas(passives) {
  if (!passives || typeof passives !== 'object') return null;
  return {
    ascendancyNodes: Array.isArray(passives.ascendancyNodes)
      ? passives.ascendancyNodes.filter(Boolean).slice(0, MAX_ASCENDANCY_NODES)
      : [],
    // Keystones are intentionally excluded: their build-defining tradeoffs are
    // too impactful for the current tag-matching system to recommend reliably.
    keystones: [],
    notables: Array.isArray(passives.notables)
      ? passives.notables.filter(Boolean).slice(0, MAX_NOTABLES)
      : []
  };
}

function normalizeRecommendationV3(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeRecommendationContract(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return {
    ...snapshot,
    recommendedSkills: normalizeSkillIdeas(snapshot.recommendedSkills),
    recommendedSkills2: normalizeSkillIdeas(snapshot.recommendedSkills2),
    synergySupports: [],
    synergySupports2: [],
    recommendedPersistentBuff: null,
    recommendedUniques: normalizeUniqueIdeas(snapshot.recommendedUniques),
    passives: normalizePassiveIdeas(snapshot.passives),
    recommendationV3: normalizeRecommendationV3(snapshot.recommendationV3)
  };
}

function looksLikeNewCoreRoll(partial) {
  return !!(
    partial &&
    typeof partial === 'object' &&
    Object.prototype.hasOwnProperty.call(partial, 'className') &&
    Object.prototype.hasOwnProperty.call(partial, 'buildName') &&
    Object.prototype.hasOwnProperty.call(partial, 'weapon')
  );
}

function normalizeMergePartial(partial) {
  if (!partial || typeof partial !== 'object') return partial;
  const next = { ...partial };

  // A new core roll is merged before its optional ideas. Clear the previous
  // roll's ideas immediately so stale recommendations never leak forward.
  if (looksLikeNewCoreRoll(next)) {
    next.recommendedSkills = [];
    next.recommendedSkills2 = [];
    next.synergySupports = [];
    next.synergySupports2 = [];
    next.recommendedPersistentBuff = null;
    next.recommendedUniques = [];
    next.passives = null;
    next.recommendationV3 = null;
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'recommendedSkills')) {
    next.recommendedSkills = normalizeSkillIdeas(partial.recommendedSkills);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'recommendedSkills2')) {
    next.recommendedSkills2 = normalizeSkillIdeas(partial.recommendedSkills2);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'recommendedUniques')) {
    next.recommendedUniques = normalizeUniqueIdeas(partial.recommendedUniques);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'passives')) {
    next.passives = normalizePassiveIdeas(partial.passives);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'recommendationV3')) {
    next.recommendationV3 = normalizeRecommendationV3(partial.recommendationV3);
  }

  // Deprecated recommendation families stay empty even if an older generator
  // still attempts to merge them during this transitional pass.
  if (Object.prototype.hasOwnProperty.call(partial, 'synergySupports')) next.synergySupports = [];
  if (Object.prototype.hasOwnProperty.call(partial, 'synergySupports2')) next.synergySupports2 = [];
  if (Object.prototype.hasOwnProperty.call(partial, 'recommendedPersistentBuff')) next.recommendedPersistentBuff = null;

  return next;
}

function syncLegacyRecommendationContext(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const legacy = window.CURRENT_ROLL;
  if (!legacy || typeof legacy !== 'object') return;
  legacy.recommendedSkills = snapshot.recommendedSkills || [];
  legacy.recommendedSkills2 = snapshot.recommendedSkills2 || [];
  legacy.synergySupports = [];
  legacy.synergySupports2 = [];
  legacy.recommendedPersistentBuff = null;
  legacy.recommendedUniques = snapshot.recommendedUniques || [];
  legacy.passives = snapshot.passives || null;
  legacy.recommendationV3 = snapshot.recommendationV3 || null;
}

function installCanonicalContract() {
  const App = window.App;
  if (!App || App.__recommendationContractInstalled) return false;

  const originalMerge = typeof App.mergeCurrentRoll === 'function'
    ? App.mergeCurrentRoll.bind(App)
    : null;
  const originalReplace = typeof App.replaceCurrentRoll === 'function'
    ? App.replaceCurrentRoll.bind(App)
    : null;

  if (originalMerge) {
    App.mergeCurrentRoll = function mergeCurrentRollWithRecommendationContract(partial) {
      const result = originalMerge(normalizeMergePartial(partial));
      const normalized = normalizeRecommendationContract(result);
      App.state.currentRoll = normalized;
      syncLegacyRecommendationContext(normalized);
      return normalized;
    };
  }

  if (originalReplace) {
    App.replaceCurrentRoll = function replaceCurrentRollWithRecommendationContract(snapshot) {
      const result = originalReplace(normalizeRecommendationContract(snapshot));
      const normalized = normalizeRecommendationContract(result);
      App.state.currentRoll = normalized;
      syncLegacyRecommendationContext(normalized);
      return normalized;
    };
  }

  App.state.currentRoll = normalizeRecommendationContract(App.state.currentRoll || {});
  App.__recommendationContractInstalled = true;
  return true;
}

function install() {
  installCanonicalContract();

  // App is normally ready before this module executes, but keep a small retry
  // for unusual bootstrap timing and local development hot reloads.
  if (!window.App?.__recommendationContractInstalled) {
    let attempts = 0;
    const retry = window.setInterval(() => {
      attempts += 1;
      if (installCanonicalContract() || attempts >= 20) window.clearInterval(retry);
    }, 50);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

export {
  MAX_SKILLS_PER_WEAPON_SET,
  MAX_UNIQUES,
  MAX_ASCENDANCY_NODES,
  MAX_NOTABLES,
  normalizeRecommendationContract
};
