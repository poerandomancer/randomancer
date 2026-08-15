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
      { id: 'ignite', name: 'Ignite', category: 'Ailment', aliases: [] },
      { id: 'physical', name: 'Physical Damage', category: 'Damage Type', aliases: [] },
      { id: 'fire', name: 'Fire Damage', category: 'Damage Type', aliases: [] },
      { id: 'cold', name: 'Cold Damage', category: 'Damage Type', aliases: [] },
      { id: 'lightning', name: 'Lightning Damage', category: 'Damage Type', aliases: [] },
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

test('canonical Offense inventory no longer exposes Thorns as a roll option', async () => {
  const realOffense = await readFile(
    new URL('../data/offense-inventory.json', import.meta.url),
    'utf8'
  ).then(JSON.parse);

  assert.equal(realOffense.elements.some((entry) => entry.id === 'thorns'), false);
  assert.equal(realOffense.elements.some((entry) => entry.name === 'Thorns'), false);
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

test('martial packages reject unrestricted spells as supporting skills', () => {
  const crossbowEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['crossbow'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['crossbow'],
    display: 'Requires Crossbow'
  };
  const fixtures = catalog([
    entity({
      id: 'crossbow-lightning',
      name: 'Crossbow Lightning',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' }],
      equipment: crossbowEquipment,
      types: ['Attack', 'Crossbow', 'Lightning']
    }),
    entity({
      id: 'generic-electrocute-nova',
      name: 'Generic Electrocute Nova',
      roles: ['primary_damage', 'setup_control'],
      facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'electrocute', confidence: 'strong' }],
      types: ['AreaSpell', 'Damage', 'Lightning', 'Spell']
    }),
    entity({
      id: 'weapon-bound-primer',
      name: 'Weapon-bound Primer',
      roles: ['setup_control'],
      facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'electrocute', confidence: 'strong' }],
      equipment: crossbowEquipment,
      types: ['Buff', 'Crossbow', 'Spell']
    })
  ]);
  const martial = selectRecommendationPackageV3(fixtures, {
    weapon: 'Crossbow',
    offenseList: ['Electrocute']
  }, {
    offenseInventory: {
      elements: [{ id: 'electrocute', name: 'Electrocute', category: 'Ailment', aliases: [] }]
    }
  });
  const caster = selectRecommendationPackageV3(fixtures, {
    weapon: 'Wand',
    offenseList: ['Electrocute']
  }, {
    offenseInventory: {
      elements: [{ id: 'electrocute', name: 'Electrocute', category: 'Ailment', aliases: [] }]
    }
  });

  assert.deepEqual(martial.pieces.map((entry) => entry.name), [
    'Crossbow Lightning',
    'Weapon-bound Primer'
  ]);
  assert.ok(!martial.pieces.some((entry) => entry.name === 'Generic Electrocute Nova'));
  assert.equal(caster.primarySkill?.name, 'Generic Electrocute Nova');
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
  assert.deepEqual(repeated.pieces, first.pieces);
  assert.equal(first.pieces.length, 2);
  assert.equal(first.supportingSkill?.assignedRole, 'secondary_damage');
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

test('critical-hit rolls prefer higher intrinsic base crit when coverage is otherwise equal', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({ id: 'low-crit', name: 'Low Crit Spell', facts: [] }),
    entity({ id: 'high-crit', name: 'High Crit Spell', facts: [] })
  ]), { weapon: 'Wand', offenseList: ['Critical Hits'] }, {
    offenseInventory: offenseInventory(),
    criticalProfiles: {
      profiles: {
        'low-crit': { base_crit_chance: 5, source_url: 'https://example.test/low' },
        'high-crit': { base_crit_chance: 15, source_url: 'https://example.test/high' }
      }
    }
  });

  assert.equal(result.primarySkill?.name, 'High Crit Spell');
  assert.equal(result.primarySkill?.criticalAffinity.source, 'skill');
  assert.equal(result.primarySkill?.criticalAffinity.baseCritChance, 15);
  assert.equal(result.primarySkill?.fulfilledObligations[0]?.obligationId, 'offense:critical_hits');
});

