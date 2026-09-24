import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  analyzeRecommendationCellV3,
  evaluateCompatibilityV3,
  isIndependentChaosEvidenceV3,
  MAX_OPTIMIZER_SUPPORTS,
  MAX_REQUIRED_SUPPORTS,
  MAX_TOTAL_SUPPORTS,
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3,
  selectRecommendationPackageV3,
  dedupeCoreProviders,
  validateCoreProviderCompatibility
} from '../js/30-recommendation-v3-selector.js';
import { mergeRecommendationUniqueSemanticsV3, selectNonSkillRecommendations } from '../js/31-non-skill-recommendation-selector.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url)));
const offenseInventory = read('data/offense-inventory.json');
let catalog = read('data/enriched/recommendation_catalog_v3.json');
catalog = mergeRecommendationGrantedSkillAccessV3(catalog, read('data/enriched/recommendation_granted_skill_access_v3.json'));
catalog = mergeRecommendationSkillCraftingV3(catalog, read('data/enriched/recommendation_skill_crafting_v3.json'));
const analyze = (weapon, offense) => analyzeRecommendationCellV3(
  catalog, { weapon, offenseSet: [offense] }, { offenseInventory }
);

test('Unarmed keeps native and provider-granted weapon access distinct', () => {
  const physical = analyze('Unarmed', 'physical');
  const punch = physical.legal.find((candidate) => candidate.entity.name === 'Punch');
  assert.ok(punch?.primaryEligible);
  assert.equal(punch.accessBridge, null);

  const cold = analyze('Unarmed', 'cold');
  const iceStrike = cold.legal.find((candidate) => candidate.entity.name === 'Ice Strike');
  assert.equal(iceStrike.accessBridge.rolledWeapon, 'unarmed');
  assert.equal(iceStrike.accessBridge.effectiveSkillFamily, 'quarterstaff');
  assert.equal(iceStrike.accessBridge.provider.name, 'Hollow Palm Technique');

  const ignite = analyze('Unarmed', 'ignite');
  const perfectStrike = ignite.legal.find((candidate) => candidate.entity.name === 'Perfect Strike');
  assert.equal(perfectStrike.accessBridge.effectiveSkillFamily, 'mace');
  assert.equal(perfectStrike.accessBridge.provider.name, 'Facebreaker');
  assert.ok(!analyze('Bow', 'physical').legal.some((candidate) => candidate.entity.name === 'Punch'));
});

test('Unarmed access packages preserve the roll and surface their required provider', () => {
  const result = selectRecommendationPackageV3(catalog, { weapon: 'Unarmed', offenseSet: ['cold'] }, {
    offenseInventory, selectionSeed: 'unarmed-cold'
  });
  assert.equal(result.packageProfile.weapon, 'unarmed');
  assert.equal(result.solutionClass, 'ACCESS_BRIDGE');
  assert.equal(result.coreProviders[0].name, 'Hollow Palm Technique');
  assert.equal(result.coreProviders[0].required, true);
  const nonSkills = selectNonSkillRecommendations(catalog, { weapon: 'Unarmed', offenseSet: ['cold'] }, result);
  assert.ok(nonSkills.passives.keystones.some((passive) => passive.name === 'Hollow Palm Technique'));
});

test('production Invoker / Unarmed / Chill preserves Hollow Palm for presentation', () => {
  const result = selectRecommendationPackageV3(catalog, {
    ascendancy: 'Invoker', weapon: 'Unarmed', offenseSet: ['chill']
  }, { offenseInventory, selectionSeed: 'invoker-unarmed-chill' });
  const nonSkills = selectNonSkillRecommendations(catalog, {
    ascendancy: 'Invoker', weapon: 'Unarmed', offenseSet: ['chill']
  }, result);
  assert.equal(result.packageProfile.weapon, 'unarmed');
  assert.equal(result.primarySkill.weaponAccess.effectiveSkillFamily, 'quarterstaff');
  assert.equal(result.primarySkill.weaponAccess.provider.name, 'Hollow Palm Technique');
  assert.ok(nonSkills.passives.keystones.some((entry) => entry.name === 'Hollow Palm Technique'));
});

