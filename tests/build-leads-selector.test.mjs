import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUILD_LEAD_COPY, ROLE_MINIMUMS, selectBuildLeads } from '../js/32-build-leads-selector.js';
import { mergeRecommendationGrantedSkillAccessV3, mergeRecommendationSkillCraftingV3 } from '../js/30-recommendation-v3-selector.js';
import { mergeRecommendationUniqueSemanticsV3 } from '../js/31-non-skill-recommendation-selector.js';

const fact = (relation, mechanic, extra = {}) => ({ relation, mechanic, confidence: 'strong', scope: 'outgoing', ...extra });
const entity = (id, contentType, facts, extra = {}) => ({ id, source_id: id, name: extra.name || id,
  content_type: contentType, facts, compatibility: extra.compatibility || { equipment: { is_unrestricted: true } }, ...extra });
const maceCompatibility = { equipment: { allowed_weapon_tags_any_of: ['mace'] } };
const snapshot = { ascendancy: 'Chronomancer', weapon: 'Mace', weaponFamily: 'Mace', offenseSet: ['cold'], passiveTreeStart: 'str_int' };
const catalog = (entities) => ({ _meta: { schema_version: 'recommendation-catalog-v3.0.0' }, entities });
const active = (id, mechanic = 'cold', weapon = 'mace', extra = {}) => entity(id, 'active_skill', [
  fact('has_property', mechanic, { confidence: 'exact' }), fact('fulfills', mechanic)
], { candidate_roles: ['primary_damage'], compatibility: { equipment: { requirement_id: weapon,
  mainhand_tags_any_of: [weapon], allowed_weapon_tags_any_of: [weapon] } },
source_evidence: { active_skill_types: ['Attack', titleCase(weapon), titleCase(mechanic)],
  crafting: { types_raw: [titleCase(weapon)], weapon_affinities: [weapon] } }, ...extra });
const titleCase = (value) => value[0].toUpperCase() + value.slice(1);

test('explicit Weapon + Offense skills are Direct Fits and outrank generic single-tag tools', () => {
  const direct = active('cold-hammer');
  const generic = entity('cold-number', 'passive', [fact('modifies', 'cold')]);
  const result = selectBuildLeads(catalog([generic, direct]), snapshot, { selectionSeed: 'same' });
  assert.equal(result.categories.directFits[0].id, 'cold-hammer');
  assert.ok(result.categories.directFits[0].score > result.categories.usefulTools[0].score);
});

test('a roll without a direct skill leaves Direct Fits absent rather than filling it', () => {
  const result = selectBuildLeads(catalog([
    entity('cold-tool', 'unique', [fact('provides', 'cold')])
  ]), snapshot);
  assert.equal(result.categories.directFits, undefined);
  assert.equal(result.categories.enablers.length, 1);
});

test('conversion and gain/provision facts are enablers while prior-state requirements are payoffs', () => {
  const result = selectBuildLeads(catalog([
    entity('conversion', 'unique', [fact('converts', null, { from: 'fire', to: 'cold' })]),
    entity('extra-cold', 'unique', [fact('provides', 'cold')]),
    entity('frozen-payoff', 'passive', [fact('requires', 'cold')])
  ]), snapshot);
  assert.deepEqual(new Set(result.categories.enablers.map((lead) => lead.id)), new Set(['conversion', 'extra-cold']));
  assert.deepEqual(result.categories.payoffs.map((lead) => lead.id), ['frozen-payoff']);
  assert.match(result.categories.payoffs[0].explanation, /Cold after it is established/);
});

test('prevents facts reject contradictory candidates', () => {
  const result = selectBuildLeads(catalog([
    entity('contradiction', 'unique', [fact('inflicts', 'cold'), fact('prevents', 'cold')]),
    entity('safe', 'unique', [fact('inflicts', 'cold')])
  ]), snapshot);
  assert.deepEqual(result.categories.enablers.map((lead) => lead.id), ['safe']);
});

test('item tools, granted-skill semantics, and keystones can surface', () => {
  const result = selectBuildLeads(catalog([
    entity('granted-cold-mace', 'unique', [fact('provides', 'cold'), fact('provides', 'granted_skill')], { compatibility: maceCompatibility }),
    entity('cold-keystone', 'keystone', [fact('converts', null, { from: 'physical', to: 'cold' })])
  ]), snapshot);
  assert.equal(result.categories.directFits[0].id, 'granted-cold-mace');
  assert.equal(result.categories.enablers.find((lead) => lead.id === 'cold-keystone')?.contentType, 'keystone');
});

