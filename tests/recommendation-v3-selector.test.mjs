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
  evaluateCompatibilityV3,
  evaluateDeliveryCompatibilityV3,
  isEquipmentCompatibleV3,
  isRecommendationContentAllowedV3,
  isRecommendationV3Enabled,
  mergeRecommendationGrantedSkillAccessV3,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3
} = selector;

function offenseInventory() {
  return {
    elements: [
      { id: 'poison', name: 'Poison', category: 'Ailment', aliases: [] },
      { id: 'shock', name: 'Shock', category: 'Ailment', aliases: [] },
      { id: 'ignite', name: 'Ignite', category: 'Ailment', aliases: [] },
      { id: 'bleed', name: 'Bleed', category: 'Ailment', aliases: [] },
      { id: 'chill', name: 'Chill', category: 'Ailment', aliases: [] },
      { id: 'freeze', name: 'Freeze', category: 'Ailment', aliases: [] },
      { id: 'electrocute', name: 'Electrocute', category: 'Ailment', aliases: [] },
      { id: 'physical', name: 'Physical Damage', category: 'Damage Type', aliases: [] },
      { id: 'fire', name: 'Fire Damage', category: 'Damage Type', aliases: [] },
      { id: 'cold', name: 'Cold Damage', category: 'Damage Type', aliases: [] },
      { id: 'lightning', name: 'Lightning Damage', category: 'Damage Type', aliases: [] },
      { id: 'chaos', name: 'Chaos Damage', category: 'Damage Type', aliases: [] },
      { id: 'critical_hits', name: 'Critical Hits', category: 'Scaling', aliases: ['Crit'] },
      { id: 'minions', name: 'Minions', category: 'Archetype', aliases: ['Minion', 'Minions/Companions'] },
      { id: 'companions', name: 'Companions', category: 'Archetype', aliases: ['Companion'] },
      { id: 'totems', name: 'Totems', category: 'Archetype', aliases: [] }
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
  retrievalTerms = [],
  roles = ['primary_damage'],
  description = '',
  contentType = 'active_skill',
  compatibility = null,
  supportFamily = null
}) {
  return {
    id: `skill:${id}`,
    source_id: id,
    content_type: contentType,
    name,
    ...(supportFamily ? { support_family: supportFamily } : {}),
    candidate_roles: roles,
    retrieval_terms: retrievalTerms,
    facts,
    compatibility: compatibility || { equipment },
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

async function loadRealRecommendationCatalogV3() {
  const [realCatalog, grantedAccess] = await Promise.all([
    readFile(new URL('../data/enriched/recommendation_catalog_v3.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/enriched/recommendation_granted_skill_access_v3.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  return mergeRecommendationGrantedSkillAccessV3(realCatalog, grantedAccess);
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

test('canonical Offense inventory splits Archetypes by attribute identity', async () => {
  const realOffense = await readFile(
    new URL('../data/offense-inventory.json', import.meta.url),
    'utf8'
  ).then(JSON.parse);
  const archetypes = realOffense.elements.filter((entry) => entry.category === 'Archetype');

  assert.deepEqual(archetypes.map((entry) => entry.name), ['Minions', 'Companions', 'Totems']);
  assert.deepEqual(archetypes.map((entry) => entry.id), ['minions', 'companions', 'totems']);
  assert.deepEqual(archetypes.map((entry) => entry.attributes), [
    { intelligence: 1.0 },
    { dexterity: 1.0 },
    { strength: 1.0 }
  ]);
  assert.equal(archetypes.filter((entry) => entry.name === 'Minions/Companions').length, 0);
});

test('standard weapon adapters do not synthesize Unarmed as a randomized family', async () => {
  const [familyRuntime, frequencyRuntime] = await Promise.all([
    readFile(new URL('../js/28-primary-equipment-runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/29-selection-frequency-runtime.js', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(familyRuntime, /byName\.set\(['"]Unarmed['"]/);
  assert.doesNotMatch(frequencyRuntime, /makeUnarmedCandidate|pool\.push\(unarmed\)/);
  assert.match(frequencyRuntime, /pool\[index\]\?\.name === ['"]Unarmed['"]/);
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

test('granted skill access requires matching ascendancy or selected unique provider', () => {
  const meleeRequirement = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['mace', 'spear'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['mace', 'spear'],
    display: 'Requires Any Melee Weapon'
  };
  const bowRequirement = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['bow'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['bow'],
    display: 'Requires Bow'
  };
  const manifest = entity({
    id: 'manifest-weapon',
    name: 'Manifest Weapon',
    facts: [{ relation: 'creates', subject: 'skill', mechanic: 'companion', confidence: 'exact' }],
    compatibility: {
      access: {
        requires_granted_source: true,
        granted_sources: [{ kind: 'ascendancy_passive', ascendancy: 'Smith of Kitava' }]
      },
      equipment: meleeRequirement
    }
  });
  const phantasmal = entity({
    id: 'phantasmal-arrow',
    name: 'Phantasmal Arrow',
    facts: [{ relation: 'inflicts', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }],
    compatibility: {
      access: {
        requires_granted_source: true,
        requires_unique_provider: true,
        granted_sources: [{ kind: 'unique', unique_name: "Fairgraves' Curse" }]
      },
      equipment: bowRequirement
    }
  });

  assert.equal(evaluateCompatibilityV3(manifest, { weapon: 'Mace', ascendancy: 'Titan' }).ok, false);
  assert.equal(evaluateCompatibilityV3(manifest, { weapon: 'Mace', ascendancy: 'Smith of Kitava' }).ok, true);
  assert.equal(evaluateCompatibilityV3(manifest, { weapon: 'Bow', ascendancy: 'Smith of Kitava' }).ok, false);

  assert.equal(evaluateCompatibilityV3(phantasmal, { weapon: 'Bow' }).ok, false);
  assert.equal(evaluateCompatibilityV3(phantasmal, {
    weapon: 'Bow',
    recommendedUniques: ["Fairgraves' Curse"]
  }).ok, true);
  assert.equal(evaluateCompatibilityV3(phantasmal, {
    weapon: 'Mace',
    recommendedUniques: ["Fairgraves' Curse"]
  }).ok, false);
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
      types: ['Spell', 'Damage', 'CreatesMinion', 'Physical']
    })
  ]);

  const bow = selectRecommendationPackageV3(fixtures, {
    weapon: 'Bow',
    offenseList: ['Chaos Damage']
  }, { offenseInventory: offenseInventory() });
  const spear = selectRecommendationPackageV3(fixtures, {
    weapon: 'Spear',
    offenseList: ['Minions']
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
  assert.equal(first.pieces.length, 1);
  assert.equal(first.supportingSkill, null);
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
  assert.equal(result.diagnostics.offenseCoverage[0]?.state, 'carrier_only');
  assert.equal(result.diagnostics.offenseCoverage[0]?.mechanic, 'lightning');
  assert.ok(result.unresolved.some((entry) =>
    entry.obligationId === 'offense:shock' && entry.reason.includes('explicit Shock application')
  ));
});

test('Companion rolls prefer Tame Beast and suppress Rhoa Mount skill ideas', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'tame-beast',
      name: 'Tame Beast',
      facts: [
        { relation: 'creates', subject: 'skill', mechanic: 'companion', confidence: 'exact' },
        { relation: 'creates', subject: 'skill', mechanic: 'minion', confidence: 'exact' },
        { relation: 'prevents', subject: 'skill', mechanic: 'damage', condition: 'base_effect_only', confidence: 'exact' }
      ],
      types: ['Companion', 'Duration', 'Minion']
    }),
    entity({
      id: 'rhoa-mount',
      name: 'Rhoa Mount',
      facts: [{ relation: 'creates', subject: 'skill', mechanic: 'companion', confidence: 'exact' }],
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: ['bow', 'spear'],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: ['bow', 'spear']
      },
      types: ['Persistent', 'HasReservation', 'CreatesCompanion', 'Companion']
    })
  ]), { weapon: 'Bow', offenseList: ['Companions'] }, {
    offenseInventory: offenseInventory()
  });

  assert.equal(result.primarySkill?.name, 'Tame Beast');
  assert.deepEqual(result.primarySkill?.fulfilledObligations.map((proof) => proof.obligationId), [
    'offense:companions'
  ]);
  assert.equal(result.pieces.some((piece) => piece.name === 'Rhoa Mount'), false);
});

test('persistent minion skills do not become generic non-archetype damage primaries', () => {
  const ragingSpirits = entity({
    id: 'raging-spirits',
    name: 'Raging Spirits',
    facts: [
      { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
      { relation: 'creates', subject: 'skill', mechanic: 'minion', confidence: 'exact' }
    ],
    types: ['Buff', 'Persistent', 'HasReservation', 'CreatesMinion', 'Minion', 'Fire']
  });
  const fireball = entity({
    id: 'fireball',
    name: 'Fireball',
    facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }],
    types: ['Spell', 'Damage', 'Fire']
  });

  const fireResult = selectRecommendationPackageV3(catalog([ragingSpirits, fireball]), {
    weapon: 'Wand',
    offenseList: ['Fire Damage']
  }, { offenseInventory: offenseInventory() });
  const minionResult = selectRecommendationPackageV3(catalog([ragingSpirits, fireball]), {
    weapon: 'Wand',
    offenseList: ['Minions']
  }, { offenseInventory: offenseInventory() });

  assert.equal(fireResult.primarySkill?.name, 'Fireball');
  assert.equal(minionResult.primarySkill?.name, 'Raging Spirits');
});

test('unrestricted summon skills do not become generic ailment carriers without a rolled archetype', () => {
  const raiseZombie = entity({
    id: 'raise-zombie',
    name: 'Raise Zombie',
    facts: [
      { relation: 'creates', subject: 'skill', mechanic: 'minion', confidence: 'exact' },
      { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }
    ],
    types: ['CreatesMinion', 'Minion', 'Physical']
  });
  const crossbowHit = entity({
    id: 'crossbow-hit',
    name: 'Crossbow Hit',
    facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
    equipment: {
      is_unrestricted: false,
      mainhand_tags_any_of: ['crossbow'],
      offhand_tags_any_of: [],
      allowed_weapon_tags_any_of: ['crossbow']
    },
    types: ['Attack', 'Damage', 'Crossbow']
  });

  const poisonResult = selectRecommendationPackageV3(catalog([raiseZombie, crossbowHit]), {
    weapon: 'Crossbow',
    offenseList: ['Poison']
  }, { offenseInventory: offenseInventory() });
  const minionResult = selectRecommendationPackageV3(catalog([raiseZombie, crossbowHit]), {
    weapon: 'Crossbow',
    offenseList: ['Minions']
  }, { offenseInventory: offenseInventory() });

  assert.equal(poisonResult.primarySkill?.name, 'Crossbow Hit');
  assert.equal(minionResult.primarySkill?.name, 'Raise Zombie');
});

test('Minion rolls prefer non-Companion minions while Companion rolls prefer Companion evidence', () => {
  const skeletons = entity({
    id: 'skeletons',
    name: 'Skeletal Warrior',
    facts: [{ relation: 'creates', subject: 'skill', mechanic: 'minion', confidence: 'exact' }],
    types: ['Persistent', 'HasReservation', 'CreatesMinion', 'Minion']
  });
  const wolf = entity({
    id: 'wolf',
    name: 'Azmerian Wolf',
    facts: [
      { relation: 'creates', subject: 'skill', mechanic: 'minion', confidence: 'exact' },
      { relation: 'creates', subject: 'skill', mechanic: 'companion', confidence: 'exact' },
      { relation: 'has_property', subject: 'skill', mechanic: 'companion', confidence: 'exact' }
    ],
    equipment: {
      is_unrestricted: false,
      mainhand_tags_any_of: ['bow'],
      offhand_tags_any_of: [],
      allowed_weapon_tags_any_of: ['bow']
    },
    types: ['Persistent', 'HasReservation', 'CreatesMinion', 'CreatesCompanion', 'Minion', 'Companion']
  });

  const minionResult = selectRecommendationPackageV3(catalog([wolf, skeletons]), {
    weapon: 'Sceptre',
    offenseList: ['Minions']
  }, { offenseInventory: offenseInventory() });
  const companionResult = selectRecommendationPackageV3(catalog([wolf, skeletons]), {
    weapon: 'Bow',
    offenseList: ['Companions']
  }, { offenseInventory: offenseInventory() });

  assert.equal(minionResult.primarySkill?.name, 'Skeletal Warrior');
  assert.equal(companionResult.primarySkill?.name, 'Azmerian Wolf');
});

test('a provider support completes the active package without becoming a second active skill', () => {
  const maceEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['mace'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['mace']
  };
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'earthshatter',
      name: 'Earthshatter',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
      equipment: maceEquipment,
      types: ['Attack', 'Damage', 'Mace', 'CanCreateStoneElementals']
    }),
    entity({
      id: 'skittering-stone',
      name: 'Skittering Stone I',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [{ relation: 'creates', subject: 'supported_skill', mechanic: 'minion', confidence: 'exact' }],
      types: [],
      compatibility: {
        equipment: { is_unrestricted: true },
        target_skill: {
          allowed_skill_types_any_of: ['CanCreateStoneElementals'],
          excluded_skill_types: []
        }
      }
    })
  ]), { weapon: 'Mace', offenseList: ['Minions'] }, {
    offenseInventory: offenseInventory()
  });

  assert.equal(result.primarySkill?.name, 'Earthshatter');
  assert.equal(result.supportingSkill, null);
  assert.equal(result.primarySkill?.carrierObligations[0]?.completionType, 'support');
  assert.equal(result.primarySkill?.carrierObligations[0]?.providerName, 'Skittering Stone I');
  assert.deepEqual(result.primarySkill?.supports.map((support) => support.name), ['Skittering Stone I']);
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:minions'));
  assert.equal(result.diagnostics.assignedSupportCount, 1);
  assert.deepEqual(result.diagnostics.offenseCoverage.map((entry) => [
    entry.obligationId,
    entry.state,
    entry.providerName,
    entry.supportedSkillName
  ]), [
    ['offense:minions', 'support_assigned', 'Skittering Stone I', 'Earthshatter']
  ]);
});

test('support assignment chooses one best family tier and leaves unrelated slots empty', () => {
  const maceEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['mace'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['mace']
  };
  const target = {
    equipment: { is_unrestricted: true },
    target_skill: {
      allowed_skill_types_any_of: ['Attack', 'Damage'],
      excluded_skill_types: []
    }
  };
  const bleedSupport = (tier) => entity({
    id: `bleed-${tier}`,
    name: `Bleed ${tier === 1 ? 'I' : 'III'}`,
    contentType: 'support_gem',
    roles: ['enabler'],
    facts: [{ relation: 'inflicts', subject: 'supported_skill', mechanic: 'bleed', confidence: 'exact' }],
    types: [],
    compatibility: target,
    supportFamily: { id: 'support-family:bleed', name: 'Bleed', tier }
  });
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'mace-physical',
      name: 'Mace Physical',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
      equipment: maceEquipment,
      types: ['Attack', 'Damage', 'Mace']
    }),
    bleedSupport(1),
    bleedSupport(3),
    entity({
      id: 'unrelated-fire',
      name: 'Unrelated Fire',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [{ relation: 'provides', subject: 'supported_skill', mechanic: 'fire', confidence: 'exact' }],
      types: [],
      compatibility: target,
      supportFamily: { id: 'support-family:unrelated-fire', name: 'Unrelated Fire', tier: null }
    })
  ]), { weapon: 'Mace', offenseList: ['Bleed'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(result.primarySkill?.supports.map((support) => support.name), ['Bleed III']);
  assert.equal(result.primarySkill?.supports[0]?.familyId, 'support-family:bleed');
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:bleed'));
  assert.equal(result.diagnostics.assignedSupportCount, 1);
  assert.deepEqual(result.diagnostics.offenseCoverage.map((entry) => [
    entry.obligationId,
    entry.state,
    entry.providerName,
    entry.familyName
  ]), [
    ['offense:bleed', 'support_assigned', 'Bleed III', 'Bleed']
  ]);
});

test('two supports may form a typed damage-to-ailment bridge on one skill', () => {
  const target = {
    equipment: { is_unrestricted: true },
    target_skill: {
      allowed_skill_types_any_of: ['Attack', 'Damage'],
      excluded_skill_types: []
    }
  };
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'mace-hit',
      name: 'Mace Hit',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: ['mace'],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: ['mace']
      },
      types: ['Attack', 'Damage', 'Mace']
    }),
    entity({
      id: 'gain-chaos',
      name: 'Gain Chaos',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [{ relation: 'provides', subject: 'supported_skill', mechanic: 'chaos', confidence: 'exact' }],
      types: [],
      compatibility: target,
      supportFamily: { id: 'support-family:gain-chaos', name: 'Gain Chaos', tier: null }
    }),
    entity({
      id: 'chaos-can-shock',
      name: 'Chaos Can Shock',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [
        {
          relation: 'provides',
          subject: 'supported_skill',
          mechanic: 'shock',
          condition: 'chaos_damage',
          confidence: 'exact'
        },
        { relation: 'requires', subject: 'supported_skill', mechanic: 'chaos', confidence: 'exact' }
      ],
      types: [],
      compatibility: target,
      supportFamily: { id: 'support-family:chaos-can-shock', name: 'Chaos Can Shock', tier: null }
    })
  ]), { weapon: 'Mace', offenseList: ['Shock'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(
    new Set(result.primarySkill?.supports.map((support) => support.name)),
    new Set(['Gain Chaos', 'Chaos Can Shock'])
  );
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:shock'));
  assert.equal(result.diagnostics.assignedSupportCount, 2);
  assert.ok(result.supportEdges.some((edge) =>
    edge.targetKind === 'offense' && edge.mechanic === 'shock'
  ));
});

