import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const {
  getBindFatesWeaponOptions,
  getCoreBuildWeaponCategories,
  weaponMatchesCategory
} = await import('../js/weapon-categories.js');

const data = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url), 'utf8'));
const expectedCategories = [
  'Mace',
  'Quarterstaff',
  'Bow',
  'Crossbow',
  'Staff',
  'Talisman',
  'Wand',
  'Sceptre',
  'Spear'
];

test('Bind the Fates exposes exactly the core Build weapon categories', () => {
  const coreCategories = getCoreBuildWeaponCategories(data);

  assert.deepEqual(coreCategories, expectedCategories);
  assert.deepEqual(getBindFatesWeaponOptions(data), coreCategories);
});

test('the canonical Mace binding selects both core Mace inventory variants', () => {
  assert.equal(weaponMatchesCategory({ name: 'One-handed Mace' }, 'Mace'), true);
  assert.equal(weaponMatchesCategory({ name: 'Two-handed Mace' }, 'Mace'), true);
  assert.equal(weaponMatchesCategory({ name: 'Quarterstaff' }, 'Mace'), false);
});
