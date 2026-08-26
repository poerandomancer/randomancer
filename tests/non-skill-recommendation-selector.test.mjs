import assert from 'node:assert/strict';
import test from 'node:test';
import { selectNonSkillRecommendations } from '../js/31-non-skill-recommendation-selector.js';

const fact = (mechanic, relation = 'provides') => ({ mechanic, relation, confidence: 'exact' });
const entity = (id, content_type, mechanics, extra = {}) => ({
  id, source_id: id, name: id, content_type,
  facts: mechanics.map((mechanic) => typeof mechanic === 'string' ? fact(mechanic) : mechanic),
  retrieval_terms: [], compatibility: { access: {} }, provenance: {}, ...extra
});
const snap = { ascendancy: 'Invoker', weaponFamily: 'Bow', offenseList: ['Freeze'] };
const pkg = { selectionSeed: 'fixed', pieces: [{ entityId: 'skill' }] };
const catalog = (entities) => ({ entities: [entity('skill', 'active_skill', ['freeze']), ...entities] });

test('owns ascendancy, excludes keystones, and enforces unique weapon family', () => {
  const result = selectNonSkillRecommendations(catalog([
    entity('invoker', 'ascendancy_passive', ['freeze'], { compatibility: { access: { ascendancy: 'Invoker' } } }),
    entity('wrong-owner', 'ascendancy_passive', ['freeze'], { compatibility: { access: { ascendancy: 'Deadeye' } } }),
    entity('keystone', 'keystone', ['freeze']),
    entity('bow', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Weapon', base: 'Advanced Bow' } } }),
    entity('mace', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Weapon', base: 'Advanced Mace' } } })
  ]), snap, pkg);
  assert.deepEqual(result.passives.ascendancyNodes.map((entry) => entry.id), ['invoker']);
  assert.deepEqual(result.recommendedUniques.map((entry) => entry.id), ['bow']);
  assert.equal(JSON.stringify(result).includes('keystone'), false);
});

test('off-hand uniques require a one-handed rolled weapon', () => {
  const offHands = [
    entity('shield', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Shield', base: 'Tower Shield' } } }),
    entity('buckler', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Buckler', base: 'Iron Buckler' } } }),
    entity('focus', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Focus', base: 'Twig Focus' } } })
  ];
  const staff = selectNonSkillRecommendations(catalog(offHands), { ...snap, weaponFamily: 'Staff' }, pkg);
  const crossbow = selectNonSkillRecommendations(catalog(offHands), { ...snap, weaponFamily: 'Crossbow' }, pkg);
  const talisman = selectNonSkillRecommendations(catalog(offHands), { ...snap, weaponFamily: 'Talisman' }, pkg);
  const wand = selectNonSkillRecommendations(catalog(offHands), { ...snap, weaponFamily: 'Wand' }, pkg);
  const mace = selectNonSkillRecommendations(catalog(offHands), { ...snap, weaponFamily: 'Mace' }, pkg);
  assert.deepEqual(staff.recommendedUniques, []);
  assert.deepEqual(crossbow.recommendedUniques, []);
  assert.deepEqual(talisman.recommendedUniques, []);
  assert.ok(wand.recommendedUniques.length > 0);
  assert.ok(mace.recommendedUniques.length > 0);
  assert.ok(wand.recommendedUniques.every((entry) => entry.recommendationEvidence.matches[0].mechanic === 'freeze'));
});

test('unique selector uses exact primary families, meaningful offense facts, and one result', () => {
  const unique = (id, base, mechanics) => entity(id, 'unique', mechanics, {
    compatibility: { access: {}, equipment: { slot: base, base } }
  });
  const candidates = catalog([
    unique('bow-freeze', 'Bow', ['freeze']),
    unique('quiver-freeze', 'Quiver', ['freeze']),
    unique('crossbow-freeze', 'Crossbow', ['freeze']),
    unique('helmet-freeze', 'Helmet', ['freeze']),
    unique('bow-generic', 'Bow', ['damage'])
  ]);
  const result = selectNonSkillRecommendations(candidates, snap, pkg);
  assert.equal(result.recommendedUniques.length, 1);
  assert.ok(['bow-freeze', 'quiver-freeze'].includes(result.recommendedUniques[0].id));
  assert.deepEqual(selectNonSkillRecommendations(candidates, { ...snap, weaponFamily: 'Crossbow' }, pkg).recommendedUniques.map((item) => item.id), ['crossbow-freeze']);
});

test('mace family covers one- and two-handed bases and primary beats off-hand fallback', () => {
  const mace = entity('mace', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Mace', base: 'Great Mace' } } });
  const shield = entity('shield', 'unique', [{ ...fact('freeze'), relation: 'inflicts' }], { compatibility: { access: {}, equipment: { slot: 'Shield', base: 'Tower Shield' } } });
  const candidates = catalog([mace, shield]);
  assert.deepEqual(selectNonSkillRecommendations(candidates, { ...snap, weaponFamily: 'One-handed Mace' }, pkg).recommendedUniques.map((item) => item.id), ['mace']);
  assert.deepEqual(selectNonSkillRecommendations(candidates, { ...snap, weaponFamily: 'Two-handed Mace' }, pkg).recommendedUniques.map((item) => item.id), ['mace']);
});

test('unique selector accepts toward conversion and rejects contradictions and away conversion', () => {
  const bow = (id, mechanics) => entity(id, 'unique', mechanics, { compatibility: { access: {}, equipment: { slot: 'Bow', base: 'Bow' } } });
  const conversion = { relation: 'converts', from: 'fire', to: 'freeze', confidence: 'exact' };
  const result = selectNonSkillRecommendations(catalog([
    bow('toward', [conversion]),
    bow('cannot', [fact('freeze'), { ...fact('freeze'), relation: 'cannot' }]),
    bow('away', [fact('freeze'), { relation: 'converts', from: 'freeze', to: 'fire' }])
  ]), snap, pkg);
  assert.deepEqual(result.recommendedUniques.map((item) => item.id), ['toward']);
});

test('off-hand fallback is restricted to one-handed weapons and empty is valid', () => {
  const focus = entity('focus', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Focus', base: 'Focus' } } });
  const unrelated = entity('ring', 'unique', ['freeze'], { compatibility: { access: {}, equipment: { slot: 'Ring', base: 'Ring' } } });
  const candidates = catalog([focus, unrelated]);
  assert.deepEqual(selectNonSkillRecommendations(candidates, { ...snap, weaponFamily: 'Wand' }, pkg).recommendedUniques.map((item) => item.id), ['focus']);
  assert.deepEqual(selectNonSkillRecommendations(candidates, { ...snap, weaponFamily: 'Staff' }, pkg).recommendedUniques, []);
  assert.deepEqual(selectNonSkillRecommendations(catalog([]), snap, pkg).recommendedUniques, []);
});

test('rejects generic, contradictory, DNT, prototype, inaccessible, and seasonal candidates', () => {
  const blocked = [
    entity('generic', 'passive', ['damage', 'hit']),
    entity('contrary', 'passive', [{ ...fact('freeze'), relation: 'prevents' }]),
    entity('DNT unused', 'passive', ['freeze']),
    entity('prototype thing', 'passive', ['freeze']),
    entity('hidden', 'passive', ['freeze'], { compatibility: { access: { available: false } } }),
    entity('season', 'passive', ['freeze'], { provenance: { source_tags: ['kalguuran'] } })
  ];
  assert.deepEqual(selectNonSkillRecommendations(catalog(blocked), snap, pkg).passives.notables, []);
});

test('limits, deduplicates weak interactions, is seeded, and permits empty categories', () => {
  const candidates = Array.from({ length: 7 }, (_, index) => entity(`n${index}`, 'passive', [index < 4 ? 'freeze' : 'chill']));
  const first = selectNonSkillRecommendations(catalog(candidates), snap, pkg, { selectionSeed: 'same' });
  const second = selectNonSkillRecommendations(catalog(candidates), snap, pkg, { selectionSeed: 'same' });
  assert.deepEqual(first, second);
  assert.ok(first.passives.notables.length <= 3);
  assert.equal(new Set(first.passives.notables.map((entry) => entry.id)).size, first.passives.notables.length);
  assert.ok(first.passives.notables.every((entry) => entry.recommendationEvidence.matches.length));
  assert.deepEqual(first.recommendedUniques, []);
  assert.deepEqual(first.passives.ascendancyNodes, []);
});

test('build card renders skill, unique, ascendancy, and notable tooltip content', async () => {
  globalThis.document = { readyState: 'loading', addEventListener() {} };
  globalThis.window = {
    DATA: {
      gems: [{ id: 'skill-id', name: 'Ice Skill', description: '[Cold|Cold] skill text' }],
      passivesEnriched: { nodes: [
        { name: 'Cold Ascendancy', lines: ['Asc effect'] },
        { name: 'Cold Notable', lines: ['Notable effect'] }
      ] },
      uniques: [{ name: 'Cold Bow', base: 'Expert Bow', slot: 'Weapon', implicit_mods: ['Cold implicit'], explicit_mods: ['Freeze mod'] }]
    },
    matchMedia: () => ({ matches: false })
  };
  const { deriveBuildCardModel, renderBuildCard, BUILD_CARD_FACES } = await import('../js/23-build-card-foundation.js');
  const model = deriveBuildCardModel({
    ascendancy: 'Invoker', weaponFamily: 'Bow', offenseList: ['Freeze'], attributes: {},
    recommendedSkills: [{ id: 'skill-id', name: 'Ice Skill' }],
    recommendedUniques: [{ id: 'cold-bow', name: 'Cold Bow', recommendationEvidence: {} }],
    passives: {
      ascendancyNodes: [{ id: 'asc', name: 'Cold Ascendancy', recommendationEvidence: {} }],
      notables: [{ id: 'notable', name: 'Cold Notable', recommendationEvidence: {} }]
    }
  });
  const html = renderBuildCard(model, { face: BUILD_CARD_FACES.BACK });
  assert.match(html, /Unique Ideas[\s\S]*Cold Bow/);
  assert.match(html, /Ascendancy — [\s\S]*Cold Ascendancy/);
  assert.match(html, /Notable — [\s\S]*Cold Notable/);
  assert.match(html, /Ice Skill[\s\S]*tabindex="0"|tabindex="0"[\s\S]*Ice Skill/);
  for (const text of ['Expert Bow · Weapon', 'Cold implicit', 'Freeze mod', 'Ascendancy Passive', 'Asc effect', 'Notable Passive', 'Notable effect']) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
