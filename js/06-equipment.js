// Neutral equipment-family data and hard Path of Exile 2 loadout rules.
const validOffhands = {
  'One-handed Mace': ['One-handed Mace', 'Shield', 'Buckler', 'Focus', 'Sceptre'],
  Spear: ['Shield', 'Buckler', 'Focus', 'Sceptre'],
  Wand: ['Shield', 'Buckler', 'Focus', 'Sceptre'],
  Sceptre: ['Shield', 'Buckler', 'Focus', 'Wand']
};

// poe.ninja's weapon-mode vocabulary is not a direct representation of the
// game's equipment rules. Keep this integration mapping explicit so unusual
// and unclassified modes remain intentional and reviewable.
const poeNinjaModesByWeaponFamily = Object.freeze({
  Mace: Object.freeze([
    'Mace', 'Mace / Buckler', 'Mace / Focus', 'Mace / Sceptre', 'Mace / Shield', 'Mace / Unknown',
    'Dual Mace', 'Two Handed Mace', 'Two Handed Mace / Buckler', 'Two Handed Mace / Focus',
    'Two Handed Mace / Sceptre', 'Two Handed Mace / Shield', 'Two Handed Mace / Unknown',
    'Dual Two Handed Mace', 'Unknown / Mace', 'Unknown / Two Handed Mace', 'Two Handed Mace / Mace'
  ]),
  Quarterstaff: Object.freeze(['Quarterstaff']),
  Bow: Object.freeze(['Bow', 'Bow / Quiver', 'Bow / Unknown', 'Unknown / Quiver']),
  Crossbow: Object.freeze(['Crossbow']),
  Staff: Object.freeze(['Staff', 'Staff / Focus', 'Staff / Unknown']),
  Talisman: Object.freeze(['Talisman', 'Talisman / Sceptre']),
  Spear: Object.freeze(['Spear', 'Spear / Buckler', 'Spear / Focus', 'Spear / Sceptre', 'Spear / Shield', 'Spear / Unknown']),
  Wand: Object.freeze(['Wand', 'Wand / Buckler', 'Wand / Focus', 'Wand / Sceptre', 'Wand / Shield', 'Wand / Unknown']),
  Sceptre: Object.freeze([
    'Sceptre', 'Sceptre / Buckler', 'Sceptre / Focus', 'Sceptre / Shield', 'Sceptre / Unknown',
    'Unknown / Sceptre', 'Wand / Sceptre', 'Spear / Sceptre', 'Mace / Sceptre',
    'Two Handed Mace / Sceptre', 'Talisman / Sceptre'
  ])
});

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
  for (const entry of families.values()) entry.poeNinjaModes = [...(poeNinjaModesByWeaponFamily[entry.name] || [])];
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

export { validOffhands, poeNinjaModesByWeaponFamily, familyName, deriveWeaponFamilies, resolveWeaponFamily, pickWeaponFamily, applyHardRestrictions };
