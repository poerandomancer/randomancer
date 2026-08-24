const GENERIC_BUILD_FLAVOR = 'Some paths are chosen. This one was rolled.';
function flavorLines(value) {
  return Array.isArray(value)
    ? value.filter((line) => typeof line === 'string' && line.trim()).map((line) => line.trim())
    : [];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withoutIdentityPrefix(line, identities) {
  const names = identities.filter((name) => typeof name === 'string' && name.trim()).map((name) => escapeRegExp(name.trim()));
  if (!names.length) return line;
  return line.replace(new RegExp(`^(?:${names.join('|')})\\s*(?::|[-–—])\\s*`, 'i'), '').trim();
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
  void weapon;
  void offense;

  const validManifest = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest
    : null;
  const ascendancyLines = flavorLines(validManifest?.ascendancy_flavor?.[className]?.[ascendancy]);
  const classEntry = validManifest
    ? manifest.class_flavor?.[className]
    : null;
  const classBaseLines = classEntry && typeof classEntry === 'object' && !Array.isArray(classEntry)
    ? flavorLines(classEntry.base)
    : [];
  const candidates = ascendancyLines.length
    ? ascendancyLines
    : (classBaseLines.length ? classBaseLines : flavorLines(validManifest?.fallback_flavor));
  if (!candidates.length) return GENERIC_BUILD_FLAVOR;

  const seeded = seededFraction(seed);
  const roll = seeded ?? (typeof random === 'function' ? random() : Math.random());
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number(roll) || 0) * candidates.length)));
  return withoutIdentityPrefix(candidates[index], [ascendancy, className]) || GENERIC_BUILD_FLAVOR;
}

export { GENERIC_BUILD_FLAVOR, selectBuildFlavor };
