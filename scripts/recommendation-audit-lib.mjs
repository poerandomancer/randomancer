/** Development-only deterministic recommendation audit generator. */
import { readFile } from 'node:fs/promises';
import { deriveWeaponFamilies } from '../js/06-equipment.js';
import { buildOffenseSnapshotFields, resolveRollableOffenseElements } from '../js/26-offense-roll.js';
import {
  adaptRecommendationPackageV3ToSnapshot,
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3
} from '../js/30-recommendation-v3-selector.js';
import { mergeRecommendationUniqueSemanticsV3, selectNonSkillRecommendations } from '../js/31-non-skill-recommendation-selector.js';

export const AUDIT_SEED = 'randomancer-recommendation-audit-v1';
export const AUDIT_REPETITIONS = 2;
const SCHEMA_VERSION = 1;

const readJson = async (root, path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

export async function loadProductionRecommendationData(root = new URL('../', import.meta.url)) {
  const [core, offenseInventory, rawCatalog, crafting, access, uniqueSemantics, criticalProfiles] = await Promise.all([
    readJson(root, 'data/core-data.json'),
    readJson(root, 'data/offense-inventory.json'),
    readJson(root, 'data/enriched/recommendation_catalog_v3.json'),
    readJson(root, 'data/enriched/recommendation_skill_crafting_v3.json'),
    readJson(root, 'data/enriched/recommendation_granted_skill_access_v3.json'),
    readJson(root, 'data/enriched/recommendation_unique_semantics_v3.json'),
    readJson(root, 'data/config/recommendation_critical_profiles_v3.json')
  ]);
  const withCrafting = mergeRecommendationSkillCraftingV3(rawCatalog, crafting);
  const withAccess = mergeRecommendationGrantedSkillAccessV3(withCrafting, access);
  const catalog = mergeRecommendationUniqueSemanticsV3(withAccess, uniqueSemantics);
  const validation = validateRecommendationCatalogV3(catalog);
  if (!validation.ok) throw new Error(`Recommendation catalog unavailable: ${validation.reason}`);
  return { core, offenseInventory, catalog, criticalProfiles };
}

const ascendanciesFrom = (core) => Object.entries(core.Classes || {}).flatMap(([className, cls]) =>
  (cls.ascendancies || []).map((ascendancy) => ({
    ascendancy, className, passiveTreeStart: cls.passiveTreeStart,
    passiveTreeCharacterId: cls.passiveTreeCharacterId
  })));

const countNames = (cases, getNames) => Object.fromEntries([...cases.reduce((counts, item) => {
  for (const name of getNames(item).filter(Boolean)) counts.set(name, (counts.get(name) || 0) + 1);
  return counts;
}, new Map())].sort(([a], [b]) => a.localeCompare(b)));

const compactEvidence = (entry) => {
  const evidence = entry?.recommendationEvidence;
  return evidence ? {
    ...(evidence.tier ? { tier: evidence.tier } : {}),
    matches: (evidence.matches || []).map(({ kind, mechanic, relation, category }) =>
      ({ kind, mechanic, relation, ...(category ? { category } : {}) }))
  } : undefined;
};

function compactCase(id, input, recommendation, nonSkills) {
  const skills = (recommendation.pieces || []).map((skill) => ({
    name: skill.name,
    role: skill.assignedRole,
    supports: (skill.supports || []).map((support) => ({ name: support.name, role: support.assignedRole })),
    fulfilledObligations: skill.fulfilledObligations || [],
    suppliedTargets: skill.suppliedTargets || []
  }));
  const compactEntries = (entries) => (entries || []).map((entry) => ({
    name: entry.name, ...(entry.itemType ? { itemType: entry.itemType } : {}),
    ...(compactEvidence(entry) ? { rationale: compactEvidence(entry) } : {})
  }));
  return {
    id,
    input,
    recommendations: {
      status: recommendation.status,
      skills,
      ascendancyPassives: compactEntries(nonSkills.passives?.ascendancyNodes),
      notables: compactEntries(nonSkills.passives?.notables),
      uniques: compactEntries([...(nonSkills.recommendedUniques || []), ...(nonSkills.recommendedJewelryUniques || [])])
    },
    unresolved: recommendation.unresolved || []
  };
}

function summarize(cases) {
  const skillNames = (item) => item.recommendations.skills.map((entry) => entry.name);
  return {
    totalCases: cases.length,
    countByWeapon: countNames(cases, (item) => [item.input.weapon]),
    countByOffense: countNames(cases, (item) => [item.input.offense]),
    countByAscendancy: countNames(cases, (item) => [item.input.ascendancy]),
    recommendationFrequency: {
      skills: countNames(cases, skillNames),
      supports: countNames(cases, (item) => item.recommendations.skills.flatMap((skill) => skill.supports.map((support) => support.name))),
      passivesAndNotables: countNames(cases, (item) => [...item.recommendations.ascendancyPassives, ...item.recommendations.notables].map((entry) => entry.name)),
      uniques: countNames(cases, (item) => item.recommendations.uniques.map((entry) => entry.name))
    },
    casesWithNoSkillRecommendation: cases.filter((item) => skillNames(item).length === 0).length,
    casesWithFewerThanTwoSkillRecommendations: cases.filter((item) => skillNames(item).length < 2).length,
    casesWithUnresolvedObligations: cases.filter((item) => item.unresolved.length > 0).length
  };
}

export async function generateRecommendationAudit(options = {}) {
  const seed = options.seed || AUDIT_SEED;
  const repetitions = options.repetitions || AUDIT_REPETITIONS;
  const data = options.data || await loadProductionRecommendationData(options.root);
  const weapons = deriveWeaponFamilies(data.core);
  const offenses = resolveRollableOffenseElements({ OffenseInventory: data.offenseInventory });
  const ascendancies = ascendanciesFrom(data.core);
  const cases = [];
  let caseNumber = 0;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (let weaponIndex = 0; weaponIndex < weapons.length; weaponIndex += 1) {
      for (let offenseIndex = 0; offenseIndex < offenses.length; offenseIndex += 1) {
        caseNumber += 1;
        // The stride avoids aligning the 23 ascendancies with either matrix axis.
        const identity = ascendancies[(caseNumber * 7 + repetition * 11) % ascendancies.length];
        const weapon = weapons[weaponIndex];
        const offense = offenses[offenseIndex];
        const caseSeed = `${seed}:r${repetition + 1}:w${weapon.id}:o${offense.id}`;
        const snapshot = {
          className: identity.className, ascendancy: identity.ascendancy,
          passiveTreeStart: identity.passiveTreeStart, passiveTreeCharacterId: identity.passiveTreeCharacterId,
          weaponFamily: weapon.name, weapon: weapon.name,
          ...buildOffenseSnapshotFields([offense])
        };
        const recommendation = selectRecommendationPackageV3(data.catalog, snapshot, {
          offenseInventory: data.offenseInventory, criticalProfiles: data.criticalProfiles, selectionSeed: caseSeed
        });
        const adapted = { ...snapshot, ...adaptRecommendationPackageV3ToSnapshot(recommendation) };
        const nonSkills = selectNonSkillRecommendations(data.catalog, adapted, recommendation, { selectionSeed: caseSeed });
        cases.push(compactCase(`AUDIT-${String(caseNumber).padStart(3, '0')}`, {
          ascendancy: identity.ascendancy, className: identity.className, weapon: weapon.name,
          offense: offense.name, offenseId: offense.id, selectionSeed: caseSeed
        }, recommendation, nonSkills));
      }
    }
  }
  return { schemaVersion: SCHEMA_VERSION, seed, strategy: { repetitions, ordering: 'repetition, weapon, offense' }, summary: summarize(cases), cases };
}
