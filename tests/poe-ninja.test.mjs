import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { deriveWeaponFamilies, poeNinjaModesByWeaponFamily } from '../js/06-equipment.js';
import { buildPoeNinjaUrl, recommendedSkillNames } from '../js/poe-ninja.js';

const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const expected = {
  Mace: [
    'Mace', 'Mace / Buckler', 'Mace / Focus', 'Mace / Sceptre', 'Mace / Shield', 'Mace / Unknown',
    'Dual Mace', 'Two Handed Mace', 'Two Handed Mace / Buckler', 'Two Handed Mace / Focus',
    'Two Handed Mace / Sceptre', 'Two Handed Mace / Shield', 'Two Handed Mace / Unknown',
    'Dual Two Handed Mace', 'Unknown / Mace', 'Unknown / Two Handed Mace', 'Two Handed Mace / Mace'
  ],
  Quarterstaff: ['Quarterstaff'],
  Bow: ['Bow', 'Bow / Quiver', 'Bow / Unknown', 'Unknown / Quiver'],
  Crossbow: ['Crossbow'],
  Staff: ['Staff', 'Staff / Focus', 'Staff / Unknown'],
  Talisman: ['Talisman', 'Talisman / Sceptre'],
  Spear: ['Spear', 'Spear / Buckler', 'Spear / Focus', 'Spear / Sceptre', 'Spear / Shield', 'Spear / Unknown'],
  Wand: ['Wand', 'Wand / Buckler', 'Wand / Focus', 'Wand / Sceptre', 'Wand / Shield', 'Wand / Unknown'],
  Sceptre: [
    'Sceptre', 'Sceptre / Buckler', 'Sceptre / Focus', 'Sceptre / Shield', 'Sceptre / Unknown',
    'Unknown / Sceptre', 'Wand / Sceptre', 'Spear / Sceptre', 'Mace / Sceptre',
    'Two Handed Mace / Sceptre', 'Talisman / Sceptre'
  ]
};

test('every rollable weapon family has the exact poe.ninja weapon-mode mapping', () => {
  const families = deriveWeaponFamilies(core);
  assert.deepEqual(families.map(({ name }) => name).sort(), Object.keys(expected).sort());
  for (const family of families) {
    assert.ok(family.poeNinjaModes.length > 0, `${family.name} has no modes`);
    assert.deepEqual(family.poeNinjaModes, expected[family.name]);
    assert.deepEqual(poeNinjaModesByWeaponFamily[family.name], expected[family.name]);
  }
});

test('special, Unknown, and full Mace modes remain explicit without ambiguous Unknown modes', () => {
  assert.equal(expected.Mace.length, 17);
  assert.ok(expected.Staff.includes('Staff / Focus'));
  assert.ok(expected.Talisman.includes('Talisman / Sceptre'));
  assert.ok(expected.Bow.includes('Unknown / Quiver'));
  assert.ok(expected.Mace.includes('Unknown / Mace'));
  assert.ok(expected.Sceptre.includes('Unknown / Sceptre'));

  const allModes = Object.values(poeNinjaModesByWeaponFamily).flat();
  for (const ambiguous of ['Unknown', 'Dual Unknown', 'Unknown / Focus', 'Unknown / Shield', 'Unknown / Buckler']) {
    assert.ok(!allModes.includes(ambiguous), `unexpected ambiguous mode: ${ambiguous}`);
  }
});

test('generated URL serializes every selected weapon mode and preserves route, league, and class', () => {
  const url = new URL(buildPoeNinjaUrl({ weapon: 'One-handed Mace', ascendancyName: 'Warbringer' }, 'rise-of-the-abyssal'));
  assert.equal(url.origin + url.pathname, 'https://poe.ninja/poe2/builds/rise-of-the-abyssal');
  assert.equal(url.searchParams.get('class'), 'Warbringer');
  assert.deepEqual(url.searchParams.get('weaponmode').split(','), expected.Mace);
  assert.match(url.search, /weaponmode=Mace%2CMace\+%2F\+Buckler/);
});

test('skill collection handles 0, 1, 2, and 3+ names in deterministic snapshot order', () => {
  const cases = [
    [{}, []],
    [{ recommendedSkills: ['Spark'] }, ['Spark']],
    [{ recommendedSkills: ['Spark', { name: 'Arc' }] }, ['Spark', 'Arc']],
    [{
      recommendedSkills: ['Spark', { name: 'Arc' }],
      recommendedSkills2: [{ name: 'Flame Wall' }],
      recommendedPersistentBuff: 'Herald of Thunder'
    }, ['Spark', 'Arc', 'Flame Wall', 'Herald of Thunder']]
  ];
  for (const [snap, names] of cases) {
    assert.deepEqual(recommendedSkillNames(snap), names);
    assert.deepEqual(new URL(buildPoeNinjaUrl(snap, 'test-league')).searchParams.get('skills')?.split(',') || [], names);
  }
});

test('skills include persistent buffs, discard blanks and duplicates, and exclude supports', () => {
  const snap = {
    weapon: { name: 'Wand' },
    ascendancy: 'Stormweaver',
    recommendedSkills: [{ name: 'Spark', recommendedSupports: [{ name: 'Acceleration' }] }, '  '],
    recommendedSkills2: ['Spark', { name: 'Orb of Storms', synergySupports: ['Arcane Tempo'] }],
    recommendedPersistentBuff: { name: 'Herald of Thunder' },
    synergySupports: [{ name: 'Lightning Mastery' }]
  };
  const url = new URL(buildPoeNinjaUrl(snap, 'test-league'));
  assert.deepEqual(url.searchParams.get('skills').split(','), ['Spark', 'Orb of Storms', 'Herald of Thunder']);
  assert.equal(url.searchParams.get('class'), 'Stormweaver');
  assert.deepEqual(url.searchParams.get('weaponmode').split(','), expected.Wand);
  for (const support of ['Acceleration', 'Arcane Tempo', 'Lightning Mastery']) assert.ok(!url.searchParams.get('skills').includes(support));
});
