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

function identityWords(identities) {
  return identities.flatMap((identity) => typeof identity === 'string' ? identity.match(/[\p{L}\p{N}]+/gu) || [] : [])
    .filter((word) => word.length > 3 && !['with'].includes(word.toLowerCase()));
}

function mentionsIdentity(line, identities) {
  return identityWords(identities).some((word) => new RegExp(`\\b${escapeRegExp(word)}(?:['’]s)?\\b`, 'i').test(line));
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
  const identities = [ascendancy, className];
  const candidates = flavorLines(validManifest?.ascendancy_flavor?.[className]?.[ascendancy])
    .map((line) => withoutIdentityPrefix(line, identities))
    .filter((line) => line && !mentionsIdentity(line, identities));
  if (!candidates.length) return GENERIC_BUILD_FLAVOR;

  const seeded = seededFraction(seed);
  const roll = seeded ?? (typeof random === 'function' ? random() : Math.random());
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number(roll) || 0) * candidates.length)));
  return candidates[index];
}

export { GENERIC_BUILD_FLAVOR, selectBuildFlavor };
