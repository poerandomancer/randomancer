import { renderOathAwareText } from './01-meta-and-domready.js';
import { renderSummaryFromSnapshot } from './02-summary-view.js';
import { dataReady, ensureDataPreload } from './08-data-load.js';
import { deriveWeaponFamilies, pickWeaponFamily } from './06-equipment.js';
import { buildOffenseSnapshotFields, selectOffense } from './26-offense-roll.js';
import { adaptRecommendationPackageV3ToSnapshot, selectRecommendationPackageV3, validateRecommendationCatalogV3 } from './30-recommendation-v3-selector.js';
import { selectNonSkillRecommendations } from './31-non-skill-recommendation-selector.js';

const randomItem = (items, random = Math.random) => items[Math.floor(random() * items.length)] || null;
const cleanFate = (fate = {}) => ({ oaths: fate.oaths || [], abominations: fate.abominations || [] });

function selectAscendancy(data, fate, random = Math.random) {
  const config = cleanFate(fate);
  const banned = new Set(config.abominations);
  const favored = new Set(config.oaths);
  const candidates = Object.entries(data.Classes || {}).flatMap(([className, cls]) =>
    (cls.ascendancies || []).filter((name) => !banned.has(name)).map((ascendancy) => ({ className, ascendancy, attributes: cls.attributes || {} }))
  );
  const preferred = candidates.filter((entry) => favored.has(entry.ascendancy));
  return randomItem(preferred.length ? preferred : candidates, random);
}

function normalizeAttributes(...sources) {
  const total = sources.reduce((sum, attrs) => {
    sum.strength += Number(attrs?.strength) || 0; sum.dexterity += Number(attrs?.dexterity) || 0; sum.intelligence += Number(attrs?.intelligence) || 0; return sum;
  }, { strength: 0, dexterity: 0, intelligence: 0 });
  const denominator = total.strength + total.dexterity + total.intelligence || 1;
  return Object.fromEntries(Object.entries(total).map(([key, value]) => [key, value / denominator]));
}

function selectionSeed() {
  if (globalThis.crypto?.getRandomValues) return [...globalThis.crypto.getRandomValues(new Uint32Array(2))].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function buildName(identity, weapon, offenses) {
  return `${identity.ascendancy} ${weapon.name} of ${offenses[0]?.name || 'Fate'}`;
}

function paintDraw(draw, fates) {
  document.getElementById('class')?.replaceChildren(document.createTextNode(draw.className));
  renderOathAwareText(document.getElementById('ascendancy'), draw.ascendancy, new Set(fates.ascendancy?.oaths || []));
  renderOathAwareText(document.getElementById('weapons'), draw.weaponFamily, new Set(fates.weapon?.oaths || []));
  renderOathAwareText(document.getElementById('offense'), draw.offenseList, new Set(fates.combat?.oaths || []));
  const name = document.getElementById('build-name'); if (name) name.textContent = draw.buildName;
  const flavor = document.getElementById('build-subtext'); if (flavor) flavor.textContent = draw.flavor;
  const bar = document.getElementById('balance-bar');
  const { strength: s, dexterity: d } = draw.attributes;
  bar?.style.setProperty('--balance-gradient', `linear-gradient(90deg,#b03030 0 ${s*100}%,#2d7a2d ${s*100}% ${(s+d)*100}%,#2f4f9d ${(s+d)*100}% 100%)`);
  const balance = document.getElementById('balance-text');
  if (balance) balance.textContent = `Strength ${Math.round(s*100)}% | Dexterity ${Math.round(d*100)}% | Intelligence ${Math.round(draw.attributes.intelligence*100)}%`;
  const app = document.getElementById('app'); if (app) app.dataset.hasRoll = 'true';
  renderSummaryFromSnapshot(draw);
}

function drawBuild(dataWrap, { random = Math.random } = {}) {
  const data = dataWrap?.core || dataWrap || window.DATA;
  if (!data) return { draw: null, error: 'Build data is unavailable.' };
  const fates = window.App?.getBindFates?.() || {};
  const identity = selectAscendancy(data, fates.ascendancy, random);
  const families = deriveWeaponFamilies(data);
  const weapon = pickWeaponFamily(families, cleanFate(fates.weapon), random);
  const offenseResult = selectOffense({ data, bindFates: fates, random });
  if (!identity || !weapon || offenseResult.error) {
    const error = offenseResult.error || 'No legal class, ascendancy, or weapon family matches the bound Fates.';
    window.showBindFatesError?.(error); return { draw: null, error };
  }
  const offenseFields = buildOffenseSnapshotFields(offenseResult.picks);
  const attributes = normalizeAttributes(identity.attributes, weapon.attributes, ...offenseResult.picks.map((entry) => entry.attributes));
  let draw = {
    schema: 'randomancer-draw-v1', snapshotVersion: 2,
    className: identity.className, ascendancy: identity.ascendancy,
    weaponFamily: weapon.name, weapon: weapon.name,
    ...offenseFields, attributes,
    buildName: buildName(identity, weapon, offenseResult.picks),
    flavor: 'A fate drawn from one weapon family and the Offense it must carry.',
    recommendationPackage: null, recommendedUniques: [], passives: null
  };
  const catalog = data.recommendationCatalogV3 || window.DATA?.recommendationCatalogV3;
  const validation = validateRecommendationCatalogV3(catalog);
  if (validation.ok) {
    const recommendation = selectRecommendationPackageV3(catalog, draw, { offenseInventory: data.OffenseInventory || {}, criticalProfiles: data.recommendationCriticalProfilesV3 || {}, selectionSeed: selectionSeed() });
    draw = { ...draw, ...adaptRecommendationPackageV3ToSnapshot(recommendation) };
    draw = { ...draw, ...selectNonSkillRecommendations(catalog, draw, recommendation, { selectionSeed: recommendation.selectionSeed }) };
  } else {
    draw.recommendationError = validation.reason || 'Recommendation catalog is unavailable.';
  }
  window.App?.replaceCurrentDraw?.(draw);
  paintDraw(draw, fates);
  document.dispatchEvent(new CustomEvent('randomancer:draw-complete', { detail: { draw } }));
  return { draw, error: null };
}

window.drawBuild = drawBuild;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('roll')?.addEventListener('click', async () => {
    const button = document.getElementById('roll'); const status = button?.querySelector('.roll-status');
    button?.classList.add('is-loading'); if (status && !dataReady) status.textContent = 'Preparing the fates…';
    try {
      if (await window.RandomancerHandleRollOverride?.({ rollBtn: button, statusEl: status })) return;
      const data = await ensureDataPreload(); drawBuild(data);
    } finally { button?.classList.remove('is-loading'); if (status) status.textContent = ''; }
  });
});

export { drawBuild, selectAscendancy, normalizeAttributes };