test('two normal supports beat one lineage support for equivalent bridge coverage', () => {
  const target = {
    equipment: { is_unrestricted: true },
    target_skill: {
      allowed_skill_types_any_of: ['Attack', 'Damage'],
      excluded_skill_types: []
    }
  };
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'mace-hit',
      name: 'Mace Hit',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: ['mace'],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: ['mace']
      },
      types: ['Attack', 'Damage', 'Mace']
    }),
    entity({
      id: 'gain-lightning',
      name: 'Gain Lightning',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [{ relation: 'provides', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' }],
      types: [],
      compatibility: target,
      supportFamily: { id: 'support-family:gain-lightning', name: 'Gain Lightning', tier: null }
    }),
    entity({
      id: 'shock',
      name: 'Shock',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [
        { relation: 'inflicts', subject: 'supported_skill', mechanic: 'shock', confidence: 'exact' },
        { relation: 'requires', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' }
      ],
      types: [],
      compatibility: target,
      supportFamily: { id: 'support-family:shock', name: 'Shock', tier: null }
    }),
    entity({
      id: 'eshs-radiance',
      name: "Esh's Radiance",
      contentType: 'support_gem',
      roles: ['enabler'],
      retrievalTerms: ['lineage'],
      facts: [
        { relation: 'provides', subject: 'supported_skill', mechanic: 'chaos', confidence: 'exact' },
        { relation: 'provides', subject: 'supported_skill', mechanic: 'shock', condition: 'chaos_damage', confidence: 'exact' },
        { relation: 'requires', subject: 'supported_skill', mechanic: 'chaos', confidence: 'exact' }
      ],
      types: [],
      compatibility: target,
      supportFamily: { id: 'support-family:eshs-radiance', name: "Esh's Radiance", tier: null }
    })
  ]), { weapon: 'Mace', offenseList: ['Shock'] }, {
    offenseInventory: offenseInventory()
  });

  assert.equal(result.primarySkill?.name, 'Mace Hit');
  assert.deepEqual(
    new Set(result.primarySkill?.carrierObligations[0]?.supportNames),
    new Set(['Gain Lightning', 'Shock'])
  );
  assert.deepEqual(
    new Set(result.primarySkill?.supports.map((support) => support.name)),
    new Set(['Gain Lightning', 'Shock'])
  );
  assert.ok(result.primarySkill?.supports.every((support) => support.availability === 'normal'));
  assert.equal(result.diagnostics.offenseCoverage[0]?.state, 'support_assigned');
  assert.equal(result.diagnostics.offenseCoverage[0]?.supportAvailability, 'normal');
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:shock'));
});

