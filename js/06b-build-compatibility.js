// Path of Exile 2 build-generator compatibility rules.
// These are game-data constraints only; keep them separate from affinity scoring.

const validOffhands = {
  'One-handed Mace': ['One-handed Mace', 'Shield', 'Buckler', 'Focus', 'Sceptre'],
  Spear: ['Shield', 'Buckler', 'Focus', 'Sceptre'],
  Wand: ['Shield', 'Buckler', 'Focus', 'Sceptre'],
  Sceptre: ['Shield', 'Buckler', 'Focus', 'Wand']
};

function applyHardRestrictions(item, ctx){
  if (!item) return false;
  if (item.name === 'Block' && !['Shield', 'Buckler'].includes(ctx.offhand)) return false;
  if (item.name === 'Deflection' && !ctx.defense.includes('Evasion')) return false;
  return true;
}

export { validOffhands, applyHardRestrictions };
