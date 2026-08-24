import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { selectBuildName, weaponDisplayName } from '../js/build-name.js';

const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');

test('single-Offense names are evocative and vary within an offense family', () => {
  const context = { ascendancy: 'Deadeye', weapon: 'Spear', offense: 'Shock' };
  const names = [0, 0.4, 0.8].map((roll) => selectBuildName({ ...context, random: () => roll }));

  assert.equal(new Set(names).size, 3);
  for (const name of names) {
    assert.notEqual(name, 'Deadeye Spear of Shock');
    assert.doesNotMatch(name, /undefined|\s{2,}|\sof\s*$/i);
  }
});

test('related Offense concepts share fitting naming templates', () => {
  assert.equal(selectBuildName({ ascendancy: 'Invoker', weapon: 'Quarterstaff', offense: 'Freeze', random: () => 0 }), 'The Frostbound Quarterstaff');
  assert.equal(selectBuildName({ ascendancy: 'Pathfinder', weapon: 'Bow', offense: 'Poison', random: () => 0 }), 'The Venom-Touched Bow');
  assert.equal(selectBuildName({ ascendancy: 'Witch Hunter', weapon: 'Crossbow', offense: 'Minions', random: () => 0 }), 'The Many-Handed Omen');
});

test('build naming normalizes known weapon labels and safely handles incomplete context', () => {
  assert.equal(weaponDisplayName('  sceptre '), 'Sceptre');
  assert.equal(selectBuildName({ weapon: 'Wand', offense: 'Arcane', random: () => 0 }), 'The Arcane Wand');
  assert.equal(selectBuildName({}), 'The Unwritten Fate');
});

test('draw construction stores the selected build name in its snapshot', () => {
  assert.match(engineSource, /buildName:\s*selectBuildName\(/);
  assert.doesNotMatch(engineSource, /`\$\{identity\.ascendancy\} \$\{weapon\.name\} of/);
});