test('empty categories are omitted and category counts are threshold-driven rather than quotas', () => {
  const one = selectBuildLeads(catalog([entity('only', 'unique', [fact('inflicts', 'cold')])]), snapshot);
  assert.deepEqual(Object.keys(one.categories), ['enablers']);
  assert.equal(one.categories.enablers.length, 1);
  assert.equal(BUILD_LEAD_COPY.categories.enablers, 'Ways to Enable');
  assert.ok(Object.values(ROLE_MINIMUMS).every((minimum) => minimum > 0));
});

test('small typed producer-to-payoff chains surface without a package', () => {
  const result = selectBuildLeads(catalog([
    entity('forge', 'unique', [fact('creates', 'cold')], { name: 'Forge' }),
    entity('payoff', 'passive', [fact('requires', 'cold')], { name: 'Payoff' })
  ]), snapshot);
  assert.equal(result.categories.connections[0].name, 'Forge → Payoff');
  assert.match(result.categories.connections[0].explanation, /Creates Cold/);
  assert.equal(result.package, undefined);
});

test('ascendancy access and current-content exclusions remain hard gates', () => {
  const result = selectBuildLeads(catalog([
    entity('owned', 'ascendancy_passive', [fact('provides', 'cold')], { required_ascendancy: 'Chronomancer' }),
    entity('other', 'ascendancy_passive', [fact('provides', 'cold')], { required_ascendancy: 'Invoker' }),
    entity('seasonal', 'unique', [fact('provides', 'cold')], { provenance: { source_tags: ['kalguuran'] } }),
    entity('prototype', 'support_gem', [fact('provides', 'cold')], { retrieval_terms: ['prototype'] }),
    entity('inaccessible', 'unique', [fact('provides', 'cold')], { compatibility: { access: { available: false }, equipment: { is_unrestricted: true } } }),
    entity('missing-provider', 'active_skill', [fact('provides', 'cold')], { compatibility: {
      access: { requires_granted_source: true, granted_sources: [] }, equipment: { is_unrestricted: true }
    } })
  ]), snapshot);
  assert.deepEqual(result.categories.enablers.map((lead) => lead.id), ['owned']);
  assert.equal(result.categories.directFits, undefined);
});

test('selection is deterministic and caps only independently qualified candidates', () => {
  const entities = Array.from({ length: 8 }, (_, index) => entity(`tool-${index}`, 'unique', [fact('inflicts', 'cold')]));
  const first = selectBuildLeads(catalog(entities), snapshot, { selectionSeed: 'fate' });
  const second = selectBuildLeads(catalog(entities), snapshot, { selectionSeed: 'fate' });
  assert.deepEqual(first, second);
  assert.equal(first.categories.enablers.length, 6);
  assert.ok(first.categories.enablers.every((lead) => lead.score >= ROLE_MINIMUMS.enablers));
});

test('one-hop ailment neighbors and a controlled conversion source can establish relevance', () => {
  const result = selectBuildLeads(catalog([
    entity('freeze-buildup', 'passive', [fact('modifies', 'freeze')]),
    entity('fire-to-cold', 'unique', [fact('converts', null, { from: 'fire', to: 'cold' })]),
    entity('fire-mace', 'active_skill', [fact('has_property', 'fire')], { compatibility: maceCompatibility })
  ]), snapshot);
  assert.equal(result.categories.usefulTools.find((lead) => lead.id === 'freeze-buildup')?.relevancePath.distance, 1);
  assert.equal(leadNames(result).includes('fire-mace'), false);
  assert.equal(result.categories.connections, undefined);
});

test('semantic role is primary while entity type remains presentation metadata', () => {
  const result = selectBuildLeads(catalog([
    entity('conversion-gloves', 'unique', [fact('converts', null, { from: 'fire', to: 'cold' })])
  ]), snapshot);
  assert.equal(result.categories.enablers[0].role, 'enablers');
  assert.equal(result.categories.enablers[0].entityType, 'Unique');
  assert.equal(result.categories.enablers[0].contentType, 'unique');
});

