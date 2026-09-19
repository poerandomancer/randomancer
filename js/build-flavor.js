import { buildPresentationContext } from './build-presentation-context.js';

const GENERIC_BUILD_FLAVOR = 'Some paths are walked. Others are carved.';
const lines = (value) => Array.isArray(value) ? value.filter((line) => typeof line === 'string' && line.trim()).map((line) => line.trim()) : [];

function seededRandom(seed) {
  if (seed == null || seed === '') return null;
  let state = 2166136261;
  for (const character of String(seed)) { state ^= character.codePointAt(0); state = Math.imul(state, 16777619); }
  return () => ((state = Math.imul(state ^ (state >>> 15), 2246822519)) >>> 0) / 4294967296;
}

function chooseWeighted(pools, random) {
  const total = pools.reduce((sum, pool) => sum + pool.weight, 0);
  if (!total) return null;
  let point = Math.min(.999999999, Math.max(0, Number(random()) || 0)) * total;
  for (const pool of pools) { point -= pool.weight; if (point < 0) return pool; }
  return pools.at(-1);
}

/** Select one complete authored phrase; phrases are never combined or modified. */
function selectBuildFlavor(manifest, rawContext = {}, options = {}) {
  const data = manifest?.build_flavor;
  if (!data || typeof data !== 'object') return GENERIC_BUILD_FLAVOR;
  const context = buildPresentationContext(rawContext);
  const weights = data.settings?.poolWeights || {};
  const offenseLines = [
    ...lines(data.offenseOverrides?.[context.offense.raw]),
    ...lines(data.offenseFamilies?.[context.offense.family])
  ];
  const candidates = [
    { type: 'combination', values: lines(data.combinations?.[`${context.ascendancy}:${context.offense.family}`]) },
    { type: 'ascendancy', values: lines(data.ascendancies?.[context.ascendancy]) },
    { type: 'offense', values: offenseLines },
    { type: 'weapon', values: lines(data.weapons?.[context.weapon.key]) },
    { type: 'class', values: lines(data.classes?.[context.className]) }
  ].map((pool) => ({ ...pool, weight: Math.max(0, Number(weights[pool.type]) || 0) }))
    .filter((pool) => pool.values.length && pool.weight > 0);
  const random = seededRandom(options.seed ?? rawContext.seed) || options.random || rawContext.random || Math.random;
  const pool = chooseWeighted(candidates, random);
  if (pool) return pool.values[Math.floor(Math.min(.999999999, Math.max(0, Number(random()) || 0)) * pool.values.length)];
  const classFallback = lines(data.classes?.[context.className]);
  const fallback = classFallback.length ? classFallback : lines(data.fallback);
  return fallback.length ? fallback[Math.floor(Math.min(.999999999, Math.max(0, Number(random()) || 0)) * fallback.length)] : GENERIC_BUILD_FLAVOR;
}

export { GENERIC_BUILD_FLAVOR, selectBuildFlavor };