test('weapon attacks remain neutral critical-hit candidates without invented skill crit values', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'bow-attack',
      name: 'Bow Attack',
      facts: [],
      types: ['Attack', 'Damage', 'Bow']
    })
  ]), { weapon: 'Bow', offenseList: ['Critical Hits'] }, {
    offenseInventory: offenseInventory()
  });

  assert.equal(result.primarySkill?.name, 'Bow Attack');
  assert.equal(result.primarySkill?.criticalAffinity.source, 'weapon');
  assert.equal(result.primarySkill?.criticalAffinity.baseCritChance, null);
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
    entry.obligationId === 'offense:shock' && entry.reason.includes('explicit Shock application')
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

test('package-first scoring may choose a weaker standalone primary for a stronger setup-payoff pair', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'steady-flame',
      name: 'Steady Flame',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }]
    }),
    entity({
      id: 'ignition-payoff',
      name: 'Ignition Payoff',
      roles: ['primary_damage', 'payoff'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'strong' },
        { relation: 'consumes', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'ignite-primer',
      name: 'Ignite Primer',
      roles: ['setup_control'],
      facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Fire Damage'] }, { offenseInventory: offenseInventory() });

  assert.deepEqual(result.pieces.map((entry) => entry.name), ['Ignition Payoff', 'Ignite Primer']);
  assert.equal(result.supportingSkill?.assignedRole, 'setup_control');
  assert.ok(result.synergyEdges.some((edge) =>
    edge.mechanic === 'ignite' && edge.demandRelation === 'consumes'
  ));
});

test('package-first scoring recognizes primary-to-payoff setup direction', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'shock-primer',
      name: 'Shock Primer',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'shock', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'shock-payoff',
      name: 'Shock Payoff',
      roles: ['payoff'],
      facts: [{ relation: 'consumes', subject: 'skill', mechanic: 'shock', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Shock'] }, { offenseInventory: offenseInventory() });

  assert.deepEqual(result.pieces.map((entry) => entry.name), ['Shock Primer', 'Shock Payoff']);
  assert.equal(result.supportingSkill?.assignedRole, 'payoff');
  assert.ok(result.synergyEdges.some((edge) =>
    edge.fromEntityId.endsWith('shock-primer') && edge.toEntityId.endsWith('shock-payoff')
  ));
});

test('parallel skills may form a two-Offense package when both add real coverage', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'fire-strike',
      name: 'Fire Strike',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }]
    }),
    entity({
      id: 'frost-strike',
      name: 'Frost Strike',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'cold', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Fire Damage', 'Cold Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(new Set(result.pieces.map((entry) => entry.name)), new Set(['Fire Strike', 'Frost Strike']));
  assert.equal(result.supportingSkill?.assignedRole, 'secondary_damage');
  assert.deepEqual(
    new Set(result.pieces.flatMap((entry) => entry.fulfilledObligations.map((proof) => proof.obligationId))),
    new Set(['offense:fire', 'offense:cold'])
  );
});

test('a synergistic two-Offense pair outranks a merely parallel alternative', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'flame-primer',
      name: 'Flame Primer',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'frost-payoff',
      name: 'Frost Payoff',
      roles: ['primary_damage', 'payoff'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'cold', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'plain-frost',
      name: 'Plain Frost',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'cold', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Fire Damage', 'Cold Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(result.pieces.map((entry) => entry.name), ['Flame Primer', 'Frost Payoff']);
  assert.equal(result.supportingSkill?.assignedRole, 'payoff');
  assert.ok(result.synergyEdges.some((edge) => edge.mechanic === 'ignite'));
});

