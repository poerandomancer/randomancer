import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { selectNonSkillRecommendations, selectJewelryRecommendations } from '../js/31-non-skill-recommendation-selector.js';

const fact = (mechanic, relation = 'provides') => ({ mechanic, relation, confidence: 'exact', offense_role: 'enabler' });
const entity = (id, content_type, mechanics, extra = {}) => ({
  id, source_id: id, name: id, content_type,
  facts: mechanics.map((mechanic) => typeof mechanic === 'string' ? fact(mechanic) : mechanic),
  retrieval_terms: [], compatibility: { access: {} }, provenance: {},
  ...(content_type === 'passive' ? { passive_tree_starts: ['dex'] } : {}), ...extra
});
const snap = { ascendancy: 'Invoker', weaponFamily: 'Bow', offenseList: ['Freeze'], passiveTreeStart: 'dex' };
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

test('catalog passive class overrides cannot leak through selection fallback', () => {
  const defaultPassive = entity('default', 'passive', ['freeze'], { compatibility: { access: {
    overridden_for_passive_tree_character_ids: [8], overridden_for_classes: ['Huntress']
  } } });
  const replacement = entity('replacement', 'passive', ['freeze'], { compatibility: { access: {
    passive_tree_character_id: 8, class_name: 'Huntress', override_of: 'default'
  } } });
  const forHuntress = selectNonSkillRecommendations(catalog([defaultPassive, replacement]),
    { ...snap, className: 'Huntress', passiveTreeCharacterId: 8 }, pkg).passives.notables;
  const forRanger = selectNonSkillRecommendations(catalog([defaultPassive, replacement]),
    { ...snap, className: 'Ranger', passiveTreeCharacterId: 2 }, pkg).passives.notables;
  assert.deepEqual(forHuntress.map((entry) => entry.id), ['replacement']);
  assert.deepEqual(forRanger.map((entry) => entry.id), ['default']);
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

test('jewelry eligibility uses authoritative Ring and Amulet slots only', () => {
  const candidate = (id, slot) => semanticUnique(id, slot, 'freeze', 'STRONG_SPECIALIZATION', 310,
    [{ c: 'STRONG_SPECIALIZATION', r: 'provides', m: 'freeze', k: 'item_fact' }]);
  const result = selectJewelryRecommendations(catalog([
    candidate('ring', 'Ring'), candidate('amulet', 'Amulet'), candidate('jewel', 'Jewel'),
    candidate('belt', 'Belt'), candidate('charm', 'Charm'), candidate('helmet', 'Helmet'), candidate('bow', 'Bow')
  ]), snap, 'eligibility');
  assert.deepEqual(new Set(result.map((entry) => entry.itemType)), new Set(['Ring', 'Amulet']));
  assert.ok(result.every((entry) => !['jewel', 'belt', 'charm', 'helmet', 'bow'].includes(entry.id)));
});

test('jewelry capacity permits two distinct Rings but at most one Amulet', () => {
  const jewelry = (id, slot, strength = 410, sourceId = id) => ({
    ...semanticUnique(id, slot, 'freeze', 'BUILD_DEFINING_CAPABILITY', strength,
      [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]), source_id: sourceId
  });
  const rings = selectJewelryRecommendations(catalog([
    jewelry('ring-a', 'Ring'), jewelry('ring-b', 'Ring'), jewelry('weak-amulet', 'Amulet', 300)
  ]), snap, 'rings');
  assert.equal(rings.length, 2);
  assert.ok(rings.every((entry) => entry.itemType === 'Ring'));
  const mixed = selectJewelryRecommendations(catalog([
    jewelry('ring', 'Ring'), jewelry('amulet-a', 'Amulet'), jewelry('amulet-b', 'Amulet')
  ]), snap, 'mixed');
  assert.equal(mixed.filter((entry) => entry.itemType === 'Amulet').length, 1);
  assert.equal(new Set(mixed.map((entry) => entry.id)).size, mixed.length);
  const duplicate = selectJewelryRecommendations(catalog([
    jewelry('copy-a', 'Ring', 410, 'same-ring'), jewelry('copy-b', 'Ring', 409, 'same-ring')
  ]), snap, 'duplicate');
  assert.equal(duplicate.length, 1);
});

test('jewelry shares semantic tiers, granted facts, contradictions, and directional conversion', () => {
  const candidates = catalog([
    semanticUnique('granted-capability', 'Ring', 'freeze', 'BUILD_DEFINING_CAPABILITY', 401,
      [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'granted_skill', e: 'skill:freeze' }]),
    semanticUnique('specialization', 'Amulet', 'freeze', 'STRONG_SPECIALIZATION', 999,
      [{ c: 'STRONG_SPECIALIZATION', r: 'provides', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('affinity', 'Ring', 'freeze', 'AFFINITY_AMPLIFICATION', 9999,
      [{ c: 'AFFINITY_AMPLIFICATION', r: 'modifies', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('payoff', 'Ring', 'freeze', 'PAYOFF_CONTEXT', 99999,
      [{ c: 'PAYOFF_CONTEXT', r: 'requires', m: 'freeze', k: 'item_fact' }]),
    semanticUnique('blocked', 'Ring', 'freeze', 'CONTRADICTION_PREVENTION', -1,
      [{ c: 'CONTRADICTION_PREVENTION', r: 'prevents', m: 'freeze', k: 'item_fact' }])
  ]);
  const result = selectJewelryRecommendations(candidates, snap, 'tiers');
  assert.deepEqual(result.map((entry) => entry.id), ['granted-capability']);
  assert.equal(result[0].recommendationEvidence.matches[0].sourceEntity, 'skill:freeze');
  const raw = (id, facts) => entity(id, 'unique', facts, { compatibility: { access: {}, equipment: { slot: 'Ring', base: 'Gold Ring' } } });
  assert.deepEqual(selectJewelryRecommendations(catalog([
    raw('toward', [{ relation: 'converts', from: 'fire', to: 'freeze' }]),
    raw('away', [fact('freeze'), { relation: 'converts', from: 'freeze', to: 'fire' }])
  ]), snap, 'conversion').map((entry) => entry.id), ['toward']);
});

test('jewelry selection is deterministic, varies within its band, and does not force weak slots', () => {
  const ring = (id, strength) => semanticUnique(id, 'Ring', 'freeze', 'STRONG_SPECIALIZATION', strength,
    [{ c: 'STRONG_SPECIALIZATION', r: 'provides', m: 'freeze', k: 'item_fact' }]);
  const candidates = catalog([ring('a', 310), ring('b', 308), ring('c', 305)]);
  const pick = (seed) => selectJewelryRecommendations(candidates, snap, seed).map((entry) => entry.id);
  assert.deepEqual(pick('same'), pick('same'));
  assert.ok(new Set(Array.from({ length: 20 }, (_, index) => pick(`seed-${index}`).join(','))).size > 1);
  const single = selectJewelryRecommendations(catalog([
    ring('strong', 310), semanticUnique('lower-tier', 'Amulet', 'freeze', 'AFFINITY_AMPLIFICATION', 299,
      [{ c: 'AFFINITY_AMPLIFICATION', r: 'modifies', m: 'freeze', k: 'item_fact' }])
  ]), snap, 'single');
  assert.deepEqual(single.map((entry) => entry.id), ['strong']);
  assert.deepEqual(selectJewelryRecommendations(catalog([]), snap, 'empty'), []);
});

test('jewelry lane is weapon-independent and cannot displace the primary unique', () => {
  const bow = semanticUnique('primary-bow', 'Bow', 'freeze', 'AFFINITY_AMPLIFICATION', 201,
    [{ c: 'AFFINITY_AMPLIFICATION', r: 'modifies', m: 'freeze', k: 'item_fact' }]);
  const ring = semanticUnique('strong-ring', 'Ring', 'freeze', 'BUILD_DEFINING_CAPABILITY', 410,
    [{ c: 'BUILD_DEFINING_CAPABILITY', r: 'inflicts', m: 'freeze', k: 'item_fact' }]);
  for (const weaponFamily of ['Bow', 'Crossbow']) {
    const result = selectNonSkillRecommendations(catalog([bow, ring]), { ...snap, weaponFamily }, pkg);
    assert.deepEqual(result.recommendedJewelryUniques.map((entry) => entry.id), ['strong-ring']);
    assert.ok(result.recommendedUniques.length <= 1);
    if (weaponFamily === 'Bow') assert.deepEqual(result.recommendedUniques.map((entry) => entry.id), ['primary-bow']);
  }
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

test('production path enforces Void locality for Huntress while retaining Int eligibility', () => {
  const production = JSON.parse(fs.readFileSync(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url)));
  const voidEntity = production.entities.find((candidate) => candidate.name === 'Void' && candidate.content_type === 'passive');
  assert.deepEqual(voidEntity.passive_tree_starts, ['dex_int', 'int', 'str_int']);
  assert.ok(voidEntity.facts.some((entry) => entry.mechanic === 'chaos' && entry.offense_role === 'enabler'));
  const onlyVoid = catalog([voidEntity]);
  const huntress = { ascendancy: 'Ritualist', weaponFamily: 'Spear', offenseList: ['Chaos'], passiveTreeStart: 'dex' };
  const witch = { ...huntress, ascendancy: 'Lich', passiveTreeStart: 'int' };
  assert.deepEqual(selectNonSkillRecommendations(onlyVoid, huntress, null).passives.notables, []);
  assert.deepEqual(selectNonSkillRecommendations(onlyVoid, witch, null).passives.notables.map((entry) => entry.name), ['Void']);
});

test('ordinary notables fail closed when either side of locality metadata is missing', () => {
  const candidate = entity('chaos-notable', 'passive', ['chaos'], { passive_tree_starts: ['dex'] });
  assert.deepEqual(selectNonSkillRecommendations(catalog([candidate]), { ...snap, passiveTreeStart: '' }, null).passives.notables, []);
  assert.deepEqual(selectNonSkillRecommendations(catalog([{ ...candidate, passive_tree_starts: undefined }]), snap, null).passives.notables, []);
});

test('ordinary notable weapon requirements are a hard gate before selection', () => {
  const restricted = (id, requirements, compatible) => entity(id, 'passive', ['poison'], {
    compatibility: { access: {}, passive_weapon: {
      requirements_any_of: requirements, compatible_weapon_family_ids: compatible,
      unresolved_requirements: [], fail_closed: false
    } }
  });
  const bow = restricted('bow-poison', ['bow'], ['bow']);
  const bowOrSpear = restricted('bow-or-spear-poison', ['bow', 'spear'], ['bow', 'spear']);
  const generic = entity('generic-poison', 'passive', ['poison']);
  const base = { ...snap, offenseList: ['Poison'] };

  assert.deepEqual(selectNonSkillRecommendations(catalog([bow]),
    { ...base, weaponFamily: 'Bow' }, null).passives.notables.map((entry) => entry.id), ['bow-poison']);
  assert.deepEqual(selectNonSkillRecommendations(catalog([bow]),
    { ...base, weaponFamily: 'Mace' }, null).passives.notables, []);
  for (const weaponFamily of ['Bow', 'Spear']) {
    assert.deepEqual(selectNonSkillRecommendations(catalog([bowOrSpear]),
      { ...base, weaponFamily }, null).passives.notables.map((entry) => entry.id), ['bow-or-spear-poison']);
  }
  assert.deepEqual(selectNonSkillRecommendations(catalog([generic]),
    { ...base, weaponFamily: 'Crossbow' }, null).passives.notables.map((entry) => entry.id), ['generic-poison']);
});

test('future and unresolved weapon requirements fail closed without fallback', () => {
  const futureDagger = entity('future-dagger', 'passive', ['poison'], { compatibility: { access: {}, passive_weapon: {
    requirements_any_of: ['dagger'], compatible_weapon_family_ids: [], unresolved_requirements: [], fail_closed: false
  } } });
  const unresolved = entity('unknown-weapon', 'passive', ['poison'], { compatibility: { access: {}, passive_weapon: {
    requirements_any_of: ['future_blade'], compatible_weapon_family_ids: [], unresolved_requirements: ['future_blade'], fail_closed: true
  } } });
  for (const weaponFamily of ['Bow', 'Mace', 'Quarterstaff']) {
    assert.deepEqual(selectNonSkillRecommendations(catalog([futureDagger, unresolved]),
      { ...snap, offenseList: ['Poison'], weaponFamily }, null).passives.notables, []);
  }
});

test('production Coated Knife dagger restriction rejects unrelated live weapons', () => {
  const production = JSON.parse(fs.readFileSync(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url)));
  const coatedBlade = production.entities.find((candidate) => ['Coated Blade', 'Coated Knife'].includes(candidate.name)
    && candidate.content_type === 'passive');
  assert.ok(coatedBlade, 'expected the production dagger poison notable');
  assert.deepEqual(coatedBlade.compatibility.passive_weapon.requirements_any_of, ['dagger']);
  assert.deepEqual(coatedBlade.compatibility.passive_weapon.compatible_weapon_family_ids, []);
  const base = { ...snap, offenseList: ['Poison'], passiveTreeStart: coatedBlade.passive_tree_starts[0] };
  for (const weaponFamily of ['Bow', 'Mace']) {
    assert.deepEqual(selectNonSkillRecommendations(catalog([coatedBlade]),
      { ...base, weaponFamily }, null).passives.notables, []);
  }
});

test('ascendancy-owned ordinary notables require their owner before normal checks', () => {
  const owned = entity('oracle-chaos', 'passive', ['chaos'], {
    required_ascendancy: 'Oracle', passive_tree_starts: ['str_int']
  });
  const ordinary = entity('ordinary-chaos', 'passive', ['chaos'], {
    passive_tree_starts: ['str_int']
  });
  const base = { ...snap, offenseList: ['Chaos'], passiveTreeStart: 'str_int' };
  const ritualist = selectNonSkillRecommendations(catalog([owned, ordinary]),
    { ...base, ascendancy: 'Ritualist' }, null).passives.notables;
  assert.deepEqual(ritualist.map((entry) => entry.id), ['ordinary-chaos']);
  const oracle = selectNonSkillRecommendations(catalog([owned]),
    { ...base, ascendancy: 'Oracle' }, null).passives.notables;
  assert.deepEqual(oracle.map((entry) => entry.id), ['oracle-chaos']);
  const wrongOffense = selectNonSkillRecommendations(catalog([owned]),
    { ...base, ascendancy: 'Oracle', offenseList: ['Freeze'] }, null).passives.notables;
  assert.deepEqual(wrongOffense, []);
});

test('production First Sting is Oracle-only', () => {
  const production = JSON.parse(fs.readFileSync(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url)));
  const firstSting = production.entities.find((candidate) => candidate.name === 'First Sting' && candidate.content_type === 'passive');
  assert.equal(firstSting.required_ascendancy, 'Oracle');
  const base = { ...snap, offenseList: ['Poison'], passiveTreeStart: firstSting.passive_tree_starts[0] };
  assert.deepEqual(selectNonSkillRecommendations(catalog([firstSting]),
    { ...base, ascendancy: 'Disciple of Varashta' }, null).passives.notables, []);
  assert.deepEqual(selectNonSkillRecommendations(catalog([firstSting]),
    { ...base, ascendancy: 'Oracle' }, null).passives.notables.map((entry) => entry.name), ['First Sting']);
});

test('passive offense matching requires an explicitly offensive semantic role', () => {
  const passive = (id, mechanic, offenseRole) => entity(id, 'passive', [
    { mechanic, relation: 'modifies', confidence: 'strong', ...(offenseRole ? { offense_role: offenseRole } : {}) }
  ]);
  const eligible = [
    passive('increased-chaos-damage', 'chaos', 'enabler'),
    passive('enemy-chaos-resistance-reduction', 'chaos', 'setup_control')
  ];
  for (const candidate of eligible) {
    const selected = selectNonSkillRecommendations(catalog([candidate]),
      { ...snap, offenseList: ['Chaos'] }, null).passives.notables;
    assert.deepEqual(selected.map((entry) => entry.id), [candidate.id]);
  }
  const result = selectNonSkillRecommendations(catalog([
    passive('chaos-resistance', 'chaos', null),
    passive('reduced-chaos-damage-taken', 'chaos', null),
    passive('chaos-recovery', 'chaos', 'recovery'),
    passive('poison-protection', 'poison', 'defense'),
    passive('bleed-recovery', 'bleed', 'recovery'),
    passive('ignite-protection', 'ignite', 'defense')
  ]), { ...snap, offenseList: ['Chaos'] }, null, { selectionSeed: 'semantic-direction' });
  assert.deepEqual(result.passives.notables, []);
});

test('build card renders skill, unique, ascendancy, and notable tooltip content', async () => {
  globalThis.document = { readyState: 'loading', addEventListener() {} };
  globalThis.window = {
    DATA: {
      gems: [
        { id: 'skill-id', name: 'Ice Skill', description: '[Cold|Cold] skill text' },
        { id: 'support-id', name: 'Deep Freeze', description: 'Support-only detail' }
      ],
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
    recommendedSkills: [{
      id: 'skill-id', name: 'Ice Skill',
      recommendationPackage: { assignedRole: 'primary_damage', supports: [{ id: 'support-id', name: 'Deep Freeze' }] }
    }],
    recommendedUniques: [{ id: 'cold-bow', name: 'Cold Bow', recommendationEvidence: {} }],
    passives: {
      ascendancyNodes: [{ id: 'asc', name: 'Cold Ascendancy', recommendationEvidence: {} }],
      notables: [{ id: 'notable', name: 'Cold Notable', recommendationEvidence: {} }]
    }
  });
  const html = renderBuildCard(model, { face: BUILD_CARD_FACES.BACK });
  assert.match(html, /Unique Ideas[\s\S]*Cold Bow/);
  assert.match(html, /Ascendancy — [\s\S]*Cold Ascendancy/);
  assert.doesNotMatch(html, /(?:Primary|Notable) —/);
  assert.match(html, /rc-skill-group__skill[\s\S]*Ice Skill[\s\S]*rc-skill-group__supports[\s\S]*Deep Freeze/);
  assert.match(html, /rc-skill-group__support[\s\S]*Deep Freeze/);
  assert.match(html, /data-tip-title="Deep Freeze" data-tip-lines="\[&quot;Support-only detail&quot;\]"/);
  assert.doesNotMatch(html, /data-tip-title="Ice Skill"[^>]*Support-only detail/);
  assert.match(html, /Ice Skill[\s\S]*tabindex="0"|tabindex="0"[\s\S]*Ice Skill/);
  for (const text of ['Expert Bow · Weapon', 'Cold implicit', 'Freeze mod', 'Ascendancy Passive', 'Asc effect', 'Notable Passive', 'Notable effect']) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('build card skill groups center skills and wrap columns and supports', () => {
  const css = fs.readFileSync(new URL('../css/85-build-card-foundation.css', import.meta.url), 'utf8');
  assert.match(css, /\.rc-skill-groups\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(auto-fit,/s);
  assert.match(css, /\.rc-skill-group\s*\{[^}]*width:fit-content;[^}]*justify-self:center;/s);
  assert.match(css, /\.rc-skill-group__skill\s*\{[^}]*text-align:center;/s);
  assert.match(css, /\.rc-skill-group__supports\s*\{[^}]*display:flex;[^}]*flex-wrap:wrap;[^}]*width:fit-content;[^}]*margin:\.18rem auto 0;/s);
});
