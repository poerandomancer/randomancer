// Conservative selection for catalog entities which are not gems.  This consumes the
// same facts and compatibility records as the skill package selector; it deliberately
// does not attempt to infer a second build model from display text.
import { isRecommendationContentAllowedV3 } from './30-recommendation-v3-selector.js';

const GENERIC = new Set(['damage', 'hit', 'attack', 'attributes', 'attribute', 'strength', 'dexterity', 'intelligence', 'armour', 'evasion', 'energy_shield', 'life', 'mana', 'defence', 'defenses']);
const SEASONAL = new Set(['kalguuran', 'prototype', 'inaccessible', 'dnt', 'dnt_unused', 'coming_soon', 'derived_template']);
const WEAPONS = ['quarterstaff', 'crossbow', 'sceptre', 'talisman', 'staff', 'wand', 'spear', 'flail', 'dagger', 'claw', 'sword', 'mace', 'axe', 'bow', 'unarmed'];
const ONE_HANDED_WEAPONS = new Set(['sceptre', 'wand', 'spear', 'flail', 'dagger', 'claw', 'sword', 'mace', 'axe']);
const OFF_HAND_WEAPONS = new Set(['shield', 'buckler', 'focus']);
const GOOD_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates', 'converts', 'modifies', 'has_property']);
const IMPACT = new Map([['fulfills', 8], ['inflicts', 8], ['creates', 8], ['provides', 7], ['generates', 7], ['converts', 7], ['has_property', 5], ['modifies', 4]]);

const arr = (value) => Array.isArray(value) ? value : [];
const token = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const uniq = (values) => [...new Set(values.filter(Boolean))];

function entityMechanics(entity) {
  return uniq([
    ...arr(entity?.facts).flatMap((fact) => fact?.relation === 'converts' ? [token(fact.to), token(fact.from)] : [token(fact?.mechanic)]),
    ...arr(entity?.retrieval_terms).map(token)
  ]);
}

function contextMechanics(catalog, snapshot, recommendationPackage) {
  const offense = arr(snapshot?.offenseSet).concat(arr(snapshot?.offenseList), arr(snapshot?.ailmentSet), arr(snapshot?.tacticSet))
    .flatMap((entry) => [token(entry?.id || entry), ...arr(entry?.mechanics).map(token)]);
  const selected = arr(recommendationPackage?.pieces).concat(arr(recommendationPackage?.supportAssignments).flatMap((entry) => arr(entry?.supports)));
  const ids = new Set(selected.flatMap((entry) => [entry?.entityId, entry?.sourceId]).filter(Boolean));
  const entities = arr(catalog?.entities).filter((entity) => ids.has(entity.id) || ids.has(entity.source_id));
  return {
    offense: new Set(offense.filter((value) => value && !GENERIC.has(value))),
    package: new Set(entities.flatMap(entityMechanics).filter((value) => value && !GENERIC.has(value)))
  };
}

function isExcluded(entity) {
  if (!entity || entity.content_type === 'keystone') return true;
  if (!isRecommendationContentAllowedV3(entity)) return true;
  const text = [entity.name, entity?.source_evidence?.description, ...arr(entity?.provenance?.source_tags), ...arr(entity?.retrieval_terms)].map(token);
  if (text.some((value) => SEASONAL.has(value) || value.startsWith('dnt_') || value.startsWith('prototype'))) return true;
  const access = entity?.compatibility?.access || {};
  return access.inaccessible === true || access.available === false || entity?.provenance?.accessible === false;
}

function uniqueWeaponFamily(entity) {
  const equipment = entity?.compatibility?.equipment || {};
  const slot = token(equipment.slot);
  const baseTerms = [equipment.weapon_family, equipment.base, slot].map(token);
  const terms = [...baseTerms, ...arr(entity?.retrieval_terms).map(token)];
  const families = WEAPONS.filter((family) => terms.some((term) => term === family || term.includes(`${family}_`) || term.endsWith(`_${family}`)));
  const offHandFamilies = [...OFF_HAND_WEAPONS].filter((family) => baseTerms.some((term) => term === family || term.includes(`${family}_`) || term.endsWith(`_${family}`)));
  const weaponSlot = slot.includes('weapon') || slot === 'main_hand' || slot === 'off_hand'
    || WEAPONS.some((family) => baseTerms.some((term) => term === family || term.includes(`${family}_`) || term.endsWith(`_${family}`)));
  return { weaponSlot, families, offHandFamilies };
}

