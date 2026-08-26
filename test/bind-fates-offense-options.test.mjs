import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const {
  getBindFatesOffenseOptions,
  getCoreBuildOffenseOptions
} = await import('../js/offense-options.js');

const data = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url), 'utf8'));

test('Bind the Fates exposes exactly the core Build offense option set', () => {
  const coreOptions = getCoreBuildOffenseOptions(data);

  assert.deepEqual(getBindFatesOffenseOptions(data), coreOptions);
  assert.deepEqual(
    coreOptions.map(({ name, kind }) => [name, kind]),
    [
      ['Freeze', 'ailment'],
      ['Ignite', 'ailment'],
      ['Shock', 'ailment'],
      ['Poison', 'ailment'],
      ['Bleed', 'ailment'],
      ['Heavy Stun', 'tactic'],
      ['Armour Break', 'tactic'],
      ['Critical Hit', 'tactic'],
      ['Totems', 'tactic'],
      ['Warcry', 'tactic'],
      ['Marks', 'tactic'],
      ['Curses', 'tactic'],
      ['Minions', 'tactic'],
      ['Companions', 'tactic'],
      ['Thorns', 'tactic'],
      ['Culling Strike', 'tactic'],
      ['Slow/Maim/Hinder', 'tactic'],
      ['Chaos Damage', 'tactic']
    ]
  );
});
