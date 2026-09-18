import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getPendingSnapshotReadiness } from '../js/primary-card-roll-freshness.js';

const FALLBACK_MS = 1200;
const stageSource = await readFile(new URL('../js/24-primary-card-stage.js', import.meta.url), 'utf8');

function readiness({ startIdentity = 'old', latestIdentity = 'new', source = 'replace', elapsed = 20 } = {}) {
  return getPendingSnapshotReadiness({
    startIdentity,
    latestSource: source,
    startedAt: 100
  }, latestIdentity, 100 + elapsed, FALLBACK_MS);
}

test('a replacement snapshot with a different identity is ready for normal reveal', () => {
  assert.deepEqual(readiness(), { ready: true, retryAfter: null });
});

test('a replacement snapshot with the same identity is ready without the roll timeout', () => {
  assert.deepEqual(readiness({ latestIdentity: 'old' }), { ready: true, retryAfter: null });
});

test('repeated Fate-constrained replacement draws remain ready when their identities repeat', () => {
  const fateIdentity = JSON.stringify(['Repeated Name', 'Ranger', 'Deadeye', 'Bow', 'Fire']);
  for (let draw = 0; draw < 25; draw += 1) {
    assert.equal(readiness({
      startIdentity: fateIdentity,
      latestIdentity: fateIdentity,
      source: 'replace',
      elapsed: draw
    }).ready, true);
  }
});

test('same-identity non-replacement fallback requests its threshold and then resolves', () => {
  assert.deepEqual(readiness({ latestIdentity: 'old', source: 'merge', elapsed: 200 }), {
    ready: false,
    retryAfter: 1000
  });
  assert.deepEqual(readiness({ latestIdentity: 'old', source: 'merge', elapsed: FALLBACK_MS }), {
    ready: true,
    retryAfter: null
  });
  assert.match(stageSource, /freshnessTimer = window\.setTimeout\(\(\) => \{[\s\S]*?maybeRevealPendingRoll\(\);[\s\S]*?\}, readiness\.retryAfter\);/);
});
