const OFFENSE_NAME_TEMPLATES = {
  physical: ['The Iron Argument', '{ascendancy} of Splintered Stone', 'The Stone-Breaking {weapon}'],
  fire: ['The Kindled {weapon}', '{ascendancy} of the Last Ember', 'The Ash-Crowned {weapon}'],
  cold: ['The Frostbound {weapon}', '{ascendancy} of the Still Hour', 'The Winter-Edged {weapon}'],
  lightning: ['The Thunderstruck {weapon}', '{ascendancy} of the First Thunder', 'The Storm-Tipped {weapon}'],
  chaos: ['The Venom-Touched {weapon}', '{ascendancy} of the Black Bloom', 'The Withering {weapon}'],
  bleed: ['The Red-Edged {weapon}', '{ascendancy} of the Open Vein', 'The Crimson Wound'],
  minions: ['The Many-Handed Omen', '{ascendancy} of the Bound Pack', 'The Raised Standard']
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

function fillTemplate(template, context) {
  return template.replace(/\{(ascendancy|weapon|offense)\}/g, (_, key) => context[key] || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,:])/g, '$1')
    .trim();
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
  if (templates?.length) return fillTemplate(randomItem(templates, random), context);
  if (context.offense && context.weapon) return `The ${context.offense} ${context.weapon}`;
  if (context.weapon) return `The Fated ${context.weapon}`;
  if (context.ascendancy) return `${context.ascendancy} of the Unwritten Path`;
  return 'The Unwritten Fate';
}

export { selectBuildName, weaponDisplayName };
