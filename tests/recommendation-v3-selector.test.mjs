import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const selectorSource = await readFile(
  new URL('../js/30-recommendation-v3-selector.js', import.meta.url),
  'utf8'
);
const selector = await import(`data:text/javascript;base64,${Buffer.from(selectorSource).toString('base64')}`);

const {
  adaptRecommendationPackageV3ToSnapshot,
  buildRecommendationObligationsV3,
  evaluateDeliveryCompatibilityV3,
  isEquipmentCompatibleV3,
  isRecommendationContentAllowedV3,
  isRecommendationV3Enabled,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3
} = selector;

function offenseInventory() {
  return {
    elements: [
      { id: 'poison', name: 'Poison', category: 'Ailment', aliases: [] },
      { id: 'shock', name: 'Shock', category: 'Ailment', aliases: [] },
      { id: 'physical', name: 'Physical Damage', category: 'Damage Type', aliases: [] },
      { id: 'fire', name: 'Fire Damage', category: 'Damage Type', aliases: [] },
      { id: 'chaos', name: 'Chaos Damage', category: 'Damage Type', aliases: [] },
      { id: 'critical_hits', name: 'Critical Hits', category: 'Scaling', aliases: ['Crit'] },
      { id: 'minions_companions', name: 'Minions/Companions', category: 'Archetype', aliases: ['Minions'] }
    ]
  };
}

function entity({
  id,
  name,
  facts,
  equipment = { is_unrestricted: true },
  types = ['Spell', 'Damage'],
  sourceTags = [],
  roles = ['primary_damage'],
  description = ''
}) {
  return {
    id: `skill:${id}`,
    source_id: id,
    content_type: 'active_skill',
    name,
    candidate_roles: roles,
    retrieval_terms: [],
    facts,
    compatibility: { equipment },
    source_evidence: { active_skill_types: types, description },
    provenance: { source_tags: sourceTags }
  };
}

function catalog(entities) {
  return {
    _meta: { schema_version: 'recommendation-catalog-v3.0.0' },
    entities
  };
}

test('feature flag is explicit and supports a test override', () => {
  assert.equal(isRecommendationV3Enabled({ location: { search: '' } }), false);
  assert.equal(isRecommendationV3Enabled({ location: { search: '?recommendationV3=1' } }), true);
  assert.equal(isRecommendationV3Enabled({ location: { search: '?recommendationV3=false' } }), false);
  assert.equal(isRecommendationV3Enabled({ RandomancerRecommendationV3Enabled: true }), true);
  assert.equal(isRecommendationV3Enabled({ RandomancerRecommendationV3Enabled: false, location: { search: '?recommendationV3=1' } }), false);
});

test('catalog validation rejects missing and stale schemas', () => {
  assert.equal(validateRecommendationCatalogV3(null).ok, false);
  assert.equal(validateRecommendationCatalogV3({ _meta: { schema_version: 'v2' }, entities: [] }).ok, false);
  assert.equal(validateRecommendationCatalogV3(catalog([])).ok, true);
});

test('canonical Offense fields win over the legacy compatibility fields', () => {
  const result = buildRecommendationObligationsV3({
    offenseList: ['Poison'],
    ailmentList: ['Fire Damage'],
    weapon: 'Bow',
    defense: 'Evasion'
  }, offenseInventory());

  const offense = result.obligations.filter((entry) => entry.kind === 'offense');
  assert.deepEqual(offense.map((entry) => entry.id), ['offense:poison']);
  assert.equal(result.context.weapon, 'Bow');
  assert.equal(result.context.primaryDefense, 'Evasion');
});

test('equipment compatibility distinguishes bow/crossbow and staff/quarterstaff', () => {
  const requires = (tag) => ({
    compatibility: {
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: [tag],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: [tag],
        display: `Requires ${tag}`
      }
    }
  });

  assert.equal(isEquipmentCompatibleV3(requires('bow'), { weapon: 'Bow' }), true);
  assert.equal(isEquipmentCompatibleV3(requires('bow'), { weapon: 'Crossbow' }), false);
  assert.equal(isEquipmentCompatibleV3(requires('staff'), { weapon: 'Staff' }), true);
  assert.equal(isEquipmentCompatibleV3(requires('staff'), { weapon: 'Quarterstaff' }), false);
});