test('Unarmed Lightning automatically discovers Thunderfist-granted Crackling Palm', () => {
  const cracklingPalm = catalog.entities.find((entity) => entity.name === 'Crackling Palm');
  assert.equal(evaluateCompatibilityV3(cracklingPalm, { weapon: 'Unarmed' }).ok, false);
  assert.equal(evaluateCompatibilityV3(cracklingPalm, {
    weapon: 'Unarmed', recommendedUniques: ['Thunderfist']
  }).ok, true);
  const result = Array.from({ length: 30 }, (_, index) => selectRecommendationPackageV3(catalog, {
    weapon: 'Unarmed', offenseSet: ['lightning']
  }, { offenseInventory, selectionSeed: `auto-thunder-${index}` }))
    .find((entry) => entry.primarySkill.name === 'Crackling Palm');
  assert.ok(result, 'Thunderfist-granted Crackling Palm remains in the competitive solution space');
  assert.equal(result.primarySkill.name, 'Crackling Palm');
  assert.equal(result.coreUnique.name, 'Thunderfist');
  assert.equal(result.coreUnique.required, true);
  assert.equal(result.coreUnique.packageRole, 'granted_skill_provider');
  assert.ok(result.bridgePath.some((edge) => edge.type === 'granted_skill'
    && edge.provider === 'Thunderfist' && edge.to === 'Crackling Palm'));
  const nonSkills = selectNonSkillRecommendations(catalog, {
    weapon: 'Unarmed', offenseSet: ['lightning']
  }, result);
  assert.equal(nonSkills.recommendedUniques[0].name, 'Thunderfist');

  const bow = selectRecommendationPackageV3(catalog, {
    weapon: 'Bow', offenseSet: ['lightning']
  }, { offenseInventory, selectionSeed: 'auto-thunder-0' });
  assert.notEqual(bow.coreUnique?.name, 'Thunderfist');
});

test('Poison-derived Chaos taxonomy is directional and independent Chaos proof survives', () => {
  const poison = { relation: 'inflicts', mechanic: 'poison', confidence: 'exact' };
  const taxonomyChaos = { relation: 'has_property', mechanic: 'chaos', confidence: 'exact',
    evidence: [{ kind: 'active_skill_type', value: 'Chaos' }] };
  const poisonOnly = { facts: [poison, taxonomyChaos] };
  assert.equal(isIndependentChaosEvidenceV3(poisonOnly, taxonomyChaos), false);

  const directChaos = { relation: 'fulfills', mechanic: 'chaos', confidence: 'exact',
    evidence: [{ kind: 'stat_id', value: 'base_chaos_damage' }] };
  const mixed = { facts: [poison, taxonomyChaos, directChaos] };
  assert.equal(isIndependentChaosEvidenceV3(mixed, taxonomyChaos), true);
  assert.equal(isIndependentChaosEvidenceV3(mixed, directChaos), true);

  const chaosDot = { relation: 'provides', mechanic: 'chaos', confidence: 'exact',
    evidence: [{ kind: 'skill_description', value: 'Deals Chaos damage over time' }] };
  const conversion = { relation: 'converts', from: 'physical', to: 'chaos', confidence: 'exact' };
  const gain = { relation: 'provides', mechanic: 'chaos', confidence: 'exact',
    source_kind: 'stat_id' };
  for (const fact of [chaosDot, conversion, gain]) {
    assert.equal(isIndependentChaosEvidenceV3({ facts: [poison, fact] }, fact), true);
  }
});