test('hard applicability rejects cross-family unique weapons and passives before relevance', () => {
  const result = selectBuildLeads(catalog([
    entity('cold-bow', 'unique', [fact('provides', 'cold')], { compatibility: { equipment: { slot: 'Bow', base: 'Cold Bow' } } }),
    entity('cold-gloves', 'unique', [fact('provides', 'cold')], { compatibility: { equipment: { slot: 'Gloves' } } }),
    entity('bow-passive', 'passive', [fact('modifies', 'cold')], { passive_tree_starts: ['str_int'],
      compatibility: { passive_weapon: { compatible_weapon_family_ids: ['bow'], unresolved_requirements: [], fail_closed: false } } }),
    entity('mace-passive', 'passive', [fact('modifies', 'cold')], { passive_tree_starts: ['str_int'],
      compatibility: { passive_weapon: { compatible_weapon_family_ids: ['mace'], unresolved_requirements: [], fail_closed: false } } })
  ]), snapshot);
  assert.equal(leadNames(result).includes('cold-bow'), false);
  assert.equal(leadNames(result).includes('bow-passive'), false);
  assert.ok(leadNames(result).includes('cold-gloves'));
  assert.ok(leadNames(result).includes('mace-passive'));
});

test('supports require a plausible target in the rolled weapon ecosystem', () => {
  const carrier = active('cold-hammer');
  const support = (id, targetType) => entity(id, 'support_gem', [fact('modifies', 'cold')], {
    compatibility: { equipment: { is_unrestricted: true }, target_skill: { allowed_skill_types_any_of: [targetType] } }
  });
  const result = selectBuildLeads(catalog([carrier, support('attack-support', 'Attack'), support('bow-support', 'Bow')]), snapshot);
  assert.ok(leadNames(result).includes('attack-support'));
  assert.equal(leadNames(result).includes('bow-support'), false);
});

test('granted active skills require an actually available granting source', () => {
  const granted = (id, sourceAscendancy) => active(id, 'cold', 'mace', { compatibility: {
    access: { requires_granted_source: true, granted_sources: [{ kind: 'ascendancy_passive', ascendancy: sourceAscendancy }] },
    equipment: { requirement_id: 'Mace', mainhand_tags_any_of: ['mace'], allowed_weapon_tags_any_of: ['mace'] }
  } });
  const result = selectBuildLeads(catalog([granted('chronomancer-skill', 'Chronomancer'), granted('invoker-skill', 'Invoker')]), snapshot);
  assert.ok(leadNames(result).includes('chronomancer-skill'));
  assert.equal(leadNames(result).includes('invoker-skill'), false);

  const uniqueGranted = active('item-skill', 'cold', 'mace', { compatibility: {
    access: { requires_granted_source: true, granted_sources: [{ kind: 'unique', unique_name: 'Provider', unique_id: 'Provider||Gloves' }] },
    equipment: { requirement_id: 'Mace', mainhand_tags_any_of: ['mace'], allowed_weapon_tags_any_of: ['mace'] }
  } });
  assert.equal(leadNames(selectBuildLeads(catalog([uniqueGranted]), snapshot)).includes('item-skill'), false);
  assert.ok(leadNames(selectBuildLeads(catalog([uniqueGranted]), { ...snapshot, recommendedUniques: ['Provider'] })).includes('item-skill'));
});

const readProduction = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const offenseInventory = readProduction('../data/offense-inventory.json');
let productionCatalog = readProduction('../data/enriched/recommendation_catalog_v3.json');
productionCatalog = mergeRecommendationSkillCraftingV3(productionCatalog,
  readProduction('../data/enriched/recommendation_skill_crafting_v3.json'));
productionCatalog = mergeRecommendationGrantedSkillAccessV3(productionCatalog,
  readProduction('../data/enriched/recommendation_granted_skill_access_v3.json'));
productionCatalog = mergeRecommendationUniqueSemanticsV3(productionCatalog,
  readProduction('../data/enriched/recommendation_unique_semantics_v3.json'));
const productionFate = (ascendancy, weapon, offense, passiveTreeStart, seed = 'production-regression') =>
  selectBuildLeads(productionCatalog, { ascendancy, weapon, weaponFamily: weapon, offenseSet: [offense], passiveTreeStart },
    { selectionSeed: seed, offenseInventory });
