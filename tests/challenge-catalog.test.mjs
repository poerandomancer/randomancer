import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { minSeverityAllowed } from '../js/challenge-difficulty.js';
import { deriveWeaponFamilies } from '../js/06-equipment.js';

const tasks = JSON.parse(await readFile(new URL('../data/challenge_tasks.json', import.meta.url)));
const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const challengeEngineSource = await readFile(new URL('../js/15-challenge-engine.js', import.meta.url), 'utf8');
const contractsSource = await readFile(new URL('../js/contracts.js', import.meta.url), 'utf8');
const byId = new Map(tasks.map(task => [task.id, task]));

test('challenge catalog has the expected roles and minimum tiers', () => {
  const count = (role, minSeverity) => tasks.filter(task =>
    (!role || task.role === role) && (!minSeverity || task.minSeverity === minSeverity)
  ).length;

  assert.equal(tasks.length, 46);
  assert.equal(count('anchor'), 10);
  assert.equal(count('twist'), 36);
  assert.deepEqual(['mild', 'cruel', 'diabolical'].map(tier => count(null, tier)), [20, 16, 10]);
  assert.deepEqual(['mild', 'cruel', 'diabolical'].map(tier => count('anchor', tier)), [5, 2, 3]);
  assert.deepEqual(['mild', 'cruel', 'diabolical'].map(tier => count('twist', tier)), [15, 14, 7]);
});

test('difficulty eligibility includes every lower minimum tier', () => {
  assert.deepEqual(tasks.filter(task => minSeverityAllowed('mild', task.minSeverity)).length, 20);
  assert.deepEqual(tasks.filter(task => minSeverityAllowed('cruel', task.minSeverity)).length, 36);
  assert.deepEqual(tasks.filter(task => minSeverityAllowed('diabolical', task.minSeverity)).length, 46);
});

test('cadence configuration drives the finalized challenge compositions', () => {
  assert.match(contractsSource, /cadence: 'daily', severity: 'mild', composition: \['anchor', 'twist'\]/);
  assert.match(contractsSource, /cadence: 'weekly', severity: 'cruel', composition: \['anchor', 'twist', 'twist'\]/);
  assert.match(contractsSource, /cadence: 'monthly', severity: 'diabolical', composition: \['anchor', 'twist', 'twist'\]/);
  assert.match(contractsSource, /generateChallengeContract\(\{severity:config\.severity,composition:config\.composition,random:seededRandom\(seed\)\}\)/);
  assert.match(challengeEngineSource, /const rolePlan = composition;/);
});

test('catalog cleanup and changed minimum tiers remain enforced', () => {
  for (const id of [
    'A9_shapeshift_forms_only',
    'G2_default_weapon_skill_only',
    'J1_attribute_nodes_only',
    'SF1_skill_family_damage_only'
  ]) assert.equal(byId.has(id), false);

  for (const id of [
    'A5_class_plus_zero_defense',
    'A6_class_weapon_and_zero_defense',
    'A12_class_skill_family_and_defense',
    'O2_one_damage_skill_only',
    'S5_zero_element_resist'
  ]) assert.equal(byId.get(id)?.minSeverity, 'diabolical');
  assert.equal(byId.get('A8_class_plus_active_skill')?.minSeverity, 'cruel');
  assert.equal(byId.get('O1_two_damage_skills_max')?.minSeverity, 'cruel');
});

test('Unwarded conflicts with anchors marked as explicit Ascendancy choices', () => {
  const anchor = byId.get('A14_ascendancy_plus_unique_granted_skill');
  const unwarded = byId.get('S5_zero_element_resist');
  assert.ok(anchor.domainTags.includes('explicit_ascendancy'));
  assert.ok(unwarded.conflicts.some(conflict =>
    conflict.level === 'hard' && conflict.with?.domainTag === 'explicit_ascendancy'
  ));
  assert.ok(!byId.get('A4_class_plus_weapon').domainTags.includes('explicit_ascendancy'));
});

test('challenge weapons come only from the canonical Build weapon-family source', () => {
  const familyNames = deriveWeaponFamilies(core).map(weapon => weapon.name);

  assert.ok(familyNames.includes('Mace'));
  assert.ok(!familyNames.includes('Unarmed'));
  assert.ok(!familyNames.includes('Empty Off-hand'));
  assert.match(challengeEngineSource, /deriveWeaponFamilies\(core\)/);
  assert.doesNotMatch(challengeEngineSource, /Weapon Set I|Weapon Set II|dualChance/);
  assert.doesNotMatch(challengeEngineSource, /weaponLoadout\.push\(['"](?:Unarmed|Empty Off-hand)/);
});