test('a support conflict cannot destroy an existing rolled-Offense route', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'lightning-shock',
      name: 'Lightning Shock',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'shock', confidence: 'exact' }
      ]
    }),
    entity({
      id: 'electrocute-conflict',
      name: 'Electrocute Conflict',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [
        { relation: 'provides', subject: 'supported_skill', mechanic: 'electrocute', confidence: 'exact' },
        { relation: 'requires', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' },
        { relation: 'prevents', subject: 'supported_skill', mechanic: 'shock', confidence: 'exact' }
      ],
      types: [],
      compatibility: {
        equipment: { is_unrestricted: true },
        target_skill: { allowed_skill_types_any_of: ['Damage'], excluded_skill_types: [] }
      },
      supportFamily: { id: 'support-family:electrocute', name: 'Electrocute', tier: null }
    })
  ]), { weapon: 'Wand', offenseList: ['Shock', 'Electrocute'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(result.primarySkill?.supports, []);
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:shock'));
  assert.ok(result.unresolved.some((entry) => entry.obligationId === 'offense:electrocute'));
});

test('conflicting Shock and Electrocute support routes split across separate active skill lanes', () => {
  const talismanEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['talisman'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['talisman']
  };
  const attackSupportTarget = {
    equipment: { is_unrestricted: true },
    target_skill: { allowed_skill_types_any_of: ['Attack', 'Damage'], excluded_skill_types: [] }
  };
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'rampage',
      name: 'Rampage',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
      equipment: talismanEquipment,
      types: ['Attack', 'Damage', 'Talisman']
    }),
    entity({
      id: 'rend',
      name: 'Rend',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' },
        { relation: 'modifies', subject: 'skill', mechanic: 'lightning', confidence: 'strong' }
      ],
      equipment: talismanEquipment,
      types: ['Attack', 'Damage', 'Talisman']
    }),
    entity({
      id: 'thunderstorm',
      name: 'Thunderstorm',
      facts: [
        { relation: 'has_property', subject: 'skill', mechanic: 'lightning', confidence: 'exact' },
        { relation: 'inflicts', subject: 'skill', mechanic: 'shock', confidence: 'strong' }
      ],
      types: ['Spell', 'Damage', 'Lightning']
    }),
    entity({
      id: 'lightning-attunement',
      name: 'Lightning Attunement',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [{ relation: 'provides', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' }],
      types: [],
      compatibility: attackSupportTarget,
      supportFamily: { id: 'support-family:lightning-attunement', name: 'Lightning Attunement', tier: null }
    }),
    entity({
      id: 'shock',
      name: 'Shock',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [
        { relation: 'has_property', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' },
        { relation: 'inflicts', subject: 'supported_skill', mechanic: 'shock', confidence: 'strong' }
      ],
      types: [],
      compatibility: attackSupportTarget,
      supportFamily: { id: 'support-family:shock', name: 'Shock', tier: null }
    }),
    entity({
      id: 'electrocute',
      name: 'Electrocute',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [
        { relation: 'provides', subject: 'supported_skill', mechanic: 'electrocute', condition: 'lightning_damage', confidence: 'exact' },
        { relation: 'requires', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' },
        { relation: 'prevents', subject: 'supported_skill', mechanic: 'shock', confidence: 'exact' }
      ],
      types: [],
      compatibility: attackSupportTarget,
      supportFamily: { id: 'support-family:electrocute', name: 'Electrocute', tier: null }
    })
  ]), { weapon: 'Talisman', offenseList: ['Shock', 'Electrocute'] }, {
    offenseInventory: offenseInventory()
  });

  assert.ok(result.pieces.some((piece) => piece.name === 'Rend'));
  assert.equal(result.pieces.some((piece) => piece.name === 'Thunderstorm'), false);
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:shock'));
  assert.ok(!result.unresolved.some((entry) => entry.obligationId === 'offense:electrocute'));

  const assignedSupports = result.supportAssignments.flatMap((assignment) =>
    assignment.supports.map((support) => ({ ...support, skillName: assignment.skillName }))
  );
  assert.deepEqual(
    new Set(assignedSupports.map((support) => support.name)),
    new Set(['Electrocute', 'Lightning Attunement', 'Shock'])
  );
  const shockSkill = assignedSupports.find((support) => support.name === 'Shock')?.skillName;
  const electrocuteSkill = assignedSupports.find((support) => support.name === 'Electrocute')?.skillName;
  assert.notEqual(shockSkill, electrocuteSkill);
});