test('an off-theme dependency loop cannot outrank an Offense-aligned physical package', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'armour-piercer',
      name: 'Armour Piercer',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'armour_break', confidence: 'strong' }
      ]
    }),
    entity({
      id: 'riven-payoff',
      name: 'Riven Payoff',
      roles: ['primary_damage', 'payoff'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'armour_break', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'toxic-physical',
      name: 'Toxic Physical',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'poison', confidence: 'strong' }
      ]
    }),
    entity({
      id: 'plague-payoff',
      name: 'Plague Payoff',
      roles: ['setup_control'],
      types: ['Spell'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'requires', subject: 'skill', mechanic: 'poison', confidence: 'strong' }
      ]
    })
  ]), { weapon: 'Wand', offenseList: ['Physical Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(
    new Set(result.pieces.map((entry) => entry.name)),
    new Set(['Armour Piercer', 'Riven Payoff'])
  );
  assert.ok(result.synergyEdges.some((edge) => edge.mechanic === 'armour_break'));
  assert.ok(!result.pieces.some((entry) => entry.name === 'Plague Payoff'));
});

test('an elemental payoff uses the branch aligned with the rolled Offense', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'elemental-snap',
      name: 'Elemental Snap',
      roles: ['primary_damage', 'payoff'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'cold', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'freeze', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'frost-primer',
      name: 'Frost Primer',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'cold', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'freeze', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'flame-wall',
      name: 'Flame Wall',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }
      ]
    })
  ]), { weapon: 'Wand', offenseList: ['Cold Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(
    new Set(result.pieces.map((entry) => entry.name)),
    new Set(['Elemental Snap', 'Frost Primer'])
  );
  assert.ok(result.synergyEdges.some((edge) => edge.mechanic === 'freeze'));
  assert.ok(!result.pieces.some((entry) => entry.name === 'Flame Wall'));
});

test('a conditional gas payoff prefers a rolled-Fire detonator over more Poison', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'gas-cloud',
      name: 'Gas Cloud',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'inflicts', subject: 'skill', mechanic: 'poison', confidence: 'strong' },
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
        { relation: 'requires', subject: 'skill', mechanic: 'detonation', confidence: 'strong' }
      ]
    }),
    entity({
      id: 'explosive-payoff',
      name: 'Explosive Payoff',
      roles: ['primary_damage', 'payoff'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
        { relation: 'provides', subject: 'skill', mechanic: 'detonation', confidence: 'strong' }
      ]
    }),
    entity({
      id: 'plague-bearer',
      name: 'Plague Bearer',
      roles: ['setup_control'],
      types: ['Spell'],
      facts: [
        { relation: 'inflicts', subject: 'skill', mechanic: 'poison', confidence: 'strong' },
        { relation: 'requires', subject: 'skill', mechanic: 'poison', confidence: 'strong' }
      ]
    })
  ]), { weapon: 'Wand', offenseList: ['Poison', 'Fire Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(
    new Set(result.pieces.map((entry) => entry.name)),
    new Set(['Gas Cloud', 'Explosive Payoff'])
  );
  assert.ok(result.synergyEdges.some((edge) => edge.mechanic === 'detonation'));
  assert.ok(!result.pieces.some((entry) => entry.name === 'Plague Bearer'));
});

test('generic charge evidence cannot bridge a specific charge setup cost', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'frenzy-payoff',
      name: 'Frenzy Payoff',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'cold', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'charge', confidence: 'exact' },
        { relation: 'consumes', subject: 'skill', mechanic: 'frenzy_charge', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'generic-charge-maker',
      name: 'Generic Charge Maker',
      roles: ['enabler'],
      facts: [{ relation: 'generates', subject: 'skill', mechanic: 'charge', confidence: 'exact' }]
    })
  ]), { weapon: 'Wand', offenseList: ['Cold Damage'] }, { offenseInventory: offenseInventory() });

  assert.equal(result.supportingSkill, null);
  assert.deepEqual(result.primarySkill?.setupCosts, ['frenzy_charge']);
  assert.deepEqual(result.synergyEdges, []);
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