test('production Chaos skill pool rejects Poison-derived taxonomy but preserves mixed semantics', () => {
  const bowChaos = analyze('Bow', 'chaos').direct.map((candidate) => candidate.entity.name);
  assert.ok(!bowChaos.includes('Poisonburst Arrow'));
  assert.ok(!bowChaos.includes('Gas Arrow'));
  assert.ok(!bowChaos.includes('Toxic Domain'));
  const decompose = catalog.entities.find((candidate) => candidate.name === 'Decompose');
  const decomposeChaos = decompose.facts.find((fact) => fact.mechanic === 'chaos'
    && fact.relation === 'modifies');
  assert.equal(isIndependentChaosEvidenceV3(decompose, decomposeChaos), true);
  assert.ok(analyze('Bow', 'poison').direct.some((candidate) => candidate.entity.name === 'Poisonburst Arrow'));
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
  assert.ok(maceIgnite.diagnostics.competitiveCandidates.some((entry) => entry.primarySkill === 'Molten Blast'));
  const repeated = selectRecommendationPackageV3(catalog, { weapon: 'Quarterstaff', offenseSet: ['freeze'] }, {
    offenseInventory, selectionSeed: 'stable-seed'
  });
  const repeatedAgain = selectRecommendationPackageV3(catalog, { weapon: 'Quarterstaff', offenseSet: ['freeze'] }, {
    offenseInventory, selectionSeed: 'stable-seed'
  });
  assert.equal(repeated.primarySkill.entityId, repeatedAgain.primarySkill.entityId);
});

test('DIRECT solves a singleton core before appending top-band alternatives', () => {
  const result = selectRecommendationPackageV3(catalog, { weapon: 'Spear', offenseSet: ['bleed'] }, {
    offenseInventory, selectionSeed: 'direct-regression'
  });
  assert.equal(result.diagnostics.recommendationTier, 'DIRECT');
  assert.ok(result.pieces.length >= 1 && result.pieces.length <= 3);
  assert.equal(result.pieces[0].entityId, result.primarySkill.entityId);
  assert.equal(result.supportingSkill, null);
});

test('skill richness uses only the solved tier top band and preserves its anchor', () => {
  const result = selectRecommendationPackageV3(catalog, { weapon: 'Bow', offenseSet: ['poison'] }, {
    offenseInventory, selectionSeed: 'richness-band'
  });
  assert.ok(result.pieces.length > 1 && result.pieces.length <= 3);
  assert.equal(result.pieces[0].entityId, result.primarySkill.entityId);
  assert.ok(result.pieces.length >= 2);
  assert.equal(new Set(result.pieces.map((skill) => skill.entityId)).size, result.pieces.length);

  const poolLimited = selectRecommendationPackageV3(catalog, { weapon: 'Mace', offenseSet: ['companions'] }, {
    offenseInventory, selectionSeed: 'pool-limited'
  });
  assert.deepEqual(poolLimited.pieces.map((skill) => skill.name), ['Tame Beast']);
});

test('native elemental weapon packages expose DIRECT_NATIVE before bridge routes', () => {
  for (const [weapon, offense] of [['Mace', 'fire'], ['Bow', 'lightning'], ['Quarterstaff', 'cold']]) {
    const result = selectRecommendationPackageV3(catalog, { weapon, offenseSet: [offense] }, {
      offenseInventory, selectionSeed: `native-${weapon}-${offense}`
    });
    assert.equal(result.solutionClass, 'DIRECT_NATIVE');
    assert.equal(result.coreUnique, null);
    assert.ok(result.packageProfile.finalOffense.includes(offense));
    assert.ok(!result.supportAssignments.flatMap((entry) => entry.supports)
      .some((support) => /Attunement/.test(support.name)));
  }
});

