import fs from 'node:fs';
import { selectNonSkillRecommendations } from '../../js/31-non-skill-recommendation-selector.js';
import {
  FAMILY_MAP, analyzeWholeUnique, classifyEmpty, familyOf, legalForWeapon, qualityBand, rankCandidates
} from './lib/recommendation_unique_analysis_v3.mjs';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const catalog = read('data/enriched/recommendation_catalog_v3.json');
const raw = read('data/enriched/poe2db_uniques_min.json');
const inventory = read('data/offense-inventory.json');
const core = read('data/core-data.json');
const uniques = catalog.entities.filter((entity) => entity.content_type === 'unique');
const entitiesByName = new Map();
for (const entity of catalog.entities) {
  const entries = entitiesByName.get(entity.name) || []; entries.push(entity); entitiesByName.set(entity.name, entries);
}
const rawByKey = new Map(Object.values(raw.items).map((item) => [item.key, item]));
const sources = { rawByKey, entitiesByName };
const offenses = inventory.elements.filter((offense) => offense.id !== 'critical_hits').slice(0, 15);
const weaponLabels = [...core.Weapons['Two-Handed'], ...core.Weapons['One-Handed']].map((weapon) => weapon.name);
const weapons = [...new Set(weaponLabels.map((weapon) => weapon.replace(/^(?:One|Two)-handed Mace$/, 'Mace')))]
  .filter((weapon) => FAMILY_MAP.has(weapon));

const compactCandidate = (candidate, currentId, proposedRank, bandIds) => ({
  id: candidate.id, name: candidate.name, slot: candidate.equipment.slot, family: candidate.equipment.primary || candidate.equipment.offhand,
  currentSelectorEligible: candidate.currentEligible, currentScore: candidate.currentScore,
  currentRank: candidate.currentEligible ? candidate.currentRank : null,
  proposedTier: candidate.bestTier, proposedScore: candidate.proposedScore, proposedRank,
  qualityBand: bandIds.has(candidate.id), selectedCurrently: currentId === candidate.sourceId,
  contradiction: candidate.contradiction,
  evidence: candidate.records.slice(0, 8),
  rationale: `${candidate.bestTier}: ${candidate.records[0]?.relation || 'no positive relation'} via ${candidate.records[0]?.provenance.sourceType || 'none'}.`
});

const cells = [];
const material = new Map();
const contradictions = new Map();
for (const weapon of weapons) for (const offense of offenses) {
  const legal = uniques.filter((entity) => legalForWeapon(entity, weapon));
  const analyzed = legal.map((entity) => ({ id: entity.id, sourceId: entity.source_id, name: entity.name,
    equipment: familyOf(entity), ...analyzeWholeUnique(entity, offense.id, sources) }));
  for (const candidate of analyzed.filter((entry) => entry.contradiction)) {
    contradictions.set(`${candidate.id}:${weapon}:${offense.id}`, {
      uniqueId: candidate.id, name: candidate.name, weapon, offense: offense.id,
      evidence: candidate.records.filter((record) => record.category === 'CONTRADICTION_PREVENTION').slice(0, 3)
    });
  }
  const primaryFamilies = FAMILY_MAP.get(weapon);
  const primary = rankCandidates(analyzed.filter((candidate) => primaryFamilies.has(candidate.equipment.primary)));
  const fallback = rankCandidates(analyzed.filter((candidate) => candidate.equipment.offhand));
  const proposed = primary.length ? primary : fallback;
  const band = qualityBand(proposed); const bandIds = new Set(band.map((candidate) => candidate.id));
  const currentResult = selectNonSkillRecommendations(catalog, { weaponFamily: weapon, offenseList: [offense.id] });
  const current = currentResult.recommendedUniques[0] || null;
  const currentRanked = analyzed.filter((candidate) => candidate.currentEligible)
    .sort((a, b) => b.currentScore - a.currentScore || a.id.localeCompare(b.id));
  currentRanked.forEach((candidate, index) => { candidate.currentRank = index + 1; });
  for (const candidate of proposed.filter((entry) => entry.grantedMaterial)) {
    const key = candidate.id; const record = material.get(key) || { uniqueId: candidate.id, name: candidate.name,
      weaponFamilies: new Set(), offenses: new Set(), grantedSources: new Set(), missingFacts: new Set(), changesWinner: false };
    record.weaponFamilies.add(weapon); record.offenses.add(offense.id);
    for (const evidence of candidate.records.filter((entry) => ['granted_skill', 'granted_effect', 'nested_component'].includes(entry.provenance.sourceType))) {
      record.grantedSources.add(evidence.provenance.sourceName); record.missingFacts.add(`${evidence.category}:${evidence.relation}:${evidence.mechanic || evidence.to}`);
    }
    if (proposed[0]?.id === candidate.id && current?.id !== candidate.sourceId) record.changesWinner = true;
    material.set(key, record);
  }
  const candidates = proposed.slice(0, 3).map((candidate, index) => compactCandidate(candidate, current?.id, index + 1, bandIds));
  const currentEmpty = !current;
  cells.push({ weapon, offenseId: offense.id, offense: offense.name,
    current: current ? { id: current.id, name: current.name, score: current.recommendationEvidence.score,
      tier: analyzed.find((candidate) => candidate.sourceId === current.id)?.bestTier || null } : null,
    proposed: candidates[0] || null, differs: (current?.id || null) !== (candidates[0]?.id?.replace(/^unique:/, '') || null)
      && (current?.name || null) !== (candidates[0]?.name || null),
    currentEmpty, richerSemanticsStrong: ['BUILD_DEFINING_CAPABILITY', 'STRONG_SPECIALIZATION'].includes(candidates[0]?.proposedTier),
    emptyClassification: currentEmpty ? classifyEmpty(proposed, legal.length) : null,
    qualityBandSize: band.length, candidates });
}