test('selector uses hard typed evidence, rejects prevention, and ignores cohesion', () => {
  const poisonFact = { relation: 'inflicts', subject: 'skill', mechanic: 'poison', confidence: 'exact' };
  const weaponEquipment = (family) => ({
    is_unrestricted: false,
    mainhand_tags_any_of: [family],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: [family],
    display: `Requires ${family}`
  });
  const fixtures = catalog([
    entity({
      id: 'bow-poison',
      name: 'Bow Poison',
      facts: [poisonFact],
      equipment: weaponEquipment('bow'),
      types: ['Attack', 'Bow']
    }),
    entity({
      id: 'crossbow-poison',
      name: 'Crossbow Poison',
      facts: [poisonFact],
      equipment: weaponEquipment('crossbow'),
      types: ['Attack', 'Crossbow']
    }),
    entity({
      id: 'poison-modifier',
      name: 'Poison Modifier',
      facts: [{ relation: 'modifies', subject: 'skill', mechanic: 'poison', confidence: 'strong' }],
      equipment: weaponEquipment('bow'),
      types: ['Attack', 'Bow']
    }),
    entity({
      id: 'poison-preventer',
      name: 'Poison Preventer',
      facts: [
        poisonFact,
        { relation: 'prevents', subject: 'skill', mechanic: 'poison', confidence: 'exact' }
      ],
      equipment: weaponEquipment('bow'),
      types: ['Attack', 'Bow']
    })
  ]);
  const snapshot = { weapon: 'Bow', offhand: 'Quiver', offenseList: ['Poison'] };
  const strict = selectRecommendationPackageV3(fixtures, snapshot, {
    offenseInventory: offenseInventory(),
    cohesion: 1
  });
  const madness = selectRecommendationPackageV3(fixtures, snapshot, {
    offenseInventory: offenseInventory(),
    cohesion: 0
  });

  assert.equal(strict.primarySkill?.name, 'Bow Poison');
  assert.equal(madness.primarySkill?.entityId, strict.primarySkill?.entityId);
  assert.deepEqual(
    strict.primarySkill.fulfilledObligations.map((entry) => entry.obligationId),
    ['offense:poison']
  );
  assert.equal(strict.status, 'partial');
  assert.ok(strict.unresolved.some((entry) => entry.obligationId === 'survivability:secondary_defense'));
  assert.ok(strict.unresolved.some((entry) => entry.obligationId === 'survivability:recovery'));
});

test('weapon delivery rejects generic spells for martial rolls', () => {
  const bowEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['bow'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['bow'],
    display: 'Requires Bow'
  };
  const fixtures = catalog([
    entity({
      id: 'chaos-bolt',
      name: 'Chaos Bolt',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'chaos', confidence: 'exact' }],
      types: ['Spell', 'Chaos']
    }),
    entity({
      id: 'bow-chaos',
      name: 'Bow Chaos',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'chaos', confidence: 'exact' }],
      equipment: bowEquipment,
      types: ['Attack', 'Bow', 'Chaos']
    }),
    entity({
      id: 'unearth',
      name: 'Unearth',
      facts: [
        { relation: 'creates', subject: 'skill', mechanic: 'minion', confidence: 'exact' },
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }
      ],
      types: ['Spell', 'CreatesMinion', 'Physical']
    })
  ]);

  const bow = selectRecommendationPackageV3(fixtures, {
    weapon: 'Bow',
    offenseList: ['Chaos Damage']
  }, { offenseInventory: offenseInventory() });
  const spear = selectRecommendationPackageV3(fixtures, {
    weapon: 'Spear',
    offenseList: ['Minions/Companions']
  }, { offenseInventory: offenseInventory() });
  const sceptre = selectRecommendationPackageV3(fixtures, {
    weapon: 'Sceptre',
    offenseList: ['Physical Damage']
  }, {
    offenseInventory: {
      elements: [{ id: 'physical', name: 'Physical Damage', category: 'Damage Type', aliases: [] }]
    }
  });

  assert.equal(bow.primarySkill?.name, 'Bow Chaos');
  assert.equal(spear.primarySkill, null);
  assert.equal(sceptre.primarySkill?.name, 'Unearth');
  assert.equal(evaluateDeliveryCompatibilityV3(fixtures.entities[0], { weapon: 'Bow' }).ok, false);
  assert.equal(evaluateDeliveryCompatibilityV3(fixtures.entities[2], { weapon: 'Spear' }).ok, false);
  assert.equal(evaluateDeliveryCompatibilityV3(fixtures.entities[2], { weapon: 'Sceptre' }).ok, true);
});

