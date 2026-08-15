const RECOMMENDATION_CATALOG_V3_SCHEMA = 'recommendation-catalog-v3.0.0';
const RECOMMENDATION_PACKAGE_V3_SCHEMA = 'recommendation-package-v3.0.0';
const RECOMMENDATION_V3_QUERY_PARAM = 'recommendationV3';
const PRIMARY_QUALITY_BAND = 12;
const COMPANION_QUALITY_BAND = 8;
const RECOMMENDATION_EXCLUDED_SOURCE_TAGS = new Set(['kalguuran']);

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
const CASTER_WEAPON_FAMILIES = new Set(['sceptre', 'staff', 'wand']);
const MARTIAL_WEAPON_FAMILIES = new Set([
  'axe',
  'bow',
  'claw',
  'crossbow',
  'dagger',
  'flail',
  'mace',
  'quarterstaff',
  'spear',
  'sword',
  'talisman',
  'unarmed'
]);
const WEAPON_FAMILY_ORDER = [
  'quarterstaff',
  'crossbow',
  'sceptre',
  'talisman',
  'unarmed',
  'staff',
  'wand',
  'spear',
  'flail',
  'dagger',
  'claw',
  'sword',
  'mace',
  'axe',
  'bow'
];

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

const AILMENT_CARRIER_MECHANICS = Object.freeze({
  ignite: ['fire'],
  bleed: ['physical'],
  poison: ['chaos', 'physical'],
  chill: ['cold'],
  freeze: ['cold'],
  shock: ['lightning'],
  electrocute: ['lightning']
});
const DAMAGE_TYPE_MECHANICS = new Set(['physical', 'fire', 'cold', 'lightning', 'chaos']);
const CARRIER_RELATIONS = new Set(['fulfills', 'has_property', 'converts']);
const COMPANION_CANDIDATE_ROLES = new Set(['setup_control', 'payoff', 'enabler', 'utility']);
const SUPPLY_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates']);

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
      return ['fulfills', 'inflicts', 'provides'];
    case 'scaling':
      return ['fulfills', 'modifies', 'provides', 'has_property'];
    case 'archetype':
      return ['fulfills', 'creates', 'has_property', 'provides'];
    default:
      return ['fulfills', 'inflicts', 'creates', 'provides', 'has_property'];
  }
}

