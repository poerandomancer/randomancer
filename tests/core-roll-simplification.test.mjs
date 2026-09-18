import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const offenseSource = await readFile(new URL('../js/26-offense-roll.js', import.meta.url), 'utf8');
const testableOffenseSource = offenseSource.replace(
  "import { cohesionThreshold, pickByCohesion } from './06-cohesion.js';",
  'const cohesionThreshold = 0; const pickByCohesion = (pool) => pool[0] || null;'
);
const offenseModule = await import(`data:text/javascript;base64,${Buffer.from(testableOffenseSource).toString('base64')}`);

test('Critical Hits remains available as data but cannot be rolled as Offense', () => {
  const criticalHits = { id: 'critical_hits', name: 'Critical Hits', category: 'Scaling' };
  const totems = { id: 'totems', name: 'Totems', category: 'Archetype' };
  const data = { Offense: [criticalHits, totems] };

  assert.equal(offenseModule.resolveOffenseElements(data).includes(criticalHits), true);
  assert.equal(offenseModule.isRollableOffense(criticalHits), false);
  assert.equal(offenseModule.isRollableOffense(totems), true);
  assert.deepEqual(offenseModule.selectOffense({ data }).picks, [totems]);
});

test('standard UI has no Cohesion or randomized defense controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="cohesionRange"/);
  assert.doesNotMatch(html, /id="defense"/);
  assert.doesNotMatch(html, /id="defstrat"/);
  assert.doesNotMatch(html, /data-category="defensiveStrategy"/);
});


test('runtime graph excludes retired rules, pre-gate, and scorer systems', async () => {
  const core = await readFile(new URL('../core-script.js', import.meta.url), 'utf8');
  for (const retiredModule of ['03-config-and-schema', '05-tags-and-scorer', '11-pre-gate-and-sync']) {
    assert.doesNotMatch(core, new RegExp(retiredModule));
  }

  const appState = await readFile(new URL('../js/04-app-state.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appState, /\b(?:Config|RulesEngine|validateAndFix|singleEntryMode)\b/);
  assert.doesNotMatch(appState, /window\.SKILLS/);

  const skillsRenderer = await readFile(new URL('../js/07-skills-render.js', import.meta.url), 'utf8');
  assert.doesNotMatch(skillsRenderer, /\b(?:TAG_IDF|scoreGemSynergy|rollRecommendedSkills)\b/);
});
