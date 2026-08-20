const OFFENSE_CATEGORY_ARCHETYPE = 'Archetype';
const MIN_OFFENSE_COUNT = 1;
const MAX_OFFENSE_COUNT = 2;
const NON_ROLLABLE_OFFENSE_IDS = new Set(['critical_hits', 'critical_hit']);

const offenseNames = (entry) => [entry?.id, entry?.name, ...(entry?.aliases || [])].map((value) => String(value || '').trim()).filter(Boolean);
const isArchetype = (entry) => entry?.category === OFFENSE_CATEGORY_ARCHETYPE;
const isRollableOffense = (entry) => !offenseNames(entry).some((value) => NON_ROLLABLE_OFFENSE_IDS.has(value.toLowerCase().replace(/[^a-z0-9]+/g, '_')));
const randomOffenseCount = (random = Math.random) => random() < 0.5 ? 1 : 2;
const normalizeOffenseCount = (value, random) => [1, 2].includes(Number(value)) ? Number(value) : randomOffenseCount(random);

function resolveOffenseElements(data = window.DATA || {}) {
  return (Array.isArray(data.Offense) ? data.Offense : data.OffenseInventory?.elements || []).filter(Boolean);
}

function resolveOffenseEntry(data, raw) {
  const needle = String(raw?.id || raw?.name || raw || '').trim().toLowerCase();
  return resolveOffenseElements(data).find((entry) => offenseNames(entry).some((name) => name.toLowerCase() === needle)) || null;
}

function matches(entry, values) {
  const wanted = new Set((values || []).map((value) => String(value).toLowerCase()));
  return offenseNames(entry).some((name) => wanted.has(name.toLowerCase()));
}

function selectOffense({ data = window.DATA || {}, bindFates = {}, count, random = Math.random } = {}) {
  const target = normalizeOffenseCount(count, random);
  const fate = bindFates.combat || {};
  const allowed = resolveOffenseElements(data).filter((entry) => isRollableOffense(entry) && !matches(entry, fate.abominations));
  const preferred = allowed.filter((entry) => matches(entry, fate.oaths));
  const picks = [];
  const take = (source) => {
    const pool = source.filter((entry) => !picks.includes(entry) && !(isArchetype(entry) && picks.some(isArchetype)));
    const next = pool[Math.floor(random() * pool.length)];
    if (next) picks.push(next);
  };
  while (picks.length < target && preferred.length) take(preferred);
  while (picks.length < target) {
    const before = picks.length; take(allowed); if (picks.length === before) break;
  }
  return picks.length === target
    ? { picks, error: null }
    : { picks: [], error: `Not enough valid Offense concepts to draw ${target} with your current Oaths & Abominations.` };
}

function buildOffenseSnapshotFields(picks = []) {
  const offenseSet = picks.filter(Boolean);
  const offenseList = offenseSet.map((entry) => entry.name);
  return {
    offense: offenseList.join(' & '), offenseList, offenseSet,
    offenseTags: [...new Set(offenseSet.flatMap((entry) => entry.tags || []))]
  };
}

export { OFFENSE_CATEGORY_ARCHETYPE, MIN_OFFENSE_COUNT, MAX_OFFENSE_COUNT, randomOffenseCount, normalizeOffenseCount, resolveOffenseElements, resolveOffenseEntry, isArchetype, isRollableOffense, selectOffense, buildOffenseSnapshotFields };
