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
    if (cell.classification === 'CARRIER') {
      assert.equal(cell.directCandidates.length, 0);
      assert.ok(cell.carrierCandidates.length);
    }
    if (cell.classification === 'GAP') assert.deepEqual(cell.counts, { direct: 0, carrier: 0 });
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
  assert.equal(analyze('Mace', 'bleed').classification, 'CARRIER');
  assert.equal(analyze('Mace', 'poison').classification, 'CARRIER');
  assert.equal(analyze('Quarterstaff', 'electrocute').classification, 'CARRIER');
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
  const carrierKeys = new Set(native.cells.filter((cell) => cell.classification === 'CARRIER')
    .map((cell) => `${cell.weapon}:${cell.offenseId}`));
  assert.equal(bridges.cells.length, carrierKeys.size);
  assert.ok(bridges.cells.every((cell) => carrierKeys.has(`${cell.weapon}:${cell.offenseId}`)));
  assert.ok(!JSON.stringify(bridges).includes('invalidPairs'));
  assert.ok(fs.statSync(new URL('../data/enriched/recommendation_carrier_bridges_v3.json', import.meta.url)).size < 200_000);
});
