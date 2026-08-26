// Conservative selection for catalog entities which are not gems.  This consumes the
// same facts and compatibility records as the skill package selector; it deliberately
// does not attempt to infer a second build model from display text.
import { isRecommendationContentAllowedV3 } from './30-recommendation-v3-selector.js';

const GENERIC = new Set(['damage', 'hit', 'attack', 'attributes', 'attribute', 'strength', 'dexterity', 'intelligence', 'armour', 'evasion', 'energy_shield', 'life', 'mana', 'defence', 'defenses']);
const SEASONAL = new Set(['kalguuran', 'prototype', 'inaccessible', 'dnt', 'dnt_unused', 'coming_soon', 'derived_template']);
const WEAPON_FAMILIES = new Map([
  ['bow', new Set(['bow', 'quiver'])],
  ['crossbow', new Set(['crossbow'])],
  ['spear', new Set(['spear'])],
  ['quarterstaff', new Set(['quarterstaff'])],
  ['staff', new Set(['staff'])],
  ['wand', new Set(['wand'])],
  ['sceptre', new Set(['sceptre'])],
  ['talisman', new Set(['talisman'])],
  ['mace', new Set(['mace'])]
]);
const ONE_HANDED_WEAPONS = new Set(['sceptre', 'wand', 'spear', 'mace']);
const OFF_HAND_WEAPONS = new Set(['shield', 'buckler', 'focus']);
const GOOD_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates', 'consumes', 'converts', 'modifies', 'has_property']);
const IMPACT = new Map([['fulfills', 8], ['inflicts', 8], ['creates', 8], ['provides', 7], ['generates', 7], ['consumes', 7], ['converts', 7], ['has_property', 5], ['modifies', 4]]);

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

function rolledWeaponFamily(snapshot) {
  const rolled = token(snapshot?.weaponFamily || snapshot?.weapon).replace(/^(one|two)_handed_/, '');
  return WEAPON_FAMILIES.has(rolled) ? rolled : '';
}

function uniqueEquipmentFamily(entity) {
  const equipment = entity?.compatibility?.equipment || {};
  const slot = token(equipment.slot);
  const terms = [equipment.weapon_family, equipment.base, slot].map(token).filter(Boolean);
  const known = new Set([...WEAPON_FAMILIES.values()].flatMap((families) => [...families]));
  const matches = (family) => terms.some((term) => term === family || term.startsWith(`${family}_`) || term.endsWith(`_${family}`) || term.includes(`_${family}_`));
  return {
    family: [...known].find(matches) || '',
    offHandFamily: [...OFF_HAND_WEAPONS].find(matches) || ''
  };
}

function contradicts(entity, essentials) {
  return arr(entity?.facts).some((fact) => {
    if (token(fact?.relation) === 'converts') {
      const from = token(fact?.from);
      const to = token(fact?.to);
      if (essentials.has(from) && !essentials.has(to)) return true;
    }
    if (!['prevents', 'replaces', 'cannot', 'removes'].includes(token(fact?.relation))) return false;
    const mechanics = [token(fact?.mechanic), token(fact?.from)].filter(Boolean);
    return mechanics.some((mechanic) => essentials.has(mechanic) || mechanic === 'damage');
  });
}

function analyze(entity, snapshot, context) {
  if (isExcluded(entity)) return null;
  // Uniques have a deliberately separate weapon + offense-only path below.
  if (entity.content_type === 'unique') return null;
  if (entity.content_type === 'ascendancy_passive') {
    const owner = token(entity?.compatibility?.access?.ascendancy || arr(entity?.facts).find((fact) => fact.relation === 'exclusive_to')?.evidence?.[0]?.value);
    if (!owner || owner !== token(snapshot?.ascendancyName || snapshot?.ascendancy)) return null;
  }
  const essentials = new Set([...context.offense, ...context.package]);
  if (contradicts(entity, essentials)) return null;

  const matches = [];
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

function rolledOffenseMechanics(snapshot) {
  const entries = arr(snapshot?.offenseSet).length ? arr(snapshot.offenseSet) : arr(snapshot?.offenseList);
  const offense = entries[0];
  return new Set([token(offense?.id || offense?.name || offense), ...arr(offense?.mechanics).map(token)].filter((value) => value && !GENERIC.has(value)));
}

function analyzeUnique(entity, offense) {
  if (entity?.content_type !== 'unique' || isExcluded(entity) || contradicts(entity, offense)) return null;
  const matches = [];
  for (const fact of arr(entity.facts)) {
    const relation = token(fact?.relation);
    // Conversion is directional: only conversion toward the rolled offense helps it.
    const mechanic = token(relation === 'converts' ? fact?.to : fact?.mechanic);
    if (!mechanic || GENERIC.has(mechanic) || !offense.has(mechanic) || !GOOD_RELATIONS.has(relation)) continue;
    matches.push({ kind: 'offense', mechanic, relation, weight: IMPACT.get(relation) || 0 });
  }
  if (!matches.length) return null;
  return {
    entity,
    equipment: uniqueEquipmentFamily(entity),
    score: matches.reduce((sum, match) => sum + match.weight, 0),
    matches
  };
}

function selectUniqueRecommendation(catalog, snapshot) {
  const rolledWeapon = rolledWeaponFamily(snapshot);
  const eligibleFamilies = WEAPON_FAMILIES.get(rolledWeapon);
  const offense = rolledOffenseMechanics(snapshot);
  if (!eligibleFamilies || !offense.size) return [];
  const candidates = arr(catalog?.entities).map((entity) => analyzeUnique(entity, offense)).filter(Boolean);
  const primary = candidates.filter((candidate) => eligibleFamilies.has(candidate.equipment.family));
  const fallback = ONE_HANDED_WEAPONS.has(rolledWeapon)
    ? candidates.filter((candidate) => OFF_HAND_WEAPONS.has(candidate.equipment.offHandFamily))
    : [];
  const ranked = (primary.length ? primary : fallback).sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  return ranked.slice(0, 1).map(({ entity, score, matches }) => ({
    id: entity.source_id || entity.id,
    name: entity.name,
    recommendationEvidence: { score, matches: matches.map(({ kind, mechanic, relation }) => ({ kind, mechanic, relation })) }
  }));
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
    recommendedUniques: selectUniqueRecommendation(catalog, snapshot),
    passives: {
      ascendancyNodes: choose(byType('ascendancy_passive'), 1, `${seed}:ascendancy`, false),
      notables: choose(byType('passive'), 3, `${seed}:notable`, true)
    }
  };
}

export { selectNonSkillRecommendations, isExcluded as isNonSkillRecommendationExcluded };
