import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3,
  selectRecommendationPackageV3
} from '../js/30-recommendation-v3-selector.js';

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url)));
const auditUrl = new URL('../data/enriched/weapon_offense_coverage_v3.json', import.meta.url);
const inventory = await load('../data/offense-inventory.json');
const catalog = mergeRecommendationGrantedSkillAccessV3(
  mergeRecommendationSkillCraftingV3(
    await load('../data/enriched/recommendation_catalog_v3.json'),
    await load('../data/enriched/recommendation_skill_crafting_v3.json')
  ),
  await load('../data/enriched/recommendation_granted_skill_access_v3.json')
);
const audit = await load('../data/enriched/weapon_offense_coverage_v3.json');
const cell = (weapon, offense) => audit.cells.find((entry) => entry.weaponFamily === weapon && entry.offense.id === offense);

test('audit contains exactly the 135 unique live combinations and excludes Critical Hits', () => {
  assert.equal(audit.cells.length, 135);
  assert.equal(new Set(audit.cells.map((entry) => `${entry.weaponFamily}:${entry.offense.id}`)).size, 135);
  assert.equal(audit.cells.some((entry) => entry.offense.id === 'critical_hits'), false);
});

test('native coverage distinguishes direct damage, direct ailments, carriers, and gaps', () => {
  assert.equal(cell('Bow', 'cold').classification, 'DIRECT');
  assert.ok(cell('Bow', 'cold').directCandidates.some((skill) => skill.name === 'Ice Shot'));
  assert.equal(cell('Spear', 'bleed').classification, 'DIRECT');
  assert.ok(cell('Spear', 'bleed').directCandidates.some((skill) => skill.name === 'Rake'));
  assert.equal(cell('Bow', 'ignite').classification, 'CARRIER');
  assert.equal(cell('Bow', 'ignite').directCandidates.length, 0, 'fire damage alone must not fulfill Ignite');
  assert.ok(cell('Bow', 'ignite').carrierCandidates.some((skill) => skill.name === 'Gas Arrow'));
  assert.equal(cell('Mace', 'cold').classification, 'GAP');
});

test('every DIRECT cell contains legal semantic evidence', () => {
  for (const entry of audit.cells.filter((candidate) => candidate.classification === 'DIRECT')) {
    assert.ok(entry.directCandidates.length > 0);
    assert.ok(entry.directCandidates.every((skill) => skill.evidence.length > 0));
  }
});

test('coverage generation is byte-for-byte deterministic', async () => {
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const before = await readFile(auditUrl);
  execFileSync(process.execPath, ['data/helperScripts/generate_weapon_offense_coverage_v3.mjs'], { cwd: new URL('..', import.meta.url) });
  const after = await readFile(auditUrl);
  assert.equal(hash(after), hash(before));
});

test('runtime stops at the hard DIRECT tier', () => {
  const result = selectRecommendationPackageV3(catalog, {
    weapon: 'Spear', offense: 'bleed', offenseList: ['bleed']
  }, { offenseInventory: inventory, selectionSeed: 'direct-tier-regression' });
  assert.equal(result.diagnostics.recommendationTier, 'DIRECT');
  assert.equal(result.supportingSkill, null);
  assert.ok(result.primarySkill.fulfilledObligations.some((proof) => proof.obligationId === 'offense:bleed'));
});

test('runtime retains fallback package behavior without a native DIRECT skill', () => {
  const result = selectRecommendationPackageV3(catalog, {
    weapon: 'Bow', offense: 'ignite', offenseList: ['ignite']
  }, { offenseInventory: inventory, selectionSeed: 'fallback-tier-regression' });
  assert.equal(result.diagnostics.recommendationTier, 'FALLBACK');
  assert.ok(result.primarySkill);
});
