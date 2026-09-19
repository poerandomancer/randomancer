import { buildPresentationContext, normalizeWeapon } from './build-presentation-context.js';

const SAFE_FALLBACK = 'The Unwritten Fate';
const recentNames = [];

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const roll = (random) => Math.min(0.999999999, Math.max(0, Number(random?.() ?? Math.random()) || 0));
const pick = (items, random) => items[Math.floor(roll(random) * items.length)];

function weightedPick(items, random) {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, Number(item.weight) || 0) })).filter(({ weight }) => weight > 0);
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!total) return null;
  let point = roll(random) * total;
  for (const entry of weighted) {
    point -= entry.weight;
    if (point < 0) return entry.item;
  }
  return weighted.at(-1).item;
}

function term(value) {
  if (typeof value === 'string') return { text: value.trim(), collisions: [] };
  if (!value || typeof value.text !== 'string') return null;
  return { text: value.text.trim(), collisions: list(value.collisionKeys || value.tags).map(String) };
}

function offenseVocabulary(manifest, context) {
  const family = manifest?.offenseFamilies?.[context.offense.family] || {};
  const override = manifest?.offenseOverrides?.[context.offense.raw] || {};
  const inherited = override.inherits ? manifest?.offenseFamilies?.[override.inherits] || {} : family;
  const roles = new Set([...Object.keys(inherited), ...Object.keys(override)]);
  return Object.fromEntries([...roles].map((role) => [role, [...list(override[role]), ...list(inherited[role])]]));
}

function vocabulary(manifest, context) {
  return {
    ascendancy: manifest?.ascendancies?.[context.ascendancy] || {},
    weapon: manifest?.weapons?.[context.weapon.key] || {},
    offense: offenseVocabulary(manifest, context)
  };
}

function placeholders(pattern) {
  return [...String(pattern || '').matchAll(/\{(ascendancy|weapon|offense)\.([A-Za-z]+)\}/g)]
    .map((match) => ({ placeholder: match[0], group: match[1], role: match[2] }));
}

function eligible(template, vocab) {
  const slots = placeholders(template?.pattern);
  return slots.length && !String(template.pattern).match(/\{(?!ascendancy\.|weapon\.|offense\.)/) && slots.every(({ group, role }) => list(vocab[group]?.[role]).some((entry) => term(entry)?.text));
}

function hasCollision(terms) {
  const keys = terms.flatMap((entry) => entry.collisions).map((key) => key.toLowerCase());
  if (new Set(keys).size !== keys.length) return true;
  const words = terms.map((entry) => entry.text.toLowerCase().match(/[a-z]{4,}/g) || []);
  for (let left = 0; left < words.length; left += 1) {
    for (let right = left + 1; right < words.length; right += 1) {
      if (words[left].some((a) => words[right].some((b) => a === b || a.startsWith(b) || b.startsWith(a)))) return true;
    }
  }
  return false;
}

function render(template, vocab, random) {
  const selected = [];
  let value = template.pattern;
  for (const slot of placeholders(value)) {
    const choices = list(vocab[slot.group]?.[slot.role]).map(term).filter((entry) => entry?.text);
    const chosen = pick(choices, random);
    if (!chosen) return '';
    selected.push(chosen);
    value = value.replace(slot.placeholder, chosen.text);
  }
  return hasCollision(selected) ? '' : value.trim().replace(/\s+/g, ' ');
}

function validName(value, settings) {
  const significantWords = String(value).split(/\s+/).filter((word) => !/^(?:the|a|an|of)$/i.test(word));
  return Boolean(value && !/[{}]|undefined/i.test(value) && !/\b(?:of|the|a|an)\s*$/i.test(value)
    && value.length <= settings.maxCharacters && significantWords.length <= settings.maxWords);
}

function playfulSpecificity(match, context) {
  if (!match || typeof match !== 'object') return 0;
  const hasAscendancy = typeof match.ascendancy === 'string';
  const hasWeapon = typeof match.weapon === 'string';
  const hasExactOffense = typeof match.offense === 'string';
  const hasOffenseFamily = typeof match.offenseFamily === 'string';
  if (hasExactOffense === hasOffenseFamily) {
    if (!(hasAscendancy && hasWeapon) || hasExactOffense) return 0;
  }
  if (hasAscendancy && match.ascendancy !== context.ascendancy) return 0;
  if (hasWeapon && match.weapon !== context.weapon.key) return 0;
  if (hasExactOffense && match.offense !== context.offense.raw) return 0;
  if (hasOffenseFamily && match.offenseFamily.toLowerCase() !== context.offense.family) return 0;

  if (hasAscendancy && hasWeapon && hasExactOffense) return 7;
  if (hasAscendancy && hasWeapon && hasOffenseFamily) return 6;
  if (hasAscendancy && hasExactOffense) return 5;
  if (hasWeapon && hasExactOffense) return 4;
  if (hasAscendancy && hasWeapon) return 3;
  if (hasAscendancy && hasOffenseFamily) return 2;
  if (hasWeapon && hasOffenseFamily) return 1;
  return 0;
}

function selectPlayfulName(manifest, context, settings, random) {
  const playful = manifest?.playfulNames;
  const chance = Number(playful?.settings?.chance);
  if (!Number.isFinite(chance) || chance <= 0) return '';
  const matches = list(playful.entries).map((entry) => ({
    entry,
    specificity: playfulSpecificity(entry?.match, context)
  })).filter(({ specificity }) => specificity > 0);
  const highestSpecificity = Math.max(0, ...matches.map(({ specificity }) => specificity));
  const candidates = matches
    .filter(({ specificity }) => specificity === highestSpecificity)
    .flatMap(({ entry }) => list(entry.names))
    .map((name) => typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '')
    .filter((name) => validName(name, settings) && !recentNames.includes(name));
  if (!candidates.length || roll(random) >= Math.min(1, chance)) return '';
  return pick(candidates, random);
}

function safeFallback(value, defaultValue) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return cleaned && !/[{}]|undefined/i.test(cleaned) && !/\b(?:of|the|a|an)\s*$/i.test(cleaned) ? cleaned : defaultValue;
}