test('authoritative item-fact conversions can form a required unique bridge', () => {
  const uniqueCatalog = mergeRecommendationUniqueSemanticsV3(catalog, read('data/enriched/recommendation_unique_semantics_v3.json'));
  const conversionExists = uniqueCatalog.entities.some((item) => item.content_type === 'unique'
    && Object.values(item.unique_offense_semantics || {}).some((semantic) => (semantic.facts || []).some((fact) =>
      fact.c === 'BUILD_DEFINING_CAPABILITY' && fact.r === 'converts' && fact.k === 'item_fact')));
  assert.ok(conversionExists);
  const originalSin = uniqueCatalog.entities.find((item) => item.name === 'Original Sin');
  assert.ok(originalSin?.unique_offense_semantics?.chaos?.facts.some((fact) =>
    fact.r === 'converts' && fact.f === 'elemental_damage' && fact.t === 'chaos' && fact.s === 'outgoing'));
  for (const name of ['Lightning Coil', 'Cloak of Flame', "Apep's Supremacy"]) {
    const defensive = uniqueCatalog.entities.find((item) => item.name === name);
    assert.ok(!(defensive?.unique_offense_semantics?.chaos?.facts || []).some((fact) =>
      fact.r === 'converts' && fact.s !== 'outgoing'));
  }
  const found = ['Mace', 'Bow', 'Quarterstaff', 'Spear', 'Staff', 'Wand', 'Sceptre', 'Talisman', 'Crossbow']
    .map((weapon) => selectRecommendationPackageV3(uniqueCatalog, { weapon, offenseSet: ['chaos'] }, {
      offenseInventory, selectionSeed: `unique-${weapon}`
    })).find((result) => result.coreUnique);
  assert.ok(found, 'expected a production conversion unique to open a Chaos source-skill family');
  assert.equal(found.solutionClass, 'ONE_BRIDGE');
  assert.equal(found.coreUnique.required, true);
  assert.ok(found.bridgePath.some((edge) => edge.type === 'unique' && edge.relation === 'converts'));
  assert.ok(!found.supportAssignments.flatMap((entry) => entry.supports)
    .some((support) => support.name === 'Chaos Attunement'));
});

test('direct and source-proven conversion solutions coexist for production Quarterstaff Chaos', () => {
  const uniqueCatalog = mergeRecommendationUniqueSemanticsV3(catalog, read('data/enriched/recommendation_unique_semantics_v3.json'));
  const results = Array.from({ length: 80 }, (_, index) => selectRecommendationPackageV3(uniqueCatalog,
    { weapon: 'Quarterstaff', offenseSet: ['chaos'] },
    { offenseInventory, selectionSeed: `quarterstaff-chaos-${index}` }));
  assert.ok(results.some((result) => result.primarySkill.name === 'Hand of Chayula' && !result.coreProviders.length));
  const converted = results.find((result) => result.coreProviders.some((provider) => provider.name === 'Original Sin'));
  assert.ok(converted, 'Original Sin conversion should be selectable inside the complete quality band');
  assert.ok(converted.bridgePath.some((edge) => edge.provider === 'Original Sin' && edge.from === 'elemental_damage'));
  assert.equal(converted.diagnostics.providerCompatibility.ok, true);
});

test('multi-provider packages retain every necessary compatible provider and surface each unique', () => {
  const uniqueCatalog = mergeRecommendationUniqueSemanticsV3(catalog, read('data/enriched/recommendation_unique_semantics_v3.json'));
  const results = Array.from({ length: 100 }, (_, index) => selectRecommendationPackageV3(uniqueCatalog,
    { weapon: 'Unarmed', offenseSet: ['chaos'] },
    { offenseInventory, selectionSeed: `unarmed-chaos-${index}` }));
  const multi = results.find((result) => result.coreProviders.length >= 2);
  assert.ok(multi, 'expected a production Unarmed access provider plus Original Sin route');
  assert.ok(multi.coreProviders.some((provider) => provider.name === 'Original Sin'));
  assert.ok(multi.bridgePath.some((edge) => edge.type === 'weapon_access' || edge.type === 'granted_skill'));
  assert.ok(multi.bridgePath.some((edge) => edge.provider === 'Original Sin'));
  const presented = selectNonSkillRecommendations(uniqueCatalog, { weapon: 'Unarmed', offenseSet: ['chaos'] }, multi);
  for (const provider of multi.coreProviders.filter((entry) => entry.providerType === 'unique')) {
    assert.ok(presented.recommendedUniques.some((entry) => entry.name === provider.name));
  }
  const candidates = results[0].diagnostics.competitiveCandidates;
  assert.ok(candidates.some((entry) => entry.providers.includes('Hollow Palm Technique')
    && entry.providers.includes('Original Sin')));
  assert.ok(candidates.some((entry) => entry.providers.includes('Facebreaker')
    && entry.providers.includes('Original Sin')));
});