function contradicts(entity, essentials) {
  return arr(entity?.facts).some((fact) => {
    if (!['prevents', 'replaces', 'cannot', 'removes'].includes(token(fact?.relation))) return false;
    const mechanics = [token(fact?.mechanic), token(fact?.from)].filter(Boolean);
    return mechanics.some((mechanic) => essentials.has(mechanic) || mechanic === 'damage');
  });
}

function analyze(entity, snapshot, context) {
  if (isExcluded(entity)) return null;
  if (entity.content_type === 'ascendancy_passive') {
    const owner = token(entity?.compatibility?.access?.ascendancy || arr(entity?.facts).find((fact) => fact.relation === 'exclusive_to')?.evidence?.[0]?.value);
    if (!owner || owner !== token(snapshot?.ascendancyName || snapshot?.ascendancy)) return null;
  }
  const rolledWeapon = token(snapshot?.weaponFamily || snapshot?.weapon);
  const weapon = uniqueWeaponFamily(entity);
  if (entity.content_type === 'unique' && weapon.weaponSlot && (!rolledWeapon || !weapon.families.includes(rolledWeapon))) return null;
  if (entity.content_type === 'unique' && weapon.offHandFamilies.length && !ONE_HANDED_WEAPONS.has(rolledWeapon)) return null;
  const essentials = new Set([...context.offense, ...context.package]);
  if (contradicts(entity, essentials)) return null;

  const matches = [];
  if (entity.content_type === 'unique' && weapon.weaponSlot && weapon.families.includes(rolledWeapon)) {
    matches.push({ kind: 'weapon', mechanic: rolledWeapon, relation: 'requires', weight: 9 });
  }
  if (entity.content_type === 'unique' && weapon.offHandFamilies.length && ONE_HANDED_WEAPONS.has(rolledWeapon)) {
    matches.push({ kind: 'weapon', mechanic: weapon.offHandFamilies[0], relation: 'off_hand_for', weight: 9 });
  }
  for (const fact of arr(entity.facts)) {
    const mechanic = token(fact?.relation === 'converts' ? fact.to : fact?.mechanic);
    if (!mechanic || GENERIC.has(mechanic) || !GOOD_RELATIONS.has(fact?.relation)) continue;
    const kind = context.offense.has(mechanic) ? 'offense' : context.package.has(mechanic) ? 'skill_support' : '';
    if (kind) matches.push({ kind, mechanic, relation: fact.relation, weight: IMPACT.get(fact.relation) || 0 });
  }
  if (!matches.length) return null;
  const distinct = uniq(matches.map((match) => `${match.kind}:${match.mechanic}`));
  const score = matches.reduce((sum, match) => sum + match.weight, 0) + Math.max(0, distinct.length - 1) * 2;
  if (score < 5) return null;
  return { entity, score, matches, signature: distinct.join('|') };
}

function seededUnit(seed, salt) {
  let hash = 2166136261;
  for (const char of `${seed ?? ''}:${salt}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

function choose(pool, limit, seed, diversify) {
  const ranked = pool.sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  if (!ranked.length) return [];
  const best = ranked[0].score;
  const shortlist = ranked.filter((candidate) => candidate.score >= best - 4);
  const output = [];
  const signatures = new Set();
  while (output.length < limit) {
    const eligible = shortlist.filter((candidate) => !output.includes(candidate) && (!diversify || !signatures.has(candidate.signature)));
    if (!eligible.length) break;
    eligible.sort((a, b) => seededUnit(seed, `${output.length}:${a.entity.id}`) - seededUnit(seed, `${output.length}:${b.entity.id}`));
    const selected = eligible[0]; output.push(selected); signatures.add(selected.signature);
  }
  return output.map(({ entity, score, matches }) => ({
    id: entity.source_id || entity.id,
    name: entity.name,
    recommendationEvidence: { score, matches: matches.map(({ kind, mechanic, relation }) => ({ kind, mechanic, relation })) }
  }));
}

function selectNonSkillRecommendations(catalog, snapshot = {}, recommendationPackage = null, options = {}) {
  const context = contextMechanics(catalog, snapshot, recommendationPackage);
  const analyzed = arr(catalog?.entities).map((entity) => analyze(entity, snapshot, context)).filter(Boolean);
  const byType = (type) => analyzed.filter((candidate) => candidate.entity.content_type === type);
  const seed = options.selectionSeed ?? recommendationPackage?.selectionSeed ?? '';
  return {
    recommendedUniques: choose(byType('unique'), 2, `${seed}:unique`, true),
    passives: {
      ascendancyNodes: choose(byType('ascendancy_passive'), 1, `${seed}:ascendancy`, false),
      notables: choose(byType('passive'), 3, `${seed}:notable`, true)
    }
  };
}

export { selectNonSkillRecommendations, isExcluded as isNonSkillRecommendationExcluded };
