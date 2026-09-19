const OFFENSE_FAMILIES = new Map([
  ['physical damage', 'physical'], ['physical', 'physical'],
  ['fire damage', 'fire'], ['fire', 'fire'], ['ignite', 'fire'],
  ['cold damage', 'cold'], ['cold', 'cold'], ['chill', 'cold'], ['freeze', 'cold'],
  ['lightning damage', 'lightning'], ['lightning', 'lightning'], ['shock', 'lightning'], ['electrocute', 'lightning'],
  ['chaos damage', 'chaos'], ['chaos', 'chaos'], ['poison', 'chaos'],
  ['bleed', 'bleed'],
  ['minions', 'minions'], ['companions', 'minions'], ['totems', 'minions']
]);

const WEAPON_KEYS = new Map([
  ['mace', 'Mace'], ['one-handed mace', 'Mace'], ['two-handed mace', 'Mace'],
  ['quarterstaff', 'Quarterstaff'], ['bow', 'Bow'], ['crossbow', 'Crossbow'],
  ['staff', 'Staff'], ['talisman', 'Talisman'], ['wand', 'Wand'],
  ['sceptre', 'Sceptre'], ['spear', 'Spear'], ['shield', 'Shield'],
  ['buckler', 'Buckler'], ['focus', 'Focus']
]);

function cleanPresentationText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeWeapon(value) {
  const raw = cleanPresentationText(value);
  return { raw, key: WEAPON_KEYS.get(raw.toLowerCase()) || raw };
}

function normalizeOffense(value) {
  const raw = cleanPresentationText(value);
  return { raw, family: OFFENSE_FAMILIES.get(raw.toLowerCase()) || '' };
}

/** Canonical presentation-only view of a rolled identity. */
function buildPresentationContext(raw = {}) {
  return {
    className: cleanPresentationText(raw.className),
    ascendancy: cleanPresentationText(raw.ascendancy),
    weapon: normalizeWeapon(raw.weapon?.raw ?? raw.weapon),
    offense: normalizeOffense(raw.offense?.raw ?? raw.offense)
  };
}

export { buildPresentationContext, cleanPresentationText, normalizeOffense, normalizeWeapon };
