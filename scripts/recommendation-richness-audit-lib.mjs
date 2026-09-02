/** Development-only candidate-depth audit. It calls production selectors in diagnostic mode. */
import { deriveWeaponFamilies } from '../js/06-equipment.js';
import { buildOffenseSnapshotFields, resolveRollableOffenseElements } from '../js/26-offense-roll.js';
import { adaptRecommendationPackageV3ToSnapshot, selectRecommendationPackageV3 } from '../js/30-recommendation-v3-selector.js';
import { selectNonSkillRecommendations } from '../js/31-non-skill-recommendation-selector.js';
import { AUDIT_REPETITIONS, AUDIT_SEED, loadProductionRecommendationData } from './recommendation-audit-lib.mjs';

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : 0; };
const round = (value) => Math.round(value * 100) / 100;
const distribution = (values) => ({ zero: values.filter((v) => v === 0).length, one: values.filter((v) => v === 1).length,
  two: values.filter((v) => v === 2).length, threePlus: values.filter((v) => v >= 3).length });
const classification = (selected, strong, limit = Infinity) => strong <= 1 ? 'POOL_LIMITED'
  : Math.min(strong, limit) <= selected ? 'ALREADY_RICH' : 'SELECTOR_LIMITED';
const compactRank = (candidate, best, index) => ({ rank: index + 1, name: candidate.name, score: candidate.score ?? candidate.priority,
  absoluteGap: best - (candidate.score ?? candidate.priority), relativeGap: best ? round((best - (candidate.score ?? candidate.priority)) / Math.abs(best)) : 0 });

function depth(candidates, selectedNames, bandPredicate = (candidate) => candidate.inTopBand,
  distinctKey = (candidate) => candidate.familyId || candidate.entityId, limit = Infinity) {
  const byEntity = new Map();
  for (const candidate of candidates) {
    const prior = byEntity.get(candidate.entityId);
    if (!prior || (candidate.score ?? candidate.priority) > (prior.score ?? prior.priority)) byEntity.set(candidate.entityId, candidate);
    else if (candidate.inTopBand) prior.inTopBand = true;
  }
  const deduped = [...byEntity.values()];
  const strong = deduped.filter(bandPredicate);
  const distinct = new Set(strong.map(distinctKey)).size;
  const best = deduped[0]?.score ?? deduped[0]?.priority ?? 0;
  const selectedCount = new Set(selectedNames).size;
  return { selectedCount, eligibleCount: deduped.length, topQualityBandCount: strong.length,
    meaningfullyDistinctCount: distinct, classification: classification(selectedCount, strong.length, limit),
    selectedScore: deduped.find((candidate) => selectedNames.includes(candidate.name))?.score ?? null,
    strongest: deduped.slice(0, 5).map((candidate, index) => compactRank(candidate, best, index)) };
}

const summarizeCategory = (cases, key) => {
  const entries = cases.flatMap((item) => Array.isArray(item.depth[key]) ? item.depth[key] : [item.depth[key]]);
  const eligible = entries.map((entry) => entry.eligibleCount); const strong = entries.map((entry) => entry.topQualityBandCount);
  return { observations: entries.length, averageEligibleCount: round(eligible.reduce((a, b) => a + b, 0) / entries.length),
    medianEligibleCount: median(eligible), strongCandidateDistribution: distribution(strong),
    classification: Object.fromEntries(['POOL_LIMITED', 'SELECTOR_LIMITED', 'DIVERSITY_LIMITED', 'ALREADY_RICH']
      .map((name) => [name, entries.filter((entry) => entry.classification === name).length])),
    underFilled: entries.filter((entry) => entry.selectedCount < entry.topQualityBandCount).length };
};

