import {
  isEquipmentCompatibleV3,
  isRecommendationContentAllowedV3
} from './30-recommendation-v3-selector.js';

const BUILD_LEADS_SCHEMA = 'build-leads-v1.1.0';

const BUILD_LEAD_COPY = Object.freeze({
  heading: 'Build Leads',
  subheading: 'Tools and mechanics worth exploring for this Fate.',
  categories: Object.freeze({
    directFits: 'Direct Fits',
    enablers: 'Ways to Enable',
    payoffs: 'Payoffs',
    usefulTools: 'Useful Tools',
    connections: 'Mechanical Connections'
  })
});

const ENTITY_TYPE_LABELS = Object.freeze({
  active_skill: 'Skill', support_gem: 'Support', unique: 'Unique', passive: 'Passive',
  keystone: 'Keystone', ascendancy_passive: 'Ascendancy Passive'
});
const BLOCKED_SOURCE_TOKENS = new Set(['kalguuran', 'prototype', 'inaccessible', 'dnt', 'dnt_unused', 'coming_soon', 'derived_template']);
const STRONG_CONFIDENCE = new Set(['exact', 'strong']);
const GRAPH_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates', 'converts',
  'requires', 'consumes', 'modifies', 'has_property', 'grants', 'enables', 'replaces']);
const PRODUCER_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates', 'grants', 'enables']);
const PAYOFF_RELATIONS = new Set(['requires', 'consumes']);
const AMPLIFIER_RELATIONS = new Set(['modifies', 'has_property']);
const WEAPON_FAMILIES = ['quarterstaff', 'crossbow', 'sceptre', 'talisman', 'staff', 'wand', 'spear',
  'flail', 'dagger', 'claw', 'sword', 'mace', 'axe', 'bow'];
const ROLE_MINIMUMS = Object.freeze({ directFits: 78, enablers: 62, payoffs: 50, usefulTools: 42, connections: 68 });
const TYPE_CAPS = Object.freeze({ directFits: 6, enablers: 6, payoffs: 5, usefulTools: 7, connections: 5 });
const OFFENSE_NEIGHBORS = Object.freeze({
  cold: ['chill', 'freeze'], fire: ['ignite'], lightning: ['shock', 'electrocute'],
  physical: ['bleed', 'armour_break', 'heavy_stun'], chaos: ['poison'],
  chill: ['cold', 'freeze'], freeze: ['cold', 'chill'], ignite: ['fire'], shock: ['lightning', 'electrocute'],
  electrocute: ['lightning', 'shock'], poison: ['chaos'], bleed: ['physical'],
  armour_break: ['physical'], heavy_stun: ['physical'], minions: ['minion'], companions: ['companion'], totems: ['totem']
});

const arr = (value) => Array.isArray(value) ? value : [];
const token = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const title = (value) => token(value).split('_').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
const unique = (values) => [...new Set(values.filter(Boolean))];

function offenseMechanics(snapshot) {
  const values = arr(snapshot?.offenseSet).length ? arr(snapshot.offenseSet) : arr(snapshot?.offenseList);
  return new Set(values.flatMap((entry) => [entry?.id || entry?.name || entry, ...arr(entry?.mechanics)]).map(token).filter(Boolean));
}

function rolledWeapon(snapshot) {
  return token(snapshot?.weaponFamily || snapshot?.weapon).replace(/^(one|two)_handed_/, '');
}

function factMechanics(fact) {
  return fact?.relation === 'converts' || fact?.relation === 'replaces'
    ? [token(fact.from), token(fact.to)].filter(Boolean)
    : [token(fact?.mechanic)].filter(Boolean);
}

function factIsStrong(fact) {
  return STRONG_CONFIDENCE.has(token(fact?.confidence)) && GRAPH_RELATIONS.has(token(fact?.relation));
}

function sourceBlocked(entity) {
  if (!isRecommendationContentAllowedV3(entity)) return true;
  const access = entity?.compatibility?.access || {};
  if (access.inaccessible === true || access.available === false || entity?.provenance?.accessible === false) return true;
  return [entity?.name, ...arr(entity?.provenance?.source_tags), ...arr(entity?.retrieval_terms)]
    .map(token).some((part) => BLOCKED_SOURCE_TOKENS.has(part) || part.startsWith('dnt_') || part.startsWith('prototype'));
}

