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
  if (record.card_kind !== 'build') throw new Error('Shared card type is unsupported.');
  if (!isRecord(record.payload)) throw new Error('Shared card payload was invalid.');
  return record;
}

function hydrateSharedBuildCard(payload) {
  const draw = isRecord(payload?.snapshot) ? payload.snapshot : null;
  if (!draw || draw.schema !== 'randomancer-draw-v1') throw new Error('Shared draw schema is unsupported.');
  return cloneJsonSafe(draw);
}


export {
  validatePublicCardRecord,
  hydrateSharedBuildCard,
};
