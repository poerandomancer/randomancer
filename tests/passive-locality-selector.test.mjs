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