function belongsToAscendancy(entity, snapshot) {
  if (entity?.content_type !== 'ascendancy_passive') return true;
  const owner = token(entity?.required_ascendancy || entity?.compatibility?.access?.ascendancy
    || arr(entity?.facts).find((fact) => fact?.relation === 'exclusive_to')?.mechanic);
  return owner && owner === token(snapshot?.ascendancyName || snapshot?.ascendancy);
}

function passiveAccessible(entity, snapshot) {
  if (!['passive', 'keystone'].includes(entity?.content_type)) return true;
  const starts = arr(entity?.passive_tree_starts).map(token).filter(Boolean);
  if (starts.length && (!snapshot?.passiveTreeStart || !starts.includes(token(snapshot.passiveTreeStart)))) return false;
  const weaponRule = entity?.compatibility?.passive_weapon;
  if (!weaponRule) return true;
  return !weaponRule.fail_closed && !arr(weaponRule.unresolved_requirements).length
    && arr(weaponRule.compatible_weapon_family_ids).map(token).includes(rolledWeapon(snapshot));
}

function uniqueWeaponFamily(entity) {
  if (entity?.content_type !== 'unique') return '';
  const equipment = entity?.compatibility?.equipment || {};
  const values = [equipment.slot, equipment.base, equipment.weapon_family].map(token);
  // Check longer names first so Quarterstaff is never mistaken for Staff.
  return WEAPON_FAMILIES.find((family) => values.some((value) => value === family
    || value.startsWith(`${family}_`) || value.endsWith(`_${family}`) || value.includes(`_${family}_`))) || '';
}

function grantedSourceAvailable(entity, snapshot) {
  const access = entity?.compatibility?.access || {};
  if (!access.requires_granted_source) return true;
  const sources = arr(access.granted_sources);
  if (!sources.length) return false;
  const ascendancy = token(snapshot?.ascendancyName || snapshot?.ascendancy);
  const weapon = rolledWeapon(snapshot);
  return sources.some((source) => {
    if (source.kind === 'ascendancy_passive') return token(source.ascendancy) === ascendancy;
    if (source.kind !== 'unique') return false;
    const values = [source.slot, source.base].map(token);
    const sourceFamily = WEAPON_FAMILIES.find((family) => values.some((value) => value === family
      || value.startsWith(`${family}_`) || value.endsWith(`_${family}`) || value.includes(`_${family}_`)));
    return !sourceFamily || sourceFamily === weapon;
  });
}

function contradictsFate(entity, relevantMechanics) {
  return arr(entity?.facts).some((fact) => {
    if (token(fact?.scope) === 'incoming') return false;
    const relation = token(fact?.relation);
    if (relation === 'converts') return relevantMechanics.has(token(fact.from)) && !relevantMechanics.has(token(fact.to));
    return ['prevents', 'cannot', 'removes'].includes(relation)
      && factMechanics(fact).some((mechanic) => relevantMechanics.has(mechanic) || mechanic === 'damage');
  });
}

function explicitWeaponEvidence(entity, snapshot) {
  const weapon = rolledWeapon(snapshot);
  if (!weapon) return false;
  const equipment = entity?.structured_weapon_requirements || entity?.compatibility?.equipment || {};
  const values = [equipment.weapon_family, equipment.slot, equipment.base, equipment.requirement_id,
    ...arr(equipment.mainhand_tags_any_of), ...arr(equipment.allowed_weapon_tags_any_of),
    ...arr(entity?.crafting?.weapon_affinities), ...arr(entity?.source_evidence?.active_skill_types)].map(token);
  return values.some((value) => value === weapon || value.startsWith(`${weapon}_`)
    || value.endsWith(`_${weapon}`) || value.includes(`_${weapon}_`));
}

function isLegalEntity(entity, snapshot, relevantMechanics) {
  if (!entity || sourceBlocked(entity) || !belongsToAscendancy(entity, snapshot)
    || !passiveAccessible(entity, snapshot) || contradictsFate(entity, relevantMechanics)) return false;
  if (['active_skill', 'support_gem', 'unique'].includes(entity.content_type)
    && !isEquipmentCompatibleV3(entity, snapshot)) return false;
  const itemFamily = uniqueWeaponFamily(entity);
  if (itemFamily && itemFamily !== rolledWeapon(snapshot)) return false;
  return grantedSourceAvailable(entity, snapshot);
}

