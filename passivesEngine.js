// Passive recommendation engine for Randomancer.
// Pure functions for scoring and selecting passive nodes based on build context and cohesion mode.

/**
 * @typedef {"strict" | "cohesive" | "chaotic" | "madness"} CohesionMode
 *
 * @typedef {Object} RawStat
 * @property {number} rid
 * @property {string} id
 * @property {number} value
 * @property {number|null} semantic
 * @property {number|null} category
 *
 * @typedef {"keystone" | "ascendancy" | "notable"} PassiveType
 *
 * @typedef {Object} PassiveNode
 * @property {string} id
 * @property {PassiveType} type
 * @property {string} name
 * @property {number|null} ascendancyId
 * @property {string|null} ascendancy
 * @property {string|null} icon
 * @property {string[]} lines
 * @property {string[]} tags
 * @property {string} flavour
 * @property {RawStat[]} rawStats
 *
 * @typedef {Object} PassivesData
 * @property {PassiveNode[]} nodes
 * @property {Object.<string, { id: number; name: string }>} ascendancies
 *
 * @typedef {Object} PassiveIndex
 * @property {Map<string, PassiveNode[]>} byAscendancyName
 * @property {PassiveNode[]} keystones
 * @property {PassiveNode[]} notables
 * @property {PassiveNode[]} ascendancyNodes
 *
 * @typedef {Object} BuildContext
 * @property {number|null} ascendancyId
 * @property {string|null} ascendancyName
 * @property {string[]} tags
 * @property {string[]} defenseTags
 * @property {{ strength: number; dexterity: number; intelligence: number }} attributes
 * @property {CohesionMode} cohesionMode
 */

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const normalizeTags = (list) => (Array.isArray(list) ? list.map((t) => String(t).toLowerCase()) : []);

const computeTagOverlap = (nodeTags, buildTags) => {
  if (!Array.isArray(nodeTags) || nodeTags.length === 0) return 0;
  if (!Array.isArray(buildTags) || buildTags.length === 0) return 0;
  const buildSet = new Set(normalizeTags(buildTags));
  const shared = normalizeTags(nodeTags).reduce((acc, tag) => (buildSet.has(tag) ? acc + 1 : acc), 0);
  return clamp01(shared / Math.max(nodeTags.length, 1));
};

const computeAscendancyAffinity = (node, ctx) => {
  if (!node || node.type !== 'ascendancy') return 0;
  if (ctx.ascendancyId == null) return 0;
  return node.ascendancyId === ctx.ascendancyId ? 1 : 0;
};

const ATTRIBUTE_HINTS = {
  strength: new Set([
    'armour',
    'physical',
    'life',
    'melee',
    'slam',
    'leech',
    'warcry',
  ]),
  dexterity: new Set([
    'evasion',
    'bow',
    'trap',
    'traps',
    'mine',
    'mines',
    'attack',
    'accuracy',
  ]),
  intelligence: new Set([
    'energy shield',
    'spell',
    'chaos',
    'curses',
    'minions',
    'mana',
  ]),
};

const computeAttributeAffinity = (nodeTags, attributes) => {
  if (!Array.isArray(nodeTags) || nodeTags.length === 0) return 0;
  let str = 0;
  let dex = 0;
  let int = 0;
  normalizeTags(nodeTags).forEach((tag) => {
    if (ATTRIBUTE_HINTS.strength.has(tag)) str += 1;
    if (ATTRIBUTE_HINTS.dexterity.has(tag)) dex += 1;
    if (ATTRIBUTE_HINTS.intelligence.has(tag)) int += 1;
  });
  const total = str + dex + int;
  if (total <= 0) return 0;
  const nodeStr = str / total;
  const nodeDex = dex / total;
  const nodeInt = int / total;
  const affinity =
    nodeStr * (attributes?.strength ?? 0) +
    nodeDex * (attributes?.dexterity ?? 0) +
    nodeInt * (attributes?.intelligence ?? 0);
  return clamp01(affinity);
};

/**
 * Score a passive node against the build context in [0,1].
 * @param {PassiveNode} node
 * @param {BuildContext} ctx
 * @returns {number}
 */
export function scorePassiveNode(node, ctx) {
  const nodeTags = Array.isArray(node?.tags) ? node.tags : [];
  const overlapRatio = computeTagOverlap(nodeTags, ctx?.tags || []);
  const ascendancyAffinity = computeAscendancyAffinity(node, ctx || {});
  const defenseRatio = computeTagOverlap(nodeTags, ctx?.defenseTags || []);
  const attributeAffinity = computeAttributeAffinity(nodeTags, ctx?.attributes || {});

  const wTags = 0.55;
  const wAsc = 0.25;
  const wDef = 0.15;
  const wAttr = 0.05;

  const scoreRaw =
    wTags * overlapRatio +
    wAsc * ascendancyAffinity +
    wDef * defenseRatio +
    wAttr * attributeAffinity;

  return clamp01(scoreRaw);
}

