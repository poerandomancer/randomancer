// Neutral equipment-family data and hard Path of Exile 2 loadout rules.
const validOffhands = {
  'One-handed Mace': ['One-handed Mace', 'Shield', 'Buckler', 'Focus', 'Sceptre'],
  Spear: ['Shield', 'Buckler', 'Focus', 'Sceptre'],
  Wand: ['Shield', 'Buckler', 'Focus', 'Sceptre'],
  Sceptre: ['Shield', 'Buckler', 'Focus', 'Wand']
};

const familyName = (raw) => String(raw?.name || raw || '').trim()
  .replace(/^(?:one|two)[- ]handed\s+/i, '').trim();

function deriveWeaponFamilies(data) {
  const sources = [...(data?.Weapons?.['Two-Handed'] || []), ...(data?.Weapons?.['One-Handed'] || [])];
  const families = new Map();
  for (const source of sources) {
    const name = familyName(source);
    if (!name) continue;
    const entry = families.get(name) || { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), name, aliases: [], tags: [], attributes: {}, poeNinjaModes: [] };
    entry.aliases.push(source.name);
    entry.tags = [...new Set([...entry.tags, ...(source.tags || [])])];
    entry.attributes = { ...entry.attributes, ...(source.attributes || {}) };
    families.set(name, entry);
  }
  for (const entry of families.values()) {
    const one = entry.aliases.some((name) => /^one[- ]handed/i.test(name));
    const two = entry.aliases.some((name) => /^two[- ]handed/i.test(name));
    entry.poeNinjaModes = [entry.name, ...(one && two ? [`Two Handed ${entry.name}`] : [])];
    if (entry.tags.includes('bow')) entry.poeNinjaModes.push(`${entry.name} / Quiver`);
  }
  return [...families.values()];
}

function resolveWeaponFamily(families, raw) {
  const value = String(raw?.name || raw || '').trim().toLowerCase();
  const normalized = familyName(raw).toLowerCase();
  return (families || []).find((entry) => entry.name.toLowerCase() === normalized || entry.id === normalized || entry.aliases.some((alias) => alias.toLowerCase() === value)) || null;
}

function pickWeaponFamily(families, fates = {}, random = Math.random) {
  const banned = new Set(fates.abominations || []);
  const favored = new Set(fates.oaths || []);
  const allowed = families.filter((entry) => !banned.has(entry.name));
  const preferred = allowed.filter((entry) => favored.has(entry.name));
  const pool = preferred.length ? preferred : allowed;
  return pool[Math.floor(random() * pool.length)] || null;
}

function applyHardRestrictions(item, ctx) {
  if (!item) return false;
  if (item.name === 'Block' && !['Shield', 'Buckler'].includes(ctx.offhand)) return false;
  if (item.name === 'Deflection' && !ctx.defense.includes('Evasion')) return false;
  return true;
}

export { validOffhands, familyName, deriveWeaponFamilies, resolveWeaponFamily, pickWeaponFamily, applyHardRestrictions };
