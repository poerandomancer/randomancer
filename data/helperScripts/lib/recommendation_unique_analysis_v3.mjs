const FAMILY_MAP = new Map([
  ['Bow', new Set(['bow', 'quiver'])], ['Crossbow', new Set(['crossbow'])],
  ['Spear', new Set(['spear'])], ['Quarterstaff', new Set(['quarterstaff'])],
  ['Staff', new Set(['staff'])], ['Wand', new Set(['wand'])],
  ['Sceptre', new Set(['sceptre'])], ['Talisman', new Set(['talisman'])],
  ['Mace', new Set(['mace'])]
]);
const ONE_HANDED = new Set(['Spear', 'Wand', 'Sceptre', 'Mace']);
const OFF_HAND = new Set(['shield', 'buckler', 'focus']);
const TIERS = ['CONTRADICTION_PREVENTION', 'PAYOFF_CONTEXT', 'AFFINITY_AMPLIFICATION',
  'STRONG_SPECIALIZATION', 'BUILD_DEFINING_CAPABILITY'];
const CURRENT_WEIGHT = new Map([['fulfills', 8], ['inflicts', 8], ['creates', 8],
  ['provides', 7], ['generates', 7], ['consumes', 7], ['converts', 7],
  ['has_property', 5], ['modifies', 4]]);

const arr = (value) => Array.isArray(value) ? value : [];
const token = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const normalizeWeapon = (value) => {
  const family = token(value).replace(/^(one|two)_handed_/, '');
  return [...FAMILY_MAP.keys()].find((key) => token(key) === family) || '';
};
const familyOf = (entity) => {
  const equipment = entity?.compatibility?.equipment || {};
  const terms = [equipment.slot, equipment.base, equipment.weapon_family].map(token);
  const known = new Set([...FAMILY_MAP.values()].flatMap((families) => [...families]));
  const matches = (family) => terms.some((term) => term === family || term.startsWith(`${family}_`)
    || term.endsWith(`_${family}`) || term.includes(`_${family}_`));
  return { primary: [...known].find(matches) || '', offhand: [...OFF_HAND].find(matches) || '',
    slot: equipment.slot || '', base: equipment.base || '' };
};

function legalForWeapon(entity, weapon) {
  const family = familyOf(entity); const allowed = FAMILY_MAP.get(normalizeWeapon(weapon));
  if (!allowed) return false;
  return allowed.has(family.primary) || (ONE_HANDED.has(normalizeWeapon(weapon)) && OFF_HAND.has(family.offhand));
}

function categoryFor(fact, offense) {
  const relation = token(fact.relation); const mechanic = token(relation === 'converts' ? fact.to : fact.mechanic);
  const from = token(fact.from); const to = token(fact.to);
  const evidenceText = arr(fact.evidence).map((entry) => String(entry?.value || '')).join(' ');
  // Incoming conversion and self/conditional ailment state remain useful facts,
  // but can never be promoted as offensive item capabilities.
  if (relation === 'converts' && token(fact.scope) !== 'outgoing') return null;
  if (relation === 'inflicts' && (token(fact.target) === 'self' || token(fact.scope) === 'incoming'
    || token(fact.application) === 'condition')) return null;
  if (['prevents', 'cannot', 'removes', 'replaces'].includes(relation) && fact.scope !== 'incoming'
    && (mechanic === offense || from === offense)) return 'CONTRADICTION_PREVENTION';
  if (relation === 'converts' && from === offense && to !== offense) return 'CONTRADICTION_PREVENTION';
  if (mechanic !== offense) return null;
  // An enemy-state condition is payoff evidence even when an upstream extractor
  // has over-broadly labelled the line as application (for example, piercing
  // enemies that are already Ignited).
  if (/(?:against|affected by|all\s+\w+\s+enemies|while\s+\w+ed|if\s+\w+ed)/i.test(evidenceText)) return 'PAYOFF_CONTEXT';
  if (['inflicts', 'creates', 'fulfills'].includes(relation) || (relation === 'converts' && to === offense)) return 'BUILD_DEFINING_CAPABILITY';
  if (['provides', 'generates'].includes(relation)) return 'STRONG_SPECIALIZATION';
  if (['consumes', 'requires'].includes(relation)) return 'PAYOFF_CONTEXT';
  if (['modifies', 'has_property'].includes(relation)) return 'AFFINITY_AMPLIFICATION';
  return null;
}

