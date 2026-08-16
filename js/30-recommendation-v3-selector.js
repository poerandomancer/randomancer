const RECOMMENDATION_CATALOG_V3_SCHEMA = 'recommendation-catalog-v3.0.0';
const RECOMMENDATION_PACKAGE_V3_SCHEMA = 'recommendation-package-v3.0.0';
const RECOMMENDATION_V3_QUERY_PARAM = 'recommendationV3';
const PRIMARY_QUALITY_BAND = 12;
const COMPANION_QUALITY_BAND = 8;
const PACKAGE_QUALITY_BAND = 12;
const RECOMMENDATION_EXCLUDED_SOURCE_TAGS = new Set(['kalguuran']);

const HARD_CONFIDENCE = new Set(['exact', 'strong']);
const DIRECT_USE_ALWAYS_BLOCKED_TYPES = new Set([
  'inbuilttrigger',
  'triggered'
]);
const DIRECT_USE_PROXY_ALLOWED_TYPES = new Set(['hasreservation', 'persistent']);
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
  totems: ['totem']
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
const AILMENT_MECHANICS = new Set(['ignite', 'bleed', 'poison', 'chill', 'freeze', 'shock', 'electrocute']);
const DAMAGE_TYPE_AFFINITIES = Object.freeze({
  physical: ['armour_break'],
  fire: ['ignite', 'detonation'],
  cold: ['chill', 'freeze'],
  lightning: ['shock', 'electrocute'],
  chaos: ['poison']
});
const CARRIER_RELATIONS = new Set(['fulfills', 'has_property', 'converts']);
const PACKAGE_CANDIDATE_ROLES = new Set(['primary_damage', 'setup_control', 'payoff', 'enabler', 'utility']);
const SUPPLY_RELATIONS = new Set(['fulfills', 'inflicts', 'creates', 'provides', 'generates']);

