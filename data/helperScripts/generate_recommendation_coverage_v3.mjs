import fs from 'node:fs';
import {
  analyzeRecommendationCellV3,
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3
} from '../../js/30-recommendation-v3-selector.js';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const core = read('data/core-data.json');
const offenseInventory = read('data/offense-inventory.json');
let catalog = read('data/enriched/recommendation_catalog_v3.json');
catalog = mergeRecommendationGrantedSkillAccessV3(catalog, read('data/enriched/recommendation_granted_skill_access_v3.json'));
catalog = mergeRecommendationSkillCraftingV3(catalog, read('data/enriched/recommendation_skill_crafting_v3.json'));
const extractedCapabilityPattern = /burst of \[?poison|build(?:s|ing)?(?: up)? \[?electrocut/i;
const baselineCatalog = {
  ...catalog,
  fate_vocabulary: { ...catalog.fate_vocabulary, global_offense_rules: [] },
  entities: catalog.entities.map((entity) => ({
    ...entity,
    facts: entity.facts.filter((fact) => !(['inflicts', 'provides'].includes(fact.relation)
      && fact.evidence?.some((item) => item.kind === 'skill_description'
        && extractedCapabilityPattern.test(item.value || ''))))
  }))
};

const familyName = (weapon) => {
  const tags = new Set(weapon.tags || []);
  if (tags.has('mace')) return 'Mace';
  const tag = ['quarterstaff', 'bow', 'crossbow', 'spear', 'talisman', 'staff', 'wand', 'sceptre']
    .find((entry) => tags.has(entry));
  return tag ? tag[0].toUpperCase() + tag.slice(1) : null;
};
const weapons = [...new Set(['Two-Handed', 'One-Handed'].flatMap((group) => core.Weapons[group] || [])
  .map(familyName).filter(Boolean))];
const offenses = offenseInventory.elements.filter((entry) => entry.id !== 'critical_hits');
const evidence = (candidate, kind) => (candidate[kind] || []).map((proof) =>
  `${proof.relation}:${proof.mechanic}:${proof.confidence}`
).sort();
const cells = [];
const bridgeCells = [];
for (const weapon of weapons) for (const offense of offenses) {
  const snapshot = { weapon, offenseSet: [offense.id] };
  const result = analyzeRecommendationCellV3(catalog, snapshot, { offenseInventory });
  const baseline = analyzeRecommendationCellV3(baselineCatalog, snapshot, { offenseInventory });
  cells.push({
    weapon, offenseId: offense.id, offense: offense.name, classification: result.classification,
    baselineClassification: baseline.classification,
    directCandidates: result.direct.map((candidate) => ({
      id: candidate.entity.id, name: candidate.entity.name,
      proofType: candidate.directKind === 'EXPLICIT_DIRECT' ? 'explicit' : 'inherent',
      evidence: candidate.directProofs.map((proof) => ({
        relation: proof.relation, mechanic: proof.mechanic, confidence: proof.confidence,
        proofType: proof.proofType, globalRule: proof.globalRule || null,
        damageEvidence: proof.damageEvidence || null,
        affinity: proof.affinityFacts.map((fact) => `${fact.relation}:${fact.mechanic}:${fact.confidence}`)
      }))
    })),
    carrierCandidates: result.carriers.map((candidate) => ({
      id: candidate.entity.id, name: candidate.entity.name, evidence: evidence(candidate, 'carriers')
    })),
    counts: { direct: result.direct.length, carrier: result.carriers.length }
  });
  if (result.classification === 'CARRIER') {
    const complete = result.bridges.map((entry) => ({
      carrierId: entry.candidate.entity.id, carrier: entry.candidate.entity.name,
      supportId: entry.support.id, support: entry.support.name,
      family: entry.support.support_family?.name || entry.support.name,
      tier: entry.support.support_family?.tier || null,
      evidence: `${entry.proof.relation}:${entry.proof.mechanic}:${entry.proof.confidence}`
    }));
    bridgeCells.push({
      weapon, offenseId: offense.id, offense: offense.name,
      carriers: result.carriers.map((candidate) => ({ id: candidate.entity.id, name: candidate.entity.name })), complete,
      counts: result.bridgeEvaluations.reduce((sum, item) => ({
        considered: sum.considered + item.considered, complete: sum.complete + item.complete.length,
        partial: sum.partial + item.partial, invalid: sum.invalid + item.invalid
      }), { considered: 0, complete: 0, partial: 0, invalid: 0 }),
      unresolvedReason: complete.length ? null : 'No compatible one-support fact explicitly supplies the missing Offense capability.'
    });
  }
}

const totals = Object.fromEntries(['DIRECT', 'CARRIER', 'GAP']
  .map((key) => [key, cells.filter((cell) => cell.classification === key).length]));
const directCandidateCounts = {
  explicit: cells.flatMap((cell) => cell.directCandidates).filter((candidate) => candidate.proofType === 'explicit').length,
  inherent: cells.flatMap((cell) => cell.directCandidates).filter((candidate) => candidate.proofType === 'inherent').length
};
const changedClassifications = cells.filter((cell) => cell.classification !== cell.baselineClassification)
  .map((cell) => ({ weapon: cell.weapon, offenseId: cell.offenseId, offense: cell.offense, from: cell.baselineClassification, to: cell.classification }));
const newlyExtractedCapabilities = catalog.entities.filter((entity) => entity.content_type === 'active_skill'
  && entity.facts.some((fact) => ['inflicts', 'provides'].includes(fact.relation)
    && fact.evidence?.some((item) => item.kind === 'skill_description' && extractedCapabilityPattern.test(item.value || ''))))
  .map((entity) => entity.name).sort();
const affinityOnlySkills = [...new Set(catalog.entities.filter((entity) => entity.content_type === 'active_skill'
  && entity.facts.some((fact) => fact.relation === 'modifies' && ['bleed', 'poison', 'electrocute'].includes(fact.mechanic))
  && !entity.facts.some((fact) => ['inflicts', 'provides', 'creates'].includes(fact.relation)
    && ['bleed', 'poison', 'electrocute'].includes(fact.mechanic)))
  .map((entity) => entity.name))].sort();
const payload = {
  schemaVersion: 'recommendation-native-coverage-v3.1.0', weapons,
  offenses: offenses.map(({ id, name }) => ({ id, name })), totals, directCandidateCounts,
  changedClassifications, newlyExtractedCapabilities, affinityOnlySkills, cells
};
fs.writeFileSync('data/enriched/recommendation_native_coverage_v3.json', `${JSON.stringify(payload, null, 2)}\n`);
fs.writeFileSync('data/enriched/recommendation_carrier_bridges_v3.json', `${JSON.stringify({ schemaVersion: 'recommendation-carrier-bridges-v3.0.0', cells: bridgeCells }, null, 2)}\n`);

const grouped = (key) => [...new Set(cells.map((cell) => cell[key]))].map((value) => {
  const rows = cells.filter((cell) => cell[key] === value);
  return `| ${value} | ${rows.filter((cell) => cell.classification === 'DIRECT').length} | ${rows.filter((cell) => cell.classification === 'CARRIER').length} | ${rows.filter((cell) => cell.classification === 'GAP').length} |`;
}).join('\n');
const directNames = [...new Set(cells.flatMap((cell) => cell.directCandidates.map((candidate) => candidate.name)))].sort();
const report = `# Recommendation native coverage v3\n\nGenerated by \`make recommendation-coverage\`.\n\n- Weapons: ${weapons.length}\n- Rollable Offenses: ${offenses.length}\n- Cells: ${cells.length}\n- DIRECT: ${totals.DIRECT}\n- CARRIER: ${totals.CARRIER}\n- GAP: ${totals.GAP}\n- EXPLICIT_DIRECT candidates: ${directCandidateCounts.explicit}\n- INHERENT_DIRECT candidates: ${directCandidateCounts.inherent}\n\n## Classification changes from explicit-only semantics\n\n${changedClassifications.map((cell) => `- ${cell.weapon} × ${cell.offense}: ${cell.from} → ${cell.to}`).join('\n') || '- None'}\n\n## Newly extracted explicit capabilities\n\n${newlyExtractedCapabilities.map((name) => `- ${name}`).join('\n') || '- None'}\n\n## Affinity-only skills kept from bootstrapping capability\n\n${affinityOnlySkills.map((name) => `- ${name}`).join('\n') || '- None'}\n\n## By weapon\n\n| Weapon | DIRECT | CARRIER | GAP |\n|---|---:|---:|---:|\n${grouped('weapon')}\n\n## By Offense\n\n| Offense | DIRECT | CARRIER | GAP |\n|---|---:|---:|---:|\n${grouped('offense')}\n\n## Direct skill names\n\n${directNames.map((name) => `- ${name}`).join('\n')}\n\n## CARRIER cells\n\n${bridgeCells.map((cell) => `- ${cell.weapon} × ${cell.offense}: ${cell.carriers.map((candidate) => candidate.name).join(', ')}${cell.complete.length ? `; bridges: ${cell.complete.map((bridge) => `${bridge.carrier} → ${bridge.support}`).join(', ')}` : '; unresolved'}`).join('\n')}\n\n## GAP cells\n\n${cells.filter((cell) => cell.classification === 'GAP').map((cell) => `- ${cell.weapon} × ${cell.offense}`).join('\n')}\n\n## Review notes\n\nCaster-family coverage can be broad because current Staff/Wand/Sceptre delivery legality is intentionally unchanged. Inspect missing explicit facts in the semantic catalog before treating narrow ailment coverage as a runtime defect.\n`;
fs.writeFileSync('docs/recommendation_coverage_v3.md', report);
console.log(JSON.stringify({
  weapons: weapons.length, offenses: offenses.length, cells: cells.length, totals, directCandidateCounts,
  changedClassifications: changedClassifications.length, carrierCells: bridgeCells.length,
  solvedCarrierCells: bridgeCells.filter((cell) => cell.complete.length).length
}, null, 2));
