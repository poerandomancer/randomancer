// Passive recommendation engine for Randomancer.
// Pure functions for scoring and selecting passive nodes based on build context and cohesion mode.

export type CohesionMode = "strict" | "cohesive" | "chaotic" | "madness";

export interface RawStat {
  rid: number;
  id: string;
  value: number;
  semantic: number | null;
  category: number | null;
}

export interface PassiveNode {
  id: string;
  type: "keystone" | "ascendancy" | "notable";
  name: string;
  ascendancyId: number | null;
  ascendancy: string | null;
  icon: string | null;
  lines: string[];
  tags: string[];
  flavour: string;
  rawStats: RawStat[];
}

export interface PassivesData {
  nodes: PassiveNode[];
  ascendancies: {
    [id: string]: {
      id: number;
      name: string;
    };
  };
}

export interface BuildContext {
  ascendancyId: number | null;
  tags: string[];
  defenseTags: string[];
  attributes: {
    strength: number;
    dexterity: number;
    intelligence: number;
  };
  cohesionMode: CohesionMode;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const tagOverlapScore = (nodeTags: string[], contextTags: string[]): number => {
  if (nodeTags.length === 0 || contextTags.length === 0) return 0;
  const ctxSet = new Set(contextTags.map((t) => t.toLowerCase()));
  const shared = nodeTags.reduce((count, tag) => (ctxSet.has(tag.toLowerCase()) ? count + 1 : count), 0);
  return clamp01(shared / Math.max(nodeTags.length, 1));
};

const defenseAffinityScore = (nodeTags: string[], defenseTags: string[]): number => {
  if (nodeTags.length === 0 || defenseTags.length === 0) return 0;
  const defSet = new Set(defenseTags.map((t) => t.toLowerCase()));
  const shared = nodeTags.reduce((count, tag) => (defSet.has(tag.toLowerCase()) ? count + 1 : count), 0);
  return clamp01(shared / Math.max(nodeTags.length, 1));
};

const ascendancyAffinityScore = (node: PassiveNode, ctx: BuildContext): number => {
  if (node.type !== "ascendancy") return 0;
  if (ctx.ascendancyId === null) return 0;
  return node.ascendancyId === ctx.ascendancyId ? 1 : 0;
};

const ATTRIBUTE_TAGS = {
  strength: new Set([
    "armour",
    "physical",
    "life",
    "warcry",
    "melee",
    "slam",
    "leech",
  ]),
  dexterity: new Set([
    "evasion",
    "bow",
    "trap",
    "mines",
    "traps",
    "mines",
    "attack",
    "accuracy",
  ]),
  intelligence: new Set([
    "energy shield",
    "spell",
    "chaos",
    "curses",
    "minions",
    "mana",
  ]),
};

const attributeAffinityScore = (nodeTags: string[], ctxAttributes: BuildContext["attributes"]): number => {
  let str = 0;
  let dex = 0;
  let int = 0;
  nodeTags.forEach((tag) => {
    const lower = tag.toLowerCase();
    if (ATTRIBUTE_TAGS.strength.has(lower)) str += 1;
    if (ATTRIBUTE_TAGS.dexterity.has(lower)) dex += 1;
    if (ATTRIBUTE_TAGS.intelligence.has(lower)) int += 1;
  });
  const total = str + dex + int;
  const normStr = total > 0 ? str / total : 1 / 3;
  const normDex = total > 0 ? dex / total : 1 / 3;
  const normInt = total > 0 ? int / total : 1 / 3;
  const affinity =
    ctxAttributes.strength * normStr +
    ctxAttributes.dexterity * normDex +
    ctxAttributes.intelligence * normInt;
  return clamp01(affinity);
};

export function scorePassiveNode(node: PassiveNode, ctx: BuildContext): number {
  const overlap = tagOverlapScore(node.tags, ctx.tags);
  const ascendancyAffinity = ascendancyAffinityScore(node, ctx);
  const defenseAffinity = defenseAffinityScore(node.tags, ctx.defenseTags);
  const attrAffinity = attributeAffinityScore(node.tags, ctx.attributes);

  const wTags = 0.55;
  const wAsc = 0.25;
  const wDef = 0.15;
  const wAttr = 0.05;

  const score =
    wTags * overlap +
    wAsc * ascendancyAffinity +
    wDef * defenseAffinity +
    wAttr * attrAffinity;

  return clamp01(score);
}

const weightedSample = <T>(
  items: T[],
  weightFn: (item: T) => number,
  count: number,
  rng: () => number
): T[] => {
  const results: T[] = [];
  const pool = [...items];
  while (results.length < count && pool.length > 0) {
    const weights = pool.map(weightFn);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) break;
    let roll = rng() * totalWeight;
    let chosenIndex = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        chosenIndex = i;
        break;
      }
    }
    results.push(pool.splice(chosenIndex, 1)[0]);
  }
  return results;
};

