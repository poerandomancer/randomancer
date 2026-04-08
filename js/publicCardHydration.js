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
  const snapshot = isRecord(payload?.snapshot) ? payload.snapshot : null;
  if (!snapshot) throw new Error('Shared build payload was invalid.');
  return cloneJsonSafe({
    snapshotVersion: Number(snapshot.snapshotVersion) || 1,
    className: snapshot.className || '',
    ascendancy: snapshot.ascendancy || '',
    ascendancyId: snapshot.ascendancyId ?? null,
    defense: snapshot.defense || '',
    defStrat: snapshot.defStrat || '',
    weapon: snapshot.weapon || '',
    offhand: snapshot.offhand || '',
    weapon2: snapshot.weapon2 || '',
    offhand2: snapshot.offhand2 || '',
    ailments: Array.isArray(snapshot.ailments) ? snapshot.ailments.join(' & ') : '',
    tactics: Array.isArray(snapshot.tactics) ? snapshot.tactics.join(' & ') : '',
    ailmentList: Array.isArray(snapshot.ailments) ? snapshot.ailments : [],
    tacticList: Array.isArray(snapshot.tactics) ? snapshot.tactics : [],
    buildName: snapshot.buildName || '',
    flavor: snapshot.flavor || '',
    attributes: snapshot.attributes || { strength: 0, dexterity: 0, intelligence: 0 },
    recommendedSkills: Array.isArray(snapshot.recommendedSkills) ? snapshot.recommendedSkills : [],
    recommendedSkills2: Array.isArray(snapshot.recommendedSkills2) ? snapshot.recommendedSkills2 : [],
    synergySupports: Array.isArray(snapshot.synergySupports) ? snapshot.synergySupports : [],
    synergySupports2: Array.isArray(snapshot.synergySupports2) ? snapshot.synergySupports2 : [],
    recommendedPersistentBuff: snapshot.recommendedPersistentBuff || null,
    recommendedUniques: Array.isArray(snapshot.recommendedUniques) ? snapshot.recommendedUniques : [],
    passives: isRecord(snapshot.passives) ? snapshot.passives : null,
  });
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