test('core-provider equipment capacity is generic and identities are deduplicated', () => {
  const facebreaker = { id: 'facebreaker', name: 'Facebreaker', providerType: 'unique', slot: 'Gloves' };
  const originalSin = { id: 'original-sin', name: 'Original Sin', providerType: 'unique', slot: 'Ring' };
  const hollowPalm = { id: 'hollow-palm', name: 'Hollow Palm Technique', providerType: 'keystone' };
  const thunderfist = { id: 'thunderfist', name: 'Thunderfist', providerType: 'unique', slot: 'Gloves' };
  assert.equal(validateCoreProviderCompatibility([facebreaker, originalSin]).ok, true);
  assert.equal(validateCoreProviderCompatibility([hollowPalm, originalSin]).ok, true);
  assert.equal(validateCoreProviderCompatibility([facebreaker, thunderfist]).ok, false);
  assert.equal(dedupeCoreProviders([facebreaker, { ...facebreaker }]).length, 1);
});

test('production ailment bridge facts require enemy-targeted offensive application', () => {
  const uniqueCatalog = mergeRecommendationUniqueSemanticsV3(catalog, read('data/enriched/recommendation_unique_semantics_v3.json'));
  for (const [name, offense] of [['The Pandemonius', 'chill'], ['Coat of Red', 'bleed']]) {
    const item = uniqueCatalog.entities.find((entity) => entity.name === name);
    assert.ok(!(item?.unique_offense_semantics?.[offense]?.facts || []).some((fact) =>
      fact.r === 'inflicts' && fact.s === 'outgoing' && fact.a === 'enemy'));
  }
  const snakebite = uniqueCatalog.entities.find((entity) => entity.name === 'Snakebite');
  assert.ok(snakebite?.unique_offense_semantics?.poison?.facts.some((fact) =>
    fact.r === 'inflicts' && fact.s === 'outgoing' && fact.a === 'enemy' && fact.d === 'generic_hit'));
});

test('one compatible enabling support forms CARRIER_BRIDGE ahead of fallback', () => {
  const result = selectRecommendationPackageV3(catalog, { weapon: 'Mace', offenseSet: ['bleed'] }, {
    offenseInventory, selectionSeed: 'bridge-regression'
  });
  assert.equal(result.diagnostics.recommendationTier, 'ONE_BRIDGE');
  assert.equal(result.solutionClass, 'ONE_BRIDGE');
  assert.ok(result.pieces.length >= 1 && result.pieces.length <= 3);
  assert.equal(result.supportingSkill, null);
  const supports = result.supportAssignments[0].supports;
  assert.equal(supports.filter((support) => support.assignedRole !== 'OPTIONAL_OFFENSE_OPTIMIZER').length, 1);
  assert.ok(result.supportAssignments.every((entry) => entry.supports.length <= MAX_TOTAL_SUPPORTS));
});

