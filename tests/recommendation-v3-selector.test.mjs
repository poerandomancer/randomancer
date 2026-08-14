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
  isEquipmentCompatibleV3,
  isRecommendationV3Enabled,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3
} = selector;

function offenseInventory() {
  return {
    elements: [
      { id: 'poison', name: 'Poison', category: 'Ailment', aliases: [] },
      { id: 'fire', name: 'Fire Damage', category: 'Damage Type', aliases: [] },
      { id: 'critical_hits', name: 'Critical Hits', category: 'Scaling', aliases: ['Crit'] },
      { id: 'minions_companions', name: 'Minions/Companions', category: 'Archetype', aliases: ['Minions'] }
    ]
  };
}

function entity({ id, name, facts, equipment = { is_unrestricted: true }, types = [] }) {
  return {
    id: `skill:${id}`,
    source_id: id,
    content_type: 'active_skill',
    name,
    candidate_roles: ['primary_damage'],
    retrieval_terms: [],
    facts,
    compatibility: { equipment },
    source_evidence: { active_skill_types: types }
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
  const fixtures = catalog([
    entity({
      id: 'bow-poison',
      name: 'Bow Poison',
      facts: [poisonFact],
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: ['bow'],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: ['bow'],
        display: 'Requires Bow'
      }
    }),
    entity({
      id: 'crossbow-poison',
      name: 'Crossbow Poison',
      facts: [poisonFact],
      equipment: {
        is_unrestricted: false,
        mainhand_tags_any_of: ['crossbow'],
        offhand_tags_any_of: [],
        allowed_weapon_tags_any_of: ['crossbow'],
        display: 'Requires Crossbow'
      }
    }),
    entity({
      id: 'poison-modifier',
      name: 'Poison Modifier',
      facts: [{ relation: 'modifies', subject: 'skill', mechanic: 'poison', confidence: 'strong' }]
    }),
    entity({
      id: 'poison-preventer',
      name: 'Poison Preventer',
      facts: [
        poisonFact,
        { relation: 'prevents', subject: 'skill', mechanic: 'poison', confidence: 'exact' }
      ]
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
    'Claw', 'Dagger', 'Flail', 'Spear', 'Wand', 'Sceptre'
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
      assert.ok(first.primarySkill.fulfilledObligations.length > 0, `${weapon} / ${offense.name}`);
      assert.doesNotMatch(first.primarySkill.name, /^\s*\[?DNT/i, `${weapon} / ${offense.name}`);
    }
  }
});
