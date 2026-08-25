#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  classifyNativeOffenseCoverageV3,
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3
} from '../../js/30-recommendation-v3-selector.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const catalog = mergeRecommendationGrantedSkillAccessV3(
  mergeRecommendationSkillCraftingV3(
    await load('data/enriched/recommendation_catalog_v3.json'),
    await load('data/enriched/recommendation_skill_crafting_v3.json')
  ),
  await load('data/enriched/recommendation_granted_skill_access_v3.json')
);
const offenseInventory = await load('data/offense-inventory.json');
const core = await load('data/core-data.json');
const familyName = (name) => String(name).replace(/^(?:one|two)[- ]handed\s+/i, '');
const weaponFamilies = [...new Set([
  ...(core.Weapons?.['Two-Handed'] || []),
  ...(core.Weapons?.['One-Handed'] || [])
].map((entry) => familyName(entry.name)))].sort();
const offenses = offenseInventory.elements.filter((entry) => entry.id !== 'critical_hits');

const cells = weaponFamilies.flatMap((weaponFamily) => offenses.map((offense) => {
  const result = classifyNativeOffenseCoverageV3(catalog, {
    weapon: weaponFamily,
    offense: offense.id,
    offenseList: [offense.id]
  }, { offenseInventory });
  return {
    weaponFamily,
    offense: { id: offense.id, name: offense.name },
    classification: result.classification,
    directCandidates: result.directCandidates,
    carrierCandidates: result.carrierCandidates,
    counts: {
      direct: result.directCandidates.length,
      carrier: result.carrierCandidates.length
    }
  };
}));
const classifications = ['DIRECT', 'CARRIER', 'GAP'];
const totals = Object.fromEntries(classifications.map((kind) => [kind, cells.filter((cell) => cell.classification === kind).length]));
const byWeapon = Object.fromEntries(weaponFamilies.map((weapon) => [weapon,
  Object.fromEntries(classifications.map((kind) => [kind, cells.filter((cell) => cell.weaponFamily === weapon && cell.classification === kind).length]))
]));
const artifact = {
  schemaVersion: 'weapon-offense-coverage-v3.0.0',
  inputs: { weaponCount: weaponFamilies.length, offenseCount: offenses.length, combinationCount: cells.length },
  totals,
  byWeapon,
  cells
};
await writeFile(resolve(root, 'data/enriched/weapon_offense_coverage_v3.json'), `${JSON.stringify(artifact, null, 2)}\n`);

const lines = [
  '# Weapon × Offense native coverage v3', '',
  `Generated deterministically from the recommendation catalog and runtime legality rules. **${cells.length} combinations**: ${classifications.map((kind) => `${kind} ${totals[kind]}`).join(', ')}.`, '',
  '## Coverage by weapon', '',
  '| Weapon | DIRECT | CARRIER | GAP |', '|---|---:|---:|---:|',
  ...weaponFamilies.map((weapon) => `| ${weapon} | ${byWeapon[weapon].DIRECT} | ${byWeapon[weapon].CARRIER} | ${byWeapon[weapon].GAP} |`), '',
  '## DIRECT cells', ''
];
for (const weapon of weaponFamilies) {
  lines.push(`### ${weapon}`, '');
  const direct = cells.filter((cell) => cell.weaponFamily === weapon && cell.classification === 'DIRECT');
  lines.push(...(direct.length ? direct.map((cell) => `- **${cell.offense.name}:** ${cell.directCandidates.map((skill) => skill.name).join(', ')}`) : ['- None']), '');
}
lines.push('## Review signals', '');
for (const weapon of weaponFamilies) {
  const direct = byWeapon[weapon].DIRECT;
  if (direct <= 2 || direct >= 13) lines.push(`- ${weapon} has ${direct}/15 DIRECT cells (${direct <= 2 ? 'unexpectedly narrow' : 'unexpectedly broad'}).`);
}
for (const cell of cells.filter((entry) => entry.counts.direct >= 20)) {
  lines.push(`- ${cell.weaponFamily} + ${cell.offense.name} has ${cell.counts.direct} direct candidates; review unusually broad coverage.`);
}
if (lines.at(-1) === '') lines.push('- No threshold-based review signals.');
await writeFile(resolve(root, 'data/enriched/weapon_offense_coverage_v3_report.md'), `${lines.join('\n')}\n`);