test('optional Offense optimizers attach after, and never participate in, fulfillment', () => {
  assert.deepEqual([MAX_REQUIRED_SUPPORTS, MAX_OPTIMIZER_SUPPORTS, MAX_TOTAL_SUPPORTS], [2, 3, 3]);
  for (const [weapon, offense, tier] of [
    ['Quarterstaff', 'freeze', 'DIRECT'],
    ['Crossbow', 'shock', 'DIRECT'],
    ['Mace', 'ignite', 'DIRECT'],
    ['Spear', 'bleed', 'DIRECT'],
    ['Bow', 'poison', 'DIRECT'],
    ['Mace', 'freeze', 'ONE_BRIDGE']
  ]) {
    const result = selectRecommendationPackageV3(catalog, { weapon, offenseSet: [offense] }, {
      offenseInventory, selectionSeed: `optimizer-${weapon}-${offense}`
    });
    const supports = result.supportAssignments.flatMap((entry) => entry.supports);
    const optimizer = supports.find((support) => support.assignedRole === 'OPTIONAL_OFFENSE_OPTIMIZER');
    if (!optimizer) continue;
    assert.equal(result.diagnostics.recommendationTier, tier);
    assert.deepEqual(optimizer.fulfilledObligations, []);
    assert.deepEqual(optimizer.suppliedTargets, []);
    assert.equal(supports.at(-1).assignedRole, 'OPTIONAL_OFFENSE_OPTIMIZER');
    assert.ok(result.supportAssignments.every((entry) => entry.supports.length <= MAX_TOTAL_SUPPORTS));
    assert.equal(result.unresolved.length, 0);
  }
});

test('optimizer is deterministic, family-safe, and conservative for damage identities', () => {
  const run = (seed) => selectRecommendationPackageV3(catalog,
    { weapon: 'Quarterstaff', offenseSet: ['freeze'] }, { offenseInventory, selectionSeed: seed });
  const names = (result) => result.supportAssignments.flatMap((entry) => entry.supports)
    .filter((support) => support.assignedRole === 'OPTIONAL_OFFENSE_OPTIMIZER').map((support) => support.name);
  assert.deepEqual(names(run('same-optimizer')), names(run('same-optimizer')));
  for (const offense of ['physical', 'fire', 'cold', 'lightning', 'chaos']) {
    const result = selectRecommendationPackageV3(catalog, { weapon: 'Quarterstaff', offenseSet: [offense] }, {
      offenseInventory, selectionSeed: `no-filler-${offense}`
    });
    assert.equal(names(result).length, 0);
  }
  const chain = selectRecommendationPackageV3(catalog, { weapon: 'Mace', offenseSet: ['electrocute'] }, {
    offenseInventory, selectionSeed: 'chain-capacity'
  });
  assert.equal(chain.diagnostics.recommendationTier, 'SUPPORT_CHAIN');
  assert.equal(chain.diagnostics.assignedRequiredSupportCount, 2);
  assert.ok(chain.diagnostics.assignedOptimizerSupportCount <= 1);
  assert.ok(chain.supportAssignments.every((entry) => entry.supports.length <= 3));
});

