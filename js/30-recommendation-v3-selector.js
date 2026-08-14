const RECOMMENDATION_CATALOG_V3_SCHEMA = 'recommendation-catalog-v3.0.0';
const RECOMMENDATION_PACKAGE_V3_SCHEMA = 'recommendation-package-v3.0.0';
const RECOMMENDATION_V3_QUERY_PARAM = 'recommendationV3';

const HARD_CONFIDENCE = new Set(['exact', 'strong']);
const DIRECT_USE_BLOCKED_TYPES = new Set([
  'hasreservation',
  'inbuilttrigger',
  'persistent',
  'triggered'
]);
const STATEFUL_SETUP_MECHANICS = new Set([
  'armour_break',
  'bleed',
  'charge',
  'corpse',
  'electrocute',
  'elemental_infusion',
  'endurance_charge',
  'freeze',
  'frenzy_charge',
  'ignite',
  'infusion',
  'minion',
  'poison',
  'power_charge',
  'runic_ward',
  'shock'
]);

const OFFENSE_MECHANICS = Object.freeze({
  physical: ['physical'],
  fire: ['fire'],
  cold: ['cold'],
  lightning: ['lightning'],
  chaos: ['chaos'],
  ignite: ['ignite'],
  bleed: ['bleed'],
  poison: ['poison'],
  chill: ['chill'],
  freeze: ['freeze'],
  shock: ['shock'],
  electrocute: ['electrocute'],
  critical_hits: ['critical_hits'],
  minions_companions: ['minion', 'companion'],
  totems: ['totem'],
  thorns: ['thorns']
});