const weightedPick = (pool, weightFn, rng) => {
  const total = pool.reduce((acc, item) => acc + Math.max(0, weightFn(item)), 0);
  if (total <= 0) {
    return pool[Math.floor(rng() * pool.length)] || null;
  }
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= Math.max(0, weightFn(pool[i]));
    if (roll <= 0) {
      return pool[i];
    }
  }
  return pool[pool.length - 1] || null;
};

/**
 * Cohesion-aware selection helper.
 * @template T
 * @param {T[]} candidates
 * @param {Map<T, number>} scores
 * @param {CohesionMode} mode
 * @param {number} count
 * @param {() => number} [rng]
 * @returns {T[]}
 */
export function selectByCohesion(candidates, scores, mode, count, rng = Math.random) {
  if (!Array.isArray(candidates) || candidates.length === 0 || count <= 0) return [];
  const pool = candidates.map((item) => ({ item, score: clamp01(scores.get(item) ?? 0) }));
  const pickWeighted = (list, weightFn) => {
    const available = [...list];
    const results = [];
    while (results.length < count && available.length > 0) {
      const choice = weightedPick(available, weightFn, rng);
      if (!choice) break;
      results.push(choice.item);
      const idx = available.indexOf(choice);
      if (idx >= 0) available.splice(idx, 1);
    }
    return results;
  };

  if (mode === 'strict') {
    const filtered = pool.filter(({ score }) => score >= 0.6).sort((a, b) => b.score - a.score);
    return filtered.slice(0, count).map(({ item }) => item);
  }

  if (mode === 'cohesive') {
    const filtered = pool.filter(({ score }) => score >= 0.3);
    const source = filtered.length > 0 ? filtered : pool;
    return pickWeighted(source, ({ score }) => Math.pow(score, 2)).slice(0, count);
  }

  if (mode === 'chaotic') {
    const filtered = pool.filter(({ score }) => score >= 0.1);
    const source = filtered.length > 0 ? filtered : pool;
    return pickWeighted(source, ({ score }) => 0.3 + score).slice(0, count);
  }

  // madness
  return pickWeighted(pool, ({ score }) => 1 + 0.2 * score).slice(0, count);
}

const buildScoreMap = (nodes, ctx) => {
  const map = new Map();
  (nodes || []).forEach((node) => map.set(node, scorePassiveNode(node, ctx)));
  return map;
};

/**
 * @param {PassivesData} passivesData
 * @param {PassiveIndex|null} passiveIndex
 * @param {BuildContext} ctx
 * @param {number} [count]
 * @returns {PassiveNode[]}
 */
export function pickRecommendedAscendancyNodes(passivesData, passiveIndex, ctx, count = 4) {
  if (!ctx || ctx.ascendancyId == null) return [];
  const byName = passiveIndex?.byAscendancyName?.get?.(ctx.ascendancyName || '') || null;
  const candidates = Array.isArray(byName)
    ? byName
    : (passivesData?.nodes || []).filter(
        (node) => node?.type === 'ascendancy' && node.ascendancyId === ctx.ascendancyId
      );
  if (!candidates.length) return [];
  const scores = buildScoreMap(candidates, ctx);
  return selectByCohesion(candidates, scores, ctx.cohesionMode, count);
}

/**
 * @param {PassivesData} passivesData
 * @param {PassiveIndex|null} passiveIndex
 * @param {BuildContext} ctx
 * @param {number} [count]
 * @returns {PassiveNode[]}
 */
export function pickRecommendedKeystones(passivesData, passiveIndex, ctx, count = 2) {
  const candidates = passiveIndex?.keystones?.length
    ? passiveIndex.keystones
    : (passivesData?.nodes || []).filter((node) => node?.type === 'keystone');
  if (!candidates.length) return [];
  const scores = buildScoreMap(candidates, ctx);
  return selectByCohesion(candidates, scores, ctx.cohesionMode, count);
}

/**
 * @param {PassivesData} passivesData
 * @param {PassiveIndex|null} passiveIndex
 * @param {BuildContext} ctx
 * @param {number} [count]
 * @returns {PassiveNode[]}
 */
export function pickRecommendedNotables(passivesData, passiveIndex, ctx, count = 6) {
  const candidates = passiveIndex?.notables?.length
    ? passiveIndex.notables
    : (passivesData?.nodes || []).filter((node) => node?.type === 'notable');
  if (!candidates.length) return [];
  const scores = new Map();
  candidates.forEach((node) => {
    const base = scorePassiveNode(node, ctx);
    const adjusted = (!node.tags || node.tags.length === 0) && base < 0.05 ? 0 : base;
    scores.set(node, adjusted);
  });
  return selectByCohesion(candidates, scores, ctx.cohesionMode, count);
}

export default {
  scorePassiveNode,
  selectByCohesion,
  pickRecommendedAscendancyNodes,
  pickRecommendedKeystones,
  pickRecommendedNotables,
};