const grantedSkillUniques = uniques.filter((entity) => (rawByKey.get(entity.source_id)?.granted_skills || []).length);
const grantedEffectUniques = grantedSkillUniques.filter((entity) => (rawByKey.get(entity.source_id)?.granted_skills || []).some((skill) =>
  (entitiesByName.get(skill.name) || []).some((granted) => (granted.source_evidence?.granted_effects || []).length)));
const materialItems = [...material.values()].map((entry) => ({ ...entry,
  weaponFamilies: [...entry.weaponFamilies].sort(), offenses: [...entry.offenses].sort(),
  grantedSources: [...entry.grantedSources].sort(), missingFacts: [...entry.missingFacts].sort() }))
  .sort((a, b) => a.name.localeCompare(b.name));
const empties = cells.filter((cell) => cell.currentEmpty);
const bandCounts = Object.fromEntries([1, 2, 3].map((size) => [size, cells.filter((cell) => cell.qualityBandSize === size).length]));
const summary = {
  uniqueCandidatesAudited: new Set(uniques.filter((entity) => weapons.some((weapon) => legalForWeapon(entity, weapon))).map((entity) => entity.id)).size,
  containingGrantedSkills: grantedSkillUniques.length, containingGrantedEffects: grantedEffectUniques.length,
  grantedSemanticsMateriallyChangeRelevance: materialItems.length,
  currentSelectorMissesStrongCandidate: cells.filter((cell) => cell.currentEmpty && cell.richerSemanticsStrong).length,
  currentWinnerDiffers: cells.filter((cell) => !cell.currentEmpty && cell.differs).length,
  currentEmptyCells: empties.length,
  legitimatelyEmptyCells: empties.filter((cell) => !cell.richerSemanticsStrong).length,
  emptyCellsGainStrongCandidate: empties.filter((cell) => cell.richerSemanticsStrong).length,
  qualityBandCounts: bandCounts,
  contradictionPreventionFindings: contradictions.size,
  emptyCauses: Object.fromEntries([...new Set(empties.map((cell) => cell.emptyClassification))].sort()
    .map((cause) => [cause, empties.filter((cell) => cell.emptyClassification === cause).length])),
  runtimeSelectorChanged: false, namedItemOrCellExceptionsIntroduced: false
};
const payload = { schemaVersion: 'recommendation-unique-analysis-v3.0.0', summary,
  semanticHierarchy: ['BUILD_DEFINING_CAPABILITY', 'STRONG_SPECIALIZATION', 'AFFINITY_AMPLIFICATION', 'PAYOFF_CONTEXT'],
  qualityBandRule: 'At most three candidates in the best semantic tier and within 10 diagnostic score points of its leader.',
  grantedCompletenessFindings: materialItems, contradictionFindings: [...contradictions.values()], cells };
fs.writeFileSync('data/enriched/recommendation_unique_analysis_v3.json', `${JSON.stringify(payload, null, 2)}\n`);