const RELATION_WEIGHT = Object.freeze({
  fulfills: 9,
  inflicts: 8,
  creates: 8,
  provides: 7,
  converts: 7,
  has_property: 6,
  generates: 6,
  modifies: 4
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isRecommendationV3Enabled(environment = globalThis) {
  if (environment?.RandomancerRecommendationV3Enabled === true) return true;
  if (environment?.RandomancerRecommendationV3Enabled === false) return false;

  const search = String(environment?.location?.search || '');
  try {
    const params = new URLSearchParams(search);
    const value = normalizeToken(params.get(RECOMMENDATION_V3_QUERY_PARAM));
    return ['1', 'enabled', 'on', 'true'].includes(value);
  } catch {
    return new RegExp(`(?:^|[?&])${RECOMMENDATION_V3_QUERY_PARAM}=1(?:&|$)`).test(search);
  }
}

function validateRecommendationCatalogV3(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { ok: false, reason: 'catalog is not an object' };
  }
  const schema = catalog?._meta?.schema_version;
  if (schema !== RECOMMENDATION_CATALOG_V3_SCHEMA) {
    return { ok: false, reason: `unexpected catalog schema ${schema || '<missing>'}` };
  }
  if (!Array.isArray(catalog.entities)) {
    return { ok: false, reason: 'catalog entities are missing' };
  }
  return { ok: true, reason: '' };
}

function offenseLookup(offenseInventory) {
  const byKey = new Map();
  for (const entry of asArray(offenseInventory?.elements)) {
    const keys = [entry?.id, entry?.name, ...asArray(entry?.aliases)].map(normalizeToken);
    for (const key of keys) if (key && !byKey.has(key)) byKey.set(key, entry);
  }
  return byKey;
}

function rawOffenseValues(snapshot) {
  const canonical = [
    ...asArray(snapshot?.offenseSet),
    ...asArray(snapshot?.offenseList)
  ];
  if (canonical.length) return canonical;
  return [
    ...asArray(snapshot?.ailmentSet),
    ...asArray(snapshot?.tacticSet),
    ...asArray(snapshot?.ailmentList),
    ...asArray(snapshot?.tacticList)
  ];
}

function resolveOffenseEntries(snapshot, offenseInventory) {
  const lookup = offenseLookup(offenseInventory);
  const seen = new Set();
  const entries = [];

  for (const raw of rawOffenseValues(snapshot)) {
    const id = raw?.id || raw?.name || raw;
    const key = normalizeToken(id);
    if (!key) continue;
    const entry = lookup.get(key) || {
      id: key,
      name: raw?.name || String(id),
      category: raw?.category || 'Unknown'
    };
    const entryKey = normalizeToken(entry.id || entry.name);
    if (!entryKey || seen.has(entryKey)) continue;
    seen.add(entryKey);
    entries.push(entry);
  }
  return entries.slice(0, 2);
}

function allowedRelationsForOffense(category) {
  switch (normalizeToken(category)) {
    case 'damage_type':
      return ['fulfills', 'has_property', 'converts', 'provides'];
    case 'ailment':
      return ['fulfills', 'inflicts'];
    case 'scaling':
      return ['fulfills', 'modifies', 'provides', 'has_property'];
    case 'archetype':
      return ['fulfills', 'creates', 'has_property', 'provides'];
    default:
      return ['fulfills', 'inflicts', 'creates', 'provides', 'has_property'];
  }
}

function buildRecommendationObligationsV3(snapshot = {}, offenseInventory = {}) {
  const offense = resolveOffenseEntries(snapshot, offenseInventory);
  const obligations = offense.map((entry) => {
    const offenseId = normalizeToken(entry.id || entry.name);
    return {
      id: `offense:${offenseId}`,
      kind: 'offense',
      category: entry.category || 'Unknown',
      label: entry.name || entry.id,
      mechanics: OFFENSE_MECHANICS[offenseId] || [offenseId],
      allowedRelations: allowedRelationsForOffense(entry.category)
    };
  });

  obligations.push(
    {
      id: 'survivability:secondary_defense',
      kind: 'survivability',
      category: 'Defense',
      label: 'Complementary defensive layer',
      primaryDefense: snapshot?.defense || ''
    },
    {
      id: 'survivability:recovery',
      kind: 'survivability',
      category: 'Recovery',
      label: 'Credible recovery loop'
    }
  );

  return {
    context: {
      className: snapshot?.className || '',
      ascendancy: snapshot?.ascendancyName || snapshot?.ascendancy || '',
      weapon: snapshot?.weapon || '',
      offhand: snapshot?.offhand || '',
      primaryDefense: snapshot?.defense || ''
    },
    obligations
  };
}

function weaponTags(value) {
  const normalized = normalizeToken(value);
  const tags = new Set();
  if (!normalized) return tags;

  if (normalized.includes('quarterstaff')) tags.add('quarterstaff');
  else if (normalized.includes('staff')) tags.add('staff');
  if (normalized.includes('crossbow')) tags.add('crossbow');
  else if (normalized.includes('bow')) tags.add('bow');

  const rules = [
    ['sceptre', 'sceptre'],
    ['talisman', 'talisman'],
    ['buckler', 'buckler'],
    ['shield', 'shield'],
    ['focus', 'focus'],
    ['wand', 'wand'],
    ['spear', 'spear'],
    ['mace', 'mace'],
    ['sword', 'sword'],
    ['axe', 'axe'],
    ['dagger', 'dagger'],
    ['claw', 'claw'],
    ['flail', 'flail'],
    ['unarmed', 'unarmed']
  ];
  for (const [needle, tag] of rules) if (normalized.includes(needle)) tags.add(tag);
  if (normalized.includes('two_handed') || normalized.includes('two_hand')) tags.add('two_handed');
  if (normalized.includes('one_handed') || normalized.includes('one_hand')) tags.add('one_handed');
  return tags;
}

function intersects(values, tags) {
  return asArray(values).some((value) => tags.has(normalizeToken(value)));
}

function evaluateCompatibilityV3(entity, snapshot = {}) {
  const access = entity?.compatibility?.access || {};
  const requiredAscendancy = normalizeToken(access.ascendancy);
  const actualAscendancy = normalizeToken(snapshot.ascendancyName || snapshot.ascendancy);
  if (requiredAscendancy && requiredAscendancy !== actualAscendancy) {
    return { ok: false, reason: `requires ascendancy ${access.ascendancy}` };
  }

  const equipment = entity?.compatibility?.equipment || {};
  if (equipment.is_unrestricted === true) return { ok: true, reason: '' };

  const mainhand = weaponTags(snapshot.weapon);
  const offhand = weaponTags(snapshot.offhand);
  const mainRequirements = asArray(equipment.mainhand_tags_any_of);
  const offRequirements = asArray(equipment.offhand_tags_any_of);
  const allowed = asArray(equipment.allowed_weapon_tags_any_of);

  const requirementId = normalizeToken(equipment.requirement_id);
  if (requirementId.includes('two_hand') && !mainhand.has('two_handed')) {
    return { ok: false, reason: `requires ${equipment.display || equipment.requirement_id}` };
  }
  if (requirementId.includes('one_hand') && !mainhand.has('one_handed')) {
    return { ok: false, reason: `requires ${equipment.display || equipment.requirement_id}` };
  }

  if (mainRequirements.length || offRequirements.length) {
    const mainOk = mainRequirements.length && intersects(mainRequirements, mainhand);
    const offOk = offRequirements.length && intersects(offRequirements, offhand);
    if (!mainOk && !offOk) {
      return { ok: false, reason: `requires ${equipment.display || equipment.requirement_id || 'different equipment'}` };
    }
    return { ok: true, reason: '' };
  }

  if (allowed.length && !intersects(allowed, new Set([...mainhand, ...offhand]))) {
    return { ok: false, reason: `requires ${equipment.display || equipment.requirement_id || 'different equipment'}` };
  }
  return { ok: true, reason: '' };
}

function isEquipmentCompatibleV3(entity, snapshot = {}) {
  return evaluateCompatibilityV3(entity, snapshot).ok;
}

function isDirectlyUsableActive(entity) {
  if (!entity || entity.content_type !== 'active_skill') return false;
  if (!asArray(entity.candidate_roles).includes('primary_damage')) return false;
  if (/^\s*\[?DNT(?:-UNUSED)?\]?/i.test(String(entity.name || ''))) return false;

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  for (const blocked of DIRECT_USE_BLOCKED_TYPES) if (types.has(blocked)) return false;
  const hardPreventsDamage = asArray(entity.facts).some((fact) =>
    fact?.relation === 'prevents'
    && normalizeToken(fact?.mechanic) === 'damage'
    && HARD_CONFIDENCE.has(fact?.confidence)
  );
  return !hardPreventsDamage;
}

function factMechanics(fact) {
  if (fact?.relation === 'converts') return unique([normalizeToken(fact?.to)]);
  return unique([normalizeToken(fact?.mechanic)]);
}

function factMatchesObligation(fact, obligation) {
  if (!fact || obligation?.kind !== 'offense') return false;
  if (!HARD_CONFIDENCE.has(fact.confidence)) return false;
  if (!asArray(obligation.allowedRelations).includes(fact.relation)) return false;
  const allowedMechanics = new Set(asArray(obligation.mechanics).map(normalizeToken));
  return factMechanics(fact).some((mechanic) => allowedMechanics.has(mechanic));
}

function factPreventsObligation(fact, obligation) {
  if (fact?.relation !== 'prevents' || !HARD_CONFIDENCE.has(fact?.confidence)) return false;
  const allowedMechanics = new Set(asArray(obligation?.mechanics).map(normalizeToken));
  return factMechanics(fact).some((mechanic) => allowedMechanics.has(mechanic));
}

function proofScore(fact) {
  return (RELATION_WEIGHT[fact?.relation] || 0) + (fact?.confidence === 'exact' ? 2 : 1);
}

function candidateDependencies(entity) {
  const ownProvision = new Set();
  for (const fact of asArray(entity?.facts)) {
    if (!HARD_CONFIDENCE.has(fact?.confidence)) continue;
    if (['fulfills', 'generates', 'provides', 'creates'].includes(fact?.relation)) {
      for (const mechanic of factMechanics(fact)) ownProvision.add(mechanic);
    }
  }

  const dependencies = [];
  for (const fact of asArray(entity?.facts)) {
    if (!HARD_CONFIDENCE.has(fact?.confidence)) continue;
    const mechanic = normalizeToken(fact?.mechanic);
    if (fact?.relation !== 'requires' || !mechanic || ownProvision.has(mechanic)) continue;
    dependencies.push(mechanic);
  }
  return unique(dependencies);
}

function candidateSetupCosts(entity) {
  return unique(asArray(entity?.facts)
    .filter((fact) => fact?.relation === 'consumes' && HARD_CONFIDENCE.has(fact?.confidence))
    .map((fact) => normalizeToken(fact?.mechanic))
    .filter((mechanic) => STATEFUL_SETUP_MECHANICS.has(mechanic)));
}

function evaluatePrimaryCandidate(entity, offenseObligations, snapshot) {
  if (!isDirectlyUsableActive(entity)) return null;
  const compatibility = evaluateCompatibilityV3(entity, snapshot);
  if (!compatibility.ok) return null;

  const facts = asArray(entity.facts);
  if (offenseObligations.some((obligation) => facts.some((fact) => factPreventsObligation(fact, obligation)))) {
    return null;
  }

  const fulfilled = [];
  let evidenceScore = 0;
  let exactProofs = 0;

  for (const obligation of offenseObligations) {
    const proofs = facts.filter((fact) => factMatchesObligation(fact, obligation));
    if (!proofs.length) continue;
    proofs.sort((a, b) => proofScore(b) - proofScore(a));
    const proof = proofs[0];
    evidenceScore += proofScore(proof);
    if (proof.confidence === 'exact') exactProofs += 1;
    fulfilled.push({
      obligationId: obligation.id,
      relation: proof.relation,
      confidence: proof.confidence,
      mechanic: factMechanics(proof)[0] || ''
    });
  }

  if (!fulfilled.length) return null;
  const dependencies = candidateDependencies(entity);
  const setupCosts = candidateSetupCosts(entity);
  const roles = new Set(asArray(entity.candidate_roles));
  const packageCostPenalty = dependencies.length * 30
    + setupCosts.length * 5
    + (roles.has('payoff') ? 12 : 0)
    + (roles.has('setup_control') ? 5 : 0);
  return {
    entity,
    fulfilled,
    dependencies,
    setupCosts,
    score: fulfilled.length * 100 + exactProofs * 10 + evidenceScore - packageCostPenalty,
    exactProofs
  };
}

function unresolvedEntry(obligation, reason) {
  return {
    obligationId: obligation.id,
    label: obligation.label,
    reason
  };
}

function selectRecommendationPackageV3(catalog, snapshot = {}, options = {}) {
  const validation = validateRecommendationCatalogV3(catalog);
  if (!validation.ok) {
    return {
      schemaVersion: RECOMMENDATION_PACKAGE_V3_SCHEMA,
      status: 'unavailable',
      primarySkill: null,
      pieces: [],
      obligations: [],
      unresolved: [{ obligationId: 'catalog', label: 'Recommendation catalog', reason: validation.reason }],
      diagnostics: { totalPrimaryCandidates: 0, rankedCandidates: 0 }
    };
  }

  const model = buildRecommendationObligationsV3(snapshot, options.offenseInventory || {});
  const offenseObligations = model.obligations.filter((entry) => entry.kind === 'offense');
  const primaryCandidates = catalog.entities.filter((entity) =>
    entity?.content_type === 'active_skill'
    && asArray(entity?.candidate_roles).includes('primary_damage')
  );
  const ranked = primaryCandidates
    .map((entity) => evaluatePrimaryCandidate(entity, offenseObligations, snapshot))
    .filter(Boolean)
    .sort((a, b) =>
      b.score - a.score
      || b.exactProofs - a.exactProofs
      || String(a.entity.name || '').localeCompare(String(b.entity.name || ''))
      || String(a.entity.id || '').localeCompare(String(b.entity.id || ''))
    );

  const winner = ranked[0] || null;
  const fulfilledIds = new Set(asArray(winner?.fulfilled).map((entry) => entry.obligationId));
  const unresolved = [];

  for (const obligation of offenseObligations) {
    if (!fulfilledIds.has(obligation.id)) {
      unresolved.push(unresolvedEntry(obligation, 'No selected primary skill provides hard semantic evidence for this Offense.'));
    }
  }
  for (const obligation of model.obligations.filter((entry) => entry.kind === 'survivability')) {
    unresolved.push(unresolvedEntry(obligation, 'Not assigned by the primary-skill migration slice.'));
  }
  for (const dependency of asArray(winner?.dependencies)) {
    unresolved.push({
      obligationId: `dependency:${dependency}`,
      label: `Provide ${dependency.replace(/_/g, ' ')}`,
      reason: `The selected primary skill requires ${dependency.replace(/_/g, ' ')} from another package piece.`
    });
  }

  const primarySkill = winner ? {
    entityId: winner.entity.id,
    sourceId: winner.entity.source_id,
    name: winner.entity.name,
    contentType: winner.entity.content_type,
    assignedRole: 'primary_damage',
    fulfilledObligations: winner.fulfilled,
    dependencies: winner.dependencies,
    setupCosts: winner.setupCosts,
    score: winner.score
  } : null;

  return {
    schemaVersion: RECOMMENDATION_PACKAGE_V3_SCHEMA,
    status: primarySkill ? (unresolved.length ? 'partial' : 'complete') : 'unresolved',
    context: model.context,
    obligations: model.obligations,
    primarySkill,
    pieces: primarySkill ? [primarySkill] : [],
    unresolved,
    diagnostics: {
      totalPrimaryCandidates: primaryCandidates.length,
      rankedCandidates: ranked.length
    }
  };
}

function adaptRecommendationPackageV3ToSnapshot(packageResult) {
  const skill = packageResult?.primarySkill;
  return {
    recommendedSkills: skill ? [{
      id: skill.sourceId || skill.entityId,
      name: skill.name,
      recommendationV3: {
        entityId: skill.entityId,
        assignedRole: skill.assignedRole,
        fulfilledObligations: skill.fulfilledObligations
      }
    }] : [],
    recommendationV3: packageResult || null
  };
}

export {
  RECOMMENDATION_CATALOG_V3_SCHEMA,
  RECOMMENDATION_PACKAGE_V3_SCHEMA,
  RECOMMENDATION_V3_QUERY_PARAM,
  adaptRecommendationPackageV3ToSnapshot,
  buildRecommendationObligationsV3,
  evaluateCompatibilityV3,
  isEquipmentCompatibleV3,
  isRecommendationV3Enabled,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3
};
