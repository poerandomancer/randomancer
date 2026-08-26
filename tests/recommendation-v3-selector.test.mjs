import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  analyzeRecommendationCellV3,
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3,
  selectRecommendationPackageV3
} from '../js/30-recommendation-v3-selector.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url)));
const offenseInventory = read('data/offense-inventory.json');
let catalog = read('data/enriched/recommendation_catalog_v3.json');
catalog = mergeRecommendationGrantedSkillAccessV3(catalog, read('data/enriched/recommendation_granted_skill_access_v3.json'));
catalog = mergeRecommendationSkillCraftingV3(catalog, read('data/enriched/recommendation_skill_crafting_v3.json'));
const analyze = (weapon, offense) => analyzeRecommendationCellV3(
  catalog, { weapon, offenseSet: [offense] }, { offenseInventory }
);

test('native artifact contains every live non-critical cell exactly once', () => {
  const report = read('data/enriched/recommendation_native_coverage_v3.json');
  assert.equal(report.cells.length, report.weapons.length * report.offenses.length);
  assert.equal(new Set(report.cells.map((cell) => `${cell.weapon}:${cell.offenseId}`)).size, report.cells.length);
  assert.ok(!report.offenses.some((offense) => offense.id === 'critical_hits'));
  for (const cell of report.cells) {
    if (cell.classification === 'DIRECT') assert.ok(cell.directCandidates.length);
    if (cell.classification === 'CARRIER_BRIDGE') {
      assert.equal(cell.directCandidates.length, 0);
      assert.ok(cell.carrierCandidates.length);
    }
    if (cell.classification === 'SUPPORT_CHAIN') assert.ok(cell.supportChainCandidates.length);
    if (cell.classification === 'GAP') assert.deepEqual(cell.counts,
      { direct: 0, carrierBridge: 0, supportChain: 0 });
  }
});

test('representative native semantic facts remain strict', () => {
  assert.ok(analyze('Mace', 'ignite').direct.every((c) => c.directKind === 'INHERENT_DIRECT'));
  assert.ok(analyze('Quarterstaff', 'chill').direct.every((c) => c.directKind === 'INHERENT_DIRECT'));
  assert.ok(analyze('Quarterstaff', 'freeze').direct.some(
    (c) => c.entity.name === 'Wave of Frost' && c.directKind === 'EXPLICIT_DIRECT'
  ));
  assert.ok(analyze('Crossbow', 'shock').direct.every((c) => c.directKind === 'INHERENT_DIRECT'));
  assert.equal(analyze('Bow', 'freeze').classification, 'DIRECT');
  assert.ok(analyze('Bow', 'freeze').direct.some((c) => c.entity.name === 'Escape Shot'));
  assert.ok(analyze('Crossbow', 'electrocute').direct.some((c) => c.entity.name === 'Voltaic Grenade'));
  assert.ok(analyze('Spear', 'bleed').direct.some((c) => c.entity.name === 'Rake'));
  assert.ok(!analyze('Quarterstaff', 'shock').direct.some((c) => c.entity.name === 'Primal Strikes'));
  assert.ok(analyze('Bow', 'poison').direct.some((c) => c.entity.name === 'Poisonburst Arrow'));
  assert.ok(analyze('Bow', 'electrocute').direct.some((c) => c.entity.name === 'Electrocuting Arrow'));
  assert.equal(analyze('Mace', 'bleed').classification, 'CARRIER_BRIDGE');
  assert.equal(analyze('Mace', 'poison').classification, 'CARRIER_BRIDGE');
  assert.equal(analyze('Quarterstaff', 'electrocute').classification, 'CARRIER_BRIDGE');
});

test('explicit capability and inherent affinity rank only already-valid DIRECT candidates', () => {
  const bowPoison = selectRecommendationPackageV3(catalog, { weapon: 'Bow', offenseSet: ['poison'] }, {
    offenseInventory, selectionSeed: 'explicit-quality'
  });
  assert.equal(bowPoison.primarySkill.carrierObligations.length, 0);
  assert.ok(analyze('Bow', 'poison').direct.find((c) => c.entity.name === bowPoison.primarySkill.name)
    .directKind === 'EXPLICIT_DIRECT');
  const maceIgnite = selectRecommendationPackageV3(catalog, { weapon: 'Mace', offenseSet: ['ignite'] }, {
    offenseInventory, selectionSeed: 'affinity-quality'
  });
  assert.equal(maceIgnite.primarySkill.name, 'Molten Blast');
  const repeated = selectRecommendationPackageV3(catalog, { weapon: 'Quarterstaff', offenseSet: ['freeze'] }, {
    offenseInventory, selectionSeed: 'stable-seed'
  });
  const repeatedAgain = selectRecommendationPackageV3(catalog, { weapon: 'Quarterstaff', offenseSet: ['freeze'] }, {
    offenseInventory, selectionSeed: 'stable-seed'
  });
  assert.equal(repeated.primarySkill.entityId, repeatedAgain.primarySkill.entityId);
});

test('DIRECT is a singleton lexicographic runtime tier', () => {
  const result = selectRecommendationPackageV3(catalog, { weapon: 'Spear', offenseSet: ['bleed'] }, {
    offenseInventory, selectionSeed: 'direct-regression'
  });
  assert.equal(result.diagnostics.recommendationTier, 'DIRECT');
  assert.equal(result.pieces.length, 1);
  assert.equal(result.supportingSkill, null);
});

test('one compatible enabling support forms CARRIER_BRIDGE ahead of fallback', () => {
  const result = selectRecommendationPackageV3(catalog, { weapon: 'Mace', offenseSet: ['bleed'] }, {
    offenseInventory, selectionSeed: 'bridge-regression'
  });
  assert.equal(result.diagnostics.recommendationTier, 'CARRIER_BRIDGE');
  assert.equal(result.pieces.length, 1);
  assert.equal(result.supportingSkill, null);
  assert.equal(result.supportAssignments.flatMap((entry) => entry.supports).length, 1);
});

