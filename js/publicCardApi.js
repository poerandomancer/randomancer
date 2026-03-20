import { APP_VERSION } from './01-meta-and-domready.js';

const DEFAULT_PUBLIC_CARD_BASE_URL = 'https://cards.therandomancer.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

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

export {
  DEFAULT_PUBLIC_CARD_BASE_URL,
  getPublicCardBaseUrl,
  sharePublicCard,
  fetchPublicCardBySlug,
};
