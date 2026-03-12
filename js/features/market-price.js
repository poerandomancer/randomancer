import { SUPPORT } from '../01-meta-and-domready.js';

export const MARKET_API_BASE_URL = 'https://api.therandomancer.com';
export const MARKET_API_CONCISE_PATH = '/api/pricecheck/unique';

const marketCache = new Map();
const inFlightRequests = new Map();

const ICON_BY_CURRENCY = Object.freeze({
  exalted: 'images/currency/exalted.png',
  divine: 'images/currency/divine.png',
  mirror: 'images/currency/mirror.png',
  chaos: 'images/currency/chaos.png',
  regal: 'images/currency/regal.png',
  alchemy: 'images/currency/alchemy.png',
  annulment: 'images/currency/annulment.png',
  vaal: 'images/currency/vaal.png',
  chance: 'images/currency/chance.png',
  transmutation: 'images/currency/transmutation.png',
  augmentation: 'images/currency/augmentation.png'
});

const CURRENCY_ALIASES = Object.freeze({
  ex: 'exalted',
  exalt: 'exalted',
  exalted: 'exalted',
  exaltedorb: 'exalted',
  div: 'divine',
  divine: 'divine',
  divineorb: 'divine',
  c: 'chaos',
  chaos: 'chaos',
  chaosorb: 'chaos',
  mirror: 'mirror',
  regal: 'regal',
  alch: 'alchemy',
  alchemy: 'alchemy',
  annul: 'annulment',
  annulment: 'annulment',
  chance: 'chance',
  transmute: 'transmutation',
  transmutation: 'transmutation',
  augment: 'augmentation',
  augmentation: 'augmentation'
});

const CURRENCY_ABBREVIATION = Object.freeze({
  exalted: 'ex',
  divine: 'div',
  mirror: 'mir',
  chaos: 'chaos',
  regal: 'regal',
  alchemy: 'alch',
  annulment: 'annul',
  vaal: 'vaal',
  chance: 'chance',
  transmutation: 'trans',
  augmentation: 'aug'
});

const MARKET_TOOLTIPS = Object.freeze({
  idle: 'Get Current Market Price Estimate',
  loading: 'Loading market estimate…',
  success: 'Estimated market price',
  'no-data': 'No current market estimate found',
  error: 'Unable to retrieve market estimate'
});

function escAttr(value) {
  return String(value || '').replace(/[&<>"]/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
}

function normalizeCurrency(rawCurrency) {
  const compact = String(rawCurrency || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!compact) return '';
  return CURRENCY_ALIASES[compact] || compact;
}

function formatPriceValue(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Math.round(value * 10) / 10).replace(/\.0$/, '');
  return String(Math.round(value * 10) / 10).replace(/\.0$/, '');
}

function parseEstimatePrice(estimatedPrice) {
  const text = String(estimatedPrice || '').trim();
  if (!text) return null;

  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)/);
  if (!match) {
    return { amount: null, currencyKey: '', label: text };
  }

  const amount = Number(match[1]);
  const currencyKey = normalizeCurrency(match[2]);
  const amountLabel = Number.isFinite(amount) ? formatPriceValue(amount) : '';
  const currencyLabel = CURRENCY_ABBREVIATION[currencyKey] || match[2].toLowerCase();
  const label = `${amountLabel}x ${currencyLabel}`.trim();

  return { amount, currencyKey, label };
}

function getLeagueName(explicitLeague) {
  return String(explicitLeague || SUPPORT?.league?.name || 'Standard');
}

function buildRequestUrl({ leagueName, itemName }) {
  const league = encodeURIComponent(leagueName);
  const name = encodeURIComponent(itemName);
  return `${MARKET_API_BASE_URL}${MARKET_API_CONCISE_PATH}?league=${league}&name=${name}&view=concise`;
}

function getCacheKey({ leagueName, itemName }) {
  return `${leagueName}::${itemName}`;
}

function normalizeMarketResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    return { state: 'error', estimate: null };
  }

  if (!payload.ok) {
    return { state: 'error', estimate: null };
  }

  const parsed = parseEstimatePrice(payload.estimated_price);
  if (!parsed || !parsed.label) {
    return { state: 'no-data', estimate: null };
  }

  return { state: 'success', estimate: parsed };
}