test('a delegated off-theme ailment cannot borrow a damage tag as rolled-Offense coverage', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'toxic-domain',
      name: 'Toxic Domain',
      roles: ['primary_damage', 'setup_control'],
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'poison', confidence: 'strong' },
        {
          relation: 'prevents',
          subject: 'skill',
          mechanic: 'damage',
          condition: 'base_effect_only',
          confidence: 'exact'
        }
      ]
    })
  ]), { weapon: 'Wand', offenseList: ['Physical Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.equal(result.primarySkill, null);
  assert.equal(result.supportingSkill, null);
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
        { name: 'Secondary', recommendationV3: { assignedRole: 'secondary_damage' } },
        { name: 'Filler' }
      ]
    });
    const skillSection = deriveBuildCardModel(snapshot).backSections.find((entry) => entry.label === 'Skill Ideas');

    assert.deepEqual(snapshot.recommendedSkills.map((entry) => entry.name), ['Primary', 'Secondary']);
    assert.deepEqual(skillSection.values.map((entry) => entry.name), ['Primary', 'Secondary']);
    assert.deepEqual(skillSection.values.map((entry) => entry.prefix), ['Primary', 'Secondary']);
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

test('committed critical profiles are complete, catalog-backed, and cover every weapon family', async () => {
  const [realCatalog, realOffense, criticalProfiles] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/config/recommendation_critical_profiles_v3.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const profileEntries = Object.entries(criticalProfiles.profiles || {});
  const catalogSourceIds = new Set(realCatalog.entities.map((entry) => entry.source_id));
  assert.equal(profileEntries.length, criticalProfiles._meta.profile_count);
  assert.equal(profileEntries.length, criticalProfiles.summary.profiles);
  assert.ok(profileEntries.every(([sourceId, profile]) =>
    catalogSourceIds.has(sourceId)
    && Number.isFinite(profile.base_crit_chance)
    && profile.base_crit_chance > 0
  ));

  const weapons = [
    'Two-handed Mace', 'Two-handed Axe', 'Two-handed Sword', 'Bow', 'Crossbow',
    'Quarterstaff', 'Staff', 'One-handed Mace', 'One-handed Axe', 'One-handed Sword',
    'Claw', 'Dagger', 'Flail', 'Spear', 'Wand', 'Sceptre', 'Talisman', 'Unarmed'
  ];
  for (const weapon of weapons) {
    const snapshot = { weapon, offenseList: ['Critical Hits'] };
    const result = selectRecommendationPackageV3(realCatalog, snapshot, {
      offenseInventory: realOffense,
      criticalProfiles,
      selectionSeed: `critical-coverage-${weapon}`
    });
    assert.ok(result.primarySkill, weapon);
    assert.ok(['skill', 'weapon', 'explicit_interaction'].includes(result.primarySkill.criticalAffinity.source), weapon);
    const selected = realCatalog.entities.find((entry) => entry.id === result.primarySkill.entityId);
    assert.equal(evaluateDeliveryCompatibilityV3(selected, snapshot).ok, true, weapon);
  }
});

