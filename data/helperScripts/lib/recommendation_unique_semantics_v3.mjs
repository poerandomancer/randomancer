const TIERS = ['CONTRADICTION_PREVENTION', 'PAYOFF_CONTEXT', 'AFFINITY_AMPLIFICATION',
  'STRONG_SPECIALIZATION', 'BUILD_DEFINING_CAPABILITY'];
const arr = (value) => Array.isArray(value) ? value : [];
const token = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function categoryFor(fact, offense) {
  const relation = token(fact.relation); const mechanic = token(relation === 'converts' ? fact.to : fact.mechanic);
  const from = token(fact.from); const to = token(fact.to);
  const evidenceText = arr(fact.evidence).map((entry) => String(entry?.value || '')).join(' ');
  if (relation === 'converts' && token(fact.scope) !== 'outgoing') return null;
  if (relation === 'inflicts' && (token(fact.target) === 'self' || token(fact.scope) === 'incoming'
    || token(fact.application) === 'condition')) return null;
  if (['prevents', 'cannot', 'removes', 'replaces'].includes(relation) && fact.scope !== 'incoming'
    && (mechanic === offense || from === offense)) return 'CONTRADICTION_PREVENTION';
  if (relation === 'converts' && from === offense && to !== offense) return 'CONTRADICTION_PREVENTION';
  if (mechanic !== offense) return null;
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
    scope: token(fact.scope) || null, target: token(fact.target) || null,
    delivery: token(fact.delivery) || null, application: token(fact.application) || null,
    condition: token(fact.condition) || null, conditionTarget: token(fact.condition_target) || null,
    provenance: { sourceType, sourceEntityId: sourceEntityId || parentId,
      component: component || (String(evidence?.value || '').match(/explod|cloud|ground|burst|projectile/i)?.[0]?.toLowerCase() || null) }
  };
}

function analyzeUnique(entity, offense, sources) {
  const raw = sources.rawByKey.get(entity.source_id) || {};
  const records = [];
  const add = (fact, type, name, component, sourceEntityId) => {
    const record = evidenceRecord(fact, offense, type, name, entity.id, component, sourceEntityId);
    if (record) records.push(record);
  };
  for (const fact of arr(entity.facts)) add(fact, 'item_fact', entity.name);
  for (const fact of arr(entity.granted_effects)) add(fact, 'granted_effect', entity.name);
  for (const name of [...new Set(arr(raw.granted_skills).map((skill) => skill.name))].sort()) {
    for (const granted of arr(sources.entitiesByName.get(name))) {
      for (const fact of arr(granted.facts)) add(fact, 'granted_skill', granted.name, null, granted.id);
      for (const effect of arr(granted.source_evidence?.granted_effects)) {
        for (const fact of arr(effect.facts)) add(fact, 'granted_effect', granted.name, null, granted.id);
      }
      for (const component of arr(granted.components)) {
        for (const fact of arr(component.facts)) add(fact, 'nested_component', granted.name,
          component.name || component.id, component.id || granted.id);
      }
    }
  }
  records.sort((a, b) => TIERS.indexOf(b.category) - TIERS.indexOf(a.category)
    || a.provenance.sourceType.localeCompare(b.provenance.sourceType) || a.relation.localeCompare(b.relation));
  const contradiction = records.some((record) => record.category === 'CONTRADICTION_PREVENTION');
  const positive = records.filter((record) => record.category !== 'CONTRADICTION_PREVENTION');
  const bestTier = contradiction ? 'CONTRADICTION_PREVENTION' : positive[0]?.category || null;
  const strength = bestTier === 'CONTRADICTION_PREVENTION' ? -1
    : TIERS.indexOf(bestTier) * 100 + positive.filter((record) => record.category === bestTier).length * 5
      + new Set(positive.map((record) => record.provenance.sourceType)).size;
  return { records, bestTier, strength };
}

export function compactUniqueSemantics(catalog, rawItems, offenses) {
  const entitiesByName = new Map();
  for (const entity of arr(catalog?.entities)) {
    const entries = entitiesByName.get(entity.name) || []; entries.push(entity); entitiesByName.set(entity.name, entries);
  }
  const sources = { entitiesByName, rawByKey: new Map(Object.values(rawItems || {}).map((item) => [item.key, item])) };
  const byUniqueId = {}; let promotedFactCount = 0; let enrichedUniqueCount = 0;
  for (const entity of arr(catalog?.entities).filter((entry) => entry.content_type === 'unique')) {
    const byOffense = {};
    for (const offense of offenses) {
      const result = analyzeUnique(entity, offense, sources);
      if (!result.bestTier) continue;
      const facts = result.records.map((record) => ({
        c: record.category, r: record.relation, ...(record.mechanic ? { m: record.mechanic } : {}),
        ...(record.from ? { f: record.from } : {}), ...(record.to ? { t: record.to } : {}),
        ...(record.scope ? { s: record.scope } : {}), ...(record.target ? { a: record.target } : {}),
        ...(record.delivery ? { d: record.delivery } : {}), ...(record.application ? { q: record.application } : {}),
        ...(record.condition ? { h: record.condition } : {}), ...(record.conditionTarget ? { x: record.conditionTarget } : {}),
        k: record.provenance.sourceType,
        ...(record.provenance.sourceEntityId !== entity.id ? { e: record.provenance.sourceEntityId } : {}),
        ...(record.provenance.component ? { p: record.provenance.component } : {})
      }));
      byOffense[offense] = { tier: result.bestTier, strength: result.strength, facts };
      promotedFactCount += facts.filter((fact) => ['granted_skill', 'granted_effect', 'nested_component'].includes(fact.k)).length;
    }
    if (Object.keys(byOffense).length) {
      byUniqueId[entity.source_id] = byOffense;
      if (Object.values(byOffense).some((entry) => entry.facts.some((fact) =>
        ['granted_skill', 'granted_effect', 'nested_component'].includes(fact.k)))) enrichedUniqueCount += 1;
    }
  }
  return { schemaVersion: 'recommendation-unique-semantics-v3.0.0', enrichedUniqueCount, promotedFactCount, byUniqueId };
}