async function fetchMarketEstimate({ leagueName, itemName }) {
  const cacheKey = getCacheKey({ leagueName, itemName });
  if (marketCache.has(cacheKey)) return marketCache.get(cacheKey);

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    const response = await fetch(buildRequestUrl({ leagueName, itemName }), {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Market API request failed: ${response.status}`);
    }

    const payload = await response.json();
    const normalized = normalizeMarketResponse(payload);

    if (normalized.state === 'success' || normalized.state === 'no-data') {
      marketCache.set(cacheKey, normalized);
    }

    return normalized;
  })();

  inFlightRequests.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

function renderIcon(state, estimate) {
  if (state === 'loading') {
    return '<span class="market-badge__spinner" aria-hidden="true"></span>';
  }

  if (state === 'success') {
    const iconPath = estimate?.currencyKey ? ICON_BY_CURRENCY[estimate.currencyKey] : null;
    if (iconPath) {
      return `<img class="market-badge__currency-icon" src="${escAttr(iconPath)}" alt="${escAttr(estimate.currencyKey)} currency icon" loading="lazy" decoding="async">`;
    }
  }

  if (state === 'error') {
    return '<svg viewBox="0 0 24 24" class="market-badge__svg" aria-hidden="true" focusable="false"><path d="M12 3 2.5 20h19L12 3Zm0 6.4v5.6m0 3h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  if (state === 'no-data') {
    return '<span class="market-badge__empty" aria-hidden="true">N/A</span>';
  }

  return '<span class="market-badge__emoji" aria-hidden="true">⚖</span>';
}

function getTooltipForState(state) {
  return MARKET_TOOLTIPS[state] || MARKET_TOOLTIPS.idle;
}

function updateBadgeDom(badgeEl, state, estimate = null) {
  if (!badgeEl) return;

  const button = badgeEl.querySelector('.market-badge__button');
  const icon = badgeEl.querySelector('.market-badge__icon');
  const label = badgeEl.querySelector('.market-badge__label');
  if (!button || !icon || !label) return;

  badgeEl.classList.remove('is-idle', 'is-loading', 'is-success', 'is-empty', 'is-error');
  const className = state === 'no-data' ? 'is-empty' : `is-${state}`;
  badgeEl.classList.add(className);
  badgeEl.dataset.marketState = state;

  icon.innerHTML = renderIcon(state, estimate);
  label.textContent = state === 'success' ? (estimate?.label || '') : '';
  label.hidden = state !== 'success';

  const tooltip = getTooltipForState(state);
  button.title = tooltip;
  const itemName = badgeEl.dataset.marketItemName || 'item';
  button.setAttribute('aria-label', `${tooltip}: ${itemName}`);
  button.disabled = state === 'loading';
}

async function onMarketBadgeClick(button) {
  const badge = button?.closest('.market-badge');
  if (!badge) return;

  const currentState = badge.dataset.marketState || 'idle';
  if (currentState === 'loading') return;

  const itemName = String(badge.dataset.marketItemName || '').trim();
  const leagueName = getLeagueName(badge.dataset.marketLeague || '');
  if (!itemName) {
    updateBadgeDom(badge, 'error');
    return;
  }

  const cacheKey = getCacheKey({ leagueName, itemName });
  if (marketCache.has(cacheKey)) {
    const cached = marketCache.get(cacheKey);
    updateBadgeDom(badge, cached.state, cached.estimate || null);
    return;
  }

  updateBadgeDom(badge, 'loading');

  try {
    const result = await fetchMarketEstimate({ leagueName, itemName });
    updateBadgeDom(badge, result.state, result.estimate || null);
  } catch (error) {
    console.warn('[market-price] failed to load estimate', error);
    updateBadgeDom(badge, 'error');
  }
}

let delegationBound = false;

export function ensureMarketBadgeDelegation() {
  if (delegationBound) return;
  delegationBound = true;

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.market-badge__button') : null;
    if (!button) return;
    onMarketBadgeClick(button);
  });
}

export function renderMarketBadgeMarkup(unique, options = {}) {
  const itemName = String(unique?.name || '').trim();
  if (!itemName) return '';

  const leagueName = getLeagueName(options.leagueName);
  const sizeClass = options.context === 'codex' ? 'market-badge--codex' : 'market-badge--build';
  const title = MARKET_TOOLTIPS.idle;

  return `
    <div class="market-badge ${sizeClass} is-idle" data-market-state="idle" data-market-item-name="${escAttr(itemName)}" data-market-league="${escAttr(leagueName)}">
      <button type="button" class="market-badge__button" title="${escAttr(title)}" aria-label="${escAttr(`${title}: ${itemName}`)}">
        <span class="market-badge__icon">${renderIcon('idle')}</span>
      </button>
      <div class="market-badge__label" hidden></div>
    </div>
  `;
}

export function hydrateMarketBadges(root = document) {
  const leagueName = getLeagueName();
  root.querySelectorAll('.market-badge').forEach((badgeEl) => {
    if (!badgeEl.dataset.marketLeague) badgeEl.dataset.marketLeague = leagueName;
    const state = badgeEl.dataset.marketState || 'idle';
    updateBadgeDom(badgeEl, state);

    const itemName = String(badgeEl.dataset.marketItemName || '').trim();
    if (!itemName) return;

    const cacheKey = getCacheKey({ leagueName: badgeEl.dataset.marketLeague, itemName });
    if (marketCache.has(cacheKey)) {
      const cached = marketCache.get(cacheKey);
      updateBadgeDom(badgeEl, cached.state, cached.estimate || null);
    }
  });
}

export function getCurrencyIconPath(currencyKey) {
  return ICON_BY_CURRENCY[currencyKey] || '';
}
