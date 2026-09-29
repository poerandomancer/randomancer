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

test('explicit Weapon + Offense skills are Direct Fits and outrank generic single-tag tools', () => {
  const direct = entity('cold-hammer', 'active_skill', [fact('fulfills', 'cold')], { compatibility: maceCompatibility });
  const generic = entity('cold-number', 'support_gem', [fact('modifies', 'cold')]);
  const result = selectBuildLeads(catalog([generic, direct]), snapshot, { selectionSeed: 'same' });
  assert.equal(result.categories.directFits[0].id, 'cold-hammer');
  assert.ok(result.categories.directFits[0].score > result.categories.usefulTools[0].score);
});

test('a roll without a direct skill leaves Direct Fits absent rather than filling it', () => {
  const result = selectBuildLeads(catalog([
    entity('cold-support', 'support_gem', [fact('inflicts', 'cold')])
  ]), snapshot);
  assert.equal(result.categories.directFits, undefined);
  assert.equal(result.categories.enablers.length, 1);
});

test('conversion and gain/provision facts are enablers while prior-state requirements are payoffs', () => {
  const result = selectBuildLeads(catalog([
    entity('conversion', 'support_gem', [fact('converts', null, { from: 'fire', to: 'cold' })]),
    entity('extra-cold', 'support_gem', [fact('provides', 'cold')]),
    entity('frozen-payoff', 'active_skill', [fact('requires', 'cold')])
  ]), snapshot);
  assert.deepEqual(new Set(result.categories.enablers.map((lead) => lead.id)), new Set(['conversion', 'extra-cold']));
  assert.deepEqual(result.categories.payoffs.map((lead) => lead.id), ['frozen-payoff']);
  assert.match(result.categories.payoffs[0].explanation, /Cold after it is established/);
});

test('prevents facts reject contradictory candidates', () => {
  const result = selectBuildLeads(catalog([
    entity('contradiction', 'support_gem', [fact('inflicts', 'cold'), fact('prevents', 'cold')]),
    entity('safe', 'support_gem', [fact('inflicts', 'cold')])
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
  const one = selectBuildLeads(catalog([entity('only', 'support_gem', [fact('inflicts', 'cold')])]), snapshot);
  assert.deepEqual(Object.keys(one.categories), ['enablers']);
  assert.equal(one.categories.enablers.length, 1);
  assert.equal(BUILD_LEAD_COPY.categories.enablers, 'Ways to Enable');
  assert.ok(Object.values(ROLE_MINIMUMS).every((minimum) => minimum > 0));
});

test('small typed producer-to-payoff chains surface without a package', () => {
  const result = selectBuildLeads(catalog([
    entity('forge', 'support_gem', [fact('creates', 'cold')], { name: 'Forge' }),
    entity('payoff', 'active_skill', [fact('requires', 'cold')], { name: 'Payoff' })
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
  const entities = Array.from({ length: 8 }, (_, index) => entity(`support-${index}`, 'support_gem', [fact('inflicts', 'cold')]));
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
  assert.ok(result.categories.connections.some((lead) => lead.name === 'fire-mace → fire-to-cold → Cold'));
});

test('semantic role is primary while entity type remains presentation metadata', () => {
  const result = selectBuildLeads(catalog([
    entity('conversion-gloves', 'unique', [fact('converts', null, { from: 'fire', to: 'cold' })])
  ]), snapshot);
  assert.equal(result.categories.enablers[0].role, 'enablers');
  assert.equal(result.categories.enablers[0].entityType, 'Unique');
  assert.equal(result.categories.enablers[0].contentType, 'unique');
});

const readProduction = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
let productionCatalog = readProduction('../data/enriched/recommendation_catalog_v3.json');
productionCatalog = mergeRecommendationSkillCraftingV3(productionCatalog,
  readProduction('../data/enriched/recommendation_skill_crafting_v3.json'));
productionCatalog = mergeRecommendationGrantedSkillAccessV3(productionCatalog,
  readProduction('../data/enriched/recommendation_granted_skill_access_v3.json'));
productionCatalog = mergeRecommendationUniqueSemanticsV3(productionCatalog,
  readProduction('../data/enriched/recommendation_unique_semantics_v3.json'));
const productionFate = (ascendancy, weapon, offense, passiveTreeStart, seed = 'production-regression') =>
  selectBuildLeads(productionCatalog, { ascendancy, weapon, weaponFamily: weapon, offenseSet: [offense], passiveTreeStart }, { selectionSeed: seed });
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
  assert.ok(archetype.categories.connections.length >= 1);
});
