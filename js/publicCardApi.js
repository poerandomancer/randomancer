import { APP_VERSION } from './01-meta-and-domready.js';

const DEFAULT_PUBLIC_CARD_BASE_URL = 'https://cards.therandomancer.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const REACTOR_STORAGE_KEY = 'rm_reactor_key';

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function resolveLocalOverride() {
  const override = window.RANDOMANCER?.publicCardBaseUrl || window.PUBLIC_CARD_BASE_URL || '';
  if (override) return override;
  if (!LOCAL_HOSTS.has(window.location.hostname)) return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('publicCardBaseUrl') || params.get('cardApiBaseUrl') || '';
}

function getPublicCardBaseUrl() {
  return normalizeBaseUrl(resolveLocalOverride()) || DEFAULT_PUBLIC_CARD_BASE_URL;
}

async function readJson(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) {
    const message = data?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function sharePublicCard(body) {
  const res = await fetch(`${getPublicCardBaseUrl()}/api/cards/share`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-randomancer-app-version': APP_VERSION,
    },
    body: JSON.stringify(body),
  });
  return readJson(res);
}


async function fetchPublicCardBySlug(slug) {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) throw new Error('Missing card slug.');
  const res = await fetch(`${getPublicCardBaseUrl()}/api/cards/${encodeURIComponent(safeSlug)}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-randomancer-app-version': APP_VERSION,
    },
  });
  return readJson(res);
}

function createReactorKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  if (!bytes.length) return `rm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOrCreateReactorKey() {
  try {
    const existing = localStorage.getItem(REACTOR_STORAGE_KEY);
    if (existing && existing.trim()) return existing.trim();
    const created = createReactorKey();
    localStorage.setItem(REACTOR_STORAGE_KEY, created);
    return created;
  } catch {
    return createReactorKey();
  }
}

function buildReactionHeaders() {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-randomancer-app-version': APP_VERSION,
    'x-randomancer-reactor-key': getOrCreateReactorKey(),
  };
}

async function fetchCardReactions(slug) {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) throw new Error('Missing card slug.');
  const res = await fetch(`${getPublicCardBaseUrl()}/api/cards/${encodeURIComponent(safeSlug)}/reactions`, {
    method: 'GET',
    headers: buildReactionHeaders(),
  });
  return readJson(res);
}

async function toggleCardReaction(slug, reactionType) {
  const safeSlug = String(slug || '').trim();
  const safeReactionType = String(reactionType || '').trim();
  if (!safeSlug) throw new Error('Missing card slug.');
  if (!safeReactionType) throw new Error('Missing reaction type.');
  const res = await fetch(`${getPublicCardBaseUrl()}/api/cards/${encodeURIComponent(safeSlug)}/reactions`, {
    method: 'POST',
    headers: buildReactionHeaders(),
    body: JSON.stringify({ reaction_type: safeReactionType }),
  });
  return readJson(res);
}

export {
  DEFAULT_PUBLIC_CARD_BASE_URL,
  getPublicCardBaseUrl,
  sharePublicCard,
  fetchPublicCardBySlug,
  getOrCreateReactorKey,
  fetchCardReactions,
  toggleCardReaction,
};
