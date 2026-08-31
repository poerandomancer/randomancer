import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecommendationAudit } from '../scripts/recommendation-audit-lib.mjs';

test('recommendation audit is deterministic and covers the complete rollable matrix twice', async () => {
  const first = await generateRecommendationAudit();
  const second = await generateRecommendationAudit();
  assert.deepEqual(second, first);
  assert.equal(first.summary.totalCases, 270);
  assert.equal(Object.keys(first.summary.countByWeapon).length, 9);
  assert.equal(Object.keys(first.summary.countByOffense).length, 15);
  assert.equal(Object.keys(first.summary.countByAscendancy).length, 23);
  assert.ok(Object.values(first.summary.countByWeapon).every((count) => count === 30));
  assert.ok(Object.values(first.summary.countByOffense).every((count) => count === 18));
  assert.ok(Object.values(first.summary.countByAscendancy).every((count) => count >= 11));
});