// Establish a deliberately small neighborhood: native offense affinities are one
// hop, and conversion sources into the offense/affinity are controlled two-hop
// bridge nodes. No retrieval tags are allowed to create graph edges.
function buildSemanticNeighborhood(legalEntities, offense) {
  const distance = new Map([...offense].map((mechanic) => [mechanic, 0]));
  for (const mechanic of offense) for (const neighbor of arr(OFFENSE_NEIGHBORS[mechanic])) {
    if (!distance.has(neighbor)) distance.set(neighbor, 1);
  }
  const bridgeProviders = new Map();
  for (const entity of legalEntities) for (const fact of arr(entity.facts)) {
    if (!factIsStrong(fact) || !['converts', 'replaces'].includes(token(fact.relation)) || token(fact.scope) === 'incoming') continue;
    const from = token(fact.from); const to = token(fact.to);
    if (!from || !distance.has(to) || distance.get(to) > 1) continue;
    if (!distance.has(from)) distance.set(from, 2);
    if (!bridgeProviders.has(from)) bridgeProviders.set(from, []);
    bridgeProviders.get(from).push({ entity, fact, to });
  }
  return { distance, bridgeProviders };
}

function entityType(entity) {
  const granted = entity?.content_type === 'active_skill' && Boolean(entity?.compatibility?.access?.requires_granted_source);
  return granted ? 'Granted Skill' : (ENTITY_TYPE_LABELS[entity?.content_type] || title(entity?.content_type));
}

function pathForFact(fact, neighborhood) {
  const relation = token(fact?.relation);
  if (!factIsStrong(fact) || token(fact?.scope) === 'incoming') return null;
  if (relation === 'converts' || relation === 'replaces') {
    const from = token(fact.from); const to = token(fact.to);
    if (!neighborhood.distance.has(to) || neighborhood.distance.get(to) > 1) return null;
    return { mechanic: to, sourceMechanic: from, distance: neighborhood.distance.get(to), relation, direction: 'into' };
  }
  const mechanic = token(fact?.mechanic);
  if (!neighborhood.distance.has(mechanic)) return null;
  return { mechanic, distance: neighborhood.distance.get(mechanic), relation, direction: 'on' };
}

function explainPath(entity, path, role, weapon) {
  const mechanic = title(path.mechanic);
  if (path.relation === 'converts' || path.relation === 'replaces') {
    return `${path.relation === 'converts' ? 'Converts' : 'Changes'} ${title(path.sourceMechanic)} to ${mechanic}.`;
  }
  if (role === 'payoffs') return `${path.relation === 'consumes' ? 'Uses' : 'Rewards'} ${mechanic} after it is established.`;
  if (role === 'enablers') {
    if (path.relation === 'inflicts') return `Applies ${mechanic}.`;
    return `${title(path.relation)} ${mechanic} for compatible mechanics.`;
  }
  if (role === 'directFits') return `Directly connects ${weapon ? `${title(weapon)} and ` : ''}${mechanic}.`;
  return `${title(path.relation)} ${mechanic}${path.distance ? ' through a related mechanic' : ''}.`;
}

function roleCandidate(entity, path, weaponMatch) {
  const relation = path.relation;
  const direct = path.distance === 0;
  const classification = relation === 'has_property' ? 'identity' : relation;
  if (PAYOFF_RELATIONS.has(relation)) return { role: 'payoffs', base: direct ? 61 : 55, classification };
  if (relation === 'converts' || relation === 'replaces') return { role: 'enablers', base: direct ? 76 : 68, classification: 'transformation' };
  if (PRODUCER_RELATIONS.has(relation)) {
    if (weaponMatch && direct && ['active_skill', 'unique'].includes(entity.content_type)) {
      return { role: 'directFits', base: 73, classification: 'multi_axis_direct' };
    }
    return { role: 'enablers', base: direct ? 65 : 57, classification: 'application' };
  }
  if (AMPLIFIER_RELATIONS.has(relation)) {
    if (weaponMatch && direct && ['active_skill', 'unique'].includes(entity.content_type)) {
      return { role: 'directFits', base: 69, classification: 'multi_axis_identity' };
    }
    return { role: 'usefulTools', base: direct ? 50 : 48, classification: 'amplifier' };
  }
  return null;
}

