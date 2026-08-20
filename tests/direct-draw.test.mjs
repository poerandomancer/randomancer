import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const offense = await import('../js/26-offense-roll.js');
const equipment = await import('../js/06-equipment.js');
const inventory = JSON.parse(await readFile(new URL('../data/offense-inventory.json', import.meta.url)));
const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const entry = await readFile(new URL('../core-script.js', import.meta.url), 'utf8');

test('canonical Offense draw contains one or two concepts', () => {
  const one = offense.selectOffense({ data: { OffenseInventory: inventory }, count: 1, random: () => 0 });
  const two = offense.selectOffense({ data: { OffenseInventory: inventory }, count: 2, random: () => 0 });
  assert.equal(one.picks.length, 1); assert.equal(two.picks.length, 2);
});

test('Critical Hits is excluded from standard draws', () => {
  assert.equal(offense.isRollableOffense({ id: 'critical_hits', name: 'Critical Hits' }), false);
});

test('a draw cannot contain two Archetypes', () => {
  const result = offense.selectOffense({ data: { Offense: [{ id: 'a', name: 'A', category: 'Archetype' }, { id: 'b', name: 'B', category: 'Archetype' }, { id: 'c', name: 'C' }] }, count: 2, random: () => 0 });
  assert.equal(result.picks.filter(offense.isArchetype).length, 1);
});

test('Bind the Fates favors and bans canonical Offense', () => {
  const data = { Offense: [{ id: 'fire', name: 'Fire' }, { id: 'cold', name: 'Cold' }] };
  const result = offense.selectOffense({ data, count: 1, bindFates: { combat: { oaths: ['Cold'], abominations: ['Fire'] } }, random: () => 0 });
  assert.equal(result.picks[0].name, 'Cold');
});

test('weapon-family derivation collapses handed variants', () => {
  const families = equipment.deriveWeaponFamilies(core);
  assert.equal(new Set(families.map((family) => family.name)).size, families.length);
  assert.ok(families.some((family) => family.aliases.length > 1));
});

test('weapon-family Bind the Fates honors legality', () => {
  const families = [{ name: 'Bow' }, { name: 'Wand' }];
  assert.equal(equipment.pickWeaponFamily(families, { oaths: ['Wand'], abominations: ['Bow'] }, () => 0).name, 'Wand');
});

test('standard engine invokes the package selector directly', () => {
  assert.match(engineSource, /selectRecommendationPackageV3\(catalog, draw/);
  assert.match(engineSource, /randomancer:draw-complete/);
});

test('canonical draw has no obsolete standard fields', () => {
  const stateSource = engineSource.slice(engineSource.indexOf("schema: 'randomancer-draw-v1'"), engineSource.indexOf('const catalog'));
  assert.doesNotMatch(stateSource, /weapon2|offhand2|ailmentSet|tacticSet|defStrat|rollAttr/);
});

test('obsolete standard controls and migration runtimes are absent', () => {
  assert.doesNotMatch(html, /weapon-set2-toggle|mechanics-count-btn|id="ailments"|id="tactics"/);
  assert.doesNotMatch(entry, /27-offense-runtime|28-primary-equipment-runtime|29-selection-frequency-runtime|31-recommendation-v3-runtime/);
});

test('Challenge, Codex, and supported Legacy modes remain mounted', () => {
  for (const id of ['challenge-panel', 'codex-panel', 'legacy-panel']) assert.match(html, new RegExp(`id="${id}"`));
});
