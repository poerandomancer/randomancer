import {
  adaptRecommendationPackageV3ToSnapshot,
  isRecommendationV3Enabled,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3
} from './30-recommendation-v3-selector.js';

let installed = false;

function currentSnapshot() {
  return window.App?.state?.currentRoll || window.CURRENT_ROLL || null;
}

function runRecommendationV3(snapshot = currentSnapshot()) {
  if (!isRecommendationV3Enabled(window) || !snapshot || typeof snapshot !== 'object') return null;

  const catalog = window.DATA?.recommendationCatalogV3;
  const validation = validateRecommendationCatalogV3(catalog);
  if (!validation.ok) {
    console.warn(`[Recommendation v3] ${validation.reason}; preserving the current recommendation output.`);
    return null;
  }

  const result = selectRecommendationPackageV3(catalog, snapshot, {
    offenseInventory: window.DATA?.OffenseInventory || {}
  });
  const partial = adaptRecommendationPackageV3ToSnapshot(result);

  if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
    Object.assign(window.CURRENT_ROLL, partial);
  }
  window.App?.mergeCurrentRoll?.(partial);
  window.scheduleSummaryRefresh?.();
  return result;
}

function installRecommendationV3Runtime() {
  if (installed) return;
  installed = true;

  const previousAfter = window.RandomancerAfterBuildRoll;
  window.RandomancerAfterBuildRoll = (...args) => {
    previousAfter?.(...args);
    runRecommendationV3();
  };

  window.RandomancerRecommendationV3 = Object.freeze({
    enabled: () => isRecommendationV3Enabled(window),
    run: runRecommendationV3
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installRecommendationV3Runtime, { once: true });
} else {
  installRecommendationV3Runtime();
}

export { installRecommendationV3Runtime, runRecommendationV3 };