test('seeded quality-band selection varies legally and is reproducible', () => {
  const fixtures = catalog(['Arc One', 'Arc Two', 'Arc Three'].map((name, index) => entity({
    id: `arc-${index + 1}`,
    name,
    facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' }],
    types: ['Spell', 'Damage', 'Lightning']
  })));
  const offense = {
    elements: [{ id: 'lightning', name: 'Lightning Damage', category: 'Damage Type', aliases: [] }]
  };
  const snapshot = { weapon: 'Wand', offenseList: ['Lightning Damage'] };
  const selections = new Set();

  for (let index = 0; index < 32; index += 1) {
    const result = selectRecommendationPackageV3(fixtures, snapshot, {
      offenseInventory: offense,
      selectionSeed: `roll-${index}`
    });
    selections.add(result.primarySkill?.entityId);
  }
  const first = selectRecommendationPackageV3(fixtures, snapshot, {
    offenseInventory: offense,
    selectionSeed: 'persistent-roll'
  });
  const repeated = selectRecommendationPackageV3(fixtures, snapshot, {
    offenseInventory: offense,
    selectionSeed: 'persistent-roll'
  });
  const nextRoll = selectRecommendationPackageV3(fixtures, snapshot, {
    offenseInventory: offense,
    selectionSeed: 'persistent-roll',
    previousPrimaryEntityId: first.primarySkill?.entityId
  });

  assert.ok(selections.size > 1);
  assert.equal(repeated.primarySkill?.entityId, first.primarySkill?.entityId);
  assert.equal(repeated.selectionSeed, 'persistent-roll');
  assert.notEqual(nextRoll.primarySkill?.entityId, first.primarySkill?.entityId);
  assert.equal(first.diagnostics.shortlistedCandidates, 3);
});

test('scaling obligations may be fulfilled by a hard modifies fact', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'critical-skill',
      name: 'Critical Skill',
      facts: [{ relation: 'modifies', subject: 'skill', mechanic: 'critical_hits', confidence: 'strong' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Crit'] }, { offenseInventory: offenseInventory() });

  assert.equal(result.primarySkill?.name, 'Critical Skill');
  assert.equal(result.primarySkill?.fulfilledObligations[0]?.obligationId, 'offense:critical_hits');
});

test('native damage can carry an ailment without falsely fulfilling its application', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'lightning-carrier',
      name: 'Lightning Carrier',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Shock'] }, { offenseInventory: offenseInventory() });

  assert.equal(result.primarySkill?.name, 'Lightning Carrier');
  assert.deepEqual(result.primarySkill?.fulfilledObligations, []);
  assert.deepEqual(result.primarySkill?.carrierObligations.map((entry) => entry.obligationId), ['offense:shock']);
  assert.ok(result.unresolved.some((entry) =>
    entry.obligationId === 'offense:shock' && entry.reason.includes('another package piece')
  ));
});

test('a companion skill resolves an explicit ailment gap without replacing the primary carrier', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'lightning-carrier',
      name: 'Lightning Carrier',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' }]
    }),
    entity({
      id: 'shock-setup',
      name: 'Shock Setup',
      roles: ['setup_control'],
      types: ['Spell'],
      facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'shock', confidence: 'strong' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Shock'] }, {
    offenseInventory: offenseInventory(),
    selectionSeed: 'companion-gap'
  });

  assert.equal(result.primarySkill?.name, 'Lightning Carrier');
  assert.equal(result.supportingSkill?.name, 'Shock Setup');
  assert.equal(result.supportingSkill?.assignedRole, 'setup_control');
  assert.deepEqual(result.pieces.map((entry) => entry.name), ['Lightning Carrier', 'Shock Setup']);
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:shock'));
});

test('the package selector does not add an unrelated filler skill', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'fire-primary',
      name: 'Fire Primary',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }]
    }),
    entity({
      id: 'curse-setup',
      name: 'Curse Setup',
      roles: ['setup_control'],
      types: ['Spell'],
      facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'curse', confidence: 'strong' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Fire Damage'] }, { offenseInventory: offenseInventory() });

  assert.equal(result.primarySkill?.name, 'Fire Primary');
  assert.equal(result.supportingSkill, null);
  assert.equal(result.pieces.length, 1);
});

