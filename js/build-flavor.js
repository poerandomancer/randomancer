const GENERIC_BUILD_FLAVOR = 'Some paths are chosen. This one was rolled.';
const CLASS_FLAVOR_POOLS = ['base', 'named_lore', 'lore_mode'];

function flavorLines(value) {
  return Array.isArray(value)
    ? value.filter((line) => typeof line === 'string' && line.trim()).map((line) => line.trim())
    : [];
}

function seededFraction(seed) {
  if (seed == null || seed === '') return null;
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/** Select one line to persist with a newly-created build draw. */
function selectBuildFlavor(manifest, {
  className,
  ascendancy,
  weapon,
  offense,
  random,
  seed
} = {}) {
  void ascendancy;
  void weapon;
  void offense;

  const classEntry = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest.class_flavor?.[className]
    : null;
  const classLines = classEntry && typeof classEntry === 'object' && !Array.isArray(classEntry)
    ? CLASS_FLAVOR_POOLS.flatMap((pool) => flavorLines(classEntry[pool]))
    : [];
  const candidates = classLines.length ? classLines : flavorLines(manifest?.fallback_flavor);
  if (!candidates.length) return GENERIC_BUILD_FLAVOR;

  const seeded = seededFraction(seed);
  const roll = seeded ?? (typeof random === 'function' ? random() : Math.random());
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number(roll) || 0) * candidates.length)));
  return candidates[index];
}

export { GENERIC_BUILD_FLAVOR, selectBuildFlavor };