function evidenceRecord(fact, offense, sourceType, sourceName, parentId, component = null, sourceEntityId = null) {
  const category = categoryFor(fact, offense);
  if (!category) return null;
  const evidence = arr(fact.evidence)[0];
  return {
    category, relation: token(fact.relation), mechanic: token(fact.mechanic) || null,
    from: token(fact.from) || null, to: token(fact.to) || null,
    confidence: fact.confidence || 'strong', scope: token(fact.scope) || null,
    target: token(fact.target) || null, delivery: token(fact.delivery) || null,
    application: token(fact.application) || null,
    provenance: { parentUniqueId: parentId, sourceType, sourceName, sourceEntityId: sourceEntityId || parentId,
      component: component || (String(evidence?.value || '').match(/explod|cloud|ground|burst|projectile/i)?.[0]?.toLowerCase() || null),
      evidenceKind: evidence?.kind || null }
  };
}

function typedModifierFacts(lines, offense) {
  const label = offense.replace('_', ' '); const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${escaped}\\b`, 'i');
  return arr(lines).flatMap((line) => {
    if (!rx.test(line)) return [];
    let relation = null;
    if (/cannot|prevents?|removes?/i.test(line)) relation = 'prevents';
    else if (/inflict|chance to (?:ignite|bleed|poison|chill|freeze|shock|electrocute)/i.test(line)) relation = 'inflicts';
    else if (/convert(?:ed|s)? .* to /i.test(line)) relation = 'converts';
    else if (/adds? |gain .* as extra|penetrat|exposure/i.test(line)) relation = 'provides';
    else if (/increased|more|magnitude|effect|reduced resistance/i.test(line)) relation = 'modifies';
    else if (/against|while|when |if |consum|all .* enemies|affected by/i.test(line)) relation = 'requires';
    if (!relation) return [];
    const fact = { relation, mechanic: offense, confidence: 'strong', evidence: [{ kind: 'unique_modifier', value: line }] };
    if (relation === 'converts') {
      const conversion = line.match(/(?:convert(?:ed|s)?).*?\b(physical|fire|cold|lightning|chaos)\b.*?\bto\s+(physical|fire|cold|lightning|chaos)\b/i);
      if (!conversion) return [];
      fact.from = token(conversion[1]); fact.to = token(conversion[2]); delete fact.mechanic;
    }
    return [fact];
  });
}

function analyzeWholeUnique(entity, offense, sources = {}) {
  const raw = sources.rawByKey?.get(entity.source_id) || {};
  const records = [];
  const add = (fact, type, name, component, sourceEntityId) => {
    const record = evidenceRecord(fact, offense, type, name, entity.id, component, sourceEntityId);
    if (record) records.push(record);
  };
  for (const fact of arr(entity.facts)) add(fact, 'item_fact', entity.name);
  if (sources.parseRawModifiers !== false) for (const fact of typedModifierFacts(
    [...arr(raw.implicit_mods), ...arr(raw.explicit_mods)], offense)) add(fact, 'item_modifier', entity.name);
  const grantedNames = new Set(arr(raw.granted_skills).map((skill) => skill.name));
  for (const fact of arr(entity.granted_effects)) add(fact, 'granted_effect', entity.name);
  for (const name of [...grantedNames].sort()) {
    for (const granted of arr(sources.entitiesByName?.get(name))) {
      for (const fact of arr(granted.facts)) add(fact, 'granted_skill', granted.name, null, granted.id);
      for (const effect of arr(granted.source_evidence?.granted_effects)) {
        for (const fact of arr(effect.facts)) add(fact, 'granted_effect', granted.name, null, granted.id);
      }
      for (const component of arr(granted.components)) for (const fact of arr(component.facts)) add(fact, 'nested_component', granted.name, component.name || component.id, component.id || granted.id);
    }
  }
  records.sort((a, b) => TIERS.indexOf(b.category) - TIERS.indexOf(a.category)
    || a.provenance.sourceType.localeCompare(b.provenance.sourceType)
    || a.relation.localeCompare(b.relation));
  const contradiction = records.some((record) => record.category === 'CONTRADICTION_PREVENTION');
  const positive = records.filter((record) => record.category !== 'CONTRADICTION_PREVENTION');
  const bestTier = contradiction ? 'CONTRADICTION_PREVENTION' : positive[0]?.category || null;
  const tierIndex = bestTier ? TIERS.indexOf(bestTier) : -1;
  const proposedScore = contradiction ? -1 : tierIndex * 100 + positive.filter((record) => record.category === bestTier).length * 5
    + new Set(positive.map((record) => record.provenance.sourceType)).size;
  const currentFacts = arr(entity.facts).filter((fact) => categoryFor(fact, offense)
    && categoryFor(fact, offense) !== 'CONTRADICTION_PREVENTION');
  return { records, contradiction, bestTier, proposedScore,
    currentScore: currentFacts.reduce((sum, fact) => sum + (CURRENT_WEIGHT.get(token(fact.relation)) || 0), 0),
    currentEligible: currentFacts.length > 0 && !contradiction,
    grantedMaterial: positive.some((record) => ['granted_skill', 'granted_effect', 'nested_component'].includes(record.provenance.sourceType))
      && !currentFacts.some((fact) => ['inflicts', 'creates', 'fulfills', 'converts'].includes(token(fact.relation))) };
}

function rankCandidates(candidates) {
  return [...candidates].filter((candidate) => candidate.bestTier && !candidate.contradiction)
    .sort((a, b) => b.proposedScore - a.proposedScore || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function qualityBand(ranked) {
  if (!ranked.length) return [];
  const bestTier = ranked[0].bestTier; const floor = ranked[0].proposedScore - 10;
  return ranked.filter((candidate) => candidate.bestTier === bestTier && candidate.proposedScore >= floor).slice(0, 3);
}

function classifyEmpty(ranked, legalCount) {
  if (!legalCount) return 'WEAPON_FAMILY_FILTERING';
  if (!ranked.length) return 'GENUINELY_NO_RELEVANT_UNIQUE';
  if (ranked[0].grantedMaterial) return 'MISSING_GRANTED_SEMANTICS';
  if (ranked[0].bestTier === 'BUILD_DEFINING_CAPABILITY') return 'MISSING_APPLICATION_OR_CONVERSION_PARSING';
  if (ranked[0].bestTier === 'PAYOFF_CONTEXT') return 'PAYOFF_ONLY_NOT_CAPABILITY';
  return 'ITEM_SEMANTIC_DATA_INCOMPLETENESS';
}

function compactUniqueSemantics(catalog, rawItems, offenses) {
  const entitiesByName = new Map();
  for (const entity of arr(catalog?.entities)) {
    const entries = entitiesByName.get(entity.name) || []; entries.push(entity); entitiesByName.set(entity.name, entries);
  }
  const rawByKey = new Map(Object.values(rawItems || {}).map((item) => [item.key, item]));
  const byUniqueId = {};
  let promotedFactCount = 0; let enrichedUniqueCount = 0;
  for (const entity of arr(catalog?.entities).filter((entry) => entry.content_type === 'unique')) {
    const byOffense = {};
    for (const offense of offenses) {
      const result = analyzeWholeUnique(entity, offense, { rawByKey, entitiesByName, parseRawModifiers: false });
      if (!result.bestTier) continue;
      const facts = result.records.map((record) => ({
        c: record.category, r: record.relation, ...(record.mechanic ? { m: record.mechanic } : {}),
        ...(record.from ? { f: record.from } : {}), ...(record.to ? { t: record.to } : {}), ...(record.scope ? { s: record.scope } : {}),
        ...(record.target ? { a: record.target } : {}), ...(record.delivery ? { d: record.delivery } : {}),
        ...(record.application ? { q: record.application } : {}),
        k: record.provenance.sourceType,
        ...(record.provenance.sourceEntityId !== entity.id ? { e: record.provenance.sourceEntityId } : {}),
        ...(record.provenance.component ? { p: record.provenance.component } : {})
      }));
      byOffense[offense] = { tier: result.bestTier, strength: result.proposedScore, facts };
      promotedFactCount += facts.filter((fact) => ['granted_skill', 'granted_effect', 'nested_component'].includes(fact.k)).length;
    }
    if (Object.keys(byOffense).length) {
      byUniqueId[entity.source_id] = byOffense;
      if (Object.values(byOffense).some((entry) => entry.facts.some((fact) =>
        ['granted_skill', 'granted_effect', 'nested_component'].includes(fact.k)))) enrichedUniqueCount += 1;
    }
  }
  return { schemaVersion: 'recommendation-unique-semantics-v3.0.0', enrichedUniqueCount,
    promotedFactCount, byUniqueId };
}

export { FAMILY_MAP, TIERS, analyzeWholeUnique, classifyEmpty, familyOf, legalForWeapon,
  normalizeWeapon, qualityBand, rankCandidates, typedModifierFacts, compactUniqueSemantics };