const RELATION_WEIGHT = Object.freeze({
  fulfills: 9,
  inflicts: 8,
  creates: 8,
  provides: 7,
  converts: 7,
  has_property: 6,
  generates: 6,
  modifies: 4,
  support_completes: 8
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
      return ['fulfills', 'creates', 'provides'];
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

function activeSkillTypes(entity) {
  return new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
}

function targetSkillTypesMatch(rule, entity) {
  const types = activeSkillTypes(entity);
  const allowed = asArray(rule?.allowed_skill_types_any_of).map(normalizeToken);
  const excluded = asArray(rule?.excluded_skill_types).map(normalizeToken);
  if (excluded.some((type) => types.has(type))) return false;
  return !allowed.length || allowed.some((type) => types.has(type));
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

function evaluatePackagePieceDeliveryV3(entity, snapshot = {}) {
  const weapon = weaponDeliveryProfileV3(snapshot);
  if (weapon.kind !== 'martial') return { ok: true, reason: '', weapon };

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  const isSpell = types.has('spell') || types.has('areaspell');
  if (!isSpell) return { ok: true, reason: '', weapon };

  const explicit = explicitWeaponDeliveryEvidence(entity, snapshot);
  if (explicit) return { ok: true, reason: '', weapon, evidence: explicit };
  return {
    ok: false,
    reason: `spell requires caster delivery for ${weapon.family || 'this weapon'}`,
    weapon,
    evidence: null
  };
}

function isDirectlyUsableActive(entity) {
  if (!entity || entity.content_type !== 'active_skill') return false;
  if (!asArray(entity.candidate_roles).includes('primary_damage')) return false;
  if (!isSelectableSkillName(entity.name)) return false;

  const types = activeSkillTypes(entity);
  const createsDamageProxy = asArray(entity.facts).some((fact) =>
    fact?.relation === 'creates'
    && ['companion', 'minion', 'totem'].includes(normalizeToken(fact?.mechanic))
    && HARD_CONFIDENCE.has(fact?.confidence)
  );
  for (const blocked of DIRECT_USE_ALWAYS_BLOCKED_TYPES) if (types.has(blocked)) return false;
  if (!createsDamageProxy && Array.from(DIRECT_USE_PROXY_ALLOWED_TYPES).some((type) => types.has(type))) {
    return false;
  }
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

function supportCompletionProviders(catalog) {
  return asArray(catalog?.entities)
    .filter((entity) => entity?.content_type === 'support_gem')
    .filter((entity) => asArray(entity.facts).some((fact) =>
      fact?.relation === 'creates'
      && ['minion', 'companion'].includes(normalizeToken(fact?.mechanic))
      && HARD_CONFIDENCE.has(fact?.confidence)
    ))
    .sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
    );
}

function supportRequirementIsMet(provider, entity, mechanic) {
  return asArray(entity?.facts).some((fact) =>
    HARD_CONFIDENCE.has(fact?.confidence)
    && !['prevents', 'requires', 'consumes', 'modifies'].includes(fact?.relation)
    && factMechanics(fact).includes(mechanic)
  );
}

function supportCompletionProof(entity, obligation, providers) {
  const obligationMechanics = new Set(asArray(obligation?.mechanics).map(normalizeToken));
  if (!obligationMechanics.has('minion') && !obligationMechanics.has('companion')) return null;

  for (const provider of providers) {
    if (!targetSkillTypesMatch(provider?.compatibility?.target_skill, entity)) continue;
    const requirements = asArray(provider.facts).filter((fact) =>
      fact?.relation === 'requires'
      && normalizeToken(fact?.subject) === 'supported_skill'
      && HARD_CONFIDENCE.has(fact?.confidence)
    );
    if (requirements.some((fact) => !supportRequirementIsMet(provider, entity, normalizeToken(fact.mechanic)))) {
      continue;
    }
    const proof = asArray(provider.facts).find((fact) =>
      fact?.relation === 'creates'
      && obligationMechanics.has(normalizeToken(fact?.mechanic))
      && HARD_CONFIDENCE.has(fact?.confidence)
    );
    if (!proof) continue;
    return {
      obligationId: obligation.id,
      relation: 'support_completes',
      confidence: proof.confidence,
      mechanic: normalizeToken(proof.mechanic),
      completionType: 'support',
      providerEntityId: provider.id,
      providerSourceId: provider.source_id,
      providerName: provider.name,
      prerequisiteMechanics: requirements.map((fact) => normalizeToken(fact.mechanic))
    };
  }
  return null;
}

function factIsUsableForCandidate(entity, fact, obligation) {
  if (!['has_property', 'converts'].includes(fact?.relation)) return true;
  const facts = asArray(entity?.facts);
  const delegatesBaseDamage = facts.some((entry) =>
    entry?.relation === 'prevents'
    && normalizeToken(entry?.mechanic) === 'damage'
    && entry?.condition === 'base_effect_only'
    && HARD_CONFIDENCE.has(entry?.confidence)
  );
  if (!delegatesBaseDamage) return true;

  const affinity = offenseAffinityMechanics([obligation]);
  const offThemeAilment = facts.some((entry) =>
    entry?.relation === 'inflicts'
    && HARD_CONFIDENCE.has(entry?.confidence)
    && AILMENT_MECHANICS.has(normalizeToken(entry?.mechanic))
    && !affinity.has(normalizeToken(entry?.mechanic))
  );
  return !offThemeAilment;
}

function factPreventsObligation(fact, obligation) {
  if (fact?.relation !== 'prevents' || !HARD_CONFIDENCE.has(fact?.confidence)) return false;
  const allowedMechanics = new Set(asArray(obligation?.mechanics).map(normalizeToken));
  return factMechanics(fact).some((mechanic) => allowedMechanics.has(mechanic));
}

function proofScore(fact) {
  return (RELATION_WEIGHT[fact?.relation] || 0) + (fact?.confidence === 'exact' ? 2 : 1);
}

function candidateDependencies(entity, offenseObligations = []) {
  const ownProvision = new Set();
  for (const fact of asArray(entity?.facts)) {
    if (!HARD_CONFIDENCE.has(fact?.confidence)) continue;
    if (['fulfills', 'generates', 'provides', 'creates'].includes(fact?.relation)) {
      for (const mechanic of factMechanics(fact)) ownProvision.add(mechanic);
    }
  }

  const dependencies = [];
  const offenseAffinity = offenseAffinityMechanics(offenseObligations);
  for (const fact of asArray(entity?.facts)) {
    if (!HARD_CONFIDENCE.has(fact?.confidence)) continue;
    const mechanic = normalizeToken(fact?.mechanic);
    if (fact?.relation !== 'requires' || !mechanic || ownProvision.has(mechanic)) continue;
    if (fact?.condition === 'fire_payoff' && !offenseAffinity.has('fire')) continue;
    dependencies.push(mechanic);
  }
  return unique(dependencies);
}

function candidateSetupCosts(entity) {
  const mechanics = unique(asArray(entity?.facts)
    .filter((fact) => fact?.relation === 'consumes' && HARD_CONFIDENCE.has(fact?.confidence))
    .map((fact) => normalizeToken(fact?.mechanic))
    .filter((mechanic) => STATEFUL_SETUP_MECHANICS.has(mechanic)));
  return mechanics.includes('charge') && mechanics.some((mechanic) => /^(?:endurance|frenzy|power)_charge$/.test(mechanic))
    ? mechanics.filter((mechanic) => mechanic !== 'charge')
    : mechanics;
}

function criticalProfileForEntity(entity, criticalProfiles = {}) {
  const profiles = criticalProfiles?.profiles || criticalProfiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return null;
  const profile = profiles[entity?.source_id] || profiles[entity?.id];
  const baseCritChance = Number(profile?.base_crit_chance);
  if (!Number.isFinite(baseCritChance) || baseCritChance <= 0) return null;
  return {
    source: 'skill',
    baseCritChance,
    sourceUrl: String(profile?.source_url || '')
  };
}

function criticalEvidenceForEntity(entity, offenseObligations, criticalProfiles = {}) {
  if (!offenseObligations.some((obligation) => obligation.id === 'offense:critical_hits')) {
    return { facts: [], affinity: { source: 'none', baseCritChance: null, score: 0 } };
  }

  const profile = criticalProfileForEntity(entity, criticalProfiles);
  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  const explicitInteraction = asArray(entity?.facts).some((fact) =>
    ['fulfills', 'modifies', 'provides', 'has_property'].includes(fact?.relation)
    && normalizeToken(fact?.mechanic) === 'critical_hits'
    && HARD_CONFIDENCE.has(fact?.confidence)
  );

  if (profile) {
    const baseScore = Math.max(0, Math.min(30, Math.round((profile.baseCritChance - 5) * 3)));
    return {
      facts: [{
        relation: 'has_property',
        subject: 'skill',
        mechanic: 'critical_hits',
        confidence: 'exact',
        evidence_source: 'base_critical_hit_chance'
      }],
      affinity: {
        ...profile,
        score: baseScore + (explicitInteraction ? 8 : 0)
      }
    };
  }

  // Ordinary weapon attacks inherit their base critical chance from the
  // equipped weapon. Keep that useful but deliberately neutral: unlike an
  // intrinsic skill value, it must not be treated as a high-base-crit skill.
  if (types.has('attack') && !types.has('nonweaponattack')) {
    return {
      facts: [{
        relation: 'has_property',
        subject: 'skill',
        mechanic: 'critical_hits',
        confidence: 'strong',
        evidence_source: 'weapon_critical_hit_chance'
      }],
      affinity: { source: 'weapon', baseCritChance: null, sourceUrl: '', score: 10 }
    };
  }

  return {
    facts: [],
    affinity: {
      source: explicitInteraction ? 'explicit_interaction' : 'none',
      baseCritChance: null,
      sourceUrl: '',
      score: explicitInteraction ? 8 : 0
    }
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

function isUsablePackageActive(entity) {
  if (!entity || entity.content_type !== 'active_skill') return false;
  if (!isSelectableSkillName(entity.name) || !isRecommendationContentAllowedV3(entity)) return false;
  const roles = new Set(asArray(entity.candidate_roles));
  if (!Array.from(PACKAGE_CANDIDATE_ROLES).some((role) => roles.has(role))) return false;

  const types = new Set(asArray(entity?.source_evidence?.active_skill_types).map(normalizeToken));
  return !types.has('inbuilttrigger') && !types.has('triggered');
}

function analyzePackageCandidate(entity, offenseObligations, snapshot, criticalProfiles = {}, supportProviders = []) {
  if (!isUsablePackageActive(entity)) return null;
  const compatibility = evaluateCompatibilityV3(entity, snapshot);
  if (!compatibility.ok) return null;
  const pieceDelivery = evaluatePackagePieceDeliveryV3(entity, snapshot);
  if (!pieceDelivery.ok) return null;
  const criticalEvidence = criticalEvidenceForEntity(entity, offenseObligations, criticalProfiles);
  const facts = [...asArray(entity.facts), ...criticalEvidence.facts];
  if (offenseObligations.some((obligation) => facts.some((fact) => factPreventsObligation(fact, obligation)))) {
    return null;
  }

  const fulfilled = [];
  const carriers = [];
  let evidenceScore = 0;
  let exactProofs = 0;
  let exactCarrierProofs = 0;
  for (const obligation of offenseObligations) {
    const proofs = facts.filter((fact) =>
      factMatchesObligation(fact, obligation)
      && factIsUsableForCandidate(entity, fact, obligation)
    );
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

    const carrierProofs = facts.filter((fact) =>
      factMatchesCarrier(fact, obligation)
      && factIsUsableForCandidate(entity, fact, obligation)
    );
    if (!carrierProofs.length) {
      const completion = supportCompletionProof(entity, obligation, supportProviders);
      if (!completion) continue;
      evidenceScore += proofScore(completion);
      if (completion.confidence === 'exact') exactCarrierProofs += 1;
      carriers.push(completion);
      continue;
    }
    carrierProofs.sort((a, b) => proofScore(b) - proofScore(a));
    const proof = carrierProofs[0];
    evidenceScore += proofScore(proof);
    if (proof.confidence === 'exact') exactCarrierProofs += 1;
    carriers.push({
      obligationId: obligation.id,
      relation: proof.relation,
      confidence: proof.confidence,
      mechanic: factMechanics(proof)[0] || ''
    });
  }

  const hardFacts = facts.filter((fact) => HARD_CONFIDENCE.has(fact?.confidence));
  const supplies = [];
  for (const fact of hardFacts) {
    if (SUPPLY_RELATIONS.has(fact?.relation)) {
      for (const mechanic of factMechanics(fact)) {
        if (mechanic) supplies.push({ mechanic, relation: fact.relation, confidence: fact.confidence });
      }
    }
  }

  const dependencies = candidateDependencies(entity, offenseObligations);
  const setupCosts = candidateSetupCosts(entity);
  const demandConfidence = (relation, mechanic) => hardFacts.some((fact) =>
    fact?.relation === relation
    && normalizeToken(fact?.mechanic) === mechanic
    && fact?.confidence === 'exact'
  ) ? 'exact' : 'strong';
  const demands = [
    ...dependencies.map((mechanic) => ({
      mechanic,
      relation: 'requires',
      confidence: demandConfidence('requires', mechanic)
    })),
    ...setupCosts.map((mechanic) => ({
      mechanic,
      relation: 'consumes',
      confidence: demandConfidence('consumes', mechanic)
    }))
  ];
  const delivery = isDirectlyUsableActive(entity)
    ? evaluateDeliveryCompatibilityV3(entity, snapshot)
    : { ok: false, reason: 'not a directly usable primary damage skill', evidence: null };
  const touchedMechanics = unique(hardFacts.flatMap((fact) => [
    ...factMechanics(fact),
    normalizeToken(fact?.from),
    normalizeToken(fact?.to)
  ]));

  return {
    entity,
    fulfilled,
    carriers,
    dependencies,
    setupCosts,
    supplies,
    demands,
    hardFacts,
    touchedMechanics,
    delivery,
    primaryEligible: delivery.ok,
    criticalAffinity: criticalEvidence.affinity,
    evidenceScore,
    exactProofs,
    exactCarrierProofs,
    individualScore: fulfilled.length * 100
      + carriers.length * 35
      + exactProofs * 10
      + exactCarrierProofs * 3
      + evidenceScore
      + criticalEvidence.affinity.score
  };
}

function buildViableSkillPool(catalog, offenseObligations, snapshot, criticalProfiles = {}) {
  const providers = supportCompletionProviders(catalog);
  const analyses = asArray(catalog?.entities)
    .map((entity) => analyzePackageCandidate(entity, offenseObligations, snapshot, criticalProfiles, providers))
    .filter(Boolean);
  const seedMechanics = new Set(offenseObligations.flatMap((obligation) => [
    ...asArray(obligation.mechanics),
    ...asArray(obligation.carrierMechanics)
  ]).map(normalizeToken));
  const included = new Set();

  // Begin with skills tied to a rolled Offense, then make a narrow closure over
  // their explicit prerequisites and stateful setup costs. This retrieves
  // applicators, consumers, payoffs, and resource enablers without treating a
  // broad text/tag match as proof that the package works.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const candidate of analyses) {
      const offenseRelevant = candidate.fulfilled.length > 0 || candidate.carriers.length > 0;
      const related = candidate.touchedMechanics.some((mechanic) => seedMechanics.has(mechanic))
        || candidate.supplies.some((entry) => seedMechanics.has(entry.mechanic))
        || candidate.demands.some((entry) => seedMechanics.has(entry.mechanic));
      if (!offenseRelevant && !related) continue;
      if (!included.has(candidate.entity.id)) {
        included.add(candidate.entity.id);
        changed = true;
      }
      for (const mechanic of [...candidate.dependencies, ...candidate.setupCosts]) {
        if (!seedMechanics.has(mechanic)) {
          seedMechanics.add(mechanic);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Meta skills are not complete actives by themselves. Once an Offense-aligned
  // meta primary is in the pool, add only directly usable actives that satisfy
  // its typed socketed-skill contract.
  for (const primary of analyses.filter((candidate) => included.has(candidate.entity.id))) {
    if (!primary.entity?.compatibility?.meta_payload) continue;
    for (const payload of analyses) {
      if (metaPayloadMatches(primary, payload)) included.add(payload.entity.id);
    }
  }

  const ranked = analyses
    .filter((candidate) => included.has(candidate.entity.id))
    .sort((a, b) =>
      Number(b.primaryEligible) - Number(a.primaryEligible)
      || b.individualScore - a.individualScore
      || String(a.entity.name || '').localeCompare(String(b.entity.name || ''))
      || String(a.entity.id || '').localeCompare(String(b.entity.id || ''))
    );
  const names = new Set();
  return ranked.filter((candidate) => {
    const name = normalizeToken(candidate.entity.name);
    if (!name || names.has(name)) return false;
    names.add(name);
    return true;
  });
}

function findDirectedSynergyEdges(supplier, consumer) {
  if (!supplier || !consumer) return [];
  const edges = [];
  const seen = new Set();
  for (const supply of supplier.supplies) {
    for (const demand of consumer.demands) {
      if (!supply.mechanic || supply.mechanic !== demand.mechanic) continue;
      // `charge` is a lossy parser umbrella and must not connect Power,
      // Frenzy, and Endurance Charge mechanics across different skills.
      if (supply.mechanic === 'charge') continue;
      const key = `${supplier.entity.id}:${consumer.entity.id}:${supply.mechanic}:${demand.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        fromEntityId: supplier.entity.id,
        toEntityId: consumer.entity.id,
        mechanic: supply.mechanic,
        supplyRelation: supply.relation,
        demandRelation: demand.relation,
        confidence: supply.confidence === 'exact' && demand.confidence === 'exact' ? 'exact' : 'strong'
      });
    }
  }
  return edges;
}

function metaPayloadMatches(primary, supporting) {
  const rule = primary?.entity?.compatibility?.meta_payload;
  if (!rule || !supporting?.primaryEligible || supporting?.entity?.compatibility?.meta_payload) return false;
  return targetSkillTypesMatch(rule, supporting.entity);
}

function metaPayloadEdge(primary, supporting) {
  if (!metaPayloadMatches(primary, supporting)) return null;
  return {
    fromEntityId: supporting.entity.id,
    toEntityId: primary.entity.id,
    mechanic: normalizeToken(primary.entity.compatibility.meta_payload.mechanic) || 'socketed_skill',
    supplyRelation: 'provides',
    demandRelation: 'requires',
    confidence: 'exact',
    metaPayload: true
  };
}

function bestProofByObligation(candidates, field) {
  const best = new Map();
  for (const candidate of candidates) {
    for (const proof of asArray(candidate?.[field])) {
      const existing = best.get(proof.obligationId);
      if (!existing || proofScore(proof) > proofScore(existing)) best.set(proof.obligationId, proof);
    }
  }
  return Array.from(best.values());
}

function adjacentOffenseFacts(candidate, offenseObligations) {
  if (!candidate) return [];
  const mechanics = new Set(offenseObligations.flatMap((obligation) => [
    ...asArray(obligation.mechanics),
    ...asArray(obligation.carrierMechanics)
  ]).map(normalizeToken));
  return candidate.hardFacts.filter((fact) =>
    ['modifies', 'provides', 'converts'].includes(fact?.relation)
    && factMechanics(fact).some((mechanic) => mechanics.has(mechanic))
    && !offenseObligations.some((obligation) =>
      factMatchesObligation(fact, obligation) || factMatchesCarrier(fact, obligation)
    )
  );
}

function offenseAffinityMechanics(offenseObligations) {
  return new Set(offenseObligations.flatMap((obligation) => {
    const mechanics = [
      ...asArray(obligation.mechanics),
      ...asArray(obligation.carrierMechanics)
    ].map(normalizeToken);
    return unique([
      ...mechanics,
      ...mechanics.flatMap((mechanic) => DAMAGE_TYPE_AFFINITIES[mechanic] || [])
    ]);
  }));
}

function offenseAnchoredSynergyEdges(
  primary,
  supporting,
  rawEdges,
  offenseObligations,
  supportingFulfilled,
  supportingCarriers
) {
  const affinity = offenseAffinityMechanics(offenseObligations);
  const supportingIsOffenseRelevant = supportingFulfilled.length > 0 || supportingCarriers.length > 0;
  const primaryHasAlignedDemand = primary.demands.some((demand) => affinity.has(demand.mechanic));

  return rawEdges.filter((edge) => {
    if (affinity.has(edge.mechanic)) return true;
    if (supportingIsOffenseRelevant) return true;

    // A resource enabler can still support an Offense-relevant primary when
    // that resource is its only explicit route. It must not, however, promote
    // an off-theme payoff or satisfy the wrong branch of an elemental payoff
    // that has a rolled-Offense setup available (for example Ignite for a
    // Cold Snap package that can instead consume Freeze).
    return edge.fromEntityId === supporting.entity.id
      && edge.toEntityId === primary.entity.id
      && !primaryHasAlignedDemand;
  });
}

function resolvedDemandKeys(candidates, synergyEdges) {
  const selectedIds = new Set(candidates.map((candidate) => candidate.entity.id));
  return new Set(synergyEdges
    .filter((edge) => selectedIds.has(edge.fromEntityId) && selectedIds.has(edge.toEntityId))
    .map((edge) => `${edge.toEntityId}:${edge.demandRelation}:${edge.mechanic}`));
}

function supportingProofIsUsable(candidate, proof, offenseObligations, isCarrier = false) {
  if (!candidate || !proof) return false;
  if (isCarrier) return candidate.primaryEligible;
  const obligation = offenseObligations.find((entry) => entry.id === proof.obligationId);
  if (normalizeToken(obligation?.category) === 'archetype') return candidate.primaryEligible;
  return normalizeToken(obligation?.category) !== 'damage_type'
    || !['has_property', 'converts'].includes(proof.relation)
    || candidate.primaryEligible;
}

function assignSupportingRole(primary, supporting, synergyEdges, offenseObligations) {
  const roles = new Set(asArray(supporting?.entity?.candidate_roles));
  const suppliedToPrimary = synergyEdges.filter((edge) =>
    edge.fromEntityId === supporting.entity.id && edge.toEntityId === primary.entity.id
  );
  const paidOffFromPrimary = synergyEdges.filter((edge) =>
    edge.fromEntityId === primary.entity.id && edge.toEntityId === supporting.entity.id
  );
  if (suppliedToPrimary.some((edge) => edge.metaPayload)) return 'secondary_damage';
  if (paidOffFromPrimary.some((edge) => edge.demandRelation === 'consumes') || (paidOffFromPrimary.length && roles.has('payoff'))) {
    return 'payoff';
  }
  if (suppliedToPrimary.some((edge) => edge.demandRelation === 'requires') && roles.has('enabler')) {
    return 'enabler';
  }
  const resolvesPrimaryCarrier = supporting.fulfilled.some((proof) =>
    primary.carriers.some((carrier) => carrier.obligationId === proof.obligationId)
  );
  if (resolvesPrimaryCarrier && roles.has('setup_control')) return 'setup_control';
  if (!synergyEdges.length && roles.has('primary_damage')
    && (supporting.fulfilled.length || supporting.carriers.length)) {
    return 'secondary_damage';
  }
  if (suppliedToPrimary.length || adjacentOffenseFacts(supporting, offenseObligations).length || roles.has('setup_control')) {
    return 'setup_control';
  }
  if (roles.has('enabler')) return 'enabler';
  if (roles.has('payoff')) return 'payoff';
  if (roles.has('primary_damage')) return 'secondary_damage';
  return 'utility';
}

function evaluateSkillPackage(primary, supporting, offenseObligations) {
  if (!primary?.primaryEligible || (!primary.fulfilled.length && !primary.carriers.length)) return null;
  const primaryMetaPayload = primary.entity?.compatibility?.meta_payload || null;
  if (primaryMetaPayload && !supporting) return null;
  if (supporting && (
    supporting.entity.id === primary.entity.id
    || normalizeToken(supporting.entity.name) === normalizeToken(primary.entity.name)
  )) return null;
  const payloadEdge = supporting ? metaPayloadEdge(primary, supporting) : null;
  if (primaryMetaPayload && !payloadEdge) return null;

  const candidates = [primary, supporting].filter(Boolean);
  const supportingFulfilled = supporting
    ? supporting.fulfilled.filter((proof) => supportingProofIsUsable(supporting, proof, offenseObligations))
    : [];
  const supportingCarriers = supporting
    ? supporting.carriers.filter((proof) => supportingProofIsUsable(supporting, proof, offenseObligations, true))
    : [];
  const supportingView = supporting ? {
    ...supporting,
    fulfilled: supportingFulfilled,
    carriers: supportingCarriers
  } : null;
  const rawSynergyEdges = supporting ? [
    ...findDirectedSynergyEdges(primary, supporting),
    ...findDirectedSynergyEdges(supporting, primary)
  ] : [];
  const synergyEdges = supporting
    ? [
      ...offenseAnchoredSynergyEdges(
      primary,
      supporting,
      rawSynergyEdges,
      offenseObligations,
      supportingFulfilled,
      supportingCarriers
      ),
      ...[payloadEdge].filter(Boolean)
    ]
    : [];
  const supportingAdjacentFacts = adjacentOffenseFacts(supporting, offenseObligations);
  const primaryRepresentedBeforePair = new Set([
    ...primary.fulfilled.map((entry) => entry.obligationId),
    ...primary.carriers.map((entry) => entry.obligationId)
  ]);
  const supportingAddsCarrierCoverage = supportingCarriers.some((proof) =>
    !primaryRepresentedBeforePair.has(proof.obligationId)
  );
  const supportingDisplacesCarrierPrimary = supporting?.primaryEligible
    && supportingFulfilled.some((proof) =>
      primary.carriers.some((carrier) => carrier.obligationId === proof.obligationId)
    );
  if (supportingDisplacesCarrierPrimary) return null;
  if (supporting && !supportingFulfilled.length && !supportingCarriers.length
    && !synergyEdges.length) {
    return null;
  }
  if (supporting && !supportingFulfilled.length && !supportingAddsCarrierCoverage && !synergyEdges.length) {
    return null;
  }

  const coverageCandidates = [primary, supportingView].filter(Boolean);
  const fulfilled = bestProofByObligation(coverageCandidates, 'fulfilled');
  const carriers = bestProofByObligation(coverageCandidates, 'carriers')
    .filter((proof) => !fulfilled.some((entry) => entry.obligationId === proof.obligationId));
  const fulfilledIds = new Set(fulfilled.map((entry) => entry.obligationId));
  const representedIds = new Set([...fulfilledIds, ...carriers.map((entry) => entry.obligationId)]);
  const primaryRepresentedIds = new Set([
    ...primary.fulfilled.map((entry) => entry.obligationId),
    ...primary.carriers.map((entry) => entry.obligationId)
  ]);
  const supportingRepresentedIds = new Set(supporting ? [
    ...supportingFulfilled.map((entry) => entry.obligationId),
    ...supportingCarriers.map((entry) => entry.obligationId)
  ] : []);
  const resolvedKeys = resolvedDemandKeys(candidates, synergyEdges);
  const unresolvedDependencies = candidates.flatMap((candidate) => candidate.dependencies
    .filter((mechanic) => !resolvedKeys.has(`${candidate.entity.id}:requires:${mechanic}`))
    .map((mechanic) => ({ entityId: candidate.entity.id, mechanic }))
  );
  const unresolvedSetupCosts = candidates.flatMap((candidate) => candidate.setupCosts
    .filter((mechanic) => !resolvedKeys.has(`${candidate.entity.id}:consumes:${mechanic}`))
    .map((mechanic) => ({ entityId: candidate.entity.id, mechanic }))
  );
  const newRepresentedBySupporting = supporting
    ? Array.from(supportingRepresentedIds).filter((id) => !primaryRepresentedIds.has(id)).length
    : 0;
  const newDirectBySupporting = supporting
    ? supportingFulfilled.filter((entry) => !primary.fulfilled.some((proof) => proof.obligationId === entry.obligationId)).length
    : 0;
  if (supporting && !synergyEdges.length
    && newRepresentedBySupporting === 0
    && newDirectBySupporting === 0) return null;
  const complementaryCoverage = supporting && offenseObligations.length > 1
    && Array.from(primaryRepresentedIds).some((id) => !supportingRepresentedIds.has(id))
    && Array.from(supportingRepresentedIds).some((id) => !primaryRepresentedIds.has(id));
  const redundantParallel = supporting && !synergyEdges.length
    && newRepresentedBySupporting === 0;
  const metaPayloadPair = Boolean(payloadEdge);
  const exactProofs = primary.exactProofs
    + supportingFulfilled.filter((proof) => proof.confidence === 'exact').length;
  const exactCarrierProofs = primary.exactCarrierProofs
    + supportingCarriers.filter((proof) => proof.confidence === 'exact').length;
  const evidenceScore = primary.evidenceScore
    + supportingFulfilled.reduce((sum, proof) => sum + proofScore(proof), 0)
    + supportingCarriers.reduce((sum, proof) => sum + proofScore(proof), 0);
  const supportingRole = supporting
    ? assignSupportingRole(primary, supportingView, synergyEdges, offenseObligations)
    : null;
  const complementaryRole = supporting && supportingRole !== 'secondary_damage';
  const directCoverageComplete = offenseObligations.length > 0 && fulfilledIds.size === offenseObligations.length;
  const criticalAffinityScore = primary.criticalAffinity.score
    + (supporting ? Math.round(supporting.criticalAffinity.score * 0.5) : 0);

  // Direct rolled-Offense coverage is deliberately dominant. Synergy and the
  // two-skill preference decide among packages with comparable coverage; they
  // cannot rescue an attractive combo that leaves a satisfiable Fate unmet.
  const score = fulfilledIds.size * 500
    + carriers.length * 110
    + (directCoverageComplete ? 80 : 0)
    + exactProofs * 10
    + exactCarrierProofs * 4
    + evidenceScore * 2
    + criticalAffinityScore
    + primary.fulfilled.length * 45
    + (supporting && !metaPayloadPair ? 70 : 0)
    + synergyEdges.filter((edge) => edge.demandRelation === 'requires' && !edge.metaPayload).length * 135
    + synergyEdges.filter((edge) => edge.demandRelation === 'consumes').length * 115
    + newRepresentedBySupporting * 55
    + newDirectBySupporting * 35
    + (complementaryCoverage ? 35 : 0)
    + (complementaryRole ? 25 : 0)
    - (redundantParallel ? 45 : 0)
    - (metaPayloadPair ? 15 : 0)
    - unresolvedDependencies.length * 90
    - unresolvedSetupCosts.length * 20;

  return {
    id: supporting ? `${primary.entity.id}+${supporting.entity.id}` : primary.entity.id,
    primary,
    supporting,
    supportingFulfilled,
    supportingCarriers,
    supportingRole,
    fulfilled,
    carriers,
    synergyEdges,
    supportingAdjacentFacts,
    unresolvedDependencies,
    unresolvedSetupCosts,
    score,
    exactProofs,
    exactCarrierProofs,
    representedCount: representedIds.size
  };
}

function buildRankedSkillPackages(pool, offenseObligations) {
  const primaries = pool.filter((candidate) =>
    candidate.primaryEligible && (candidate.fulfilled.length || candidate.carriers.length)
  );
  const packages = [];
  for (const primary of primaries) {
    const single = evaluateSkillPackage(primary, null, offenseObligations);
    if (single) packages.push(single);
    for (const supporting of pool) {
      const pair = evaluateSkillPackage(primary, supporting, offenseObligations);
      if (pair) packages.push(pair);
    }
  }
  return packages.sort((a, b) =>
    b.score - a.score
    || b.fulfilled.length - a.fulfilled.length
    || b.synergyEdges.length - a.synergyEdges.length
    || Number(Boolean(b.supporting)) - Number(Boolean(a.supporting))
    || b.exactProofs - a.exactProofs
    || String(a.primary.entity.name || '').localeCompare(String(b.primary.entity.name || ''))
    || String(a.supporting?.entity?.name || '').localeCompare(String(b.supporting?.entity?.name || ''))
    || String(a.id).localeCompare(String(b.id))
  );
}

function suppliedTargetsForSupporting(packageCandidate) {
  const supporting = packageCandidate?.supporting;
  if (!supporting) return [];
  const offenseTargets = packageCandidate.supportingFulfilled.map((proof) => ({
    targetId: proof.obligationId,
    targetKind: 'offense',
    obligationId: proof.obligationId,
    relation: proof.relation,
    confidence: proof.confidence,
    mechanic: proof.mechanic
  }));
  const mechanicTargets = packageCandidate.synergyEdges
    .filter((edge) => edge.fromEntityId === supporting.entity.id)
    .map((edge) => ({
      targetId: `${edge.demandRelation === 'requires' ? 'dependency' : 'setup'}:${edge.mechanic}`,
      targetKind: edge.demandRelation === 'requires' ? 'dependency' : 'setup',
      obligationId: null,
      relation: edge.supplyRelation,
      confidence: edge.confidence,
      mechanic: edge.mechanic
    }));
  return [...offenseTargets, ...mechanicTargets];
}

function choosePackageCandidate(ranked, options = {}) {
  const top = ranked[0] || null;
  if (!top) return { winner: null, shortlist: [], qualityBand: PACKAGE_QUALITY_BAND };
  const requestedBand = Number(options.packageQualityBand ?? options.qualityBand);
  const qualityBand = Number.isFinite(requestedBand) && requestedBand >= 0
    ? requestedBand
    : PACKAGE_QUALITY_BAND;
  const shortlist = ranked.filter((candidate) => top.score - candidate.score <= qualityBand);
  let pool = shortlist;
  const previousEntityId = String(options.previousPrimaryEntityId || '');
  if (previousEntityId && shortlist.length > 1) {
    const alternatives = shortlist.filter((candidate) => candidate.primary.entity.id !== previousEntityId);
    if (alternatives.length) pool = alternatives;
  }

  if (options.selectionSeed === undefined || options.selectionSeed === null) {
    return { winner: pool[0], shortlist, qualityBand };
  }
  const weights = pool.map((candidate) =>
    Math.max(1, qualityBand + 1 - (top.score - candidate.score))
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let target = (stableHash32(`${options.selectionSeed}:skill_package`) / 0x100000000) * totalWeight;
  for (let index = 0; index < pool.length; index += 1) {
    target -= weights[index];
    if (target < 0) return { winner: pool[index], shortlist, qualityBand };
  }
  return { winner: pool[pool.length - 1], shortlist, qualityBand };
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
      supportingSkill: null,
      pieces: [],
      obligations: [],
      unresolved: [{ obligationId: 'catalog', label: 'Recommendation catalog', reason: validation.reason }],
      diagnostics: {
        viablePoolSize: 0,
        rankedPackages: 0,
        shortlistedPackages: 0,
        totalPrimaryCandidates: 0,
        rankedCandidates: 0
      }
    };
  }

  const model = buildRecommendationObligationsV3(snapshot, options.offenseInventory || {});
  const offenseObligations = model.obligations.filter((entry) => entry.kind === 'offense');
  const allPrimaryCandidates = catalog.entities.filter((entity) =>
    entity?.content_type === 'active_skill'
    && asArray(entity?.candidate_roles).includes('primary_damage')
  );
  const contentEligiblePrimaries = allPrimaryCandidates.filter(isRecommendationContentAllowedV3);
  const viablePool = buildViableSkillPool(
    catalog,
    offenseObligations,
    snapshot,
    options.criticalProfiles || {}
  );
  const primaryPool = viablePool.filter((candidate) =>
    candidate.primaryEligible && (candidate.fulfilled.length || candidate.carriers.length)
  );
  const rankedPackages = buildRankedSkillPackages(viablePool, offenseObligations);
  const { winner, shortlist, qualityBand } = choosePackageCandidate(rankedPackages, options);
  const selectedCandidates = [winner?.primary, winner?.supporting].filter(Boolean);
  const fulfilledIds = new Set(asArray(winner?.fulfilled).map((entry) => entry.obligationId));
  const carrierProofs = asArray(winner?.carriers);
  const carrierIds = new Set(carrierProofs.map((entry) => entry.obligationId));
  const unresolved = [];

  for (const obligation of offenseObligations) {
    if (fulfilledIds.has(obligation.id)) continue;
    const carrier = carrierProofs.find((entry) => entry.obligationId === obligation.id);
    const reason = carrier?.completionType === 'support'
      ? `${carrier.providerName} can complete this ${obligation.label} package, but support selection is deferred to the support pass.`
      : carrierIds.has(obligation.id)
        ? `The selected package has a viable ${carrier?.mechanic || 'damage'} carrier, but still lacks explicit ${obligation.label} application.`
      : 'No selected package skill provides hard semantic evidence for this Offense.';
    unresolved.push(unresolvedEntry(obligation, reason));
  }
  for (const obligation of model.obligations.filter((entry) => entry.kind === 'survivability')) {
    unresolved.push(unresolvedEntry(obligation, 'Not assigned by the current skill-package slice.'));
  }
  for (const unresolvedDependency of asArray(winner?.unresolvedDependencies)) {
    const candidate = selectedCandidates.find((entry) => entry.entity.id === unresolvedDependency.entityId);
    const isPrimary = candidate?.entity.id === winner?.primary?.entity.id;
    unresolved.push({
      obligationId: `${isPrimary ? 'dependency' : 'supporting_dependency'}:${unresolvedDependency.mechanic}`,
      label: `Provide ${unresolvedDependency.mechanic.replace(/_/g, ' ')}`,
      reason: `The selected ${isPrimary ? 'primary' : (winner?.supportingRole || 'supporting').replace(/_/g, ' ')} skill requires ${unresolvedDependency.mechanic.replace(/_/g, ' ')} from another package piece.`
    });
  }

  const primary = winner?.primary || null;
  const supporting = winner?.supporting || null;
  const supportingTargets = suppliedTargetsForSupporting(winner);
  const primarySkill = primary ? {
    entityId: primary.entity.id,
    sourceId: primary.entity.source_id,
    name: primary.entity.name,
    contentType: primary.entity.content_type,
    assignedRole: 'primary_damage',
    fulfilledObligations: primary.fulfilled,
    carrierObligations: primary.carriers,
    dependencies: primary.dependencies,
    setupCosts: primary.setupCosts,
    delivery: primary.delivery,
    criticalAffinity: primary.criticalAffinity,
    score: primary.individualScore,
    packageScore: winner.score
  } : null;
  const supportingSkill = supporting ? {
    entityId: supporting.entity.id,
    sourceId: supporting.entity.source_id,
    name: supporting.entity.name,
    contentType: supporting.entity.content_type,
    assignedRole: winner.supportingRole,
    fulfilledObligations: winner.supportingFulfilled,
    carrierObligations: winner.supportingCarriers,
    suppliedTargets: supportingTargets,
    dependencies: supporting.dependencies,
    setupCosts: supporting.setupCosts,
    criticalAffinity: supporting.criticalAffinity,
    score: supporting.individualScore,
    packageScore: winner.score
  } : null;
  const pieces = [primarySkill, supportingSkill].filter(Boolean);
  const shortlistedPrimaryIds = new Set(shortlist.map((candidate) => candidate.primary.entity.id));

  return {
    schemaVersion: RECOMMENDATION_PACKAGE_V3_SCHEMA,
    selectionSeed: options.selectionSeed ?? null,
    status: primarySkill ? (unresolved.length ? 'partial' : 'complete') : 'unresolved',
    context: model.context,
    obligations: model.obligations,
    primarySkill,
    supportingSkill,
    pieces,
    packageScore: winner?.score ?? null,
    synergyEdges: asArray(winner?.synergyEdges),
    unresolved,
    diagnostics: {
      viablePoolSize: viablePool.length,
      primaryPoolSize: primaryPool.length,
      singlePackages: rankedPackages.filter((candidate) => !candidate.supporting).length,
      pairPackages: rankedPackages.filter((candidate) => candidate.supporting).length,
      rankedPackages: rankedPackages.length,
      shortlistedPackages: shortlist.length,
      totalPrimaryCandidates: contentEligiblePrimaries.length,
      excludedContentCandidates: allPrimaryCandidates.length - contentEligiblePrimaries.length,
      // Retained as compatibility diagnostics for existing audits. These now
      // describe primary-capable candidates inside the package-first pool.
      rankedCandidates: primaryPool.length,
      shortlistedCandidates: shortlistedPrimaryIds.size,
      rankedCompanionCandidates: Math.max(0, viablePool.length - 1),
      shortlistedCompanionCandidates: shortlist.filter((candidate) => candidate.supporting).length,
      qualityBand,
      companionQualityBand: COMPANION_QUALITY_BAND
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
  PACKAGE_QUALITY_BAND,
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
