import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const snapshots = readFileSync(new URL('../js/00-locks-and-snapshots.js', import.meta.url), 'utf8');
const stage = readFileSync(new URL('../js/24-primary-card-stage.js', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../js/25-card-polish.js', import.meta.url), 'utf8');

test('saved primary-card actions render a filled star', () => {
  assert.match(stage, /saved \? '★' : '☆'/);
  assert.match(stage, /data-card-action="challenge-save"[^\n]+saved \? '★' : '☆'/);
  assert.match(stage, /RandomancerIsBuildSaved\?\.\(snapshot\) === true/);
  assert.match(stage, /RandomancerIsChallengeSaved\?\.\(contract\) === true/);
  assert.doesNotMatch(stage, /function isSavedBuild\([^}]+build-actions-save/);
  assert.match(snapshots, /window\.RandomancerIsBuildSaved = isBuildSaved/);
  assert.match(snapshots, /window\.RandomancerIsChallengeSaved = isChallengeSaved/);
});

test('saved and linked card restores arm the standard card animation', () => {
  assert.match(snapshots, /applyChallengeCode[\s\S]*?randomancer:card-restore-start/);
  assert.match(snapshots, /applyBuildCode[\s\S]*?randomancer:card-restore-start/);
  assert.match(snapshots, /openSharedCardBySlug[\s\S]*?randomancer:card-restore-start/);
  assert.match(snapshots, /autoLoadFromQuery[\s\S]*?requestAnimationFrame/);
  assert.match(stage, /randomancer:card-restore-start'[\s\S]*?armDrawAnimation\(\{ forceFresh: true \}\)/);
});

test('new copied build links contain the canonical snapshot', () => {
  assert.match(polish, /RandomancerEncodeSnapshot\?\.\(snapshot\) \|\| encodeCompactBuildSnapshot/);
  assert.match(snapshots, /short-lived compact-link implementation/);
});