test('Kalguuran source-tagged skills are not eligible recommendation content', () => {
  const seasonal = entity({
    id: 'seasonal-fire',
    name: 'Seasonal Fire',
    facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }],
    sourceTags: ['kalguuran']
  });
  const permanent = entity({
    id: 'permanent-fire',
    name: 'Permanent Fire',
    facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }]
  });
  const result = selectRecommendationPackageV3(catalog([seasonal, permanent]), {
    weapon: 'Wand',
    offenseList: ['Fire Damage']
  }, { offenseInventory: offenseInventory(), selectionSeed: 'seasonal-filter' });

  assert.equal(isRecommendationContentAllowedV3(seasonal), false);
  assert.equal(isRecommendationContentAllowedV3(permanent), true);
  assert.equal(result.primarySkill?.name, 'Permanent Fire');
  assert.equal(result.diagnostics.excludedContentCandidates, 1);
});

test('Kalguuran and description-only DNT skills are excluded from companion selection', () => {
  const primary = entity({
    id: 'lightning-carrier',
    name: 'Lightning Carrier',
    facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' }]
  });
  const setup = (id, name, options = {}) => entity({
    id,
    name,
    roles: ['setup_control'],
    types: ['Spell'],
    facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'shock', confidence: 'strong' }],
    ...options
  });
  const result = selectRecommendationPackageV3(catalog([
    primary,
    setup('seasonal-setup', 'Seasonal Setup', { sourceTags: ['kalguuran'] }),
    setup('hidden-dnt', 'Polished Name', { description: '[DNT-UNUSED] Internal skill.' }),
    setup('permanent-setup', 'Permanent Setup')
  ]), { weapon: 'Wand', offenseList: ['Shock'] }, {
    offenseInventory: offenseInventory(),
    selectionSeed: 'companion-content-filter'
  });

  assert.equal(result.supportingSkill?.name, 'Permanent Setup');
});

test('only explicit requires facts become unresolved dependencies', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'fire-payoff',
      name: 'Fire Payoff',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'infusion', confidence: 'exact' },
        { relation: 'requires', subject: 'skill', mechanic: 'power_charge', confidence: 'strong' }
      ]
    })
  ]), { weapon: 'Wand', offenseList: ['Fire Damage'] }, { offenseInventory: offenseInventory() });

  assert.deepEqual(result.primarySkill?.dependencies, ['power_charge']);
  assert.deepEqual(result.primarySkill?.setupCosts, ['infusion']);
  assert.ok(result.unresolved.some((entry) => entry.obligationId === 'dependency:power_charge'));
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'dependency:infusion'));
});

test('a companion enabler can satisfy an explicit primary dependency', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'fire-payoff',
      name: 'Fire Payoff',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
        { relation: 'requires', subject: 'skill', mechanic: 'power_charge', confidence: 'strong' }
      ]
    }),
    entity({
      id: 'charge-enabler',
      name: 'Charge Enabler',
      roles: ['enabler', 'setup_control'],
      types: ['Spell'],
      facts: [{ relation: 'generates', subject: 'skill', mechanic: 'power_charge', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Fire Damage'] }, {
    offenseInventory: offenseInventory(),
    selectionSeed: 'dependency-package'
  });

  assert.equal(result.supportingSkill?.name, 'Charge Enabler');
  assert.equal(result.supportingSkill?.assignedRole, 'enabler');
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'dependency:power_charge'));
});

test('a no-damage base effect does not disqualify the damaging composite skill', () => {
  const spearEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['spear'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['spear'],
    display: 'Requires Spear'
  };
  const fixtures = catalog([
    entity({
      id: 'scoped-no-damage',
      name: 'Scoped No Damage',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        {
          relation: 'prevents',
          subject: 'skill',
          mechanic: 'damage',
          condition: 'base_effect_only',
          confidence: 'exact'
        }
      ],
      equipment: spearEquipment,
      types: ['Attack', 'Damage', 'Spear']
    }),
    entity({
      id: 'unscoped-no-damage',
      name: 'Unscoped No Damage',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'prevents', subject: 'skill', mechanic: 'damage', confidence: 'exact' }
      ],
      equipment: spearEquipment,
      types: ['Attack', 'Damage', 'Spear']
    })
  ]);
  const result = selectRecommendationPackageV3(fixtures, {
    weapon: 'Spear',
    offenseList: ['Physical Damage']
  }, { offenseInventory: offenseInventory() });

  assert.equal(result.primarySkill?.name, 'Scoped No Damage');
  assert.equal(result.diagnostics.rankedCandidates, 1);
});

