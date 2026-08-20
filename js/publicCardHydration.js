import { PUBLIC_CARD_SCHEMA_VERSION } from './publicCardBuilders.js';

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {}
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validatePublicCardRecord(record) {
  if (!isRecord(record)) throw new Error('Shared card response was invalid.');
  if (record.schema_version !== PUBLIC_CARD_SCHEMA_VERSION) throw new Error('Shared card schema is unsupported.');
  if (record.card_kind !== 'build' && record.card_kind !== 'challenge') throw new Error('Shared card type is unsupported.');
  if (!isRecord(record.payload)) throw new Error('Shared card payload was invalid.');
  return record;
}

function hydrateSharedBuildCard(payload) {
  const draw = isRecord(payload?.snapshot) ? payload.snapshot : null;
  if (!draw || draw.schema !== 'randomancer-draw-v1') throw new Error('Shared draw schema is unsupported.');
  return cloneJsonSafe(draw);
}

function hydrateSharedChallengeCard(payload) {
  const contract = isRecord(payload?.contract) ? payload.contract : null;
  if (!contract) throw new Error('Shared challenge payload was invalid.');
  return cloneJsonSafe({
    mode: 'challenge',
    title: contract.title || '',
    subtitle: contract.subtitle || '',
    severity: contract.severity || 'cruel',
    taskCount: Number(contract.taskCount) || 2,
    tasks: Array.isArray(contract.tasks) ? contract.tasks : [],
    challengeFates: isRecord(contract.challengeFates)
      ? contract.challengeFates
      : { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } }
  });
}

export {
  validatePublicCardRecord,
  hydrateSharedBuildCard,
  hydrateSharedChallengeCard,
};
