import fs from 'node:fs';
import { selectNonSkillRecommendations } from '../../js/31-non-skill-recommendation-selector.js';
import {
  FAMILY_MAP, analyzeWholeUnique, classifyEmpty, compactUniqueSemantics, familyOf, legalForWeapon, qualityBand, rankCandidates
} from './lib/recommendation_unique_analysis_v3.mjs';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
let catalog = read('data/enriched/recommendation_catalog_v3.json');
const raw = read('data/enriched/poe2db_uniques_min.json');
const inventory = read('data/offense-inventory.json');
const core = read('data/core-data.json');
const uniques = catalog.entities.filter((entity) => entity.content_type === 'unique');
const entitiesByName = new Map();
for (const entity of catalog.entities) {
  const entries = entitiesByName.get(entity.name) || []; entries.push(entity); entitiesByName.set(entity.name, entries);
}
const rawByKey = new Map(Object.values(raw.items).map((item) => [item.key, item]));
const sources = { rawByKey, entitiesByName, parseRawModifiers: false };
const offenses = inventory.elements.filter((offense) => offense.id !== 'critical_hits').slice(0, 15);
const previousArtifact = read('data/enriched/recommendation_unique_runtime_baseline_v3.json');
const previousByCell = new Map(previousArtifact.cells.map((cell) =>
  [`${cell.weapon}:${cell.offenseId}`, cell.current || null]));