test('runtime adapter preserves package diagnostics while using the current skill field', () => {
  const packageResult = {
    schemaVersion: 'recommendation-package-v3.0.0',
    primarySkill: {
      entityId: 'skill:test',
      sourceId: 'test',
      name: 'Test Skill',
      assignedRole: 'primary_damage',
      fulfilledObligations: [{ obligationId: 'offense:fire' }]
    }
  };
  const adapted = adaptRecommendationPackageV3ToSnapshot(packageResult);
  assert.equal(adapted.recommendedSkills[0].name, 'Test Skill');
  assert.equal(adapted.recommendationV3, packageResult);
});

test('runtime adapter writes both primary and supporting skills in package order', () => {
  const packageResult = {
    schemaVersion: 'recommendation-package-v3.0.0',
    primarySkill: { entityId: 'skill:primary', sourceId: 'primary', name: 'Primary', assignedRole: 'primary_damage' },
    supportingSkill: { entityId: 'skill:setup', sourceId: 'setup', name: 'Setup', assignedRole: 'setup_control' },
    pieces: [
      { entityId: 'skill:primary', sourceId: 'primary', name: 'Primary', assignedRole: 'primary_damage' },
      { entityId: 'skill:setup', sourceId: 'setup', name: 'Setup', assignedRole: 'setup_control' }
    ]
  };
  const adapted = adaptRecommendationPackageV3ToSnapshot(packageResult);

  assert.deepEqual(adapted.recommendedSkills.map((entry) => entry.name), ['Primary', 'Setup']);
  assert.deepEqual(
    adapted.recommendedSkills.map((entry) => entry.recommendationV3.assignedRole),
    ['primary_damage', 'setup_control']
  );
});

test('recommendation contract and Build Card preserve two role-labeled skill ideas', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.window = {
    RANDOMANCER: {},
    DATA: { gems: [] },
    addEventListener() {},
    matchMedia() { return { matches: false }; }
  };
  globalThis.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    body: { appendChild() {} }
  };
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };

  try {
    const [{ normalizeRecommendationContract }, { deriveBuildCardModel }] = await Promise.all([
      import(new URL('../js/22-recommendation-contract.js', import.meta.url)),
      import(new URL('../js/23-build-card-foundation.js', import.meta.url))
    ]);
    const snapshot = normalizeRecommendationContract({
      buildName: 'Package Test',
      weapon: 'Crossbow',
      recommendedSkills: [
        { name: 'Primary', recommendationV3: { assignedRole: 'primary_damage' } },
        { name: 'Setup', recommendationV3: { assignedRole: 'setup_control' } },
        { name: 'Filler' }
      ]
    });
    const skillSection = deriveBuildCardModel(snapshot).backSections.find((entry) => entry.label === 'Skill Ideas');

    assert.deepEqual(snapshot.recommendedSkills.map((entry) => entry.name), ['Primary', 'Setup']);
    assert.deepEqual(skillSection.values.map((entry) => entry.name), ['Primary', 'Setup']);
    assert.deepEqual(skillSection.values.map((entry) => entry.prefix), ['Primary', 'Setup']);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.localStorage = previousLocalStorage;
  }
});

test('runtime adapter does not erase the existing recommendation when v3 has no primary', () => {
  const adapted = adaptRecommendationPackageV3ToSnapshot({
    schemaVersion: 'recommendation-package-v3.0.0',
    status: 'unresolved',
    primarySkill: null
  });

  assert.equal(Object.hasOwn(adapted, 'recommendedSkills'), false);
  assert.equal(adapted.recommendationV3.status, 'unresolved');
});