test('committed catalog remains deterministic and equipment-legal across the roll matrix', async () => {
  const [realCatalog, realOffense, criticalProfiles] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/config/recommendation_critical_profiles_v3.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const weapons = [
    'Two-handed Mace', 'Two-handed Axe', 'Two-handed Sword', 'Bow', 'Crossbow',
    'Quarterstaff', 'Staff', 'One-handed Mace', 'One-handed Axe', 'One-handed Sword',
    'Claw', 'Dagger', 'Flail', 'Spear', 'Wand', 'Sceptre', 'Talisman', 'Unarmed'
  ];

  for (const weapon of weapons) {
    for (const offense of realOffense.elements) {
      const snapshot = { weapon, offenseList: [offense.name] };
      const first = selectRecommendationPackageV3(realCatalog, snapshot, {
        offenseInventory: realOffense,
        criticalProfiles
      });
      const second = selectRecommendationPackageV3(realCatalog, snapshot, {
        offenseInventory: realOffense,
        criticalProfiles
      });
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
        const types = new Set(pieceEntity.source_evidence?.active_skill_types || []);
        if (types.has('Spell') && !['Staff', 'Wand', 'Sceptre'].includes(weapon)) {
          assert.equal(
            evaluateDeliveryCompatibilityV3(pieceEntity, snapshot).ok,
            true,
            `${weapon} / ${offense.name} selected unrestricted spell ${piece.name}`
          );
        }
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

test('committed catalog keeps the reported package failures Offense-aligned', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);

  for (let index = 0; index < 64; index += 1) {
    const physical = selectRecommendationPackageV3(realCatalog, {
      weapon: 'Crossbow',
      offenseList: ['Physical Damage']
    }, { offenseInventory: realOffense, selectionSeed: `reported-physical-${index}` });
    assert.deepEqual(
      new Set(physical.pieces.map((entry) => entry.name)),
      new Set(['Armour Piercing Rounds', 'High Velocity Rounds'])
    );
    assert.ok(physical.synergyEdges.some((edge) => edge.mechanic === 'armour_break'));

    const maceShock = selectRecommendationPackageV3(realCatalog, {
      weapon: 'Mace',
      offenseList: ['Shock']
    }, { offenseInventory: realOffense, selectionSeed: `reported-mace-shock-${index}` });
    assert.equal(maceShock.primarySkill, null);
    assert.equal(maceShock.supportingSkill, null);

    const cold = selectRecommendationPackageV3(realCatalog, {
      weapon: 'Sceptre',
      offenseList: ['Cold Damage']
    }, { offenseInventory: realOffense, selectionSeed: `reported-cold-${index}` });
    assert.ok(cold.primarySkill);
    assert.ok(!cold.pieces.some((entry) => entry.name === 'Flame Wall'));
    assert.ok(cold.pieces.some((entry) =>
      entry.fulfilledObligations.some((proof) => proof.obligationId === 'offense:cold')
    ));

    const poisonFire = selectRecommendationPackageV3(realCatalog, {
      weapon: 'Crossbow',
      offenseList: ['Poison', 'Fire Damage']
    }, { offenseInventory: realOffense, selectionSeed: `reported-poison-fire-${index}` });
    assert.equal(poisonFire.pieces.length, 2);
    assert.ok(poisonFire.pieces.some((entry) => entry.name === 'Gas Grenade'));
    assert.ok(['Explosive Grenade', 'Explosive Shot'].some((name) =>
      poisonFire.pieces.some((entry) => entry.name === name)
    ));
    assert.ok(!poisonFire.pieces.some((entry) => entry.name === 'Plague Bearer'));
    assert.ok(poisonFire.synergyEdges.some((edge) => edge.mechanic === 'detonation'));
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
      carrierIds: ['offense:shock'],
      expectSupporting: false
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
      assert.ok(!result.pieces.some((entry) => entry.name === 'Enervating Nova'), fixture.label);
      if (fixture.expectSupporting === false) {
        assert.equal(result.supportingSkill, null, fixture.label);
        continue;
      }
      assert.ok(result.supportingSkill, fixture.label);
      assert.ok(
        result.supportingSkill.fulfilledObligations.length
          + result.supportingSkill.carrierObligations.length > 0,
        fixture.label
      );
      if (fixture.expectComplementaryCoverage) {
        const represented = new Set([
          ...result.primarySkill.carrierObligations.map((entry) => entry.obligationId),
          ...result.supportingSkill.fulfilledObligations.map((entry) => entry.obligationId),
          ...result.supportingSkill.carrierObligations.map((entry) => entry.obligationId)
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
    assert.equal(result.supportingSkill?.name, 'Dark Effigy');
    assert.equal(result.supportingSkill?.assignedRole, 'secondary_damage');
    assert.equal(result.pieces.length, 2);
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