function analyzeEntity(entity, snapshot, neighborhood) {
  const weaponMatch = explicitWeaponEvidence(entity, snapshot);
  const paths = arr(entity.facts).map((fact) => ({ fact, path: pathForFact(fact, neighborhood) }))
    .filter((entry) => entry.path).map(({ fact, path }) => ({ ...path, fact }));
  const candidates = paths.map((path) => {
    const roleInfo = roleCandidate(entity, path, weaponMatch);
    if (!roleInfo) return null;
    const multiAxis = weaponMatch ? 24 : 0;
    const ownedAscendancy = entity.content_type === 'ascendancy_passive' ? 12 : 0;
    const granted = arr(entity.facts).some((fact) => fact.relation === 'provides' && token(fact.mechanic) === 'granted_skill') ? 5 : 0;
    const distancePenalty = path.distance * 5;
    return { ...roleInfo, path, score: roleInfo.base + multiAxis + ownedAscendancy + granted - distancePenalty };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const primary = candidates.find((candidate) => candidate.score >= ROLE_MINIMUMS[candidate.role]);
  if (!primary) return null;
  return {
    id: entity.source_id || entity.id, entityId: entity.id, name: entity.name,
    entityType: entityType(entity), contentType: entity.content_type,
    role: primary.role, score: primary.score, axes: 1 + Number(weaponMatch),
    explanation: explainPath(entity, primary.path, primary.role, rolledWeapon(snapshot)),
    relevancePath: { distance: primary.path.distance, relation: primary.path.relation,
      mechanic: primary.path.mechanic, sourceMechanic: primary.path.sourceMechanic || null,
      classification: primary.classification },
    secondaryRelationships: candidates.slice(1).map((candidate) => ({ role: candidate.role, score: candidate.score,
      relation: candidate.path.relation, mechanic: candidate.path.mechanic, classification: candidate.classification }))
  };
}

function seededUnit(seed, salt) {
  let hash = 2166136261;
  for (const char of `${seed}:${salt}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

function selectCategory(items, category, seed) {
  const qualified = items.filter((item) => item.score >= ROLE_MINIMUMS[category]);
  // Absolute qualification comes first. Randomness only breaks exact-score ties;
  // a stronger lead can never suppress another independently qualified lead.
  const ranked = qualified.sort((a, b) => b.score - a.score
    || seededUnit(seed, a.id) - seededUnit(seed, b.id) || a.name.localeCompare(b.name));
  const selected = [];
  let twoHopTools = 0;
  const connectionEndpoints = new Map();
  for (const item of ranked) {
    // Two-hop source options are valuable discovery, but must not crowd direct
    // amplifiers out of Useful Tools merely because many skills share a source.
    if (category === 'usefulTools' && item.relevancePath?.distance === 2) {
      if (twoHopTools >= 2) continue;
      twoHopTools += 1;
    }
    if (category === 'connections' && arr(item.entities).some((name) => (connectionEndpoints.get(name) || 0) >= 2)) continue;
    selected.push(item);
    if (category === 'connections') for (const name of arr(item.entities)) {
      connectionEndpoints.set(name, (connectionEndpoints.get(name) || 0) + 1);
    }
    if (selected.length === TYPE_CAPS[category]) break;
  }
  return selected;
}

function buildConnections(legalEntities, neighborhood, analyzed, seed) {
  const byId = new Map(analyzed.map((lead) => [lead.entityId, lead]));
  const edges = [];
  const seen = new Set();
  const typed = legalEntities.map((entity) => ({ entity, facts: arr(entity.facts).filter(factIsStrong) }));

  // Producer -> consumer is discovered from the whole legal graph, not only the
  // entities that survived individual display thresholds.
  for (const left of typed) for (const leftFact of left.facts) {
    if (!PRODUCER_RELATIONS.has(token(leftFact.relation))) continue;
    const mechanic = token(leftFact.mechanic);
    if (!neighborhood.distance.has(mechanic) || neighborhood.distance.get(mechanic) > 1) continue;
    for (const right of typed) for (const rightFact of right.facts) {
      if (left.entity.id === right.entity.id || !PAYOFF_RELATIONS.has(token(rightFact.relation))
        || token(rightFact.mechanic) !== mechanic) continue;
      const key = `${left.entity.id}>${right.entity.id}:${mechanic}`;
      if (seen.has(key)) continue; seen.add(key);
      const score = 77 - neighborhood.distance.get(mechanic) * 5
        + Number(explicitWeaponEvidence(left.entity, { weapon: neighborhood.weapon })) * 8;
      edges.push({ id: key, name: `${left.entity.name} → ${right.entity.name}`, entities: [left.entity.name, right.entity.name],
        entityType: 'Connection', contentType: 'connection', role: 'connections', score,
        explanation: `${left.entity.name} ${title(leftFact.relation)} ${title(mechanic)}, which ${right.entity.name} can use as a payoff.`,
        relevancePath: { distance: neighborhood.distance.get(mechanic) + 1, relation: 'setup_payoff', mechanic } });
    }
  }

  // Converter -> weapon-native source option is the controlled conversion chain.
  for (const [source, providers] of neighborhood.bridgeProviders) {
    const sourceEntities = typed.filter(({ entity, facts }) => explicitWeaponEvidence(entity, { weapon: neighborhood.weapon })
      && facts.some((fact) => factMechanics(fact).includes(source)));
    for (const provider of providers) for (const sourceEntity of sourceEntities) {
      if (provider.entity.id === sourceEntity.entity.id) continue;
      const key = `${sourceEntity.entity.id}>${provider.entity.id}:${source}`;
      if (seen.has(key)) continue; seen.add(key);
      edges.push({ id: key, name: `${sourceEntity.entity.name} → ${provider.entity.name} → ${title(provider.to)}`,
        entities: [sourceEntity.entity.name, provider.entity.name], entityType: 'Connection', contentType: 'connection',
        role: 'connections', score: 80,
        explanation: `${provider.entity.name} converts ${title(source)} from ${sourceEntity.entity.name} toward ${title(provider.to)}.`,
        relevancePath: { distance: 2, relation: 'conversion_bridge', mechanic: provider.to, sourceMechanic: source } });
    }
  }
  // Prefer edges containing an individually useful endpoint, but do not require both.
  edges.forEach((edge) => { if (edge.entities.some((name) => [...byId.values()].some((lead) => lead.name === name))) edge.score += 4; });
  return selectCategory(edges, 'connections', seed);
}

function selectBuildLeads(catalog, snapshot = {}, options = {}) {
  const offense = offenseMechanics(snapshot);
  const seed = options.selectionSeed || '';
  const preliminaryMechanics = new Set([...offense, ...[...offense].flatMap((mechanic) => arr(OFFENSE_NEIGHBORS[mechanic]))]);
  const legalEntities = arr(catalog?.entities).filter((entity) => isLegalEntity(entity, snapshot, preliminaryMechanics));
  const neighborhood = buildSemanticNeighborhood(legalEntities, offense);
  neighborhood.weapon = rolledWeapon(snapshot);
  // Re-run contradiction checks now that controlled conversion sources are known.
  const graphEntities = legalEntities.filter((entity) => !contradictsFate(entity, new Set(neighborhood.distance.keys())));
  const analyzed = graphEntities.map((entity) => analyzeEntity(entity, snapshot, neighborhood)).filter(Boolean);
  const categories = {};
  for (const category of ['directFits', 'enablers', 'payoffs', 'usefulTools']) {
    const selected = selectCategory(analyzed.filter((lead) => lead.role === category), category, `${seed}:${category}`);
    if (selected.length) categories[category] = selected;
  }
  const connections = buildConnections(graphEntities, neighborhood, analyzed, `${seed}:connections`);
  if (connections.length) categories.connections = connections;
  return { schemaVersion: BUILD_LEADS_SCHEMA, selectionSeed: seed,
    fate: { ascendancy: snapshot.ascendancy || snapshot.ascendancyName || '', weapon: snapshot.weaponFamily || snapshot.weapon || '', offense: [...offense] },
    neighborhood: [...neighborhood.distance].map(([mechanic, distance]) => ({ mechanic, distance })), categories };
}

function adaptBuildLeadsToSnapshot(result) {
  const categories = result?.categories || {};
  const all = unique(['directFits', 'enablers', 'payoffs', 'usefulTools']
    .flatMap((category) => arr(categories[category]))
    .map((entry) => entry.entityId)).map((id) => ['directFits', 'enablers', 'payoffs', 'usefulTools']
      .flatMap((category) => arr(categories[category])).find((entry) => entry.entityId === id));
  return {
    buildLeads: result,
    recommendedSkills: all.filter((entry) => entry.contentType === 'active_skill')
      .map((entry) => ({ id: entry.id, name: entry.name, buildLead: entry })),
    recommendedUniques: all.filter((entry) => entry.contentType === 'unique'),
    synergySupports: all.filter((entry) => entry.contentType === 'support_gem'),
    passives: {
      ascendancyNodes: all.filter((entry) => entry.contentType === 'ascendancy_passive'),
      keystones: all.filter((entry) => entry.contentType === 'keystone'),
      notables: all.filter((entry) => entry.contentType === 'passive')
    }
  };
}

export { BUILD_LEADS_SCHEMA, BUILD_LEAD_COPY, ENTITY_TYPE_LABELS, ROLE_MINIMUMS,
  adaptBuildLeadsToSnapshot, selectBuildLeads };