export async function generateRecommendationRichnessAudit(options = {}) {
  const data = options.data || await loadProductionRecommendationData(options.root);
  const weapons = deriveWeaponFamilies(data.core); const offenses = resolveRollableOffenseElements({ OffenseInventory: data.offenseInventory });
  const ascendancies = Object.entries(data.core.Classes || {}).flatMap(([className, cls]) => (cls.ascendancies || []).map((ascendancy) =>
    ({ ascendancy, className, passiveTreeStart: cls.passiveTreeStart, passiveTreeCharacterId: cls.passiveTreeCharacterId })));
  const cases = []; let caseNumber = 0;
  for (let repetition = 0; repetition < (options.repetitions || AUDIT_REPETITIONS); repetition += 1) for (const weapon of weapons) for (const offense of offenses) {
    caseNumber += 1; const identity = ascendancies[(caseNumber * 7 + repetition * 11) % ascendancies.length];
    const selectionSeed = `${options.seed || AUDIT_SEED}:r${repetition + 1}:w${weapon.id}:o${offense.id}`;
    const snapshot = { ...identity, weaponFamily: weapon.name, weapon: weapon.name, ...buildOffenseSnapshotFields([offense]) };
    const recommendation = selectRecommendationPackageV3(data.catalog, snapshot, { offenseInventory: data.offenseInventory,
      criticalProfiles: data.criticalProfiles, selectionSeed, richnessAudit: true });
    const adapted = { ...snapshot, ...adaptRecommendationPackageV3ToSnapshot(recommendation) };
    const nonSkills = selectNonSkillRecommendations(data.catalog, adapted, recommendation, { selectionSeed, richnessAudit: true });
    const skillCandidates = recommendation.diagnostics.richness?.skillCandidates || [];
    const skills = depth(skillCandidates, (recommendation.pieces || []).map((entry) => entry.name),
      (candidate) => candidate.inTopBand, (candidate) => candidate.entityId, 3);
    skills.sameSolutionClassCount = new Set(skillCandidates.map((entry) => entry.entityId)).size;
    const passiveCandidates = [...(nonSkills.candidateDiagnostics?.ascendancyPassives || []), ...(nonSkills.candidateDiagnostics?.notables || [])]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const passiveBest = passiveCandidates[0]?.score || 0;
    const passives = depth(passiveCandidates, [...(nonSkills.passives.ascendancyNodes || []), ...(nonSkills.passives.notables || [])].map((entry) => entry.name),
      (candidate) => candidate.score >= passiveBest - 4, (candidate) => candidate.entityId, 3);
    const supportDepth = (recommendation.pieces || []).map((skill) => {
      const candidates = (recommendation.diagnostics.richness?.optimizerCandidates || []).filter((entry) => entry.skillEntityId === skill.entityId);
      const bestBand = candidates[0]?.semanticBand;
      const result = depth(candidates, (skill.supports || []).filter((entry) => entry.assignedRole === 'OPTIONAL_OFFENSE_OPTIMIZER').map((entry) => entry.name),
        (candidate) => candidate.semanticBand === bestBand, (candidate) => candidate.familyId, Math.max(0, 3 - (skill.supports || []).filter((entry) => entry.assignedRole !== 'OPTIONAL_OFFENSE_OPTIMIZER').length));
      return { skill: skill.name, requiredSupportCount: (skill.supports || []).filter((entry) => entry.assignedRole !== 'OPTIONAL_OFFENSE_OPTIMIZER').length, ...result };
    });
    cases.push({ id: `AUDIT-${String(caseNumber).padStart(3, '0')}`, input: { weapon: weapon.name, offense: offense.name,
      offenseId: offense.id, ascendancy: identity.ascendancy, className: identity.className, selectionSeed }, production: {
      solutionClass: recommendation.solutionClass, skills: (recommendation.pieces || []).map((entry) => entry.name),
      supports: (recommendation.pieces || []).flatMap((entry) => (entry.supports || []).map((support) => ({ name: support.name, role: support.assignedRole }))),
      passives: [...(nonSkills.passives.ascendancyNodes || []), ...(nonSkills.passives.notables || [])].map((entry) => entry.name),
      requiredUnique: recommendation.coreUnique?.name || null }, depth: { skills, passives, optionalSupports: supportDepth } });
  }
  const summary = { totalCases: cases.length, skills: summarizeCategory(cases, 'skills'), passives: summarizeCategory(cases, 'passives'),
    optionalSupports: summarizeCategory(cases, 'optionalSupports') };
  const supportDepths = cases.flatMap((item) => item.depth.optionalSupports);
  summary.optimizerRichness = { selectedSkills: summary.optionalSupports.observations,
    withTwoPlusStrong: cases.flatMap((item) => item.depth.optionalSupports).filter((entry) => entry.topQualityBandCount >= 2).length,
    withThreePlusStrong: cases.flatMap((item) => item.depth.optionalSupports).filter((entry) => entry.topQualityBandCount >= 3).length,
    selectorLimited: supportDepths.filter((entry) => entry.classification === 'SELECTOR_LIMITED').length,
    leavingStrongUnused: supportDepths.filter((entry) => entry.selectedCount < entry.topQualityBandCount).length,
    presentationCeilingLimited: supportDepths.filter((entry) => entry.classification === 'ALREADY_RICH'
      && entry.selectedCount < entry.topQualityBandCount).length };
  const informative = [...cases].sort((a, b) => {
    const score = (item) => 3 * Number(item.depth.skills.classification === 'SELECTOR_LIMITED') + 2 * Number(item.depth.passives.classification === 'SELECTOR_LIMITED')
      + item.depth.optionalSupports.filter((entry) => entry.classification === 'SELECTOR_LIMITED').length + Number(item.production.requiredUnique) + Number(item.production.supports.some((s) => s.role !== 'OPTIONAL_OFFENSE_OPTIMIZER'));
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  const representatives = [];
  const add = (item) => { if (item && !representatives.includes(item)) representatives.push(item); };
  for (const offense of offenses) add(informative.find((item) => item.input.offenseId === offense.id));
  for (const weapon of weapons) add(informative.find((item) => item.input.weapon === weapon.name));
  for (const item of informative) { if (representatives.length >= 20) break; add(item); }
  return { schemaVersion: 1, seed: options.seed || AUDIT_SEED, strategy: { repetitions: options.repetitions || AUDIT_REPETITIONS,
    ordering: 'repetition, weapon, offense' }, summary, representativeCaseIds: representatives.slice(0, 20).map((item) => item.id), cases };
}

export function renderRecommendationRichnessReport(audit) {
  const category = (label, value) => `## ${label}\n\n- Eligible candidates: average ${value.averageEligibleCount}; median ${value.medianEligibleCount}.\n- Strong candidates: 0=${value.strongCandidateDistribution.zero}, 1=${value.strongCandidateDistribution.one}, 2=${value.strongCandidateDistribution.two}, 3+=${value.strongCandidateDistribution.threePlus}.\n- Classification: POOL_LIMITED=${value.classification.POOL_LIMITED}, SELECTOR_LIMITED=${value.classification.SELECTOR_LIMITED}, DIVERSITY_LIMITED=${value.classification.DIVERSITY_LIMITED}, ALREADY_RICH=${value.classification.ALREADY_RICH}.\n- Production selected fewer than the strong band in ${value.underFilled} observations.\n`;
  const cases = audit.representativeCaseIds.map((id) => audit.cases.find((item) => item.id === id)).map((item) => {
    const unselected = (depth, selected) => depth.strongest.filter((entry) => !selected.includes(entry.name)).slice(0, 3).map((entry) => `${entry.name} (${entry.score}, gap ${entry.absoluteGap})`);
    const supports = item.depth.optionalSupports.flatMap((entry) => unselected(entry, item.production.supports.map((support) => support.name)));
    return `### ${item.id} — ${item.input.weapon} + ${item.input.offense}\n\n- Production skills: ${item.production.skills.join(', ') || 'none'}; supports: ${item.production.supports.map((support) => `${support.name} [${support.role}]`).join(', ') || 'none'}; passives: ${item.production.passives.join(', ') || 'none'}; required unique: ${item.production.requiredUnique || 'none'}.\n- Depth: skills ${item.depth.skills.topQualityBandCount} strong/${item.depth.skills.eligibleCount} eligible (${item.depth.skills.classification}); passives ${item.depth.passives.topQualityBandCount}/${item.depth.passives.eligibleCount} (${item.depth.passives.classification}); optional supports ${item.depth.optionalSupports.reduce((sum, entry) => sum + entry.topQualityBandCount, 0)}/${item.depth.optionalSupports.reduce((sum, entry) => sum + entry.eligibleCount, 0)}.\n- Strong unselected: skills ${unselected(item.depth.skills, item.production.skills).join(', ') || 'none'}; passives ${unselected(item.depth.passives, item.production.passives).join(', ') || 'none'}; supports ${supports.join(', ') || 'none'}.\n`;
  }).join('\n');
  return `# Recommendation richness audit\n\nDevelopment-only output for the canonical ${audit.summary.totalCases}-case corpus and seed \`${audit.seed}\`. Required solver supports are excluded from optional-support depth. Candidate bands reuse production package/passive/optimizer ranking concepts; no selector setting is changed.\n\n${category('Skills', audit.summary.skills)}\n${category('Passives/notables', audit.summary.passives)}\n${category('Optional optimizer supports', audit.summary.optionalSupports)}\n## Optimizer-specific result\n\n- Selected skills observed: ${audit.summary.optimizerRichness.selectedSkills}.\n- Skills with 2+ strong optional optimizers: ${audit.summary.optimizerRichness.withTwoPlusStrong}; with 3+: ${audit.summary.optimizerRichness.withThreePlusStrong}.\n- Selector-limited skills: ${audit.summary.optimizerRichness.selectorLimited}; presentation-ceiling-limited skills: ${audit.summary.optimizerRichness.presentationCeilingLimited}.\n- Skills leaving a strong optimizer unused beyond the safety ceiling: ${audit.summary.optimizerRichness.leavingStrongUnused}.\n- Distinct support families are counted as non-duplicates, but the compact semantic priority shows many candidates occupy the same application/effect/duration/payoff lane. Treat complementarity as requiring a future pairwise conflict audit, not as proven here.\n\n## Interpretation\n\nThe data supports investigating confidence-decay policies rather than quotas: continue through the existing top band, require a distinct entity/family and compatibility, and stop at the existing quality falloff. Skill and passive candidates should still require independent direct/package anchors. Optional supports should additionally require pairwise non-conflict and a distinct optimization purpose. The zero/one bands remain naturally sparse.\n\n## Representative cases\n\n${cases}`;
}