test('bridge audit is compact and contains only native CARRIER cells', () => {
  const native = read('data/enriched/recommendation_native_coverage_v3.json');
  const bridges = read('data/enriched/recommendation_carrier_bridges_v3.json');
  const carrierKeys = new Set(native.cells.filter((cell) => cell.classification === 'CARRIER_BRIDGE')
    .map((cell) => `${cell.weapon}:${cell.offenseId}`));
  assert.equal(bridges.cells.length, carrierKeys.size);
  assert.ok(bridges.cells.every((cell) => carrierKeys.has(`${cell.weapon}:${cell.offenseId}`)));
  assert.ok(!JSON.stringify(bridges).includes('invalidPairs'));
  assert.ok(fs.statSync(new URL('../data/enriched/recommendation_carrier_bridges_v3.json', import.meta.url)).size < 200_000);
});

test('structured broad and unrestricted legality resolve archetypes generically', () => {
  for (const weapon of ['Quarterstaff', 'Bow', 'Talisman', 'Spear']) {
    const cell = analyze(weapon, 'totems');
    assert.equal(cell.classification, 'DIRECT');
    assert.ok(cell.direct.some((candidate) => candidate.entity.name === 'Shockwave Totem'));
  }
  for (const weapon of ['Mace', 'Quarterstaff', 'Crossbow']) {
    const cell = analyze(weapon, 'companions');
    assert.equal(cell.classification, 'DIRECT');
    assert.ok(cell.direct.some((candidate) => candidate.entity.name === 'Tame Beast'));
  }
  assert.ok(!analyze('Bow', 'companions').direct.some((candidate) => candidate.entity.name === 'Rhoa Mount'));
});

test('support-added elemental damage closes through Hit ontology with prevention intact', () => {
  for (const [weapon, offense, support] of [
    ['Mace', 'chill', 'Cold Attunement'],
    ['Mace', 'freeze', 'Cold Attunement'],
    ['Mace', 'shock', 'Lightning Attunement'],
    ['Quarterstaff', 'ignite', 'Fire Attunement']
  ]) {
    assert.equal(analyze(weapon, offense).classification, 'CARRIER_BRIDGE');
    const result = selectRecommendationPackageV3(catalog, { weapon, offenseSet: [offense] }, {
      offenseInventory, selectionSeed: `derived-${weapon}-${offense}`
    });
    assert.equal(result.diagnostics.recommendationTier, 'CARRIER_BRIDGE');
    assert.ok(result.supportAssignments.flatMap((entry) => entry.supports)
      .some((entry) => entry.name === support));
    assert.equal(result.unresolved.length, 0);
  }
});

test('strong inherited weapon Physical is distinct and conversion-conservative', () => {
  const cell = analyze('Talisman', 'physical');
  assert.equal(cell.classification, 'DIRECT');
  assert.ok(cell.direct.some((candidate) => candidate.directProofs.some((proof) =>
    proof.semanticSource === 'inherited_weapon_damage' && proof.relation === 'has_property')));
  assert.ok(!cell.direct.some((candidate) => candidate.entity.name === 'Fury of the Mountain'));
});

test('exact-native identity wins inside an equally complete DIRECT tier', () => {
  for (const [weapon, offense] of [['Bow', 'physical'], ['Mace', 'physical'], ['Quarterstaff', 'lightning']]) {
    const result = selectRecommendationPackageV3(catalog, { weapon, offenseSet: [offense] }, {
      offenseInventory, selectionSeed: `native-${weapon}-${offense}`
    });
    const crafting = result.primarySkill?.entityId
      ? catalog.entities.find((entity) => entity.id === result.primarySkill.entityId)?.crafting : null;
    assert.ok(crafting?.weapon_affinities?.map((value) => value.toLowerCase()).includes(weapon.toLowerCase()));
  }
});

test('bounded SUPPORT_CHAIN resolves Mace Electrocute in semantic support order', () => {
  const cell = analyze('Mace', 'electrocute');
  assert.equal(cell.classification, 'SUPPORT_CHAIN');
  assert.equal(cell.direct.length, 0);
  assert.equal(cell.bridges.length, 0);
  assert.ok(cell.supportChains.length > 0);
  for (const chain of cell.supportChains) {
    assert.equal(chain.proof.supportEntityIds.length, 2);
    assert.deepEqual(chain.proof.supportRoles,
      ['REQUIRED_PREREQUISITE_SUPPORT', 'REQUIRED_ENABLE_SUPPORT']);
    assert.equal(chain.proof.intermediateMechanic, 'lightning');
  }
  const result = selectRecommendationPackageV3(catalog,
    { weapon: 'Mace', offenseSet: ['electrocute'] },
    { offenseInventory, selectionSeed: 'support-chain-regression' });
  assert.equal(result.diagnostics.recommendationTier, 'SUPPORT_CHAIN');
  assert.deepEqual(result.supportAssignments.flatMap((entry) => entry.supports)
    .map((support) => [support.name, support.assignedRole]), [
    ['Lightning Attunement', 'REQUIRED_PREREQUISITE_SUPPORT'],
    ['Electrocute', 'REQUIRED_ENABLE_SUPPORT']
  ]);
  assert.equal(result.unresolved.length, 0);
});

test('caster Companion GAPs remain unresolved after bounded chain tier', () => {
  for (const weapon of ['Staff', 'Wand', 'Sceptre']) {
    const cell = analyze(weapon, 'companions');
    assert.equal(cell.classification, 'GAP');
    assert.equal(cell.supportChains.length, 0);
  }
});
