// Shared tag normalization helpers.
import { RULES } from './generated/tag-normalization-rules.js';

const STOP_TAGS = new Set(RULES.stop_tags.map((v) => canonicalizeTag(v)).filter(Boolean));

function sanitizeRawTag(raw) {
  const s = String(raw ?? '').replace(/[\[\]']/g, '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/[\s_-]+/g, '_').replace(/[^a-z0-9_:]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function canonicalizeTag(raw, opts = {}) {
  const token = sanitizeRawTag(raw);
  if (!token) return null;
  if (shouldRejectTag(token, opts)) return null;
  return RULES.aliases_to_canonical[token] || token;
}

function toMatchKey(rawOrCanonical) {
  const canonical = canonicalizeTag(rawOrCanonical) ?? sanitizeRawTag(rawOrCanonical);
  return String(canonical || '').replace(/[^a-z0-9]+/g, '');
}

function expandCanonicalTag(rawOrCanonical, opts = {}) {
  const canonical = canonicalizeTag(rawOrCanonical, opts);
  if (!canonical) return [];
  const expanded = RULES.expansions[canonical] || [];
  return [canonical, ...expanded.map((v) => canonicalizeTag(v, opts)).filter(Boolean)];
}

function expandMatchKeys(rawOrCanonical, opts = {}) {
  return Array.from(new Set(expandCanonicalTag(rawOrCanonical, opts).map(toMatchKey).filter(Boolean)));
}

function normalizeTagList(tags, opts = {}) {
  const out = new Set();
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const items = opts.expand ? expandCanonicalTag(tag, opts) : [canonicalizeTag(tag, opts)];
    items.filter(Boolean).forEach((item) => out.add(opts.matchKey ? toMatchKey(item) : item));
  });
  return Array.from(out);
}

function displayTag(rawOrCanonical) {
  const canonical = canonicalizeTag(rawOrCanonical) ?? sanitizeRawTag(rawOrCanonical);
  if (!canonical) return '';
  return canonical.replace(/_/g, ' ');
}

function isNoiseTag(rawOrCanonical, opts = {}) {
  if (!opts.includeStopTags) {
    const canonical = canonicalizeTag(rawOrCanonical);
    if (canonical && STOP_TAGS.has(canonical)) return true;
  }
  return false;
}

function shouldRejectTag(rawOrCanonical, opts = {}) {
  const raw = String(rawOrCanonical ?? '').trim().toLowerCase();
  if (!raw) return true;
  if (opts.rejectGrants !== false) {
    if (RULES.reject_prefixes.some((p) => raw.startsWith(p))) return true;
    if (RULES.reject_contains.some((part) => raw.includes(part))) return true;
  }
  return false;
}

export {
  RULES,
  sanitizeRawTag,
  canonicalizeTag,
  toMatchKey,
  expandCanonicalTag,
  expandMatchKeys,
  normalizeTagList,
  displayTag,
  isNoiseTag,
  shouldRejectTag
};
