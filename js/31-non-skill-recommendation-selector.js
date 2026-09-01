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
const UNIQUE_TIER = new Map([['PAYOFF_CONTEXT', 1], ['AFFINITY_AMPLIFICATION', 2],
  ['STRONG_SPECIALIZATION', 3], ['BUILD_DEFINING_CAPABILITY', 4]]);
const GOOD_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates', 'converts', 'modifies', 'has_property']);
const IMPACT = new Map([['fulfills', 8], ['inflicts', 8], ['creates', 8], ['provides', 7], ['generates', 7], ['converts', 7], ['has_property', 5], ['modifies', 4]]);
const PASSIVE_OFFENSE_ROLES = new Set(['primary_damage', 'setup_control', 'payoff', 'enabler']);

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
  const profile = recommendationPackage?.packageProfile;
  const profileMechanics = profile ? uniq([
    ...arr(profile.finalOffense), profile.weapon,
    ...arr(profile.primarySkill?.properties), ...arr(profile.sourceMechanics),
    ...arr(profile.bridgeMechanics), ...arr(profile.setupMechanics)
  ].map(token).filter((value) => value && !GENERIC.has(value))) : null;
  return {
    offense: new Set(offense.filter((value) => value && !GENERIC.has(value))),
    // New packages expose their intentional plan. Entity-wide semantics remain
    // only as a compatibility boundary for old snapshots.
    package: new Set(profileMechanics || entities.flatMap(entityMechanics).filter((value) => value && !GENERIC.has(value))),
    recommendationPackage
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

function passiveWeaponCompatible(entity, snapshot) {
  const requirement = entity?.compatibility?.passive_weapon;
  if (!requirement) return true;
  if (requirement.fail_closed || arr(requirement.unresolved_requirements).length) return false;
  const rolled = rolledWeaponFamily(snapshot);
  return Boolean(rolled) && arr(requirement.compatible_weapon_family_ids).map(token).includes(rolled);
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
    if (fact?.scope === 'incoming') return false;
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
  if (entity.content_type === 'passive') {
    const requiredAscendancy = token(entity?.required_ascendancy || entity?.compatibility?.access?.ascendancy);
    const rolledAscendancy = token(snapshot?.ascendancyName || snapshot?.ascendancy);
    if (requiredAscendancy && requiredAscendancy !== rolledAscendancy) return null;
    const access = entity?.compatibility?.access || {};
    const rolledClassId = Number(snapshot?.passiveTreeCharacterId);
    const rolledClass = token(snapshot?.className);
    const overrideClassId = Number(access.passive_tree_character_id ?? entity?.class_override?.characterId);
    const overrideClass = token(access.class_name || entity?.class_override?.className);
    if ((Number.isFinite(overrideClassId) || overrideClass)
      && !((Number.isFinite(rolledClassId) && rolledClassId === overrideClassId)
        || (!Number.isFinite(rolledClassId) && rolledClass && rolledClass === overrideClass))) return null;
    const replacedIds = arr(access.overridden_for_passive_tree_character_ids || entity?.overridden_for_class_ids).map(Number);
    const replacedClasses = arr(access.overridden_for_classes || entity?.overridden_for_classes).map(token);
    if ((Number.isFinite(rolledClassId) && replacedIds.includes(rolledClassId))
      || (!Number.isFinite(rolledClassId) && rolledClass && replacedClasses.includes(rolledClass))) return null;
    const classStart = token(snapshot?.passiveTreeStart);
    const starts = arr(entity?.passive_tree_starts).map(token).filter(Boolean);
    if (!classStart || !starts.length) return null;
    if (!starts.includes(classStart)) return null;
    // This is a hard eligibility gate on the resolved entity. It runs before
    // semantic scoring, so ranking and every selection fallback see only legal candidates.
    if (!passiveWeaponCompatible(entity, snapshot)) return null;
  }
  const essentials = new Set([...context.offense, ...context.package]);
  if (contradicts(entity, essentials)) return null;

  const matches = [];
  const recommendationPackage = context.recommendationPackage;
  const sources = packageSourceMechanics(recommendationPackage);
  for (const fact of arr(entity.facts)) {
    if (entity.content_type === 'passive' && !PASSIVE_OFFENSE_ROLES.has(token(fact?.offense_role))) continue;
    if ((entity.content_type === 'passive' || entity.content_type === 'ascendancy_passive')
      && !factAppliesToPackage(fact, recommendationPackage, sources)) continue;
    const mechanic = token(fact?.relation === 'converts' ? fact.to : fact?.mechanic);
    if (!mechanic || GENERIC.has(mechanic) || !GOOD_RELATIONS.has(fact?.relation)) continue;
    const kind = context.offense.has(mechanic) ? 'offense' : context.package.has(mechanic) ? 'skill_support' : '';
    if (kind) matches.push({ kind, mechanic, relation: fact.relation,
      delivery: fact.delivery || null, target: fact.target || null, scope: fact.scope || null,
      sourceMechanic: fact.from || fact.sourceMechanic || null,
      weight: entity.content_type === 'passive' ? Math.max(5, IMPACT.get(fact.relation) || 0) : (IMPACT.get(fact.relation) || 0) });
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

function sourceMechanicMatches(required, sources) {
  const mechanic = token(required);
  if (!mechanic) return false;
  if (sources.has(mechanic)) return true;
  if (mechanic === 'elemental_damage') return ['fire', 'cold', 'lightning'].some((child) => sources.has(child));
  // Semantic subsumption is directional: a specific element proves its broad
  // parent, but the parent cannot manufacture evidence for a specific child.
  return false;
}

function packageSourceMechanics(recommendationPackage) {
  const profile = recommendationPackage?.packageProfile;
  return new Set(uniq([
    ...arr(profile?.sourceMechanics), ...arr(profile?.primarySourceMechanics),
    ...arr(recommendationPackage?.bridgePath).map((edge) => edge?.from),
    ...arr(recommendationPackage?.pieces).flatMap((piece) => arr(piece?.fulfilledObligations)
      .flatMap((proof) => [proof?.sourceMechanic, proof?.mechanic])),
    ...arr(recommendationPackage?.pieces).flatMap((piece) => arr(piece?.supports)
      .flatMap((support) => arr(support?.suppliedTargets).map((target) => target?.mechanic)))
  ].map(token)));
}

const DELIVERY_GROUPS = {
  attack: new Set(['attack', 'attack_hit', 'melee', 'ranged']),
  spell: new Set(['spell', 'spell_hit']), minion: new Set(['minion']),
  projectile: new Set(['projectile']), totem: new Set(['totem']),
  companion: new Set(['companion']), thorns: new Set(['thorns'])
};

function packageProperties(recommendationPackage) {
  const profile = recommendationPackage?.packageProfile || {};
  return new Set(uniq([
    ...arr(profile?.primarySkill?.properties), ...arr(profile?.sourceMechanics),
    ...arr(profile?.bridgeMechanics), ...arr(profile?.setupMechanics),
    ...arr(profile?.finalOffense)
  ].map(token)));
}

function factAppliesToPackage(fact, recommendationPackage, sources = packageSourceMechanics(recommendationPackage)) {
  const scope = token(fact?.scope ?? fact?.s);
  const target = token(fact?.target ?? fact?.a);
  if (scope === 'incoming') return false;
  const state = (value) => ({ ignited: 'ignite', shocked: 'shock', chilled: 'chill', frozen: 'freeze',
    poisoned: 'poison', bleeding: 'bleed' })[token(value)] || token(value);
  const condition = state(fact?.condition ?? fact?.h);
  const conditionTarget = token(fact?.condition_target ?? fact?.x) || (condition ? 'self' : '');
  if (conditionTarget === 'self'
    && !new Set(arr(recommendationPackage?.packageProfile?.selfStates).map(state)).has(condition)) return false;
  if (['self', 'player'].includes(target) && conditionTarget !== 'self') return false;
  const delivery = token(fact?.delivery ?? fact?.d);
  if (delivery && !['skill', 'generic', 'generic_hit', 'hit'].includes(delivery)) {
    const properties = packageProperties(recommendationPackage);
    const group = Object.entries(DELIVERY_GROUPS).find(([, values]) => values.has(delivery))?.[0] || delivery;
    if (!properties.has(group) && !properties.has(delivery)) return false;
  }
  const source = token(fact?.from ?? fact?.f ?? fact?.sourceMechanic);
  if (source && !sourceMechanicMatches(source, sources)) return false;
  return true;
}

function analyzeUnique(entity, offense, recommendationPackage = null) {
  if (entity?.content_type !== 'unique' || isExcluded(entity)) return null;
  const sourceMechanics = packageSourceMechanics(recommendationPackage);
  const offenseId = [...offense][0];
  const compact = entity?.unique_offense_semantics?.[offenseId];
  if (compact?.tier === 'CONTRADICTION_PREVENTION') return null;
  const compactFacts = arr(compact?.facts);
  const matches = compactFacts.filter((fact) => factAppliesToPackage(fact, recommendationPackage, sourceMechanics)
    && (token(fact.r) !== 'converts' || token(fact.s) === 'outgoing'))
    .map((fact) => ({ kind: 'offense', mechanic: fact.m || fact.t || offenseId,
      relation: fact.r, category: fact.c, sourceKind: fact.k, sourceEntity: fact.e || null,
      delivery: fact.d || null, target: fact.a || null, scope: fact.s || null, sourceMechanic: fact.f || null,
      condition: fact.h || null, conditionTarget: fact.x || null }));
  // Catalog fixtures and older saved data can still use already-typed parent
  // facts. Production data always supplies generation-time compact semantics.
  if (!compact && contradicts(entity, offense)) return null;
  if (!compact) for (const fact of arr(entity.facts)) {
    const relation = token(fact?.relation); const mechanic = token(relation === 'converts' ? fact?.to : fact?.mechanic);
    if (!mechanic || !offense.has(mechanic) || !GOOD_RELATIONS.has(relation) || !factAppliesToPackage(fact, recommendationPackage, sourceMechanics)
      || (relation === 'converts' && (!sourceMechanicMatches(fact?.from, sourceMechanics)
        || token(fact?.scope) !== 'outgoing'))) continue;
    matches.push({ kind: 'offense', mechanic, relation, category:
      ['inflicts', 'creates', 'fulfills', 'converts'].includes(relation) ? 'BUILD_DEFINING_CAPABILITY'
        : ['provides', 'generates'].includes(relation) ? 'STRONG_SPECIALIZATION'
          : ['consumes', 'requires'].includes(relation) ? 'PAYOFF_CONTEXT' : 'AFFINITY_AMPLIFICATION' });
  }
  const tier = matches.sort((a, b) => (UNIQUE_TIER.get(b.category) || 0) - (UNIQUE_TIER.get(a.category) || 0))[0]?.category;
  if (!matches.length || !UNIQUE_TIER.has(tier)) return null;
  return {
    entity,
    equipment: uniqueEquipmentFamily(entity),
    tier,
    tierRank: UNIQUE_TIER.get(tier),
    score: compact?.strength ?? (UNIQUE_TIER.get(tier) * 100 + matches.filter((match) => match.category === tier).length * 5),
    matches
  };
}

function selectUniqueRecommendation(catalog, snapshot, recommendationPackage, seed = '') {
  const rolledWeapon = rolledWeaponFamily(snapshot);
  const eligibleFamilies = WEAPON_FAMILIES.get(rolledWeapon);
  const offense = rolledOffenseMechanics(snapshot);
  if (!eligibleFamilies || !offense.size) return [];
  const candidates = arr(catalog?.entities).map((entity) => analyzeUnique(entity, offense, recommendationPackage)).filter(Boolean);
  const primary = candidates.filter((candidate) => eligibleFamilies.has(candidate.equipment.family));
  const fallback = ONE_HANDED_WEAPONS.has(rolledWeapon)
    ? candidates.filter((candidate) => OFF_HAND_WEAPONS.has(candidate.equipment.offHandFamily))
    : [];
  const ranked = (primary.length ? primary : fallback).sort((a, b) => b.tierRank - a.tierRank || b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  if (!ranked.length) return [];
  const band = ranked.filter((candidate) => candidate.tier === ranked[0].tier && candidate.score >= ranked[0].score - 10).slice(0, 3);
  const selected = [...band].sort((a, b) => seededUnit(seed, a.entity.id) - seededUnit(seed, b.entity.id) || a.entity.id.localeCompare(b.entity.id))[0];
  return [selected].map(({ entity, score, tier, matches }) => ({
    id: entity.source_id || entity.id,
    name: entity.name,
    recommendationEvidence: { score, tier, qualityBandSize: band.length,
      matches: matches.map(({ kind, mechanic, relation, category, sourceKind, sourceEntity, delivery, target, scope, sourceMechanic, condition, conditionTarget }) =>
        ({ kind, mechanic, relation, category, sourceKind, ...(sourceEntity ? { sourceEntity } : {}),
          ...(delivery ? { delivery } : {}), ...(target ? { target } : {}), ...(scope ? { scope } : {}),
          ...(sourceMechanic ? { sourceMechanic } : {}), ...(condition ? { condition } : {}),
          ...(conditionTarget ? { conditionTarget } : {}) })) }
  }));
}

function jewelrySlot(entity) {
  const slot = token(entity?.compatibility?.equipment?.slot);
  if (slot === 'ring') return 'Ring';
  if (slot === 'amulet') return 'Amulet';
  return '';
}

function recommendationEntry(candidate, bandSize) {
  const { entity, score, tier, matches } = candidate;
  const itemType = jewelrySlot(entity);
  return {
    id: entity.source_id || entity.id,
    name: entity.name,
    ...(itemType ? { itemType } : {}),
    recommendationEvidence: { score, tier, qualityBandSize: bandSize,
      matches: matches.map(({ kind, mechanic, relation, category, sourceKind, sourceEntity, delivery, target, scope, sourceMechanic, condition, conditionTarget }) =>
        ({ kind, mechanic, relation, category, sourceKind, ...(sourceEntity ? { sourceEntity } : {}),
          ...(delivery ? { delivery } : {}), ...(target ? { target } : {}), ...(scope ? { scope } : {}),
          ...(sourceMechanic ? { sourceMechanic } : {}), ...(condition ? { condition } : {}),
          ...(conditionTarget ? { conditionTarget } : {}) })) }
  };
}

function selectJewelryRecommendations(catalog, snapshot, recommendationPackage = null, seed = '', excluded = new Set()) {
  // Preserve the public helper's historical (catalog, snapshot, seed) shape.
  if (typeof recommendationPackage === 'string') {
    seed = recommendationPackage;
    recommendationPackage = null;
  }
  const offense = rolledOffenseMechanics(snapshot);
  if (!offense.size) return [];
  const ranked = arr(catalog?.entities)
    .filter((entity) => jewelrySlot(entity))
    .map((entity) => analyzeUnique(entity, offense, recommendationPackage))
    .filter(Boolean)
    .sort((a, b) => b.tierRank - a.tierRank || b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  if (!ranked.length) return [];
  const band = ranked.filter((candidate) => candidate.tier === ranked[0].tier
    && candidate.score >= ranked[0].score - 10).slice(0, 3);
  const ordered = [...band].sort((a, b) => seededUnit(seed, a.entity.id) - seededUnit(seed, b.entity.id)
    || a.entity.id.localeCompare(b.entity.id));
  const selected = [];
  const identities = new Set();
  let amulets = 0;
  for (const candidate of ordered) {
    const identity = token(candidate.entity.source_id || candidate.entity.id || candidate.entity.name);
    const slot = jewelrySlot(candidate.entity);
    if (!identity || excluded.has(identity) || identities.has(identity) || (slot === 'Amulet' && amulets >= 1)) continue;
    selected.push(candidate); identities.add(identity);
    if (slot === 'Amulet') amulets += 1;
    if (selected.length === 2) break;
  }
  return selected.map((candidate) => recommendationEntry(candidate, band.length));
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
    recommendationEvidence: { score, matches: matches.map(({ kind, mechanic, relation, delivery, target, scope, sourceMechanic }) =>
      ({ kind, mechanic, relation, ...(delivery ? { delivery } : {}), ...(target ? { target } : {}),
        ...(scope ? { scope } : {}), ...(sourceMechanic ? { sourceMechanic } : {}) })) }
  }));
}

function selectNonSkillRecommendations(catalog, snapshot = {}, recommendationPackage = null, options = {}) {
  const context = contextMechanics(catalog, snapshot, recommendationPackage);
  const analyzed = arr(catalog?.entities).map((entity) => analyze(entity, snapshot, context)).filter(Boolean);
  const byType = (type) => analyzed.filter((candidate) => candidate.entity.content_type === type);
  const seed = options.selectionSeed ?? recommendationPackage?.selectionSeed ?? '';
  const requiredUnique = recommendationPackage?.coreUnique ? [{
    id: recommendationPackage.coreUnique.id, entityId: recommendationPackage.coreUnique.entityId, name: recommendationPackage.coreUnique.name,
    required: true, coreSolver: true, packageRole: 'unique_bridge',
    recommendationEvidence: { tier: 'BUILD_DEFINING_CAPABILITY', matches: recommendationPackage.bridgePath || [] }
  }] : [];
  const optionalUnique = selectUniqueRecommendation(catalog, snapshot, recommendationPackage, `${seed}:unique`)
    .filter((entry) => !requiredUnique.some((required) =>
      token(required.entityId || required.id) === token(entry.entityId || entry.id)));
  const recommendedUniques = [...requiredUnique, ...optionalUnique].slice(0, 1);
  const canonicalIdentity = (entry) => {
    const resolved = arr(catalog?.entities).find((entity) => [entity.id, entity.source_id]
      .map(token).includes(token(entry?.entityId || entry?.id)));
    return token(resolved?.source_id || resolved?.id || entry?.entityId || entry?.id);
  };
  const usedUniqueIds = new Set(recommendedUniques.map(canonicalIdentity).filter(Boolean));
  return {
    recommendedUniques,
    recommendedJewelryUniques: selectJewelryRecommendations(
      catalog, snapshot, recommendationPackage, `${seed}:jewelry`, usedUniqueIds
    ),
    passives: {
      ascendancyNodes: choose(byType('ascendancy_passive'), 1, `${seed}:ascendancy`, false),
      notables: choose(byType('passive'), 3, `${seed}:notable`, true)
    }
  };
}

function mergeRecommendationUniqueSemanticsV3(catalog, payload) {
  if (!catalog || payload?.schemaVersion !== 'recommendation-unique-semantics-v3.0.0' || !payload.byUniqueId) return catalog;
  return { ...catalog, entities: arr(catalog.entities).map((entity) => entity.content_type === 'unique'
    ? { ...entity, unique_offense_semantics: payload.byUniqueId[entity.source_id] || {} } : entity) };
}

export { selectNonSkillRecommendations, mergeRecommendationUniqueSemanticsV3,
  selectJewelryRecommendations, isExcluded as isNonSkillRecommendationExcluded };
