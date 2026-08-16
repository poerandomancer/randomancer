import { validOffhands } from './06-cohesion.js';

// Transitional standard-Build frequency adapter.
// Base frequency is intentionally independent from STR/DEX/INT affinity.

function currentFamilyDefinitions(){
  const direct = window.RandomancerEquipmentFamilies;
  if (Array.isArray(direct) && direct.length) return direct;
  const dataFamilies = window.DATA?.WeaponFamilies;
  return Array.isArray(dataFamilies) ? dataFamilies : [];
}

function applyPrimaryFamilyBaseWeights(){
  const pool = window.DATA?.Weapons?.['Two-Handed'];
  if (!Array.isArray(pool)) return;

  // Unarmed remains meaningful to skill and equipment semantics, but it is too
  // specialized to be synthesized as a standard randomized weapon family.
  for (let index = pool.length - 1; index >= 0; index -= 1) {
    if (pool[index]?.name === 'Unarmed') pool.splice(index, 1);
  }
  delete validOffhands.Unarmed;

  const definitions = new Map(currentFamilyDefinitions().map((entry) => [entry?.name, entry]));
  for (const candidate of pool) {
    if (!candidate?.name) continue;
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

export { applyPrimaryFamilyBaseWeights };
