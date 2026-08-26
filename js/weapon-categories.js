function getCoreBuildWeaponInventory(data) {
  const weapons = data?.Weapons || {};
  const twoHanded = Array.isArray(weapons['Two-Handed']) ? weapons['Two-Handed'] : [];
  const oneHanded = Array.isArray(weapons['One-Handed']) ? weapons['One-Handed'] : [];
  return [...twoHanded, ...oneHanded];
}

function getCoreWeaponCategory(weapon) {
  const name = typeof weapon === 'string' ? weapon : weapon?.name;
  if (/^(?:one-|two-)?handed mace$/i.test(String(name || ''))) return 'Mace';
  return String(name || '');
}

function getCoreBuildWeaponCategories(data) {
  return [...new Set(
    getCoreBuildWeaponInventory(data)
      .map(getCoreWeaponCategory)
      .filter(Boolean)
  )];
}

// Bind the Fates deliberately consumes the core inventory through this alias so
// its persisted option IDs cannot drift from the categories accepted by rolls.
function getBindFatesWeaponOptions(data) {
  return getCoreBuildWeaponCategories(data);
}

function weaponMatchesCategory(weapon, category) {
  return getCoreWeaponCategory(weapon) === category;
}

export {
  getCoreBuildWeaponInventory,
  getCoreWeaponCategory,
  getCoreBuildWeaponCategories,
  getBindFatesWeaponOptions,
  weaponMatchesCategory
};
