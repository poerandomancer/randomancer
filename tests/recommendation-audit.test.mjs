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
  assert.equal(first.schemaVersion, 2);
  assert.equal(Object.values(first.summary.solutionClass).reduce((sum, count) => sum + count, 0), 270);
  assert.ok(first.cases.every((item) => item.recommendations.packageProfile));
  assert.ok(first.summary.packagesUsingRequiredSecondarySkill > 0);
  assert.ok(first.cases.every((item) => {
    const identities = item.recommendations.uniques.map((entry) => entry.id);
    return new Set(identities).size === identities.length;
  }));
  assert.ok(first.cases.every((item) => !item.recommendations.bridgePath.some((edge) =>
    (edge.provider === 'The Pandemonius' && edge.to === 'chill')
    || (edge.provider === 'Coat of Red' && edge.to === 'bleed'))));
  assert.ok(first.cases.filter((item) => item.recommendations.requiredUnique).every((item) =>
    item.recommendations.coreSolverPieces.filter((piece) => piece.role === 'unique_bridge').every((piece) =>
      item.recommendations.uniques.filter((entry) => entry.name === piece.name).length === 1)));
});
