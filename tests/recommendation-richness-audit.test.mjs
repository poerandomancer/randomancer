import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecommendationRichnessAudit } from '../scripts/recommendation-richness-audit-lib.mjs';

test('richness audit is deterministic, compact, and uses the canonical corpus', async () => {
  const first = await generateRecommendationRichnessAudit();
  const second = await generateRecommendationRichnessAudit();
  assert.deepEqual(second, first);
  assert.equal(first.summary.totalCases, 270);
  assert.equal(first.cases[0].id, 'AUDIT-001');
  assert.equal(first.cases.at(-1).id, 'AUDIT-270');
  assert.ok(first.cases.every((item) => item.depth.skills.strongest.length <= 5));
  assert.ok(first.cases.every((item) => item.depth.passives.strongest.length <= 5));
  assert.ok(first.cases.flatMap((item) => item.depth.optionalSupports).every((item) => item.strongest.length <= 5));
});