function carrierMechanicsForOffense(entry, offenseId) {
  if (normalizeToken(entry?.category) !== 'ailment') return [];
  const related = [
    ...asArray(entry?.relations?.reinforcing),
    ...asArray(entry?.relations?.secondary)
  ].map(normalizeToken).filter((mechanic) => DAMAGE_TYPE_MECHANICS.has(mechanic));
  return unique([...(AILMENT_CARRIER_MECHANICS[offenseId] || []), ...related]);
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
      allowedRelations: allowedRelationsForOffense(entry.category),
      carrierMechanics: carrierMechanicsForOffense(entry, offenseId)
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

function primaryWeaponFamily(snapshot = {}) {
  const tags = weaponTags(snapshot.weapon);
  return WEAPON_FAMILY_ORDER.find((family) => tags.has(family)) || '';
}

function weaponDeliveryProfileV3(snapshot = {}) {
  const family = primaryWeaponFamily(snapshot);
  const kind = CASTER_WEAPON_FAMILIES.has(family)
    ? 'caster'
    : (MARTIAL_WEAPON_FAMILIES.has(family) ? 'martial' : 'unknown');
  return { family, kind };
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

function explicitWeaponDeliveryEvidence(entity, snapshot = {}) {
  const family = primaryWeaponFamily(snapshot);
  if (!family) return null;

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  if (types.has(family)) return { source: 'active_skill_type', value: family };

  const equipment = entity?.compatibility?.equipment || {};
  if (equipment.is_unrestricted === true) return null;
  const requirements = [
    ...asArray(equipment.mainhand_tags_any_of),
    ...asArray(equipment.allowed_weapon_tags_any_of)
  ].map(normalizeToken);
  if (requirements.includes(family)) return { source: 'equipment_requirement', value: family };
  return null;
}

function evaluateDeliveryCompatibilityV3(entity, snapshot = {}) {
  const weapon = weaponDeliveryProfileV3(snapshot);
  if (weapon.kind === 'unknown') {
    return { ok: true, reason: '', weapon, evidence: null };
  }

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  const isAttack = types.has('attack');
  const isSpell = types.has('spell');
  const isSummoning = types.has('createsminion')
    || types.has('createscompanion')
    || types.has('minion')
    || asArray(entity?.facts).some((fact) =>
      ['creates', 'provides'].includes(fact?.relation)
      && ['minion', 'companion'].includes(normalizeToken(fact?.mechanic))
      && HARD_CONFIDENCE.has(fact?.confidence)
    );
  const explicit = explicitWeaponDeliveryEvidence(entity, snapshot);

  if (weapon.kind === 'martial') {
    if (explicit) return { ok: true, reason: '', weapon, evidence: explicit };
    return {
      ok: false,
      reason: `does not have typed ${weapon.family} delivery evidence`,
      weapon,
      evidence: null
    };
  }

  if (isSpell || isSummoning || explicit) {
    return {
      ok: true,
      reason: '',
      weapon,
      evidence: explicit || { source: isSpell ? 'spell' : 'summoning', value: isSpell ? 'spell' : 'minion' }
    };
  }
  if (isAttack) {
    return {
      ok: false,
      reason: `attack does not have typed ${weapon.family} delivery evidence`,
      weapon,
      evidence: null
    };
  }
  return {
    ok: false,
    reason: 'candidate is neither a spell, summoning skill, nor an explicitly compatible weapon skill',
    weapon,
    evidence: null
  };
}

function isDirectlyUsableActive(entity) {
  if (!entity || entity.content_type !== 'active_skill') return false;
  if (!asArray(entity.candidate_roles).includes('primary_damage')) return false;
  if (!isSelectableSkillName(entity.name)) return false;

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  for (const blocked of DIRECT_USE_BLOCKED_TYPES) if (types.has(blocked)) return false;
  const createsDamageProxy = asArray(entity.facts).some((fact) =>
    fact?.relation === 'creates'
    && ['companion', 'minion', 'totem'].includes(normalizeToken(fact?.mechanic))
    && HARD_CONFIDENCE.has(fact?.confidence)
  );
  const hasDamageDelivery = types.has('attack')
    || types.has('damage')
    || types.has('damageovertime')
    || types.has('degenonlyspelldamage')
    || createsDamageProxy;
  if (!hasDamageDelivery) return false;
  const hardPreventsDamage = asArray(entity.facts).some((fact) =>
    fact?.relation === 'prevents'
    && normalizeToken(fact?.mechanic) === 'damage'
    && HARD_CONFIDENCE.has(fact?.confidence)
    && fact?.condition !== 'base_effect_only'
  );
  return !hardPreventsDamage;
}

function isRecommendationContentAllowedV3(entity) {
  const sourceTags = new Set(asArray(entity?.provenance?.source_tags).map(normalizeToken));
  if (Array.from(RECOMMENDATION_EXCLUDED_SOURCE_TAGS).some((tag) => sourceTags.has(tag))) return false;
  if (sourceTags.has('derived_template')) return false;
  const retrievalTerms = new Set(asArray(entity?.retrieval_terms).map(normalizeToken));
  if (retrievalTerms.has('dnt') || retrievalTerms.has('dnt_unused') || retrievalTerms.has('coming_soon')) return false;
  const description = String(entity?.source_evidence?.description || '');
  return !/^\s*\[?(?:DNT(?:-UNUSED)?|UNUSED|Coming\s+Soon)\]?/i.test(description);
}

function isSelectableSkillName(name) {
  const value = String(name || '');
  return Boolean(value.trim())
    && !/^\s*(?:\[?DNT(?:-UNUSED)?\]?|playtest\b|prototype\b)/i.test(value);
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

function factMatchesCarrier(fact, obligation) {
  if (!fact || obligation?.kind !== 'offense') return false;
  if (!HARD_CONFIDENCE.has(fact.confidence) || !CARRIER_RELATIONS.has(fact.relation)) return false;
  const carriers = new Set(asArray(obligation.carrierMechanics).map(normalizeToken));
  return carriers.size > 0 && factMechanics(fact).some((mechanic) => carriers.has(mechanic));
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
  const delivery = evaluateDeliveryCompatibilityV3(entity, snapshot);
  if (!delivery.ok) return null;

  const facts = asArray(entity.facts);
  if (offenseObligations.some((obligation) => facts.some((fact) => factPreventsObligation(fact, obligation)))) {
    return null;
  }

  const fulfilled = [];
  const carriers = [];
  let evidenceScore = 0;
  let exactProofs = 0;
  let exactCarrierProofs = 0;

  for (const obligation of offenseObligations) {
    const proofs = facts.filter((fact) => factMatchesObligation(fact, obligation));
    if (proofs.length) {
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
      continue;
    }

    const carrierProofs = facts.filter((fact) => factMatchesCarrier(fact, obligation));
    if (!carrierProofs.length) continue;
    carrierProofs.sort((a, b) => proofScore(b) - proofScore(a));
    const carrierProof = carrierProofs[0];
    evidenceScore += proofScore(carrierProof);
    if (carrierProof.confidence === 'exact') exactCarrierProofs += 1;
    carriers.push({
      obligationId: obligation.id,
      relation: carrierProof.relation,
      confidence: carrierProof.confidence,
      mechanic: factMechanics(carrierProof)[0] || ''
    });
  }

  if (!fulfilled.length && !carriers.length) return null;
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
    carriers,
    dependencies,
    setupCosts,
    delivery,
    score: fulfilled.length * 100
      + carriers.length * 35
      + exactProofs * 10
      + exactCarrierProofs * 3
      + evidenceScore
      - packageCostPenalty,
    exactProofs,
    exactCarrierProofs
  };
}

function buildCompanionTargets(primaryCandidate, offenseObligations) {
  if (!primaryCandidate) return [];
  const fulfilled = new Set(asArray(primaryCandidate.fulfilled).map((entry) => entry.obligationId));
  const carried = new Set(asArray(primaryCandidate.carriers).map((entry) => entry.obligationId));
  const targets = [];

  for (const obligation of offenseObligations) {
    if (fulfilled.has(obligation.id)) continue;
    targets.push({
      id: obligation.id,
      kind: 'offense',
      label: obligation.label,
      obligation,
      // Prefer covering a Fate component that the primary does not represent
      // at all. A carried ailment already has a typed damage bridge, even
      // though explicit application remains unresolved.
      weight: carried.has(obligation.id) ? 100 : 120
    });
  }

  for (const mechanic of asArray(primaryCandidate.dependencies)) {
    targets.push({
      id: `dependency:${mechanic}`,
      kind: 'dependency',
      label: `Provide ${mechanic.replace(/_/g, ' ')}`,
      mechanic,
      weight: 110
    });
  }

  for (const mechanic of asArray(primaryCandidate.setupCosts)) {
    if (targets.some((target) => target.mechanic === mechanic)) continue;
    targets.push({
      id: `setup:${mechanic}`,
      kind: 'setup',
      label: `Create ${mechanic.replace(/_/g, ' ')} setup`,
      mechanic,
      weight: 90
    });
  }
  return targets;
}

function factMatchesSupplyTarget(fact, target) {
  if (!fact || !target || !HARD_CONFIDENCE.has(fact.confidence)) return false;
  if (target.kind === 'offense') return factMatchesObligation(fact, target.obligation);
  if (!SUPPLY_RELATIONS.has(fact.relation)) return false;
  return factMechanics(fact).includes(normalizeToken(target.mechanic));
}

function isUsableCompanionActive(entity) {
  if (!entity || entity.content_type !== 'active_skill') return false;
  if (!isSelectableSkillName(entity.name) || !isRecommendationContentAllowedV3(entity)) return false;
  const roles = new Set(asArray(entity.candidate_roles));
  if (!Array.from(COMPANION_CANDIDATE_ROLES).some((role) => roles.has(role))) return false;

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  return !types.has('inbuilttrigger') && !types.has('triggered');
}

function evaluateCompanionCandidate(entity, primaryCandidate, targets, offenseObligations, snapshot) {
  if (!primaryCandidate || !targets.length || !isUsableCompanionActive(entity)) return null;
  if (entity.id === primaryCandidate.entity.id) return null;
  if (normalizeToken(entity.name) === normalizeToken(primaryCandidate.entity.name)) return null;

  const compatibility = evaluateCompatibilityV3(entity, snapshot);
  if (!compatibility.ok) return null;
  const facts = asArray(entity.facts);
  if (offenseObligations.some((obligation) => facts.some((fact) => factPreventsObligation(fact, obligation)))) {
    return null;
  }

  const suppliedTargets = [];
  let evidenceScore = 0;
  let exactProofs = 0;
  for (const target of targets) {
    const proofs = facts.filter((fact) => factMatchesSupplyTarget(fact, target));
    if (!proofs.length) continue;
    proofs.sort((a, b) => proofScore(b) - proofScore(a));
    const proof = proofs[0];
    evidenceScore += target.weight + proofScore(proof);
    if (proof.confidence === 'exact') exactProofs += 1;
    suppliedTargets.push({
      targetId: target.id,
      targetKind: target.kind,
      obligationId: target.kind === 'offense' ? target.id : null,
      relation: proof.relation,
      confidence: proof.confidence,
      mechanic: factMechanics(proof)[0] || ''
    });
  }
  if (!suppliedTargets.length) return null;

  const dependencies = candidateDependencies(entity);
  const setupCosts = candidateSetupCosts(entity);
  const roles = new Set(asArray(entity.candidate_roles));
  const assignedRole = suppliedTargets.some((entry) => entry.targetKind === 'offense')
    ? 'setup_control'
    : (roles.has('enabler') ? 'enabler' : 'setup_control');
  const roleBonus = roles.has(assignedRole) ? 8 : 0;
  const packageCostPenalty = dependencies.length * 25 + setupCosts.length * 5;

  return {
    entity,
    assignedRole,
    suppliedTargets,
    dependencies,
    setupCosts,
    score: suppliedTargets.length * 75 + evidenceScore + exactProofs * 5 + roleBonus - packageCostPenalty,
    exactProofs
  };
}

function stableHash32(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

function choosePrimaryCandidate(ranked, options = {}) {
  const top = ranked[0] || null;
  if (!top) return { winner: null, shortlist: [] };

  const requestedBand = Number(options.qualityBand);
  const qualityBand = Number.isFinite(requestedBand) && requestedBand >= 0
    ? requestedBand
    : PRIMARY_QUALITY_BAND;
  const shortlist = ranked.filter((candidate) => top.score - candidate.score <= qualityBand);
  let pool = shortlist;
  const previousEntityId = String(options.previousPrimaryEntityId || '');
  if (previousEntityId && shortlist.length > 1) {
    const alternatives = shortlist.filter((candidate) => candidate.entity.id !== previousEntityId);
    if (alternatives.length) pool = alternatives;
  }

  if (options.selectionSeed === undefined || options.selectionSeed === null) {
    return { winner: pool[0], shortlist };
  }

  const weights = pool.map((candidate) =>
    Math.max(1, qualityBand + 1 - (top.score - candidate.score))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let target = (stableHash32(`${options.selectionSeed}:primary_skill`) / 0x100000000) * totalWeight;
  for (let index = 0; index < pool.length; index += 1) {
    target -= weights[index];
    if (target < 0) return { winner: pool[index], shortlist };
  }
  return { winner: pool[pool.length - 1], shortlist };
}

function chooseCompanionCandidate(ranked, primaryCandidate, options = {}) {
  const top = ranked[0] || null;
  if (!top) return { winner: null, shortlist: [] };
  const requestedBand = Number(options.companionQualityBand);
  const qualityBand = Number.isFinite(requestedBand) && requestedBand >= 0
    ? requestedBand
    : COMPANION_QUALITY_BAND;
  const shortlist = ranked.filter((candidate) => top.score - candidate.score <= qualityBand);
  if (options.selectionSeed === undefined || options.selectionSeed === null) {
    return { winner: shortlist[0], shortlist };
  }

  const weights = shortlist.map((candidate) =>
    Math.max(1, qualityBand + 1 - (top.score - candidate.score))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const namespace = `companion_skill:${primaryCandidate?.entity?.id || 'none'}`;
  let target = (stableHash32(`${options.selectionSeed}:${namespace}`) / 0x100000000) * totalWeight;
  for (let index = 0; index < shortlist.length; index += 1) {
    target -= weights[index];
    if (target < 0) return { winner: shortlist[index], shortlist };
  }
  return { winner: shortlist[shortlist.length - 1], shortlist };
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
  const allPrimaryCandidates = catalog.entities.filter((entity) =>
    entity?.content_type === 'active_skill'
    && asArray(entity?.candidate_roles).includes('primary_damage')
  );
  const primaryCandidates = allPrimaryCandidates.filter(isRecommendationContentAllowedV3);
  const rankedWithDuplicateNames = primaryCandidates
    .map((entity) => evaluatePrimaryCandidate(entity, offenseObligations, snapshot))
    .filter(Boolean)
    .sort((a, b) =>
      b.score - a.score
      || b.exactProofs - a.exactProofs
      || String(a.entity.name || '').localeCompare(String(b.entity.name || ''))
      || String(a.entity.id || '').localeCompare(String(b.entity.id || ''))
    );
  const seenNames = new Set();
  const ranked = rankedWithDuplicateNames.filter((candidate) => {
    const name = normalizeToken(candidate.entity.name);
    if (!name || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });
  const { winner, shortlist } = choosePrimaryCandidate(ranked, options);
  const companionTargets = buildCompanionTargets(winner, offenseObligations);
  const allCompanionCandidates = catalog.entities.filter((entity) =>
    entity?.content_type === 'active_skill'
    && isRecommendationContentAllowedV3(entity)
  );
  const rankedCompanionsWithDuplicateNames = allCompanionCandidates
    .map((entity) => evaluateCompanionCandidate(entity, winner, companionTargets, offenseObligations, snapshot))
    .filter(Boolean)
    .sort((a, b) =>
      b.score - a.score
      || b.exactProofs - a.exactProofs
      || String(a.entity.name || '').localeCompare(String(b.entity.name || ''))
      || String(a.entity.id || '').localeCompare(String(b.entity.id || ''))
    );
  const companionNames = new Set();
  const rankedCompanions = rankedCompanionsWithDuplicateNames.filter((candidate) => {
    const name = normalizeToken(candidate.entity.name);
    if (!name || companionNames.has(name)) return false;
    companionNames.add(name);
    return true;
  });
  const { winner: companionWinner, shortlist: companionShortlist } = chooseCompanionCandidate(
    rankedCompanions,
    winner,
    options
  );
  const companionFulfilled = asArray(companionWinner?.suppliedTargets)
    .filter((entry) => entry.targetKind === 'offense')
    .map((entry) => ({
      obligationId: entry.obligationId,
      relation: entry.relation,
      confidence: entry.confidence,
      mechanic: entry.mechanic
    }));
  const fulfilledIds = new Set([
    ...asArray(winner?.fulfilled).map((entry) => entry.obligationId),
    ...companionFulfilled.map((entry) => entry.obligationId)
  ]);
  const carrierIds = new Set(asArray(winner?.carriers).map((entry) => entry.obligationId));
  const suppliedTargetIds = new Set(asArray(companionWinner?.suppliedTargets).map((entry) => entry.targetId));
  const unresolved = [];

  for (const obligation of offenseObligations) {
    if (!fulfilledIds.has(obligation.id)) {
      const reason = carrierIds.has(obligation.id)
        ? `The selected primary skill is a viable ${winner.carriers.find((entry) => entry.obligationId === obligation.id)?.mechanic || 'damage'} carrier, but another package piece must provide explicit ${obligation.label} application.`
        : 'No selected package skill provides hard semantic evidence for this Offense.';
      unresolved.push(unresolvedEntry(obligation, reason));
    }
  }
  for (const obligation of model.obligations.filter((entry) => entry.kind === 'survivability')) {
    unresolved.push(unresolvedEntry(obligation, 'Not assigned by the current skill-package slice.'));
  }
  for (const dependency of asArray(winner?.dependencies)) {
    if (suppliedTargetIds.has(`dependency:${dependency}`)) continue;
    unresolved.push({
      obligationId: `dependency:${dependency}`,
      label: `Provide ${dependency.replace(/_/g, ' ')}`,
      reason: `The selected primary skill requires ${dependency.replace(/_/g, ' ')} from another package piece.`
    });
  }
  for (const dependency of asArray(companionWinner?.dependencies)) {
    unresolved.push({
      obligationId: `companion_dependency:${dependency}`,
      label: `Provide ${dependency.replace(/_/g, ' ')}`,
      reason: `The selected ${companionWinner.assignedRole.replace(/_/g, ' ')} skill requires ${dependency.replace(/_/g, ' ')} from another package piece.`
    });
  }

  const primarySkill = winner ? {
    entityId: winner.entity.id,
    sourceId: winner.entity.source_id,
    name: winner.entity.name,
    contentType: winner.entity.content_type,
    assignedRole: 'primary_damage',
    fulfilledObligations: winner.fulfilled,
    carrierObligations: winner.carriers,
    dependencies: winner.dependencies,
    setupCosts: winner.setupCosts,
    delivery: winner.delivery,
    score: winner.score
  } : null;
  const supportingSkill = companionWinner ? {
    entityId: companionWinner.entity.id,
    sourceId: companionWinner.entity.source_id,
    name: companionWinner.entity.name,
    contentType: companionWinner.entity.content_type,
    assignedRole: companionWinner.assignedRole,
    fulfilledObligations: companionFulfilled,
    suppliedTargets: companionWinner.suppliedTargets,
    dependencies: companionWinner.dependencies,
    setupCosts: companionWinner.setupCosts,
    score: companionWinner.score
  } : null;
  const pieces = [primarySkill, supportingSkill].filter(Boolean);

  return {
    schemaVersion: RECOMMENDATION_PACKAGE_V3_SCHEMA,
    selectionSeed: options.selectionSeed ?? null,
    status: primarySkill ? (unresolved.length ? 'partial' : 'complete') : 'unresolved',
    context: model.context,
    obligations: model.obligations,
    primarySkill,
    supportingSkill,
    pieces,
    unresolved,
    diagnostics: {
      totalPrimaryCandidates: primaryCandidates.length,
      excludedContentCandidates: allPrimaryCandidates.length - primaryCandidates.length,
      rankedCandidates: ranked.length,
      shortlistedCandidates: shortlist.length,
      companionTargets: companionTargets.length,
      rankedCompanionCandidates: rankedCompanions.length,
      shortlistedCompanionCandidates: companionShortlist.length,
      qualityBand: Number.isFinite(Number(options.qualityBand)) && Number(options.qualityBand) >= 0
        ? Number(options.qualityBand)
        : PRIMARY_QUALITY_BAND,
      companionQualityBand: Number.isFinite(Number(options.companionQualityBand))
        && Number(options.companionQualityBand) >= 0
        ? Number(options.companionQualityBand)
        : COMPANION_QUALITY_BAND
    }
  };
}

function adaptRecommendationPackageV3ToSnapshot(packageResult) {
  const skills = asArray(packageResult?.pieces).length
    ? asArray(packageResult.pieces)
    : [packageResult?.primarySkill].filter(Boolean);
  const adapted = {
    recommendationV3: packageResult || null
  };
  if (skills.length) {
    adapted.recommendedSkills = skills.slice(0, 2).map((skill) => ({
      id: skill.sourceId || skill.entityId,
      name: skill.name,
      recommendationV3: {
        entityId: skill.entityId,
        assignedRole: skill.assignedRole,
        fulfilledObligations: skill.fulfilledObligations,
        carrierObligations: skill.carrierObligations,
        suppliedTargets: skill.suppliedTargets
      }
    }));
  }
  return adapted;
}

export {
  RECOMMENDATION_CATALOG_V3_SCHEMA,
  RECOMMENDATION_PACKAGE_V3_SCHEMA,
  RECOMMENDATION_V3_QUERY_PARAM,
  PRIMARY_QUALITY_BAND,
  COMPANION_QUALITY_BAND,
  adaptRecommendationPackageV3ToSnapshot,
  buildRecommendationObligationsV3,
  evaluateCompatibilityV3,
  evaluateDeliveryCompatibilityV3,
  isEquipmentCompatibleV3,
  isRecommendationContentAllowedV3,
  isRecommendationV3Enabled,
  selectRecommendationPackageV3,
  validateRecommendationCatalogV3,
  weaponDeliveryProfileV3
};
