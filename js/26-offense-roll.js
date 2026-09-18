const NON_ROLLABLE_OFFENSE_IDS = new Set(['critical_hits', 'critical_hit']);

const offenseNames = (entry) => [entry?.id, entry?.name, ...(entry?.aliases || [])].map((value) => String(value || '').trim()).filter(Boolean);
const isRollableOffense = (entry) => !offenseNames(entry).some((value) => NON_ROLLABLE_OFFENSE_IDS.has(value.toLowerCase().replace(/[^a-z0-9]+/g, '_')));

function resolveOffenseElements(data = window.DATA || {}) {
  return (Array.isArray(data.Offense) ? data.Offense : data.OffenseInventory?.elements || []).filter(Boolean);
}

function resolveRollableOffenseElements(data = window.DATA || {}) {
  return resolveOffenseElements(data).filter(isRollableOffense);
}

function resolveOffenseEntry(data, raw) {
  const needle = String(raw?.id || raw?.name || raw || '').trim().toLowerCase();
  return resolveOffenseElements(data).find((entry) => offenseNames(entry).some((name) => name.toLowerCase() === needle)) || null;
}

function matches(entry, values) {
  const wanted = new Set((values || []).map((value) => String(value).toLowerCase()));
  return offenseNames(entry).some((name) => wanted.has(name.toLowerCase()));
}

function selectOffense({ data = window.DATA || {}, bindFates = {}, random = Math.random } = {}) {
  const fate = bindFates.combat || {};
  const allowed = resolveRollableOffenseElements(data).filter((entry) => !matches(entry, fate.abominations));
  const preferred = allowed.filter((entry) => matches(entry, fate.oaths));
  const pool = preferred.length ? preferred : allowed;
  const pick = pool[Math.floor(random() * pool.length)];
  return pick
    ? { picks: [pick], error: null }
    : { picks: [], error: 'No valid Offense concept is available with your current Oaths & Abominations.' };
}

function buildOffenseSnapshotFields(picks = []) {
  const offenseSet = picks.filter(Boolean);
  const offenseList = offenseSet.map((entry) => entry.name);
  return {
    offense: offenseList.join(' & '), offenseList, offenseSet,
    offenseTags: [...new Set(offenseSet.flatMap((entry) => entry.tags || []))]
  };
}

export { resolveOffenseElements, resolveRollableOffenseElements, resolveOffenseEntry, isRollableOffense, selectOffense, buildOffenseSnapshotFields };
