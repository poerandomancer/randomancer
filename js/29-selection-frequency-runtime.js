import { validOffhands } from './06-cohesion.js';

// Transitional standard-Build frequency adapter.
// Base frequency is intentionally independent from STR/DEX/INT affinity.

const UNARMED_BASE_WEIGHT = 0.40;

function currentFamilyDefinitions(){
  const direct = window.RandomancerEquipmentFamilies;
  if (Array.isArray(direct) && direct.length) return direct;
  const dataFamilies = window.DATA?.WeaponFamilies;
  return Array.isArray(dataFamilies) ? dataFamilies : [];
}

function unarmedDefinition(){
  return currentFamilyDefinitions().find((entry) => entry?.name === 'Unarmed') || null;
}

function makeUnarmedCandidate(){
  const source = unarmedDefinition();
  return {
    name: 'Unarmed',
    tags: Array.isArray(source?.tags) ? [...source.tags] : ['unarmed', 'melee', 'quarterstaff'],
    attributes: { ...(source?.attributes || { dexterity: 0.5, intelligence: 0.5 }) },
    equipmentFamilyId: source?.id || 'unarmed',
    baseWeight: UNARMED_BASE_WEIGHT
  };
}

function syncFamilyCompatibility(){
  const source = unarmedDefinition();
  if (Array.isArray(source?.legacyOffhands) && source.legacyOffhands.length) {
    validOffhands.Unarmed = [...source.legacyOffhands];
  }
}

function applyPrimaryFamilyBaseWeights(){
  const pool = window.DATA?.Weapons?.['Two-Handed'];
  if (!Array.isArray(pool)) return;

  const abominations = new Set(window.App?.getBindFates?.()?.weapon?.abominations || []);
  let unarmed = pool.find((entry) => entry?.name === 'Unarmed') || null;

  // The preceding family adapter historically made Unarmed rare by sometimes
  // omitting it from the pool. Under weighted cohesion it stays legal and rarity
  // is represented directly by baseWeight instead.
  if (!abominations.has('Unarmed')) {
    if (!unarmed) {
      unarmed = makeUnarmedCandidate();
      pool.push(unarmed);
    }
    unarmed.baseWeight = UNARMED_BASE_WEIGHT;
    syncFamilyCompatibility();
  } else {
    delete validOffhands.Unarmed;
  }

  const definitions = new Map(currentFamilyDefinitions().map((entry) => [entry?.name, entry]));
  for (const candidate of pool) {
    if (!candidate?.name || candidate.name === 'Unarmed') continue;
    const configured = Number(definitions.get(candidate.name)?.baseWeight);
    if (Number.isFinite(configured) && configured >= 0) candidate.baseWeight = configured;
  }
}

function installFrequencyAdapter(){
  if (window.__randomancerFrequencyAdapterInstalled) return;
  window.__randomancerFrequencyAdapterInstalled = true;

  const priorPrepare = window.RandomancerPrepareBuildRoll;
  window.RandomancerPrepareBuildRoll = (...args) => {
    const result = priorPrepare?.(...args);
    applyPrimaryFamilyBaseWeights();
    return result;
  };
}

document.addEventListener('DOMContentLoaded', installFrequencyAdapter);

export { UNARMED_BASE_WEIGHT, applyPrimaryFamilyBaseWeights };