test('compound AND support targets require every concrete skill type', () => {
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'mace-hit',
      name: 'Mace Hit',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'physical', confidence: 'exact' }],
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: ['mace'],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: ['mace']
      },
      types: ['Attack', 'Damage', 'Mace']
    }),
    entity({
      id: 'bow-lightning',
      name: 'Bow Lightning',
      contentType: 'support_gem',
      roles: ['enabler'],
      facts: [{ relation: 'provides', subject: 'supported_skill', mechanic: 'lightning', confidence: 'exact' }],
      types: [],
      compatibility: {
        equipment: { is_unrestricted: true },
        target_skill: {
          allowed_skill_types_any_of: ['AND', 'Attack', 'Bow'],
          excluded_skill_types: []
        }
      },
      supportFamily: { id: 'support-family:bow-lightning', name: 'Bow Lightning', tier: null }
    })
  ]), { weapon: 'Mace', offenseList: ['Lightning Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.equal(result.primarySkill, null);
  assert.equal(result.diagnostics.assignedSupportCount, 0);
});

test('Totem meta skills require and pair with a typed socketed payload', () => {
  const casterEquipment = {
    is_unrestricted: false,
    mainhand_tags_any_of: ['staff', 'wand', 'sceptre'],
    offhand_tags_any_of: [],
    allowed_weapon_tags_any_of: ['staff', 'wand', 'sceptre']
  };
  const result = selectRecommendationPackageV3(catalog([
    entity({
      id: 'spell-totem',
      name: 'Spell Totem',
      roles: ['primary_damage', 'payoff'],
      facts: [{ relation: 'creates', subject: 'skill', mechanic: 'totem', confidence: 'exact' }],
      types: ['Meta', 'SummonsTotem'],
      compatibility: {
        equipment: casterEquipment,
        meta_payload: {
          mechanic: 'socketed_spell',
          allowed_skill_types_any_of: ['Spell'],
          excluded_skill_types: ['Cooldown']
        }
      }
    }),
    entity({
      id: 'fireball',
      name: 'Fireball',
      facts: [{ relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' }],
      types: ['Spell', 'Damage', 'Fire']
    })
  ]), { weapon: 'Wand', offenseList: ['Totems'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(result.pieces.map((piece) => piece.name), ['Spell Totem', 'Fireball']);
  assert.equal(result.supportingSkill?.assignedRole, 'secondary_damage');
  assert.ok(result.synergyEdges.some((edge) =>
    edge.metaPayload && edge.mechanic === 'socketed_spell'
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

test('a conditional resource enabler requires its paired payoff to supply a trigger', () => {
  const siphon = entity({
    id: 'infusion-focus',
    name: 'Infusion Focus',
    roles: ['setup_control', 'utility'],
    types: ['Buff'],
    facts: [{
      relation: 'generates',
      subject: 'skill',
      mechanic: 'infusion',
      condition: 'after_elemental_ailment_application',
      requires_any_mechanics: ['freeze', 'shock', 'ignite'],
      confidence: 'exact'
    }]
  });
  const payoff = (id, name, triggerFacts = []) => entity({
    id,
    name,
    roles: ['primary_damage', 'payoff'],
    facts: [
      { relation: 'has_property', subject: 'skill', mechanic: 'fire', confidence: 'exact' },
      { relation: 'consumes', subject: 'skill', mechanic: 'infusion', confidence: 'exact' },
      ...triggerFacts
    ]
  });

  const withoutTrigger = selectRecommendationPackageV3(catalog([
    payoff('plain-payoff', 'Plain Infusion Payoff'),
    siphon
  ]), { weapon: 'Wand', offenseList: ['Fire Damage'] }, {
    offenseInventory: offenseInventory()
  });
  const withTrigger = selectRecommendationPackageV3(catalog([
    payoff('ignite-payoff', 'Igniting Infusion Payoff', [
      { relation: 'inflicts', subject: 'skill', mechanic: 'ignite', confidence: 'exact' }
    ]),
    siphon
  ]), { weapon: 'Wand', offenseList: ['Fire Damage'] }, {
    offenseInventory: offenseInventory()
  });

  assert.deepEqual(withoutTrigger.pieces.map((piece) => piece.name), ['Plain Infusion Payoff']);
  assert.deepEqual(withTrigger.pieces.map((piece) => piece.name), [
    'Igniting Infusion Payoff',
    'Infusion Focus'
  ]);
  assert.ok(withTrigger.synergyEdges.some((edge) =>
    edge.mechanic === 'infusion'
      && edge.condition === 'after_elemental_ailment_application'
      && edge.requiresAnyMechanics.includes('ignite')
  ));
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
      fulfilledObligations: [{ obligationId: 'offense:fire' }],
      supports: [{
        entityId: 'skill:support',
        sourceId: 'support',
        name: 'Bridge Support',
        familyId: 'support-family:bridge',
        tier: 2
      }]
    }
  };
  const adapted = adaptRecommendationPackageV3ToSnapshot(packageResult);
  assert.equal(adapted.recommendedSkills[0].name, 'Test Skill');
  assert.deepEqual(
    adapted.recommendedSkills[0].recommendationV3.supports.map((support) => support.name),
    ['Bridge Support']
  );
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
    const [
      { normalizeRecommendationContract },
      { deriveBuildCardModel },
      { buildPublicBuildCardRequest },
      { buildCompactSnapshotPayload }
    ] = await Promise.all([
      import(new URL('../js/22-recommendation-contract.js', import.meta.url)),
      import(new URL('../js/23-build-card-foundation.js', import.meta.url)),
      import(new URL('../js/publicCardBuilders.js', import.meta.url)),
      import(new URL('../js/25-card-polish.js', import.meta.url))
    ]);
    const snapshot = normalizeRecommendationContract({
      buildName: 'Package Test',
      weapon: 'Crossbow',
      recommendedSkills: [
        {
          name: 'Primary',
          recommendationV3: {
            assignedRole: 'primary_damage',
            supports: [{ name: 'Bleed III' }, { name: 'Gain Chaos' }]
          }
        },
        { name: 'Secondary', recommendationV3: { assignedRole: 'secondary_damage' } },
        { name: 'Filler' }
      ]
    });
    const skillSection = deriveBuildCardModel(snapshot).backSections.find((entry) => entry.label === 'Skill Ideas');

    assert.deepEqual(snapshot.recommendedSkills.map((entry) => entry.name), ['Primary', 'Secondary']);
    assert.deepEqual(skillSection.values.map((entry) => entry.name), ['Primary', 'Secondary']);
    assert.deepEqual(skillSection.values.map((entry) => entry.prefix), ['Primary', 'Secondary']);
    assert.equal(skillSection.values[0].meta, ' · Supports: Bleed III + Gain Chaos');
    assert.deepEqual(skillSection.values[0].tipLines, ['Bleed III', 'Gain Chaos']);
    assert.deepEqual(
      buildPublicBuildCardRequest(snapshot).payload.snapshot.recommendedSkills[0]
        .recommendationV3.supports.map((support) => support.name),
      ['Bleed III', 'Gain Chaos']
    );
    assert.deepEqual(
      buildCompactSnapshotPayload(snapshot).rs[0]
        .recommendationV3.supports.map((support) => support.name),
      ['Bleed III', 'Gain Chaos']
    );
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
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const snapshots = [
    { weapon: 'Bow', offhand: 'Quiver', offenseList: ['Poison'] },
    { weapon: 'Quarterstaff', offhand: '', offenseList: ['Lightning Damage'] },
    { weapon: 'Sceptre', offhand: 'Focus', offenseList: ['Minions'] }
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
    loadRealRecommendationCatalogV3(),
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
    'Claw', 'Dagger', 'Flail', 'Spear', 'Wand', 'Sceptre', 'Talisman'
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
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../data/config/recommendation_critical_profiles_v3.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const weapons = [
    'Two-handed Mace', 'Two-handed Axe', 'Two-handed Sword', 'Bow', 'Crossbow',
    'Quarterstaff', 'Staff', 'One-handed Mace', 'One-handed Axe', 'One-handed Sword',
    'Claw', 'Dagger', 'Flail', 'Spear', 'Wand', 'Sceptre', 'Talisman'
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

test('the real 9 by 16 active matrix has a locked final Offense coverage breakdown', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const weapons = [
    'Mace', 'Quarterstaff', 'Bow', 'Crossbow', 'Talisman', 'Spear', 'Staff', 'Wand', 'Sceptre'
  ];
  const counts = {
    active_direct: 0,
    support_assigned: 0,
    carrier_only: 0,
    no_primary: 0
  };

  assert.equal(realOffense.elements.length, 16);
  for (const weapon of weapons) {
    for (const offense of realOffense.elements) {
      const snapshot = { weapon, offenseList: [offense.name] };
      const result = selectRecommendationPackageV3(realCatalog, snapshot, { offenseInventory: realOffense });
      const assignedSupports = result.supportAssignments.flatMap((assignment) => {
        assert.ok(assignment.supports.length <= 2, `${weapon} / ${offense.name}`);
        return assignment.supports;
      });
      assert.equal(
        new Set(assignedSupports.map((support) => support.familyId)).size,
        assignedSupports.length,
        `${weapon} / ${offense.name}`
      );
      assert.ok(assignedSupports.every((support) =>
        support.fulfilledObligations.length + support.suppliedTargets.length > 0
      ), `${weapon} / ${offense.name}`);
      const primary = result.primarySkill;
      const obligationId = `offense:${offense.id}`;
      const coverage = result.diagnostics.offenseCoverage.find((entry) => entry.obligationId === obligationId);
      assert.ok(coverage, `${weapon} / ${offense.name}`);
      assert.ok(Object.hasOwn(counts, coverage.state), `${weapon} / ${offense.name}: ${coverage.state}`);
      counts[coverage.state] += 1;

      if (!primary) {
        assert.equal(coverage.state, 'no_primary', `${weapon} / ${offense.name}`);
        continue;
      }
      const selected = realCatalog.entities.find((entry) => entry.id === primary.entityId);
      assert.equal(isEquipmentCompatibleV3(selected, snapshot), true, `${weapon} / ${offense.name}`);
      assert.equal(evaluateDeliveryCompatibilityV3(selected, snapshot).ok, true, `${weapon} / ${offense.name}`);
      if (coverage.state === 'support_assigned') {
        assert.ok(coverage.providerName, `${weapon} / ${offense.name}`);
        assert.ok(coverage.supportedSkillName, `${weapon} / ${offense.name}`);
        assert.ok(!result.unresolved.some((entry) => entry.obligationId === obligationId), `${weapon} / ${offense.name}`);
      }
    }
  }

  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 144);
  assert.deepEqual(counts, {
    active_direct: 100,
    support_assigned: 37,
    carrier_only: 2,
    no_primary: 5
  });
});

test('committed catalog gates granted-only active skills by their provider source', async () => {
  const realCatalog = await loadRealRecommendationCatalogV3();
  const findSkill = (name) => realCatalog.entities.find((entry) =>
    entry.content_type === 'active_skill' && entry.name === name
  );
  const manifest = findSkill('Manifest Weapon');
  const phantasmal = findSkill('Phantasmal Arrow');
  const cackling = findSkill('Cackling Companions');
  const azmerianWolf = findSkill('Azmerian Wolf');

  assert.equal(manifest.compatibility.access.ascendancy, 'Smith of Kitava');
  assert.equal(manifest.compatibility.access.requires_granted_source, true);
  assert.equal(evaluateCompatibilityV3(manifest, { weapon: 'Mace', ascendancy: 'Titan' }).ok, false);
  assert.equal(evaluateCompatibilityV3(manifest, { weapon: 'Mace', ascendancy: 'Smith of Kitava' }).ok, true);
  assert.equal(evaluateCompatibilityV3(manifest, { weapon: 'Bow', ascendancy: 'Smith of Kitava' }).ok, false);

  assert.equal(phantasmal.compatibility.access.requires_unique_provider, true);
  assert.equal(phantasmal.compatibility.access.granted_sources[0].unique_name, "Fairgraves' Curse");
  assert.equal(evaluateCompatibilityV3(phantasmal, { weapon: 'Bow' }).ok, false);
  assert.equal(evaluateCompatibilityV3(phantasmal, {
    weapon: 'Bow',
    recommendedUniques: ["Fairgraves' Curse"]
  }).ok, true);

  assert.equal(cackling.compatibility.access.requires_unique_provider, true);
  assert.equal(cackling.compatibility.access.granted_sources[0].unique_name, "Hysseg's Claw");
  assert.equal(evaluateCompatibilityV3(cackling, { weapon: 'Talisman' }).ok, false);
  assert.equal(azmerianWolf.compatibility.access, undefined);
});

test('committed catalog separates Companion and nested Minion archetype evidence', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const selectedNames = (weapon, offense) => {
    const names = new Set();
    for (let index = 0; index < 64; index += 1) {
      const result = selectRecommendationPackageV3(realCatalog, {
        weapon,
        offenseList: [offense]
      }, { offenseInventory: realOffense, selectionSeed: `m-${index}` });
      if (result.primarySkill?.name) names.add(result.primarySkill.name);
    }
    return names;
  };

  const bowCompanions = selectedNames('Bow', 'Companions');
  const spearCompanions = selectedNames('Spear', 'Companions');
  const talismanCompanions = selectedNames('Talisman', 'Companions');
  const talismanMinions = selectedNames('Talisman', 'Minions');

  assert.ok(bowCompanions.has('Tame Beast'));
  assert.equal(bowCompanions.has('Rhoa Mount'), false);
  assert.ok(spearCompanions.has('Tame Beast'));
  assert.equal(spearCompanions.has('Rhoa Mount'), false);
  assert.equal(talismanCompanions.has('Pounce'), false);
  assert.ok(talismanMinions.has('Pounce'));

  const pounce = realCatalog.entities.find((entry) => entry.name === 'Pounce');
  const tameBeast = realCatalog.entities.find((entry) => entry.name === 'Tame Beast');
  assert.ok(pounce.facts.some((fact) =>
    fact.relation === 'creates'
      && fact.mechanic === 'minion'
      && fact.condition === 'predators_mark_activation'
  ));
  assert.ok(tameBeast.facts.some((fact) =>
    fact.relation === 'creates' && fact.mechanic === 'companion'
  ));
  assert.equal(evaluateCompatibilityV3(tameBeast, { weapon: 'Bow' }).ok, true);
});

test('committed caster Totem rolls emit Spell Totem with a legal socketed Spell', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);

  for (const weapon of ['Staff', 'Wand', 'Sceptre']) {
    const result = selectRecommendationPackageV3(realCatalog, {
      weapon,
      offenseList: ['Totems']
    }, { offenseInventory: realOffense });
    assert.equal(result.primarySkill?.name, 'Spell Totem', weapon);
    assert.ok(result.supportingSkill, weapon);
    const payload = realCatalog.entities.find((entry) => entry.id === result.supportingSkill.entityId);
    assert.ok(payload.source_evidence.active_skill_types.includes('Spell'), weapon);
    assert.ok(!payload.source_evidence.active_skill_types.includes('Cooldown'), weapon);
    assert.ok(result.synergyEdges.some((edge) => edge.metaPayload), weapon);
  }

  const ancestral = realCatalog.entities.find((entry) => entry.name === 'Ancestral Warrior Totem');
  const mortar = realCatalog.entities.find((entry) => entry.name === 'Mortar Cannon');
  assert.equal(ancestral.compatibility.meta_payload.mechanic, 'socketed_mace_skill');
  assert.equal(mortar.compatibility.meta_payload.mechanic, 'socketed_grenade');
  assert.ok(ancestral.candidate_roles.includes('primary_damage'));
  assert.ok(mortar.candidate_roles.includes('primary_damage'));
});

test('committed provider supports retain typed Minion creation and target constraints', async () => {
  const realCatalog = await loadRealRecommendationCatalogV3();
  const living = realCatalog.entities.find((entry) => entry.name === 'Living Lightning');
  const skittering = realCatalog.entities.find((entry) => entry.name === 'Skittering Stone I');

  assert.ok(living.facts.some((fact) =>
    fact.relation === 'creates' && fact.mechanic === 'minion'
  ));
  assert.ok(living.facts.some((fact) =>
    fact.relation === 'requires' && fact.mechanic === 'lightning'
  ));
  assert.deepEqual(living.compatibility.target_skill.allowed_skill_types_any_of, ['Attack', 'Damage']);
  assert.ok(skittering.facts.some((fact) =>
    fact.relation === 'creates' && fact.mechanic === 'minion'
  ));
  assert.deepEqual(skittering.compatibility.target_skill.allowed_skill_types_any_of, [
    'CanCreateStoneElementals'
  ]);
});

test('committed support semantics collapse tiers and preserve typed bridges and conflicts', async () => {
  const realCatalog = await loadRealRecommendationCatalogV3();
  const support = (name) => realCatalog.entities.find((entry) =>
    entry.content_type === 'support_gem' && entry.name === name
  );
  const hasFact = (entity, expected) => entity.facts.some((fact) =>
    Object.entries(expected).every(([key, value]) => fact[key] === value)
  );

  const bleedOne = support('Bleed I');
  const bleedFour = support('Bleed IV');
  assert.equal(bleedOne.support_family.id, 'support-family:bleed');
  assert.equal(bleedFour.support_family.id, bleedOne.support_family.id);
  assert.equal(bleedOne.support_family.tier, 1);
  assert.equal(bleedFour.support_family.tier, 4);
  assert.equal(hasFact(bleedFour, { relation: 'inflicts', mechanic: 'bleed' }), false);
  assert.equal(hasFact(bleedFour, { relation: 'prevents', mechanic: 'bleed' }), true);

  const livingLightning = support('Living Lightning');
  const livingLightningTwo = support('Living Lightning II');
  assert.equal(livingLightning.support_family.id, livingLightningTwo.support_family.id);
  assert.equal(livingLightning.support_family.tier, 1);
  assert.equal(livingLightningTwo.support_family.tier, 2);

  const fireAttunement = support('Fire Attunement');
  assert.equal(hasFact(fireAttunement, { relation: 'provides', mechanic: 'fire' }), true);

  const electrocute = support('Electrocute');
  assert.equal(hasFact(electrocute, {
    relation: 'provides',
    mechanic: 'electrocute',
    condition: 'lightning_damage'
  }), true);
  assert.equal(hasFact(electrocute, { relation: 'requires', mechanic: 'lightning' }), true);
  assert.equal(hasFact(electrocute, { relation: 'prevents', mechanic: 'shock' }), true);

  const eshsRadiance = support("Esh's Radiance");
  assert.equal(hasFact(eshsRadiance, {
    relation: 'provides',
    mechanic: 'shock',
    condition: 'chaos_damage'
  }), true);
  assert.equal(hasFact(eshsRadiance, { relation: 'requires', mechanic: 'chaos' }), true);

  const lastingShock = support('Lasting Shock');
  assert.equal(hasFact(lastingShock, { relation: 'inflicts', mechanic: 'shock' }), false);
});

test('committed Siphon Elements data and historical false pairings stay corrected', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const siphon = realCatalog.entities.find((entry) => entry.name === 'Siphon Elements');
  const conditionalOutputs = siphon.facts.filter((fact) =>
    fact.relation === 'generates' && ['infusion', 'remnant'].includes(fact.mechanic)
  );

  assert.ok(!siphon.facts.some((fact) =>
    fact.relation === 'inflicts' && ['freeze', 'shock', 'ignite'].includes(fact.mechanic)
  ));
  assert.equal(conditionalOutputs.length, 2);
  assert.ok(conditionalOutputs.every((fact) =>
    fact.condition === 'after_elemental_ailment_application'
      && ['freeze', 'shock', 'ignite'].every((mechanic) =>
        fact.requires_any_mechanics.includes(mechanic)
      )
  ));

  const historicalFalsePairings = [
    { weapon: 'Quarterstaff', offenseList: ['Cold Damage'] },
    { weapon: 'Staff', offenseList: ['Physical Damage'] },
    { weapon: 'Wand', offenseList: ['Freeze'] },
    { weapon: 'Sceptre', offenseList: ['Minions'] },
    { weapon: 'Mace', offenseList: ['Physical Damage', 'Freeze'] }
  ];
  for (const snapshot of historicalFalsePairings) {
    const result = selectRecommendationPackageV3(realCatalog, snapshot, {
      offenseInventory: realOffense
    });
    assert.ok(!result.pieces.some((piece) => piece.name === 'Siphon Elements'), JSON.stringify(snapshot));
  }
});

test('committed catalog never selects Chaos Bolt for Bow or Unearth for Spear', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const bow = selectRecommendationPackageV3(realCatalog, {
    weapon: 'Bow',
    offhand: 'Quiver',
    offenseList: ['Chaos Damage', 'Bleed']
  }, { offenseInventory: realOffense, selectionSeed: 'screenshot-bow' });
  const spear = selectRecommendationPackageV3(realCatalog, {
    weapon: 'Spear',
    offenseList: ['Minions']
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
    loadRealRecommendationCatalogV3(),
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
    assert.ok(maceShock.primarySkill);
    assert.equal(maceShock.supportingSkill, null);
    assert.deepEqual(
      maceShock.primarySkill.supports.map((support) => support.name),
      ['Shock']
    );
    assert.ok(maceShock.primarySkill.supports.every((support) => support.availability === 'normal'));
    assert.ok(!maceShock.unresolved.some((entry) => entry.obligationId === 'offense:shock'));

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

test('committed catalog keeps legal spear and crossbow options after the tighter companion gate', async () => {
  const [realCatalog, realOffense] = await Promise.all([
    loadRealRecommendationCatalogV3(),
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
  assert.deepEqual([...spear.names], ['Fangs of Frost']);
  assert.ok(spear.diagnostics.rankedCandidates >= 2);
  assert.equal(spear.diagnostics.shortlistedCandidates, 1);

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
    loadRealRecommendationCatalogV3(),
    readFile(new URL('../data/offense-inventory.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const cases = [
    {
      label: 'Crossbow / Shock',
      snapshot: { weapon: 'Crossbow', offenseList: ['Shock'] },
      carrierIds: ['offense:shock'],
      expectSupporting: true,
      expectedSupports: ['Shock']
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
      if (fixture.expectedSupports) {
        assert.deepEqual(
          result.supportAssignments.flatMap((assignment) => assignment.supports.map((support) => support.name)),
          fixture.expectedSupports,
          fixture.label
        );
      }
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
      weapon: 'Talisman',
      offenseList: ['Shock', 'Electrocute']
    }, { offenseInventory: realOffense, selectionSeed: `reported-talisman-lanes-${index}` });
    assert.ok(result.supportingSkill, `Talisman Shock/Electrocute ${index}`);
    assert.ok(!result.pieces.some((piece) => piece.name === 'Thunderstorm'), `Talisman Shock/Electrocute ${index}`);
    assert.deepEqual(
      new Set(result.diagnostics.offenseCoverage
        .filter((entry) => ['offense:shock', 'offense:electrocute'].includes(entry.obligationId))
        .map((entry) => entry.state)),
      new Set(['support_assigned']),
      `Talisman Shock/Electrocute ${index}`
    );
    const assigned = result.supportAssignments.flatMap((assignment) =>
      assignment.supports.map((support) => ({ ...support, skillName: assignment.skillName }))
    );
    assert.ok(assigned.some((support) => support.name === 'Shock'), `Talisman Shock/Electrocute ${index}`);
    assert.ok(assigned.some((support) => support.name === 'Electrocute'), `Talisman Shock/Electrocute ${index}`);
    assert.notEqual(
      assigned.find((support) => support.name === 'Shock')?.skillName,
      assigned.find((support) => support.name === 'Electrocute')?.skillName,
      `Talisman Shock/Electrocute ${index}`
    );
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
    loadRealRecommendationCatalogV3(),
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
