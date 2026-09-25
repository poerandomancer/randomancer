import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

globalThis.window = { DATA: { gems: [], passivesEnriched: { nodes: [] } } };
globalThis.document = { addEventListener() {} };

const { deriveBuildCardModel, renderBuildCard } = await import('../js/23-build-card-foundation.js');
const source = readFileSync(new URL('../js/23-build-card-foundation.js', import.meta.url), 'utf8');

const base = {
  className: 'Monk', ascendancy: 'Invoker', weapon: 'Unarmed', offenseList: ['Companions'],
  attributes: { strength: 0.2, dexterity: 0.4, intelligence: 0.4 }
};

test('single Build Idea renders exactly as before without solution navigation', () => {
  const model = deriveBuildCardModel({ ...base, recommendedSkills: [{ name: 'Tame Beast' }] });
  const html = renderBuildCard(model, { face: 'back' });
  assert.match(html, /Tame Beast/);
  assert.doesNotMatch(html, /solution-next|rc-card-ideas__dots/);
});

test('Build Idea navigation renders whole-package state, controls, and matching dots', () => {
  const model = deriveBuildCardModel({ ...base, recommendationSolutions: [
    { recommendedSkills: [{ name: 'Tame Beast', recommendationPackage: { supports: [{ name: 'Meat Shield' }] } }], recommendedUniques: [{ name: 'Alpha Howl' }], passives: { notables: [{ name: 'Beastmaster' }] } },
    { recommendedSkills: [{ name: 'Cackling Companions', recommendationPackage: { supports: [{ name: 'Lightning Mastery' }] } }], recommendedUniques: [{ name: 'Thunderfist' }], passives: { keystones: [{ name: 'Hollow Palm Technique' }] } }
  ] });
  const first = renderBuildCard(model, { face: 'back', solutionIndex: 0 });
  const second = renderBuildCard(model, { face: 'back', solutionIndex: 1 });
  assert.match(first, /Previous build idea/);
  assert.match(first, /Next build idea/);
  assert.match(first, /Build idea 1 of 2/);
  assert.match(first, /Tame Beast/);
  assert.doesNotMatch(first, /Cackling Companions/);
  assert.match(second, /Build idea 2 of 2/);
  assert.match(second, /Cackling Companions/);
  assert.match(second, /Thunderfist/);
  assert.match(second, /Hollow Palm Technique/);
  assert.match(second, /data-tip-title="Cackling Companions"/);
});

test('navigation wraps, card flips preserve selection, and a new model resets it', () => {
  assert.match(source, /\(state\.solutionIndex \+ delta \+ count\) % count/);
  assert.match(source, /prior\?\.model === model \? prior\.solutionIndex : 0/);
  assert.match(source, /solution-prev[\s\S]*solution-next/);
  assert.match(source, /hideBuildCardTooltip\(\);[\s\S]*mountBuildCard/);
});
