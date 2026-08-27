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

const semanticUnique = (id, slot, offense, tier, strength, facts = []) => entity(id, 'unique', [], {
  compatibility: { access: {}, equipment: { slot, base: slot } },
  unique_offense_semantics: { [offense]: { tier, strength, facts } }
});

test('runtime semantic tiers are lexicographic and lower tiers cannot win by volume', () => {
  const facts = (category, count) => Array.from({ length: count }, () => ({ c: category, r: 'modifies', m: 'freeze', k: 'item_modifier' }));
  const candidates = catalog([
    semanticUnique('capability', 'Bow', 'freeze', 'BUILD_DEFINING_CAPABILITY', 401, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'granted_skill', e: 'skill:child' }]),
    semanticUnique('specialization', 'Quiver', 'freeze', 'STRONG_SPECIALIZATION', 399, facts('STRONG_SPECIALIZATION', 8)),
    semanticUnique('affinity', 'Bow', 'freeze', 'AFFINITY_AMPLIFICATION', 999, facts('AFFINITY_AMPLIFICATION', 20)),
    semanticUnique('payoff', 'Quiver', 'freeze', 'PAYOFF_CONTEXT', 9999, facts('PAYOFF_CONTEXT', 30))
  ]);
  const result = selectNonSkillRecommendations(candidates, snap, pkg);
  assert.equal(result.recommendedUniques[0].id, 'capability');
  assert.equal(result.recommendedUniques[0].recommendationEvidence.matches[0].sourceEntity, 'skill:child');
});

test('quality band stays in the strongest tier, caps at three, and is seeded', () => {
  const candidates = catalog([
    semanticUnique('a', 'Bow', 'freeze', 'BUILD_DEFINING_CAPABILITY', 410, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('b', 'Quiver', 'freeze', 'BUILD_DEFINING_CAPABILITY', 405, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('c', 'Bow', 'freeze', 'BUILD_DEFINING_CAPABILITY', 401, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('d', 'Quiver', 'freeze', 'BUILD_DEFINING_CAPABILITY', 400, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('far', 'Bow', 'freeze', 'BUILD_DEFINING_CAPABILITY', 399, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('lower', 'Bow', 'freeze', 'STRONG_SPECIALIZATION', 999, [{ c: 'STRONG_SPECIALIZATION', r: 'provides', m: 'freeze', k: 'item_fact' }])
  ]);
  const pick = (seed) => selectNonSkillRecommendations(candidates, snap, pkg, { selectionSeed: seed }).recommendedUniques[0];
  assert.deepEqual(pick('same'), pick('same'));
  assert.equal(pick('same').recommendationEvidence.qualityBandSize, 3);
  assert.ok(new Set(Array.from({ length: 20 }, (_, index) => pick(`seed-${index}`).id)).size > 1);
  assert.ok(Array.from({ length: 20 }, (_, index) => pick(`seed-${index}`).id).every((id) => ['a', 'b', 'c'].includes(id)));
  const dominantCatalog = catalog([semanticUnique('only', 'Bow', 'freeze', 'BUILD_DEFINING_CAPABILITY', 410,
    [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }])]);
  const dominant = (seed) => selectNonSkillRecommendations(dominantCatalog, snap, pkg, { selectionSeed: seed }).recommendedUniques[0];
  assert.equal(dominant('one').id, dominant('two').id);
  assert.equal(dominant('one').recommendationEvidence.qualityBandSize, 1);
});

test('stronger Bow and Quiver win neutrally while primary families beat fallback', () => {
  const choose = (bowStrength, quiverStrength) => selectNonSkillRecommendations(catalog([
    semanticUnique('bow-semantic', 'Bow', 'freeze', 'STRONG_SPECIALIZATION', bowStrength, [{ c: 'STRONG_SPECIALIZATION', r: 'provides', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('quiver-semantic', 'Quiver', 'freeze', 'STRONG_SPECIALIZATION', quiverStrength, [{ c: 'STRONG_SPECIALIZATION', r: 'provides', m: 'freeze', k: 'item_fact' }])
  ]), snap, pkg).recommendedUniques[0].id;
  assert.equal(choose(320, 300), 'bow-semantic');
  assert.equal(choose(300, 320), 'quiver-semantic');
  const wand = selectNonSkillRecommendations(catalog([
    semanticUnique('wand-primary', 'Wand', 'freeze', 'PAYOFF_CONTEXT', 101, [{ c: 'PAYOFF_CONTEXT', r: 'requires', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('focus-fallback', 'Focus', 'freeze', 'BUILD_DEFINING_CAPABILITY', 450, [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }])
  ]), { ...snap, weaponFamily: 'Wand' }, pkg);
  assert.equal(wand.recommendedUniques[0].id, 'wand-primary');
});

test('compact contradictions reject while incoming immunity does not', () => {
  const blocked = semanticUnique('blocked', 'Bow', 'freeze', 'CONTRADICTION_PREVENTION', -1,
    [{ c: 'CONTRADICTION_PREVENTION', r: 'prevents', m: 'freeze', k: 'nested_component' }]);
  const safe = semanticUnique('safe', 'Bow', 'freeze', 'AFFINITY_AMPLIFICATION', 201,
    [{ c: 'AFFINITY_AMPLIFICATION', r: 'modifies', m: 'freeze', k: 'item_fact' }]);
  assert.deepEqual(selectNonSkillRecommendations(catalog([blocked]), snap, pkg).recommendedUniques, []);
  assert.equal(selectNonSkillRecommendations(catalog([blocked, safe]), snap, pkg).recommendedUniques[0].id, 'safe');
  const incoming = entity('incoming', 'unique', [fact('freeze'), { ...fact('freeze'), relation: 'prevents', scope: 'incoming' }],
    { compatibility: { access: {}, equipment: { slot: 'Bow', base: 'Bow' } } });
  assert.equal(selectNonSkillRecommendations(catalog([incoming]), snap, pkg).recommendedUniques[0].id, 'incoming');
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
