import assert from 'node:assert/strict';
import test from 'node:test';
import { pickRecommendedNotables } from '../passivesEngine.js';

const nodes = [
  { id: 'near', type: 'notable', tags: ['fire'], passiveTreeStarts: ['str', 'str_dex'] },
  { id: 'opposite', type: 'notable', tags: ['fire'], passiveTreeStarts: ['int', 'dex_int'] },
  { id: 'central', type: 'notable', tags: ['fire'], passiveTreeStarts: ['str', 'dex', 'int', 'str_dex'] },
];
const context = { passiveTreeStart: 'str', tags: ['fire'], defenseTags: [], attributes: {}, cohesionMode: 'strict' };

test('notable locality is a hard class-start gate while tied central nodes remain eligible', () => {
  const picked = pickRecommendedNotables({ nodes }, null, context, 8);
  assert.deepEqual(new Set(picked.map((node) => node.id)), new Set(['near', 'central']));
  assert.ok(!picked.some((node) => node.id === 'opposite'));
});

test('class overrides are hard gates even when selection falls back to fill its count', () => {
  const overrideNodes = [
    { id: 'default', type: 'notable', tags: ['fire'], passiveTreeStarts: ['dex'],
      overriddenForClassIds: [8], overriddenForClasses: ['Huntress'] },
    { id: 'replacement', type: 'notable', tags: ['fire'], passiveTreeStarts: ['dex'],
      classOverride: { characterId: 8, className: 'Huntress' } },
  ];
  const huntress = pickRecommendedNotables({ nodes: overrideNodes }, null,
    { ...context, className: 'Huntress', passiveTreeCharacterId: 8, passiveTreeStart: 'dex' }, 8);
  const ranger = pickRecommendedNotables({ nodes: overrideNodes }, null,
    { ...context, className: 'Ranger', passiveTreeCharacterId: 2, passiveTreeStart: 'dex' }, 8);
  assert.deepEqual(new Set(huntress.map((node) => node.id)), new Set(['replacement']));
  assert.deepEqual(new Set(ranger.map((node) => node.id)), new Set(['default']));
});
