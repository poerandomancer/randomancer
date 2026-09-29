import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_LEAD_COPY, MINIMUM_SCORE, selectBuildLeads } from '../js/32-build-leads-selector.js';

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
  assert.ok(result.categories.directFits[0].score > (result.categories.supportIdeas?.[0]?.score || 0));
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
  assert.match(result.categories.payoffs[0].explanation, /after Cold is established/);
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
  assert.equal(result.categories.uniqueTools[0].id, 'granted-cold-mace');
  assert.equal(result.categories.enablers.find((lead) => lead.id === 'cold-keystone')?.contentType, 'keystone');
});

test('empty categories are omitted and category counts are threshold-driven rather than quotas', () => {
  const one = selectBuildLeads(catalog([entity('only', 'support_gem', [fact('inflicts', 'cold')])]), snapshot);
  assert.deepEqual(Object.keys(one.categories), ['enablers']);
  assert.equal(one.categories.enablers.length, 1);
  assert.equal(BUILD_LEAD_COPY.categories.enablers, 'Ways to Enable');
  assert.ok(MINIMUM_SCORE > 0);
});

test('small typed producer-to-payoff chains surface without a package', () => {
  const result = selectBuildLeads(catalog([
    entity('forge', 'support_gem', [fact('creates', 'cold')], { name: 'Forge' }),
    entity('payoff', 'active_skill', [fact('requires', 'cold')], { name: 'Payoff' })
  ]), snapshot);
  assert.equal(result.categories.connections[0].name, 'Forge → Payoff');
  assert.match(result.categories.connections[0].explanation, /creates or provides Cold/);
  assert.equal(result.package, undefined);
});

test('ascendancy access and current-content exclusions remain hard gates', () => {
  const result = selectBuildLeads(catalog([
    entity('owned', 'ascendancy_passive', [fact('provides', 'cold')], { required_ascendancy: 'Chronomancer' }),
    entity('other', 'ascendancy_passive', [fact('provides', 'cold')], { required_ascendancy: 'Invoker' }),
    entity('seasonal', 'unique', [fact('provides', 'cold')], { provenance: { source_tags: ['kalguuran'] } }),
    entity('prototype', 'support_gem', [fact('provides', 'cold')], { retrieval_terms: ['prototype'] }),
    entity('inaccessible', 'unique', [fact('provides', 'cold')], { compatibility: { access: { available: false }, equipment: { is_unrestricted: true } } })
  ]), snapshot);
  assert.deepEqual(result.categories.ascendancyHooks.map((lead) => lead.id), ['owned']);
  assert.equal(result.categories.uniqueTools, undefined);
});

test('selection is deterministic and randomness stays inside a qualified quality band', () => {
  const entities = Array.from({ length: 8 }, (_, index) => entity(`support-${index}`, 'support_gem', [fact('inflicts', 'cold')]));
  const first = selectBuildLeads(catalog(entities), snapshot, { selectionSeed: 'fate' });
  const second = selectBuildLeads(catalog(entities), snapshot, { selectionSeed: 'fate' });
  assert.deepEqual(first, second);
  assert.equal(first.categories.enablers.length, 5);
  assert.ok(first.categories.enablers.every((lead) => lead.score >= MINIMUM_SCORE));
});
