import {
  isEquipmentCompatibleV3,
  isRecommendationContentAllowedV3
} from './30-recommendation-v3-selector.js';

const BUILD_LEADS_SCHEMA = 'build-leads-v1.0.0';

// Presentation copy lives here rather than in the renderer so this prototype can
// be renamed after product review without changing selection behavior.
const BUILD_LEAD_COPY = Object.freeze({
  heading: 'Build Leads',
  subheading: 'Tools and mechanics worth exploring for this Fate.',
  categories: Object.freeze({
    directFits: 'Direct Fits',
    enablers: 'Ways to Enable',
    connections: 'Mechanical Connections',
    uniqueTools: 'Unique Tools',
    supportIdeas: 'Support Ideas',
    passiveLeads: 'Passive Leads',
    ascendancyHooks: 'Ascendancy Hooks',
    payoffs: 'Payoffs'
  })
});

const BLOCKED_SOURCE_TOKENS = new Set(['kalguuran', 'prototype', 'inaccessible', 'dnt', 'dnt_unused', 'coming_soon', 'derived_template']);
const STRONG_CONFIDENCE = new Set(['exact', 'strong']);
const ACTION_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates']);
const PAYOFF_RELATIONS = new Set(['requires', 'consumes']);
const TYPE_CAPS = Object.freeze({ directFits: 5, enablers: 5, connections: 4, uniqueTools: 6,
  supportIdeas: 5, passiveLeads: 5, ascendancyHooks: 4, payoffs: 5 });
const MINIMUM_SCORE = 42;

const arr = (value) => Array.isArray(value) ? value : [];
const token = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const title = (value) => token(value).split('_').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');

function offenseMechanics(snapshot) {
  const values = arr(snapshot?.offenseSet).length ? arr(snapshot.offenseSet) : arr(snapshot?.offenseList);
  return new Set(values.flatMap((entry) => [entry?.id || entry?.name || entry, ...arr(entry?.mechanics)]).map(token).filter(Boolean));
}

function rolledWeapon(snapshot) {
  return token(snapshot?.weaponFamily || snapshot?.weapon).replace(/^(one|two)_handed_/, '');
}