const categoryCount = (result) => Object.keys(result.categories).length;
const leadNames = (result) => Object.values(result.categories).flat().map((lead) => lead.name);

test('production Chronomancer Mace Cold yields a healthy semantic neighborhood without requiring a skill', () => {
  const result = productionFate('Chronomancer', 'Mace', 'cold', 'str_int');
  assert.ok(categoryCount(result) >= 3);
  assert.ok(leadNames(result).length >= 8);
  assert.ok(leadNames(result).includes('Seeing Stars'));
  assert.ok(leadNames(result).includes('Frostbreath'));
  assert.ok(result.categories.enablers.length >= 3);
  assert.ok(result.neighborhood.some((entry) => entry.mechanic === 'freeze' && entry.distance === 1));
});

test('production native, awkward, ailment, and archetype Fates retain distinct useful shapes', () => {
  const native = productionFate('Deadeye', 'Bow', 'poison', 'dex');
  assert.ok(native.categories.directFits.some((lead) => lead.name === 'Poisonburst Arrow'));
  assert.ok(native.categories.directFits.length >= 3);

  const awkward = productionFate('Warbringer', 'Mace', 'electrocute', 'str');
  assert.ok(awkward.categories.enablers.length >= 3);
  assert.ok(awkward.categories.connections.length >= 1);

  const ailment = productionFate('Invoker', 'Quarterstaff', 'freeze', 'dex_int');
  assert.ok(ailment.categories.directFits.some((lead) => lead.name === 'Wave of Frost'));
  assert.ok(ailment.categories.enablers.length >= 2);

  const archetype = productionFate('Chronomancer', 'Mace', 'totems', 'str_int');
  assert.ok(archetype.categories.enablers.some((lead) => lead.name === 'Shockwave Totem'));
});

test('production applicability audit keeps skills, unique weapons, ascendancies, and passives inside Fate boundaries', () => {
  const cases = [
    ['Chronomancer', 'Mace', 'cold', 'str_int'], ['Deadeye', 'Bow', 'poison', 'dex'],
    ['Warbringer', 'Mace', 'electrocute', 'str'], ['Invoker', 'Quarterstaff', 'freeze', 'dex_int'],
    ['Chronomancer', 'Mace', 'totems', 'str_int']
  ];
  const byId = new Map(productionCatalog.entities.map((entry) => [entry.id, entry]));
  const weaponFamilies = ['quarterstaff', 'crossbow', 'sceptre', 'talisman', 'staff', 'wand', 'spear', 'flail', 'dagger', 'claw', 'sword', 'mace', 'axe', 'bow'];
  for (const [ascendancy, weapon, offense, start] of cases) {
    const result = productionFate(ascendancy, weapon, offense, start, 'applicability-audit');
    for (const lead of Object.values(result.categories).flat().filter((entry) => entry.entityId)) {
      const source = byId.get(lead.entityId);
      assert.ok(source, `${lead.name} resolves to a catalog entity`);
      if (source.content_type === 'ascendancy_passive') {
        assert.equal(source.required_ascendancy || source.compatibility?.access?.ascendancy, ascendancy);
      }
      if (source.content_type === 'unique') {
        const equipment = source.compatibility?.equipment || {};
        const text = [equipment.slot, equipment.base, equipment.weapon_family].join(' ').toLowerCase();
        const family = weaponFamilies.find((candidate) => new RegExp(`(^|[^a-z])${candidate}([^a-z]|$)`).test(text));
        if (family) assert.equal(family, weapon.toLowerCase(), `${lead.name} matches ${weapon}`);
      }
      if (source.content_type === 'passive' && source.compatibility?.passive_weapon) {
        assert.ok(source.compatibility.passive_weapon.compatible_weapon_family_ids.includes(weapon.toLowerCase()));
      }
    }
  }
  const coldMace = productionFate('Chronomancer', 'Mace', 'cold', 'str_int', 'applicability-audit');
  const coldMaceNames = leadNames(coldMace);
  assert.equal(coldMaceNames.includes('Firestorm'), false);
  assert.equal(coldMaceNames.includes('Skeletal Brute'), false);
  assert.equal(Object.values(coldMace.categories).flat().some((lead) => lead.contentType === 'active_skill'), false);
});