test('committed catalog produces a legal primary skill for representative rolls', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const snapshots = [
    { weapon: 'Bow', offhand: 'Quiver', offenseList: ['Poison'] },
    { weapon: 'Quarterstaff', offhand: '', offenseList: ['Lightning Damage'] },
    { weapon: 'Sceptre', offhand: 'Focus', offenseList: ['Minions/Companions'] }
  ];

  for (const snapshot of snapshots) {
    const result = selectRecommendationPackageV3(realCatalog, snapshot, { offenseInventory: realOffense });
    assert.ok(result.primarySkill, `expected a primary skill for ${snapshot.offenseList[0]}`);
    assert.equal(isEquipmentCompatibleV3(
      realCatalog.entities.find((entry) => entry.id === result.primarySkill.entityId),
      snapshot
    ), true);
    assert.equal(evaluateDeliveryCompatibilityV3(
      realCatalog.entities.find((entry) => entry.id === result.primarySkill.entityId),
      snapshot
    ).ok, true);
    assert.ok(result.primarySkill.fulfilledObligations.length > 0);
    assert.doesNotMatch(result.primarySkill.name, /^\s*\[?DNT/i);
  }
});

test('committed catalog remains deterministic and equipment-legal across the roll matrix', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const weapons = [
    'Two-handed Mace', 'Two-handed Axe', 'Two-handed Sword', 'Bow', 'Crossbow',
    'Quarterstaff', 'Staff', 'One-handed Mace', 'One-handed Axe', 'One-handed Sword',
    'Claw', 'Dagger', 'Flail', 'Spear', 'Wand', 'Sceptre', 'Talisman', 'Unarmed'
  ];

  for (const weapon of weapons) {
    for (const offense of realOffense.elements) {
      const snapshot = { weapon, offenseList: [offense.name] };
      const first = selectRecommendationPackageV3(realCatalog, snapshot, { offenseInventory: realOffense });
      const second = selectRecommendationPackageV3(realCatalog, snapshot, { offenseInventory: realOffense });
      assert.equal(second.primarySkill?.entityId, first.primarySkill?.entityId, `${weapon} / ${offense.name}`);
      if (!first.primarySkill) continue;
      const selected = realCatalog.entities.find((entry) => entry.id === first.primarySkill.entityId);
      assert.equal(isEquipmentCompatibleV3(selected, snapshot), true, `${weapon} / ${offense.name}`);
      assert.equal(evaluateDeliveryCompatibilityV3(selected, snapshot).ok, true, `${weapon} / ${offense.name}`);
      assert.ok(
        first.primarySkill.fulfilledObligations.length + first.primarySkill.carrierObligations.length > 0,
        `${weapon} / ${offense.name}`
      );
      assert.doesNotMatch(first.primarySkill.name, /^\s*(?:\[?DNT|playtest\b|prototype\b)/i, `${weapon} / ${offense.name}`);
      assert.equal(isRecommendationContentAllowedV3(selected), true, `${weapon} / ${offense.name}`);
      assert.equal(new Set(first.pieces.map((entry) => entry.name)).size, first.pieces.length, `${weapon} / ${offense.name}`);
      for (const piece of first.pieces) {
        const pieceEntity = realCatalog.entities.find((entry) => entry.id === piece.entityId);
        assert.equal(isEquipmentCompatibleV3(pieceEntity, snapshot), true, `${weapon} / ${offense.name}`);
        assert.equal(isRecommendationContentAllowedV3(pieceEntity), true, `${weapon} / ${offense.name}`);
      }
    }
  }
});

test('committed catalog never selects Chaos Bolt for Bow or Unearth for Spear', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const bow = selectRecommendationPackageV3(realCatalog, {
    weapon: 'Bow',
    offhand: 'Quiver',
    offenseList: ['Chaos Damage', 'Bleed']
  }, { offenseInventory: realOffense, selectionSeed: 'screenshot-bow' });
  const spear = selectRecommendationPackageV3(realCatalog, {
    weapon: 'Spear',
    offenseList: ['Minions/Companions']
  }, { offenseInventory: realOffense, selectionSeed: 'screenshot-spear' });

  assert.notEqual(bow.primarySkill?.name, 'Chaos Bolt');
  assert.notEqual(spear.primarySkill?.name, 'Unearth');
  if (bow.primarySkill) {
    const selected = realCatalog.entities.find((entry) => entry.id === bow.primarySkill.entityId);
    assert.equal(evaluateDeliveryCompatibilityV3(selected, { weapon: 'Bow' }).ok, true);
  }
  if (spear.primarySkill) {
    const selected = realCatalog.entities.find((entry) => entry.id === spear.primarySkill.entityId);
    assert.equal(evaluateDeliveryCompatibilityV3(selected, { weapon: 'Spear' }).ok, true);
  }
});

