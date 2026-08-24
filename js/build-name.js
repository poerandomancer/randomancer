const OFFENSE_NAME_TEMPLATES = {
  physical: ['The Iron Argument', 'The Splintered-Stone Warden', 'The Stonebreaking Pathbreaker'],
  fire: ['The Last Ember', 'The Ashen Harbinger', 'The Kindled Emberhand'],
  cold: ['The Still Hour', 'The Frostbound Seer', 'The Winter Warden'],
  lightning: ['The First Thunder', 'The Stormmarked Harbinger', 'The Thunderborn Stormcaller'],
  chaos: ['The Black Bloom', 'The Withering Apostate', 'The Venom-Sworn Hexbearer'],
  bleed: ['The Crimson Wound', 'The Red-Handed Butcher', 'The Veinbound Bloodletter'],
  minions: ['The Many-Handed Omen', 'The Bound-Pack Oathbinder', 'The Raised Standard']
};

const OFFENSE_GROUPS = {
  'physical damage': 'physical', physical: 'physical',
  'fire damage': 'fire', fire: 'fire', ignite: 'fire',
  'cold damage': 'cold', cold: 'cold', chill: 'cold', freeze: 'cold',
  'lightning damage': 'lightning', lightning: 'lightning', shock: 'lightning', electrocute: 'lightning',
  'chaos damage': 'chaos', chaos: 'chaos', poison: 'chaos',
  bleed: 'bleed',
  minions: 'minions', companions: 'minions', totems: 'minions'
};

const WEAPON_DISPLAY_NAMES = new Map([
  ['mace', 'Mace'], ['quarterstaff', 'Quarterstaff'], ['bow', 'Bow'], ['crossbow', 'Crossbow'],
  ['staff', 'Staff'], ['talisman', 'Talisman'], ['wand', 'Wand'], ['sceptre', 'Sceptre'], ['spear', 'Spear']
]);

const WEAPON_IDENTITY_TEMPLATES = new Map([
  ['Mace', 'The Mace-Borne Penitent'],
  ['Quarterstaff', 'The Quarterstaff-Sworn Duelist'],
  ['Bow', 'The Bowmarked Outrider'],
  ['Crossbow', 'The Crossbow-Borne Warden'],
  ['Staff', 'The Staff-Touched Seer'],
  ['Talisman', 'The Talisman-Sworn Beastcaller'],
  ['Wand', 'The Wandmarked Heretic'],
  ['Sceptre', 'The Sceptre-Crowned Hexbearer'],
  ['Spear', 'The Spearbound Harrier']
]);

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function weaponDisplayName(value) {
  const cleaned = cleanText(value);
  return WEAPON_DISPLAY_NAMES.get(cleaned.toLowerCase()) || cleaned;
}

function randomItem(items, random) {
  const roll = typeof random === 'function' ? random() : Math.random();
  const index = Math.min(items.length - 1, Math.max(0, Math.floor((Number(roll) || 0) * items.length)));
  return items[index];
}

/** Select one evocative title to persist with a newly-created build draw. */
function selectBuildName({ ascendancy, weapon, offense, random } = {}) {
  const context = {
    ascendancy: cleanText(ascendancy),
    weapon: weaponDisplayName(weapon),
    offense: cleanText(offense).replace(/\s+Damage$/i, '')
  };
  const offenseKey = OFFENSE_GROUPS[cleanText(offense).toLowerCase()];
  const templates = OFFENSE_NAME_TEMPLATES[offenseKey];
  if (templates?.length) return randomItem(templates, random);
  if (context.offense) return `The ${context.offense} Harbinger`;
  if (WEAPON_IDENTITY_TEMPLATES.has(context.weapon)) return WEAPON_IDENTITY_TEMPLATES.get(context.weapon);
  if (context.ascendancy) return 'The Unwritten Pilgrim';
  return 'The Unwritten Fate';
}

export { selectBuildName, weaponDisplayName };
