/**
 * Skill Family utilities (Challenge Mode)
 * Resolves "skill families" via tag queries over the union of:
 *  - skill.taxonomy.gem_tags
 *  - skill.taxonomy.skill_types
 *  - skill.effect_tags
 *
 * Intended to be used with skills_enriched.json and skill_families.json.
 */

export function normalizeTag(rawTag, familyLib) {
  if (rawTag == null) return "";
  const stripRe = new RegExp(familyLib?.tag_normalization?.strip_chars_regex || "[^a-z0-9]+", "g");
  let t = String(rawTag).toLowerCase().replace(stripRe, "");
  const map = familyLib?.tag_normalization?.alias_to_canonical || {};
  if (map[t]) t = map[t];
  return t;
}

export function isEligibleSkillForFamilies(skill) {
  if (!skill || skill.type !== "active") return false;

  const blob = `${skill.id || ""} ${skill.name || ""}`.toLowerCase();
  if (blob.includes("dnt") || blob.includes("unused") || blob.includes("playtest")) return false;

  const sid = String(skill.id || "").toLowerCase();
  if (sid.includes("default") || sid.includes("unique") || sid.includes("playtest")) return false;

  return true;
}

export function getSkillTagUnion(skill, familyLib) {
  const out = new Set();
  const tax = skill.taxonomy || {};
  const addArr = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      const nt = normalizeTag(t, familyLib);
      if (nt) out.add(nt);
    }
  };
  addArr(tax.gem_tags);
  addArr(tax.skill_types);
  addArr(skill.effect_tags);
  return out;
}

/**
 * Build maps for fast family resolution.
 * Returns:
 *  - allSkillIds: Set<string>
 *  - skillsById: Map<string, skill>
 *  - skillTagsById: Map<string, Set<string>>
 *  - tagIndex: Map<string, Set<string>>  // tag -> skillIds
 */
export function buildSkillFamilyIndex(skills, familyLib) {
  const skillsById = new Map();
  const skillTagsById = new Map();
  const tagIndex = new Map();
  const allSkillIds = new Set();

  for (const skill of (skills || [])) {
    if (!isEligibleSkillForFamilies(skill)) continue;

    const id = String(skill.id);
    skillsById.set(id, skill);
    allSkillIds.add(id);

    const tagSet = getSkillTagUnion(skill, familyLib);
    skillTagsById.set(id, tagSet);

    for (const tag of tagSet) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
      tagIndex.get(tag).add(id);
    }
  }

  return { allSkillIds, skillsById, skillTagsById, tagIndex };
}

function _setUnion(sets) {
  const out = new Set();
  for (const s of sets) {
    if (!s) continue;
    for (const v of s) out.add(v);
  }
  return out;
}

function _setIntersect(a, b) {
  if (!a) return new Set(b || []);
  if (!b) return new Set();
  const out = new Set();
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (big.has(v)) out.add(v);
  return out;
}

function _setSubtract(a, b) {
  if (!a) return new Set();
  if (!b || b.size === 0) return new Set(a);
  const out = new Set(a);
  for (const v of b) out.delete(v);
  return out;
}

/**
 * Resolve a family definition into a Set of matching skill IDs.
 * familyDef.query supports:
 *  - all: string[]            (AND)
 *  - any: string[]            (OR)
 *  - any_groups: string[][]   (OR of AND groups)
 *  - not: string[]            (NOT)
 */
export function resolveSkillFamily(familyDef, index, familyLib) {
  const { allSkillIds, tagIndex } = index;
  const q = familyDef?.query || {};

  // Start with ALL skills (then constrain)
  let candidates = new Set(allSkillIds);

  // AND: all
  if (Array.isArray(q.all) && q.all.length) {
    let acc = null;
    for (const raw of q.all) {
      const tag = normalizeTag(raw, familyLib);
      const s = tagIndex.get(tag) || new Set();
      acc = acc == null ? new Set(s) : _setIntersect(acc, s);
    }
    candidates = _setIntersect(candidates, acc || new Set());
  }

  // OR: any
  if (Array.isArray(q.any) && q.any.length) {
    const sets = q.any.map(t => tagIndex.get(normalizeTag(t, familyLib)) || new Set());
    const uni = _setUnion(sets);
    candidates = _setIntersect(candidates, uni);
  }

  // OR of AND-groups: any_groups
  if (Array.isArray(q.any_groups) && q.any_groups.length) {
    const groupSets = [];
    for (const group of q.any_groups) {
      if (!Array.isArray(group) || !group.length) continue;
      let acc = null;
      for (const raw of group) {
        const tag = normalizeTag(raw, familyLib);
        const s = tagIndex.get(tag) || new Set();
        acc = acc == null ? new Set(s) : _setIntersect(acc, s);
      }
      if (acc) groupSets.push(acc);
    }
    const uni = _setUnion(groupSets);
    candidates = _setIntersect(candidates, uni);
  }

  // NOT: not
  if (Array.isArray(q.not) && q.not.length) {
    const sets = q.not.map(t => tagIndex.get(normalizeTag(t, familyLib)) || new Set());
    const bad = _setUnion(sets);
    candidates = _setSubtract(candidates, bad);
  }

  return candidates;
}

export function getFamilySkillNames(familyDef, index, matchIds, opts = {}) {
  const { skillsById } = index;
  const max = opts.max ?? 30;
  const sort = opts.sort ?? "name";

  const names = [];
  for (const id of matchIds) {
    const s = skillsById.get(id);
    if (!s) continue;
    names.push(s.name || id);
  }

  names.sort((a, b) => {
    if (sort === "name") return a.localeCompare(b, undefined, { sensitivity: "base" });
    return a.localeCompare(b);
  });

  const sliced = names.slice(0, max);
  const remaining = Math.max(0, names.length - sliced.length);

  return { names: sliced, total: names.length, remaining };
}

export function formatFamilyTooltip(familyDef, index, matchIds, opts = {}) {
  const { names, total, remaining } = getFamilySkillNames(familyDef, index, matchIds, opts);
  const lines = [
    `${familyDef.name} (${total})`,
    ...names
  ];
  if (remaining > 0) lines.push(`… +${remaining} more`);
  return lines.join("\n");
}

/**
 * Optional: quick healthcheck for dev console.
 * Returns array of {id,name,count,missingTags}.
 */
export function skillFamilyHealthcheck(familyLib, index) {
  const presentTags = new Set(index.tagIndex.keys());
  const out = [];
  for (const fam of (familyLib?.families || [])) {
    const used = new Set();
    const q = fam.query || {};
    for (const k of ["all","any","not"]) {
      for (const t of (q[k] || [])) used.add(normalizeTag(t, familyLib));
    }
    for (const g of (q.any_groups || [])) for (const t of g) used.add(normalizeTag(t, familyLib));
    const missing = [...used].filter(t => t && !presentTags.has(t)).sort();
    const matches = resolveSkillFamily(fam, index, familyLib);
    out.push({ id: fam.id, name: fam.name, count: matches.size, missingTags: missing });
  }
  out.sort((a,b) => b.count - a.count);
  return out;
}
