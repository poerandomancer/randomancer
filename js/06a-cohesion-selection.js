// Shared cohesion selection helpers for Randomancer build components.

const COHESION_WEIGHT_STRENGTH = 4.0;

function clampCohesion(value, fallback = 0.75){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeAffinity(attrs){
  const strength = Math.max(0, Number(attrs?.strength) || 0);
  const dexterity = Math.max(0, Number(attrs?.dexterity) || 0);
  const intelligence = Math.max(0, Number(attrs?.intelligence) || 0);
  const total = strength + dexterity + intelligence;
  if (!total) return { strength: 0, dexterity: 0, intelligence: 0 };
  return {
    strength: strength / total,
    dexterity: dexterity / total,
    intelligence: intelligence / total
  };
}

function attributeOverlap(a, b){
  const A = normalizeAffinity(a);
  const B = normalizeAffinity(b);
  return Math.min(A.strength, B.strength)
    + Math.min(A.dexterity, B.dexterity)
    + Math.min(A.intelligence, B.intelligence);
}

function baseSelectionWeight(item){
  const raw = Number(item?.baseWeight);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, raw);
}

function weightedRandom(list, weightFn){
  if (!Array.isArray(list) || !list.length) return null;
  const weights = list.map((item) => {
    const raw = Number(weightFn(item));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return list[Math.floor(Math.random() * list.length)] || null;

  let cursor = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return list[i];
  }
  return list[list.length - 1] || null;
}

function cohesionSelectionWeight(item, base, cohesion){
  const baseWeight = baseSelectionWeight(item);
  if (!(baseWeight > 0)) return 0;
  const t = clampCohesion(cohesion);
  const overlap = attributeOverlap(base, item?.attributes || {});
  return baseWeight * Math.exp(COHESION_WEIGHT_STRENGTH * t * overlap);
}

function pickByWeightedCohesion(list, base, cohesion){
  if (!Array.isArray(list) || !list.length) return null;
  const t = clampCohesion(cohesion);

  // Madness ignores affinity while still respecting an explicit base frequency.
  if (t === 0) return weightedRandom(list, baseSelectionWeight);

  // Selection-neutral entries keep their raw base-weight share regardless of
  // cohesion; the remaining entries compete through soft affinity weights.
  const neutral = list.filter((item) => item?.cohesionNeutral === true);
  const attributed = list.filter((item) => item?.cohesionNeutral !== true);
  if (!attributed.length) return weightedRandom(neutral, baseSelectionWeight);

  if (neutral.length) {
    const neutralWeight = neutral.reduce((sum, item) => sum + baseSelectionWeight(item), 0);
    const attributedWeight = attributed.reduce((sum, item) => sum + baseSelectionWeight(item), 0);
    const rawTotal = neutralWeight + attributedWeight;
    if (rawTotal > 0 && Math.random() < neutralWeight / rawTotal) {
      return weightedRandom(neutral, baseSelectionWeight);
    }
  }

  return weightedRandom(attributed, (item) => cohesionSelectionWeight(item, base, t));
}

function circularRingDistance(a, b, ringSize){
  const size = Math.max(1, Math.floor(Number(ringSize) || 0));
  const left = Math.max(0, Math.min(size - 1, Math.floor(Number(a) || 0)));
  const right = Math.max(0, Math.min(size - 1, Math.floor(Number(b) || 0)));
  const direct = Math.abs(left - right);
  return Math.min(direct, size - direct);
}

function cohesionRingRadius(cohesion, ringSize = 6){
  const t = clampCohesion(cohesion);
  const maxDistance = Math.floor(Math.max(1, Number(ringSize) || 1) / 2);

  // Primary structural rings use deliberate eligibility bands:
  // > .75: home only; .75 -> .50: adjacent; <= .50: distance two;
  // exact Madness unlocks the direct opposite as well.
  if (t === 0) return maxDistance;
  if (t <= 0.5) return Math.min(2, maxDistance);
  if (t <= 0.75) return Math.min(1, maxDistance);
  return 0;
}

function cohesionRingSelectionWeight(item, distance, cohesion, ringSize = 6){
  const baseWeight = baseSelectionWeight(item);
  if (!(baseWeight > 0)) return 0;
  const t = clampCohesion(cohesion);
  const maxDistance = Math.max(1, Math.floor(Math.max(1, Number(ringSize) || 1) / 2));
  const d = Math.max(0, Math.min(maxDistance, Number(distance) || 0));
  const closeness = 1 - (d / maxDistance);
  return baseWeight * Math.exp(COHESION_WEIGHT_STRENGTH * t * closeness);
}

function pickByRingCohesion(list, ringNames, homeIndex, cohesion){
  if (!Array.isArray(list) || !list.length) return null;
  if (!Array.isArray(ringNames) || ringNames.length < 2) return null;
  if (!Number.isInteger(homeIndex) || homeIndex < 0 || homeIndex >= ringNames.length) return null;

  const indexByName = new Map(ringNames.map((name, index) => [String(name), index]));
  const candidates = list.map((item) => {
    const index = indexByName.get(String(item?.name || ''));
    if (!Number.isInteger(index)) return null;
    return {
      item,
      distance: circularRingDistance(homeIndex, index, ringNames.length)
    };
  }).filter(Boolean);
  if (!candidates.length) return null;

  const t = clampCohesion(cohesion);
  const radius = cohesionRingRadius(t, ringNames.length);
  let eligible = candidates.filter((entry) => entry.distance <= radius);

  // Hard game compatibility and explicit user Fates are applied before this
  // selector. If they remove the entire in-radius pool, honor those constraints
  // by using only the nearest remaining legal ring distance rather than failing.
  if (!eligible.length) {
    const nearest = Math.min(...candidates.map((entry) => entry.distance));
    eligible = candidates.filter((entry) => entry.distance === nearest);
  }

  const picked = weightedRandom(
    eligible,
    (entry) => cohesionRingSelectionWeight(entry.item, entry.distance, t, ringNames.length)
  );
  return picked?.item || null;
}

export {
  COHESION_WEIGHT_STRENGTH,
  clampCohesion,
  normalizeAffinity,
  attributeOverlap,
  baseSelectionWeight,
  cohesionSelectionWeight,
  pickByWeightedCohesion,
  circularRingDistance,
  cohesionRingRadius,
  cohesionRingSelectionWeight,
  pickByRingCohesion
};
