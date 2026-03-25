import { fetchTrendingCards } from './publicCardApi.js';
import { PUBLIC_CARD_REACTIONS } from './publicCardReactions.js';

const TRENDING_STATE = {
  open: false,
  loading: false,
  error: '',
  items: [],
  filters: {
    window: 'month',
    type: 'both',
    reaction: 'all',
    limit: 10,
  },
};

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureTrendingPanel() {
  let panel = document.getElementById('trending-cards-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'trending-cards-panel';
  panel.className = 'trending-cards-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  return panel;
}

function isMobileLayout() {
  return window.matchMedia?.('(max-width: 640px)')?.matches;
}

function normalizeReactionCounts(counts) {
  const next = {};
  PUBLIC_CARD_REACTIONS.forEach((reaction) => {
    const value = Number(counts?.[reaction.id]);
    next[reaction.id] = Number.isFinite(value) && value >= 0 ? value : 0;
  });
  const total = Number(counts?.total);
  next.total = Number.isFinite(total) && total >= 0
    ? total
    : PUBLIC_CARD_REACTIONS.reduce((sum, reaction) => sum + (next[reaction.id] || 0), 0);
  return next;
}

function renderReactionSummary(counts) {
  const normalized = normalizeReactionCounts(counts);
  const pills = PUBLIC_CARD_REACTIONS
    .map((reaction) => {
      const count = normalized[reaction.id] || 0;
      if (!count) return '';
      return `<span class="trending-row__reaction-pill" title="${escapeHtml(reaction.label)}">${reaction.icon} ${count}</span>`;
    })
    .filter(Boolean)
    .join('');
  return `${pills}<span class="trending-row__reaction-total">${normalized.total} total</span>`;
}

function renderRows() {
  if (TRENDING_STATE.loading) return '<div class="trending-cards-panel__status" role="status" aria-live="polite">Loading trending cards…</div>';
  if (TRENDING_STATE.error) return '<div class="trending-cards-panel__status is-error" role="status" aria-live="polite">Couldn\'t load trending cards.</div>';
  if (!TRENDING_STATE.items.length) return '<div class="trending-cards-panel__status" role="status" aria-live="polite">No trending cards found for this filter.</div>';

  return `<ol class="trending-cards-panel__list">${TRENDING_STATE.items.map((item, index) => `
    <li>
      <button type="button" class="trending-row" data-trending-slug="${escapeHtml(item.slug || '')}">
        <span class="trending-row__rank">${index + 1}</span>
        <span class="trending-row__main">
          <span class="trending-row__title-line">
            <span class="trending-row__title">${escapeHtml(item.title || 'Shared card')}</span>
            <span class="trending-row__badge">${item.card_type === 'challenge' ? 'Challenge' : 'Build'}</span>
          </span>
          <span class="trending-row__subtitle">${escapeHtml(item.subtitle || 'Randomancer shared card')}</span>
          <span class="trending-row__reactions">${renderReactionSummary(item.reaction_counts)}</span>
        </span>
      </button>
    </li>
  `).join('')}</ol>`;
}

function renderFilters() {
  const reactionOptions = [
    `<option value="all"${TRENDING_STATE.filters.reaction === 'all' ? ' selected' : ''}>All</option>`,
    ...PUBLIC_CARD_REACTIONS.map((reaction) => `<option value="${reaction.id}"${TRENDING_STATE.filters.reaction === reaction.id ? ' selected' : ''}>${reaction.icon} ${escapeHtml(reaction.label)}</option>`),
  ].join('');
  return `
    <label class="trending-cards-panel__control">Time span
      <select data-trending-filter="window">
        <option value="week"${TRENDING_STATE.filters.window === 'week' ? ' selected' : ''}>Week</option>
        <option value="month"${TRENDING_STATE.filters.window === 'month' ? ' selected' : ''}>Month</option>
        <option value="all"${TRENDING_STATE.filters.window === 'all' ? ' selected' : ''}>All-time</option>
      </select>
    </label>
    <label class="trending-cards-panel__control">Type
      <select data-trending-filter="type">
        <option value="both"${TRENDING_STATE.filters.type === 'both' ? ' selected' : ''}>Both</option>
        <option value="build"${TRENDING_STATE.filters.type === 'build' ? ' selected' : ''}>Builds</option>
        <option value="challenge"${TRENDING_STATE.filters.type === 'challenge' ? ' selected' : ''}>Challenges</option>
      </select>
    </label>
    <label class="trending-cards-panel__control">Reaction
      <select data-trending-filter="reaction">${reactionOptions}</select>
    </label>
  `;
}

function positionPanel(anchor) {
  const panel = ensureTrendingPanel();
  if (!anchor || isMobileLayout()) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 24);
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width))}px`;
  panel.style.top = `${Math.min(window.innerHeight - panel.offsetHeight - 12, rect.bottom + 10)}px`;
}

function renderPanel() {
  const panel = ensureTrendingPanel();
  panel.classList.toggle('is-mobile', isMobileLayout());
  panel.innerHTML = `
    ${isMobileLayout() ? '<button type="button" class="trending-cards-panel__backdrop" data-trending-close="1" aria-label="Close"></button>' : ''}
    <section class="trending-cards-panel__dialog" role="dialog" aria-modal="true" aria-labelledby="trending-cards-title">
      <header class="trending-cards-panel__head">
        <h3 id="trending-cards-title">Trending Cards</h3>
        <button type="button" class="trending-cards-panel__close" data-trending-close="1" aria-label="Close">×</button>
      </header>
      <div class="trending-cards-panel__filters">${renderFilters()}</div>
      <div class="trending-cards-panel__body">${renderRows()}</div>
    </section>
  `;
  panel.hidden = !TRENDING_STATE.open;
  if (TRENDING_STATE.open) positionPanel(document.getElementById('trending-fab'));
}

async function loadTrending() {
  TRENDING_STATE.loading = true;
  TRENDING_STATE.error = '';
  renderPanel();
  try {
    const response = await fetchTrendingCards(TRENDING_STATE.filters);
    TRENDING_STATE.items = Array.isArray(response?.items) ? response.items : [];
    TRENDING_STATE.error = '';
  } catch (error) {
    TRENDING_STATE.error = error?.message || 'Could not load';
    TRENDING_STATE.items = [];
  } finally {
    TRENDING_STATE.loading = false;
    renderPanel();
  }
}

function closeTrendingPanel() {
  TRENDING_STATE.open = false;
  renderPanel();
  document.getElementById('trending-fab')?.setAttribute('aria-expanded', 'false');
}

function openTrendingPanel() {
  TRENDING_STATE.open = true;
  document.getElementById('trending-fab')?.setAttribute('aria-expanded', 'true');
  renderPanel();
  loadTrending();
}

function handleOpenSharedCard(slug) {
  const safeSlug = String(slug || '').trim().toLowerCase();
  if (!safeSlug) return;
  closeTrendingPanel();
  if (typeof window.RandomancerOpenSharedCardBySlug === 'function') {
    window.RandomancerOpenSharedCardBySlug(safeSlug)
      .catch(() => window.RandomancerShowToast?.('Shared card could not be restored.'));
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('sharedCard', safeSlug);
  window.location.assign(url.toString());
}

function bindTrendingUi() {
  const button = document.getElementById('trending-fab');
  if (!button || button.dataset.bound === '1') return;
  button.dataset.bound = '1';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (TRENDING_STATE.open) closeTrendingPanel();
    else openTrendingPanel();
  });
  document.addEventListener('pointerdown', (event) => {
    const panel = ensureTrendingPanel();
    if (!TRENDING_STATE.open || panel.hidden) return;
    if (isMobileLayout()) return;
    const target = event.target;
    if (panel.contains(target) || button.contains(target)) return;
    closeTrendingPanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && TRENDING_STATE.open) closeTrendingPanel();
  });

  ensureTrendingPanel().addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-trending-close="1"]');
    if (closeBtn) {
      closeTrendingPanel();
      return;
    }
    const row = event.target.closest('[data-trending-slug]');
    if (row) handleOpenSharedCard(row.dataset.trendingSlug);
  });

  ensureTrendingPanel().addEventListener('change', (event) => {
    const select = event.target.closest('[data-trending-filter]');
    if (!select) return;
    const key = select.dataset.trendingFilter;
    TRENDING_STATE.filters[key] = select.value;
    loadTrending();
  });

  window.addEventListener('resize', () => {
    if (TRENDING_STATE.open) renderPanel();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindTrendingUi);
} else {
  bindTrendingUi();
}