test('committed catalog keeps the reported spear and crossbow options in the selectable band', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const selectedNames = (snapshot) => {
    const names = new Set();
    let diagnostics = null;
    for (let index = 0; index < 64; index += 1) {
      const result = selectRecommendationPackageV3(realCatalog, snapshot, {
        offenseInventory: realOffense,
        selectionSeed: `reported-roll-${index}`
      });
      if (result.primarySkill?.name) names.add(result.primarySkill.name);
      diagnostics = result.diagnostics;
    }
    return { names, diagnostics };
  };

  const spear = selectedNames({ weapon: 'Spear', offenseList: ['Chill'] });
  assert.deepEqual([...spear.names].sort(), ['Fangs of Frost', 'Glacial Lance']);
  assert.ok(spear.diagnostics.rankedCandidates >= 2);
  assert.equal(spear.diagnostics.shortlistedCandidates, 2);

  const crossbow = selectedNames({
    weapon: 'Crossbow',
    offenseList: ['Poison', 'Electrocute']
  });
  assert.ok(crossbow.names.has('Gas Grenade'));
  assert.ok(crossbow.names.has('Voltaic Grenade'));
  assert.ok(crossbow.diagnostics.rankedCandidates >= 3);
  assert.equal(crossbow.diagnostics.shortlistedCandidates, 3);
});

test('reported empty and false-totem rolls select specific legal primary skills', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const cases = [
    {
      label: 'Crossbow / Shock',
      snapshot: { weapon: 'Crossbow', offenseList: ['Shock'] },
      carrierIds: ['offense:shock']
    },
    {
      label: 'Quarterstaff / Electrocute + Chill',
      snapshot: { weapon: 'Quarterstaff', offenseList: ['Electrocute', 'Chill'] },
      carrierIds: ['offense:electrocute', 'offense:chill'],
      expectComplementaryCoverage: true
    }
  ];

  for (const fixture of cases) {
    for (let index = 0; index < 64; index += 1) {
      const result = selectRecommendationPackageV3(realCatalog, fixture.snapshot, {
        offenseInventory: realOffense,
        selectionSeed: `reported-empty-${index}`
      });
      assert.ok(result.primarySkill, fixture.label);
      const selected = realCatalog.entities.find((entry) => entry.id === result.primarySkill.entityId);
      assert.equal(evaluateDeliveryCompatibilityV3(selected, fixture.snapshot).ok, true, fixture.label);
      assert.equal(isRecommendationContentAllowedV3(selected), true, fixture.label);
      assert.ok(
        result.primarySkill.carrierObligations.some((entry) => fixture.carrierIds.includes(entry.obligationId)),
        fixture.label
      );
      assert.ok(result.supportingSkill, fixture.label);
      assert.ok(result.supportingSkill.fulfilledObligations.length > 0, fixture.label);
      if (fixture.expectComplementaryCoverage) {
        const represented = new Set([
          ...result.primarySkill.carrierObligations.map((entry) => entry.obligationId),
          ...result.supportingSkill.fulfilledObligations.map((entry) => entry.obligationId)
        ]);
        assert.deepEqual([...represented].sort(), fixture.carrierIds.slice().sort(), fixture.label);
      }
    }
  }

  for (let index = 0; index < 64; index += 1) {
    const result = selectRecommendationPackageV3(realCatalog, {
      weapon: 'Mace',
      offenseList: ['Totems']
    }, { offenseInventory: realOffense, selectionSeed: `reported-totem-${index}` });
    assert.equal(result.primarySkill?.name, 'Shockwave Totem');
    assert.deepEqual(
      result.primarySkill?.fulfilledObligations.map((entry) => entry.obligationId),
      ['offense:totems']
    );
    assert.equal(result.supportingSkill, null);
    assert.equal(result.pieces.length, 1);
  }
});

test('committed catalog does not promote a non-damaging setup spell to primary damage', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  for (let index = 0; index < 32; index += 1) {
    const result = selectRecommendationPackageV3(realCatalog, {
      weapon: 'Wand',
      offenseList: ['Chaos Damage']
    }, { offenseInventory: realOffense, selectionSeed: `chaos-audit-${index}` });
    assert.notEqual(result.primarySkill?.name, 'Wither');
  }
});