/** Compose a title exclusively from vocabulary and templates in the supplied asset. */
function selectBuildName(manifest, rawContext, options = {}) {
  // Backwards-compatible argument detection keeps third-party callers safe while assets migrate.
  if (!manifest?.templates && rawContext == null) return SAFE_FALLBACK;
  const context = buildPresentationContext(rawContext || {});
  const random = options.random;
  const settings = { maxCharacters: 36, maxWords: 5, maxAttempts: 24, recentHistorySize: 9, ...(manifest?.settings || {}) };
  const playfulName = selectPlayfulName(manifest, context, settings, random);
  if (playfulName) {
    recentNames.push(playfulName);
    while (recentNames.length > settings.recentHistorySize) recentNames.shift();
    return playfulName;
  }
  const vocab = vocabulary(manifest, context);
  const families = Object.entries(manifest?.templates || {}).map(([key, templates]) => ({
    key,
    weight: Number(manifest?.templateWeights?.[key]) || 0,
    templates: list(templates).filter((template) => eligible(template, vocab))
  })).filter((family) => family.templates.length && family.weight > 0);

  for (let attempt = 0; attempt < Math.max(1, settings.maxAttempts); attempt += 1) {
    const family = weightedPick(families, random);
    if (!family) break;
    const template = weightedPick(family.templates.map((entry) => ({ ...entry, weight: Number(entry.weight) || 1 })), random);
    const candidate = template ? render(template, vocab, random) : '';
    if (!validName(candidate, settings) || recentNames.includes(candidate)) continue;
    recentNames.push(candidate);
    while (recentNames.length > settings.recentHistorySize) recentNames.shift();
    return candidate;
  }
  return context.ascendancy
    ? safeFallback(manifest?.fallback?.ascendancy, 'The Unwritten Pilgrim')
    : safeFallback(manifest?.fallback?.generic, SAFE_FALLBACK);
}

function weaponDisplayName(value) { return normalizeWeapon(value).key; }
function resetRecentBuildNames() { recentNames.length = 0; }

export { resetRecentBuildNames, selectBuildName, weaponDisplayName };