function factMechanics(fact) {
  return fact?.relation === 'converts'
    ? [token(fact.from), token(fact.to)].filter(Boolean)
    : [token(fact?.mechanic)].filter(Boolean);
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

function contradictsFate(entity, offense) {
  return arr(entity?.facts).some((fact) => {
    if (fact?.scope === 'incoming') return false;
    const relation = token(fact?.relation);
    if (relation === 'converts') return offense.has(token(fact.from)) && !offense.has(token(fact.to));
    return ['prevents', 'cannot', 'removes', 'replaces'].includes(relation)
      && factMechanics(fact).some((mechanic) => offense.has(mechanic) || mechanic === 'damage');
  });
}

function explicitWeaponEvidence(entity, snapshot) {
  const weapon = rolledWeapon(snapshot);
  if (!weapon) return false;
  const equipment = entity?.structured_weapon_requirements || entity?.compatibility?.equipment || {};
  const values = [equipment.weapon_family, equipment.base, equipment.requirement_id,
    ...arr(equipment.mainhand_tags_any_of), ...arr(equipment.allowed_weapon_tags_any_of),
    ...arr(entity?.crafting?.weapon_affinities), ...arr(entity?.source_evidence?.active_skill_types)]
    .map(token);
  return values.some((value) => value === weapon || value.includes(`${weapon}_`) || value.endsWith(`_${weapon}`));
}

function explain(fact, mechanic) {
  const pretty = title(mechanic);
  switch (token(fact?.relation)) {
    case 'converts': return `Converts ${title(fact.from)} to ${title(fact.to)}.`;
    case 'inflicts': return `Applies ${pretty}.`;
    case 'creates': return `Creates ${pretty}.`;
    case 'provides': return `Provides ${pretty}.`;
    case 'generates': return `Generates ${pretty}.`;
    case 'requires': return `Rewards or activates after ${pretty} is established.`;
    case 'consumes': return `Uses ${pretty} as a payoff resource.`;
    case 'modifies': return `Amplifies ${pretty}.`;
    default: return `Directly supports ${pretty}.`;
  }
}

function analyzeEntity(entity, snapshot, offense) {
  if (!entity || sourceBlocked(entity) || !belongsToAscendancy(entity, snapshot)
    || !passiveAccessible(entity, snapshot) || contradictsFate(entity, offense)) return null;
  if (['active_skill', 'support_gem', 'unique'].includes(entity.content_type)
    && !isEquipmentCompatibleV3(entity, snapshot)) return null;

  const relevant = arr(entity.facts).filter((fact) => STRONG_CONFIDENCE.has(token(fact?.confidence))
    && factMechanics(fact).some((mechanic) => offense.has(mechanic)));
  if (!relevant.length) return null;
  const weapon = explicitWeaponEvidence(entity, snapshot);
  const conversion = relevant.find((fact) => fact.relation === 'converts' && offense.has(token(fact.to)));
  const application = relevant.find((fact) => ACTION_RELATIONS.has(fact.relation));
  const payoff = relevant.find((fact) => PAYOFF_RELATIONS.has(fact.relation));
  const amplifier = relevant.find((fact) => fact.relation === 'modifies' || fact.relation === 'has_property');
  const axes = 1 + Number(weapon) + Number(entity.content_type === 'ascendancy_passive');
  let score = 18 + (axes - 1) * 30;
  if (conversion) score += 38;
  else if (application) score += 30;
  else if (payoff) score += 24;
  else if (amplifier) score += 12;
  if (entity.content_type === 'unique') score += 8;

  let role = 'supportIdeas';
  if (entity.content_type === 'ascendancy_passive') role = 'ascendancyHooks';
  else if (entity.content_type === 'unique') role = 'uniqueTools';
  else if (entity.content_type === 'active_skill' && weapon && application) role = 'directFits';
  else if (conversion || (application && entity.content_type !== 'active_skill')) role = 'enablers';
  else if (payoff) role = 'payoffs';
  else if (entity.content_type === 'passive' || entity.content_type === 'keystone') role = 'passiveLeads';
  else if (entity.content_type !== 'support_gem') return null;
  if (score < MINIMUM_SCORE) return null;
  const evidence = conversion || application || payoff || amplifier || relevant[0];
  return { id: entity.source_id || entity.id, entityId: entity.id, name: entity.name,
    contentType: entity.content_type, role, score, axes,
    explanation: explain(evidence, evidence.relation === 'converts' ? evidence.to : evidence.mechanic),
    evidence: relevant.map((fact) => ({ relation: fact.relation, mechanic: fact.mechanic || null,
      from: fact.from || null, to: fact.to || null })) };
}

function seededUnit(seed, salt) {
  let hash = 2166136261;
  for (const char of `${seed}:${salt}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

function selectCategory(items, category, seed) {
  const ranked = items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!ranked.length) return [];
  // Randomness is confined to near-equal, already-qualified leads.
  const top = ranked[0].score;
  return ranked.filter((item) => item.score >= Math.max(MINIMUM_SCORE, top - 8))
    .sort((a, b) => b.score - a.score || seededUnit(seed, a.id) - seededUnit(seed, b.id))
    .slice(0, TYPE_CAPS[category]);
}

function buildConnections(entities, leads, offense, seed) {
  const relevantIds = new Set(leads.map((lead) => lead.entityId));
  const providers = entities.filter((entity) => relevantIds.has(entity.id)).flatMap((entity) =>
    arr(entity.facts).filter((fact) => STRONG_CONFIDENCE.has(token(fact.confidence))
      && ['creates', 'provides', 'generates', 'inflicts'].includes(fact.relation))
      .map((fact) => ({ entity, mechanic: token(fact.mechanic), fact })));
  const consumers = entities.filter((entity) => relevantIds.has(entity.id)).flatMap((entity) =>
    arr(entity.facts).filter((fact) => STRONG_CONFIDENCE.has(token(fact.confidence)) && PAYOFF_RELATIONS.has(fact.relation))
      .map((fact) => ({ entity, mechanic: token(fact.mechanic), fact })));
  const seen = new Set();
  const connections = [];
  for (const left of providers) for (const right of consumers) {
    if (!left.mechanic || left.mechanic !== right.mechanic || left.entity.id === right.entity.id) continue;
    const key = `${left.entity.id}>${right.entity.id}:${left.mechanic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connections.push({ id: key, entities: [left.entity.name, right.entity.name],
      score: 72 + Number(offense.has(left.mechanic)) * 12,
      explanation: `${left.entity.name} creates or provides ${title(left.mechanic)}, which ${right.entity.name} can use as a payoff.` });
  }
  return selectCategory(connections.map((item) => ({ ...item, name: item.entities.join(' → ') })), 'connections', seed);
}

function selectBuildLeads(catalog, snapshot = {}, options = {}) {
  const offense = offenseMechanics(snapshot);
  const seed = options.selectionSeed || '';
  const entities = arr(catalog?.entities);
  const analyzed = entities.map((entity) => analyzeEntity(entity, snapshot, offense)).filter(Boolean);
  const categories = {};
  for (const category of Object.keys(BUILD_LEAD_COPY.categories).filter((key) => key !== 'connections')) {
    const selected = selectCategory(analyzed.filter((lead) => lead.role === category), category, `${seed}:${category}`);
    if (selected.length) categories[category] = selected;
  }
  const connections = buildConnections(entities, analyzed, offense, `${seed}:connections`);
  if (connections.length) categories.connections = connections;
  return { schemaVersion: BUILD_LEADS_SCHEMA, selectionSeed: seed,
    fate: { ascendancy: snapshot.ascendancy || snapshot.ascendancyName || '', weapon: snapshot.weaponFamily || snapshot.weapon || '', offense: [...offense] },
    categories };
}

function adaptBuildLeadsToSnapshot(result) {
  const categories = result?.categories || {};
  const supports = arr(categories.supportIdeas).concat(arr(categories.enablers).filter((entry) => entry.contentType === 'support_gem'));
  return {
    buildLeads: result,
    recommendedSkills: arr(categories.directFits).filter((entry) => entry.contentType === 'active_skill')
      .map((entry) => ({ id: entry.id, name: entry.name, buildLead: entry })),
    recommendedUniques: arr(categories.uniqueTools),
    synergySupports: supports,
    passives: {
      ascendancyNodes: arr(categories.ascendancyHooks),
      keystones: arr(categories.passiveLeads).filter((entry) => entry.contentType === 'keystone'),
      notables: arr(categories.passiveLeads).filter((entry) => entry.contentType === 'passive')
    }
  };
}

export { BUILD_LEADS_SCHEMA, BUILD_LEAD_COPY, MINIMUM_SCORE, adaptBuildLeadsToSnapshot, selectBuildLeads };