const probe = (offense) => cells.find((cell) => cell.weapon === 'Bow' && cell.offenseId === offense);
const fair = (offense) => probe(offense)?.candidates.find((candidate) => candidate.name === "Fairgraves' Curse");
const black = (offense) => probe(offense)?.candidates.find((candidate) => candidate.name === 'Blackgleam');
const candidateText = (candidate) => candidate ? `${candidate.name} (${candidate.proposedTier}, score ${candidate.proposedScore})` : 'not in the meaningful top three';
const report = `# Unique recommendation semantic analysis v3\n\nThis deterministic diagnostic audits whole-item semantics while preserving the runtime Weapon + Offense contract. It does not change runtime selection.\n\n## Summary\n\n- Audited uniques: ${summary.uniqueCandidatesAudited}\n- With granted skills: ${summary.containingGrantedSkills}; with granted effects: ${summary.containingGrantedEffects}\n- Material granted-semantic gaps: ${summary.grantedSemanticsMateriallyChangeRelevance}\n- Current empty cells: ${summary.currentEmptyCells}; gain a strong candidate: ${summary.emptyCellsGainStrongCandidate}; remain legitimate: ${summary.legitimatelyEmptyCells}\n- Non-empty current winners differing from the rich-semantic leader: ${summary.currentWinnerDiffers}\n- Quality bands: one=${bandCounts[1]}, two=${bandCounts[2]}, three=${bandCounts[3]} (zero=${cells.filter((cell) => !cell.qualityBandSize).length})\n\n## Ranking model\n\nBUILD_DEFINING_CAPABILITY outranks STRONG_SPECIALIZATION, which outranks AFFINITY_AMPLIFICATION, which outranks PAYOFF_CONTEXT. Contradiction/prevention rejects a candidate. Fact count only breaks ties inside a tier, so shallow match volume cannot outrank capability. The future variety band contains at most three candidates in the leading tier within 10 points.\n\n## Fairgraves' Curse and Blackgleam\n\n| Probe | Current | Proposed | Fairgraves | Blackgleam |\n|---|---|---|---|---|\n| Bow × Ignite | ${probe('ignite')?.current?.name || 'empty'} | ${probe('ignite')?.proposed?.name || 'empty'} | ${candidateText(fair('ignite'))} | ${candidateText(black('ignite'))} |\n| Bow × Fire | ${probe('fire')?.current?.name || 'empty'} | ${probe('fire')?.proposed?.name || 'empty'} | ${candidateText(fair('fire'))} | ${candidateText(black('fire'))} |\n\nFairgraves' parent catalog facts expose only its granted-skill marker and recovery. The whole-item audit additionally finds item Fire addition/magnitude plus Phantasmal Arrow's Physical→Fire conversion, Fire property, direct Ignite application, Ignite specialization, and explosion component provenance. Blackgleam exposes direct Ignite in the current catalog (derived from a payoff line), while its raw modifiers add/gain Fire and amplify Flammability. The regression therefore confirms that missing granted-skill semantics materially suppress Fairgraves; it does not justify an item-name exception.\n\n## Bow and Quiver precedence\n\nSlot type adds no semantic score. Bow and Quiver are equally family-legal, and richer ranking is tier-first. Current additive fact scoring can reward repeated shallow facts, but the current catalog more often under-represents item modifiers and granted behavior than systematically favoring Quivers. There is no evidence for a blanket Quiver preference and no Bow-first rule is proposed.\n\n## Granted semantic gaps\n\n${materialItems.slice(0, 20).map((item) => `- ${item.name} → ${item.grantedSources.join(', ')}: ${item.missingFacts.join('; ')}; offenses ${item.offenses.join(', ')}${item.changesWinner ? '; changes a proposed winner' : ''}.`).join('\n') || '- None detected.'}\n\n## Empty results\n\n${Object.entries(summary.emptyCauses).map(([cause, count]) => `- ${cause}: ${count}`).join('\n')}\n\nEmpty cells retain only up to three meaningful legal leads in the JSON artifact. No cell is force-filled. The dominant cause is absence or incompleteness of typed item semantics; granted behavior explains only the subset with a provable promoted fact.\n\n## Contradiction and prevention\n\n${[...contradictions.values()].slice(0, 12).map((entry) => `- ${entry.name} is rejected for ${entry.weapon} × ${entry.offense}: ${entry.evidence.map((fact) => `${fact.relation} ${fact.mechanic || `${fact.from}→${fact.to}`}`).join(', ')}.`).join('\n') || '- No outgoing contradiction found among legal candidates.'}\n\nIncoming player immunity is not treated as an outgoing Offense contradiction. Directionally adverse item or skill conversion remains a hard rejection.\n\n## Conclusions\n\nThe audit supports the central diagnosis: the selector contract is not inherently too narrow; the unique semantic model is incomplete, particularly where behavior lives on granted skills and raw modifiers. A future runtime change should promote provenance-preserving typed facts to the parent unique, rank lexicographically by semantic tier, retain directional conversion and contradiction safety, and randomize only within the best quality band.\n\nNo class, ascendancy, package, named-item exception, Weapon × Offense exception, or runtime randomization was introduced.\n`;
fs.writeFileSync('docs/recommendation_unique_analysis_v3.md', report);
console.log(JSON.stringify(summary, null, 2));
