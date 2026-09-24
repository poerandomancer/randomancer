import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const snapshots = readFileSync(new URL('../js/00-locks-and-snapshots.js', import.meta.url), 'utf8');
const stage = readFileSync(new URL('../js/24-primary-card-stage.js', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../js/25-card-polish.js', import.meta.url), 'utf8');
const foundation = readFileSync(new URL('../js/23-build-card-foundation.js', import.meta.url), 'utf8');
const summaryView = readFileSync(new URL('../js/02-summary-view.js', import.meta.url), 'utf8');

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
  assert.match(snapshots, /autoLoadFromQuery[\s\S]*?requestAnimationFrame/);
  assert.match(stage, /randomancer:card-restore-start'[\s\S]*?armDrawAnimation\(\{ forceFresh: true \}\)/);
});

test('new copied build links contain the canonical snapshot', () => {
  assert.match(polish, /RandomancerEncodeSnapshot\?\.\(snapshot\) \|\| encodeCompactBuildSnapshot/);
  assert.match(snapshots, /short-lived compact-link implementation/);
});

test('compact build snapshots preserve required keystones in the decoder p.k field', async () => {
  globalThis.document = { readyState: 'loading', addEventListener() {} };
  globalThis.window = {};
  const { buildCompactSnapshotPayload } = await import('../js/25-card-polish.js');
  const payload = buildCompactSnapshotPayload({
    className: 'Monk',
    passives: {
      ascendancyNodes: [{ name: 'I Am the Blizzard' }],
      keystones: [{ name: 'Hollow Palm Technique', required: true, coreSolver: true }],
      notables: [{ name: 'Cold Nature' }]
    }
  });
  assert.deepEqual(payload.p.k, [{ name: 'Hollow Palm Technique' }]);
  const transported = JSON.parse(Buffer.from(JSON.stringify(payload)).toString('utf8'));
  const decodedPassives = {
    ascendancyNodes: transported.p.a || [],
    keystones: transported.p.k || [],
    notables: transported.p.n || []
  };
  assert.deepEqual(decodedPassives.keystones, [{ name: 'Hollow Palm Technique' }]);
  assert.match(snapshots, /keystones: draw\.p\.k \|\| \[\]/);
});

test('primary Build Ideas tooltips use enriched skill and unique fields', () => {
  assert.match(foundation, /gem\?\.crafting_type/);
  assert.match(foundation, /gem\?\.crafting\?\.types_raw/);
  assert.match(foundation, /found\?\.requirements/);
  assert.match(foundation, /found\?\.flavour_text/);
  assert.match(foundation, /modifiers: cleanTooltipLines/);
  assert.match(foundation, /data-tip-payload/);
  assert.match(foundation, /rc-tooltip__requirements/);
  assert.match(foundation, /rc-tooltip__flavour/);
  assert.match(foundation, /rc-tooltip__modifiers/);
  assert.match(polish, /tipPayload[\s\S]*?synergy/);
});

test('Build Ideas tooltip ownership is cleared across card renders', () => {
  assert.match(summaryView, /function setOverlayContent[\s\S]*?hideCardTooltip\(\);[\s\S]*?body\.innerHTML =/);
  assert.match(summaryView, /if \(!target\?\.isConnected\) return/);
  assert.match(summaryView, /target !== tooltipTarget/);
  assert.match(summaryView, /tooltipTarget && !tooltipTarget\.isConnected/);
  assert.match(summaryView, /if \(tooltipTarget === el\) hideCardTooltip\(\)/);
});

test('build cards present an in-card flip CTA without duplicate keyboard flips', () => {
  for (const source of [foundation, summaryView]) {
    assert.match(source, /FLIP CARD FOR BUILD IDEAS/);
    assert.match(source, /Skills · Supports · Passives · Uniques/);
    assert.match(source, /Return to Build/);
    assert.doesNotMatch(source, /card-flip-indicator/);
    assert.doesNotMatch(source, /rc-card__fineprint/);
    assert.match(source, /event\.target !== surface|evt\.target !== flipSurface/);
  }

  const rows = foundation.indexOf('model.frontRows.filter');
  const cta = foundation.indexOf('${renderFlipCta(false)}', rows);
  const balance = foundation.indexOf('${renderBalance(model.balance)}', cta);
  assert.ok(rows < cta && cta < balance, 'front CTA must render after build rows and before Balance');
});