export function selectByCohesion<T>(
  candidates: T[],
  scores: Map<T, number>,
  mode: CohesionMode,
  count: number,
  rng: () => number = Math.random
): T[] {
  if (candidates.length === 0 || count <= 0) return [];
  const scoreList = candidates.map((c) => clamp01(scores.get(c) ?? 0));
  const itemsWithScores = candidates.map((item, idx) => ({ item, score: scoreList[idx] }));

  switch (mode) {
    case "strict": {
      const filtered = itemsWithScores.filter(({ score }) => score >= 0.6);
      filtered.sort((a, b) => b.score - a.score);
      return filtered.slice(0, count).map(({ item }) => item);
    }
    case "cohesive": {
      const filtered = itemsWithScores.filter(({ score }) => score >= 0.3);
      return weightedSample(
        filtered,
        ({ score }) => Math.pow(score, 2),
        Math.min(count, filtered.length),
        rng
      ).map(({ item }) => item);
    }
    case "chaotic": {
      const filtered = itemsWithScores.filter(({ score }) => score >= 0.1);
      return weightedSample(
        filtered,
        ({ score }) => 0.3 + score,
        Math.min(count, filtered.length),
        rng
      ).map(({ item }) => item);
    }
    case "madness":
    default: {
      const filtered = itemsWithScores;
      return weightedSample(
        filtered,
        ({ score }) => 1 + 0.2 * score,
        Math.min(count, filtered.length),
        rng
      ).map(({ item }) => item);
    }
  }
}

const buildScoreMap = (nodes: PassiveNode[], ctx: BuildContext): Map<PassiveNode, number> => {
  const map = new Map<PassiveNode, number>();
  nodes.forEach((node) => {
    map.set(node, scorePassiveNode(node, ctx));
  });
  return map;
};

export function pickRecommendedAscendancyNodes(
  passives: PassivesData,
  ctx: BuildContext,
  count = 4
): PassiveNode[] {
  const candidates = passives.nodes.filter((node) => {
    if (node.type !== "ascendancy") return false;
    if (ctx.ascendancyId === null) return true; // Allow all ascendancy nodes when no ascendancy is chosen; scoring will de-prioritize mismatches.
    return node.ascendancyId === ctx.ascendancyId;
  });

  const scores = buildScoreMap(candidates, ctx);
  return selectByCohesion(candidates, scores, ctx.cohesionMode, count);
}

export function pickRecommendedKeystones(
  passives: PassivesData,
  ctx: BuildContext,
  count = 2
): PassiveNode[] {
  const candidates = passives.nodes.filter((node) => node.type === "keystone");
  const scores = buildScoreMap(candidates, ctx);
  return selectByCohesion(candidates, scores, ctx.cohesionMode, count);
}

export function pickRecommendedNotables(
  passives: PassivesData,
  ctx: BuildContext,
  count = 6
): PassiveNode[] {
  const candidates = passives.nodes.filter((node) => node.type === "notable");
  const scores = new Map<PassiveNode, number>();
  candidates.forEach((node) => {
    const base = scorePassiveNode(node, ctx);
    const overlap = tagOverlapScore(node.tags, ctx.tags);
    const defense = defenseAffinityScore(node.tags, ctx.defenseTags);
    const adjusted = overlap === 0 && defense === 0 ? Math.max(0, base - 0.05) : base;
    scores.set(node, adjusted);
  });
  return selectByCohesion(candidates, scores, ctx.cohesionMode, count);
}

/*
Example usage:

const fakeData: PassivesData = {
  nodes: [
    {
      id: "passive_keystone_resolute_technique",
      type: "keystone",
      name: "Resolute Technique",
      ascendancyId: null,
      ascendancy: null,
      icon: null,
      lines: ["Your hits can't be Evaded"],
      tags: ["Melee", "Physical"],
      flavour: "Accuracy is meaningless.",
      rawStats: [],
    },
    {
      id: "passive_notable_iron_reflexes",
      type: "notable",
      name: "Iron Reflexes",
      ascendancyId: null,
      ascendancy: null,
      icon: null,
      lines: ["Converts all Evasion Rating to Armour"],
      tags: ["Armour", "Evasion", "Life"],
      flavour: "The strong survive.",
      rawStats: [],
    },
    {
      id: "passive_ascendancy_titan_aegis",
      type: "ascendancy",
      name: "Titan Aegis",
      ascendancyId: 1,
      ascendancy: "Titan",
      icon: null,
      lines: ["Gain Block chance"],
      tags: ["Block", "Armour", "Physical"],
      flavour: "Stand unbroken.",
      rawStats: [],
    },
  ],
  ascendancies: { "1": { id: 1, name: "Titan" } },
};

const titanContext: BuildContext = {
  ascendancyId: 1,
  tags: ["Titan", "Block", "Armour", "Melee"],
  defenseTags: ["Block", "Armour"],
  attributes: { strength: 0.6, dexterity: 0.2, intelligence: 0.2 },
  cohesionMode: "cohesive",
};

const igniteContext: BuildContext = {
  ascendancyId: null,
  tags: ["Fire", "Ignite", "Spell"],
  defenseTags: ["Energy Shield"],
  attributes: { strength: 0.2, dexterity: 0.2, intelligence: 0.6 },
  cohesionMode: "strict",
};

const minionContext: BuildContext = {
  ascendancyId: 2,
  tags: ["Minions", "Chaos", "Spell"],
  defenseTags: ["Energy Shield", "Block"],
  attributes: { strength: 0.2, dexterity: 0.2, intelligence: 0.6 },
  cohesionMode: "madness",
};

// Example calls:
// pickRecommendedAscendancyNodes(fakeData, titanContext)
// pickRecommendedKeystones(fakeData, igniteContext)
// pickRecommendedNotables(fakeData, minionContext)
*/