test('SUPPORT_CHAIN can use its full required capacity before one safe optimizer', () => {
  const targetTemplate = catalog.entities.find((entity) => entity.content_type === 'support_gem'
    && entity.compatibility?.target_skill);
  const optimizer = {
    ...targetTemplate,
    id: 'test:electrocute-optimizer',
    source_id: 'test:electrocute-optimizer',
    name: 'Test Electrocute Buildup',
    support_family: { id: 'test:electrocute-buildup', name: 'Test Electrocute Buildup', tier: 1 },
    retrieval_terms: [],
    provenance: { source_tags: [] },
    compatibility: { target_skill: {} },
    facts: [{ subject: 'supported_skill', relation: 'modifies', mechanic: 'electrocute',
      confidence: 'exact', evidence: [{ value: 'More Electrocute buildup' }] }]
  };
  const run = (extraFacts = [], sourceTags = []) => selectRecommendationPackageV3({
    ...catalog,
    entities: [...catalog.entities, { ...optimizer,
      provenance: { source_tags: sourceTags }, facts: [...optimizer.facts, ...extraFacts] }]
  }, { weapon: 'Mace', offenseSet: ['electrocute'] }, {
    offenseInventory, selectionSeed: 'synthetic-chain-optimizer'
  });
  const safe = run();
  assert.equal(safe.diagnostics.recommendationTier, 'SUPPORT_CHAIN');
  assert.deepEqual(safe.supportAssignments[0].supports.map((support) => support.assignedRole), [
    'REQUIRED_PREREQUISITE_SUPPORT', 'REQUIRED_ENABLE_SUPPORT', 'OPTIONAL_OFFENSE_OPTIMIZER'
  ]);
  assert.equal(safe.diagnostics.assignedRequiredSupportCount, 2);
  assert.equal(safe.diagnostics.assignedOptimizerSupportCount, 1);
  for (const [facts, tags] of [
    [[{ subject: 'supported_skill', relation: 'prevents', mechanic: 'electrocute', confidence: 'exact' }], []],
    [[{ subject: 'supported_skill', relation: 'consumes', mechanic: 'electrocute', confidence: 'exact' }], []],
    [[], ['lineage']],
    [[], ['kalguuran']]
  ]) {
    const rejected = run(facts, tags);
    assert.equal(rejected.diagnostics.recommendationTier, 'SUPPORT_CHAIN');
    assert.equal(rejected.diagnostics.assignedOptimizerSupportCount, 0);
    assert.equal(rejected.diagnostics.assignedRequiredSupportCount, 2);
  }
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
  for (const weapon of ['Staff', 'Wand', 'Sceptre']) {
    const cell = analyze(weapon, 'companions');
    assert.equal(cell.classification, 'DIRECT');
    assert.ok(cell.direct.some((candidate) => candidate.entity.name === 'Tame Beast'));
    assert.ok(!cell.direct.some((candidate) => candidate.entity.name === 'Shockwave Totem'));
  }
  assert.ok(!analyze('Bow', 'companions').direct.some((candidate) => candidate.entity.name === 'Rhoa Mount'));
});

test('caster archetype exemption follows typed semantics rather than skill identity', () => {
  const renamedCatalog = structuredClone(catalog);
  const tame = renamedCatalog.entities.find((entity) => entity.name === 'Tame Beast');
  tame.name = 'Generic Companion Fixture';
  for (const weapon of ['Staff', 'Wand', 'Sceptre']) {
    const cell = analyzeRecommendationCellV3(
      renamedCatalog, { weapon, offenseSet: ['companions'] }, { offenseInventory }
    );
    assert.ok(cell.direct.some((candidate) => candidate.entity.name === 'Generic Companion Fixture'));
  }

  const nonArchetypeCatalog = structuredClone(renamedCatalog);
  const fixture = nonArchetypeCatalog.entities.find((entity) => entity.name === 'Generic Companion Fixture');
  fixture.facts = fixture.facts.filter((fact) =>
    !['creates', 'fulfills', 'provides'].includes(fact.relation)
      || !['companion', 'minion', 'totem'].includes(String(fact.mechanic).toLowerCase())
  );
  assert.ok(!analyzeRecommendationCellV3(
    nonArchetypeCatalog, { weapon: 'Wand', offenseSet: ['companions'] }, { offenseInventory }
  ).direct.some((candidate) => candidate.entity.name === 'Generic Companion Fixture'));
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
    assert.equal(result.diagnostics.recommendationTier, 'ONE_BRIDGE');
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
  assert.deepEqual(result.supportAssignments[0].supports
    .map((support) => [support.name, support.assignedRole]), [
    ['Lightning Attunement', 'REQUIRED_PREREQUISITE_SUPPORT'],
    ['Electrocute', 'REQUIRED_ENABLE_SUPPORT']
  ]);
  assert.equal(result.unresolved.length, 0);
});

test('caster Companion cells resolve directly without support-chain fallback', () => {
  for (const weapon of ['Staff', 'Wand', 'Sceptre']) {
    const cell = analyze(weapon, 'companions');
    assert.equal(cell.classification, 'DIRECT');
    assert.equal(cell.supportChains.length, 0);
  }
});