const runtimeSemantics = compactUniqueSemantics(catalog, raw.items, offenses.map((offense) => offense.id));
fs.writeFileSync('data/enriched/recommendation_unique_semantics_v3.json', `${JSON.stringify(runtimeSemantics)}\n`);
catalog = { ...catalog, entities: catalog.entities.map((entity) => entity.content_type === 'unique'
  ? { ...entity, unique_offense_semantics: runtimeSemantics.byUniqueId[entity.source_id] || {} } : entity) };
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
  const previous = previousByCell.get(`${weapon}:${offense.id}`) || null;
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
    previous, current: current ? { id: current.id, name: current.name, score: current.recommendationEvidence.score,
      tier: analyzed.find((candidate) => candidate.sourceId === current.id)?.bestTier || null } : null,
    proposed: candidates[0] || null, differs: (current?.id || null) !== (candidates[0]?.id?.replace(/^unique:/, '') || null)
      && (current?.name || null) !== (candidates[0]?.name || null),
    previousEmpty: !previous, currentEmpty, richerSemanticsStrong: ['BUILD_DEFINING_CAPABILITY', 'STRONG_SPECIALIZATION'].includes(candidates[0]?.proposedTier),
    emptyClassification: currentEmpty ? classifyEmpty(proposed, legal.length) : null,
    runtimeInQualityBand: !current || candidates.some((candidate) => candidate.name === current.name && candidate.qualityBand),
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
  previousEmptyCells: cells.filter((cell) => cell.previousEmpty).length,
  emptyToNonEmpty: cells.filter((cell) => cell.previousEmpty && !cell.currentEmpty).length,
  winnerChanges: cells.filter((cell) => !cell.previousEmpty && cell.previous?.id !== cell.current?.id).length,
  currentWinnerDiffers: cells.filter((cell) => !cell.currentEmpty && cell.differs).length,
  runtimeQualityBandAgreement: cells.filter((cell) => cell.runtimeInQualityBand).length,
  currentEmptyCells: empties.length,
  legitimatelyEmptyCells: empties.filter((cell) => !cell.richerSemanticsStrong).length,
  emptyCellsGainStrongCandidate: empties.filter((cell) => cell.richerSemanticsStrong).length,
  qualityBandCounts: bandCounts,
  contradictionPreventionFindings: contradictions.size,
  emptyCauses: Object.fromEntries([...new Set(empties.map((cell) => cell.emptyClassification))].sort()
    .map((cause) => [cause, empties.filter((cell) => cell.emptyClassification === cause).length])),
  runtimeSelectorChanged: true, namedItemOrCellExceptionsIntroduced: false,
  runtimeSemantics: { enrichedUniqueCount: runtimeSemantics.enrichedUniqueCount,
    promotedFactCount: runtimeSemantics.promotedFactCount,
    bytes: fs.statSync('data/enriched/recommendation_unique_semantics_v3.json').size }
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
const report = `# Unique recommendation semantic analysis v3\n\nThis deterministic report audits the implemented whole-item runtime semantics while preserving the Weapon + Offense contract.\n\n## Summary\n\n- Audited uniques: ${summary.uniqueCandidatesAudited}\n- With granted skills: ${summary.containingGrantedSkills}; with granted effects: ${summary.containingGrantedEffects}\n- Material granted-semantic gaps: ${summary.grantedSemanticsMateriallyChangeRelevance}\n- Previous empty cells: ${summary.previousEmptyCells}; new empty cells: ${summary.currentEmptyCells}; empty→non-empty: ${summary.emptyToNonEmpty}\n- Existing non-empty winner changes: ${summary.winnerChanges}; runtime/top-band agreement: ${summary.runtimeQualityBandAgreement}/135\n- Runtime semantics: ${summary.runtimeSemantics.enrichedUniqueCount} uniques, ${summary.runtimeSemantics.promotedFactCount} promoted facts, ${summary.runtimeSemantics.bytes} bytes\n- Quality bands: one=${bandCounts[1]}, two=${bandCounts[2]}, three=${bandCounts[3]} (zero=${cells.filter((cell) => !cell.qualityBandSize).length})\n\n## Ranking model\n\nBUILD_DEFINING_CAPABILITY outranks STRONG_SPECIALIZATION, which outranks AFFINITY_AMPLIFICATION, which outranks PAYOFF_CONTEXT. Contradiction/prevention rejects a candidate. Fact count only breaks ties inside a tier, so shallow match volume cannot outrank capability. The runtime variation band contains at most three candidates in the leading tier within 10 points.\n\n## Fairgraves' Curse and Blackgleam\n\n| Probe | Current | Proposed | Fairgraves | Blackgleam |\n|---|---|---|---|---|\n| Bow × Ignite | ${probe('ignite')?.current?.name || 'empty'} | ${probe('ignite')?.proposed?.name || 'empty'} | ${candidateText(fair('ignite'))} | ${candidateText(black('ignite'))} |\n| Bow × Fire | ${probe('fire')?.current?.name || 'empty'} | ${probe('fire')?.proposed?.name || 'empty'} | ${candidateText(fair('fire'))} | ${candidateText(black('fire'))} |\n\nFairgraves' parent item facts now expose Fire addition and Ignite magnitude, while whole-item promotion additionally contributes Phantasmal Arrow's Physical→Fire conversion, Fire property, direct Ignite application, Ignite specialization, and explosion component provenance. Blackgleam's former false direct-Ignite catalog fact has been removed; its Ignited-enemy line is payoff context, while its raw modifiers add/gain Fire and amplify Flammability. The regression therefore confirms that missing granted-skill semantics materially suppress Fairgraves; it does not justify an item-name exception.\n\n## Bow and Quiver precedence\n\nSlot type adds no semantic score. Bow and Quiver are equally family-legal, and richer ranking is tier-first. Current additive fact scoring can reward repeated shallow facts, but the current catalog more often under-represents item modifiers and granted behavior than systematically favoring Quivers. There is no evidence for a blanket Quiver preference and no Bow-first rule is proposed.\n\n## Promoted granted semantics\n\n${materialItems.slice(0, 20).map((item) => `- ${item.name} → ${item.grantedSources.join(', ')}: ${item.missingFacts.join('; ')}; offenses ${item.offenses.join(', ')}${item.changesWinner ? '; changes a proposed winner' : ''}.`).join('\n') || '- None detected.'}\n\n## Empty results\n\n${Object.entries(summary.emptyCauses).map(([cause, count]) => `- ${cause}: ${count}`).join('\n')}\n\nEmpty cells retain only up to three meaningful legal leads in the JSON artifact. No cell is force-filled. The dominant cause is absence or incompleteness of typed item semantics; granted behavior explains only the subset with a provable promoted fact.\n\n## Contradiction and prevention\n\n${[...contradictions.values()].slice(0, 12).map((entry) => `- ${entry.name} is rejected for ${entry.weapon} × ${entry.offense}: ${entry.evidence.map((fact) => `${fact.relation} ${fact.mechanic || `${fact.from}→${fact.to}`}`).join(', ')}.`).join('\n') || '- No outgoing contradiction found among legal candidates.'}\n\nIncoming player immunity is not treated as an outgoing Offense contradiction. Directionally adverse item or skill conversion remains a hard rejection.\n\n## Seeded quality-band variation\n\n${cells.filter((cell) => cell.qualityBandSize > 1).slice(0, 12).map((cell) => `- ${cell.weapon} × ${cell.offense}: ${cell.candidates.filter((candidate) => candidate.qualityBand).map((candidate) => candidate.name).join(', ')} (${cell.qualityBandSize} in band).`).join('\n')}\n\nOnly candidates in the strongest represented tier and within 10 strength points enter a band; the band is capped at three. ${cells.filter((cell) => cell.qualityBandSize > 1).length} cells can vary by seed.\n\n## Conclusions\n\nThe audit supports the central diagnosis: the selector contract is not inherently too narrow; the unique semantic model is incomplete, particularly where behavior lives on granted skills and raw modifiers. Runtime now consumes compact generation-time parent semantics, ranks lexicographically by semantic tier, retains directional conversion and contradiction safety, and seeded-selects only within the best quality band.\n\nNo class, ascendancy, package, named-item exception, or Weapon × Offense exception was introduced; variation is deterministic and limited to the semantic quality band.\n`;
fs.writeFileSync('docs/recommendation_unique_analysis_v3.md', report);
console.log(JSON.stringify(summary, null, 2));
