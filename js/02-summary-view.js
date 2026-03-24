import { APP_VERSION, formatWeaponLine } from './01-meta-and-domready.js';
import { sharePublicCard, fetchCardReactions, toggleCardReaction } from './publicCardApi.js';
import { buildPublicBuildCardRequest, buildPublicChallengeCardRequest } from './publicCardBuilders.js';
import { buildGemDictionary, lookupGem } from './05-tags-and-scorer.js';
import { getFamilySkillNames, resolveSkillFamily } from './17-skill-family-utils.js';

const CARD_PARAM = 'card';
const SHARED_CARD_PARAM = 'sharedCard';
const CARD_TYPE_BUILD = 'build';
const CARD_TYPE_CHALLENGE = 'challenge';
const CARD_STATE_KEY = 'rm_card_overlay';
const BUILD_SAVE_STORAGE_KEY = 'randomancer_saved_builds_v1';
const CHALLENGE_SAVE_STORAGE_KEY = 'randomancer_saved_challenges_v1';
const SKILL_TOOLTIP_KEYS = new Set(['ACTIVE_SKILL', 'SUPPORT', 'PERSISTENT_BUFF', 'UNIQUE', 'PASSIVE', 'KEYSTONE', 'SKILL_FAMILY', 'SKILL_FAMILY_2']);
const REACTION_TYPES = [
  { id: 'fire', label: 'Fire', icon: '🔥' },
  { id: 'cursed', label: 'Cursed', icon: '💀' },
  { id: 'big_brain', label: 'Big Brain', icon: '🧠' },
  { id: 'chaotic', label: 'Chaotic', icon: '🎲' }
];

let tooltipEl = null;
let tooltipTarget = null;
let tooltipPinned = false;
let tooltipHideTimer = null;
let hoverTrigger = false;
let hoverPanel = false;
let lastOpenFocus = null;
let closeOverlayTimer = null;
let flipCleanupTimer = null;
let uniqueSourceCache = null;
let uniqueSourcePromise = null;
let floatingPanelState = {
  type: '',
  cardType: '',
  anchor: null
};
const shareUiState = {
  [CARD_TYPE_BUILD]: { status: 'idle', url: null, errorMessage: null, feedbackMessage: '', feedbackTone: '', key: '' },
  [CARD_TYPE_CHALLENGE]: { status: 'idle', url: null, errorMessage: null, feedbackMessage: '', feedbackTone: '', key: '' }
};
const reactionUiState = {
  [CARD_TYPE_BUILD]: { status: 'idle', slug: '', counts: { fire: 0, cursed: 0, big_brain: 0, chaotic: 0 }, viewerReaction: null, busy: false, key: '' },
  [CARD_TYPE_CHALLENGE]: { status: 'idle', slug: '', counts: { fire: 0, cursed: 0, big_brain: 0, chaotic: 0 }, viewerReaction: null, busy: false, key: '' }
};


function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function clearOverlayTimers() {
  if (closeOverlayTimer) {
    clearTimeout(closeOverlayTimer);
    closeOverlayTimer = null;
  }
  if (flipCleanupTimer) {
    clearTimeout(flipCleanupTimer);
    flipCleanupTimer = null;
  }
}

function getOverlayMotionMs(overlay, name, fallback) {
  if (!overlay) return fallback;
  const raw = getComputedStyle(overlay).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith('ms') || !raw ? value : value * 1000;
}

function finalizeOverlayClose(overlay, skipUrl) {
  clearOverlayTimers();
  closeFloatingPanel();
  overlay.hidden = true;
  overlay.classList.remove('is-open', 'is-closing');
  document.body.classList.remove('card-overlay-open');
  hideCardTooltip();
  if (!skipUrl) syncUrlForOverlay(overlay.dataset.cardType || '', false);
  try { localStorage.removeItem(CARD_STATE_KEY); } catch {}
  lastOpenFocus?.focus?.();
}

function triggerBuildCardFlip() {
  const overlay = getCardOverlay();
  const stage = overlay?.querySelector('.card-stage--build');
  if (!stage || prefersReducedMotion()) return;
  if (flipCleanupTimer) clearTimeout(flipCleanupTimer);
  stage.classList.remove('is-flipping');
  void stage.offsetWidth;
  stage.classList.add('is-flipping');
  flipCleanupTimer = setTimeout(() => {
    stage.classList.remove('is-flipping');
    flipCleanupTimer = null;
  }, getOverlayMotionMs(overlay, '--card-flip-duration', 280) + 40);
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripBracketMarkup(str) {
  return String(str == null ? '' : str)
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGemDict() {
  return buildGemDictionary((window.DATA && window.DATA.gems) || []);
}

function getGemDisplayName(entry) {
  if (!entry) return '';
  const key = entry.id || entry.name || entry;
  const gem = key ? lookupGem(getGemDict(), key) : null;
  return gem?.name || entry?.name || key || '';
}

function getGemDescription(entry) {
  const key = entry?.id || entry?.name || entry;
  const gem = key ? lookupGem(getGemDict(), key) : null;
  return stripBracketMarkup(gem?.description || gem?.support_text || gem?.grants || '');
}

function getPassiveDescription(name) {
  const node = (window.DATA?.passivesEnriched?.nodes || []).find((item) => item?.name === name) || null;
  return (Array.isArray(node?.lines) ? node.lines : []).map(stripBracketMarkup).filter(Boolean).join(' ');
}

function getSkillFamilyTooltipPayload(name) {
  const core = window.DATA || {};
  const lib = core.skillFamilyLib;
  const index = core.skillFamilyIndex;
  if (!name || !lib || !index) return null;

  let fam = core.skillFamilyByName?.[name] || null;
  if (!fam) {
    const hit = Object.keys(core.skillFamilyByName || {}).find((key) => String(key).toLowerCase() === String(name).toLowerCase());
    fam = hit ? core.skillFamilyByName[hit] : null;
  }
  if (!fam) return null;

  let matchIds = null;
  if (core.skillFamilyResolved && typeof core.skillFamilyResolved.get === 'function') {
    matchIds = core.skillFamilyResolved.get(fam.name);
  }
  if (!matchIds) matchIds = resolveSkillFamily(fam, index, lib);
  if (!matchIds || !matchIds.size) return null;

  const { names, total, remaining } = getFamilySkillNames(fam, index, matchIds, { max: 28 });
  const lines = names.slice();
  if (remaining > 0) lines.push(`+${remaining} more`);
  return { title: `${fam.name} (${total})`, lines };
}

function getUniqueSourceCollection() {
  if (Array.isArray(uniqueSourceCache) && uniqueSourceCache.length) return uniqueSourceCache;
  const uniques = window.DATA?.uniques || window.DATA?.poe2dbUniques || window.DATA?.poe2db_uniques_min || [];
  if (Array.isArray(uniques) && uniques.length) {
    uniqueSourceCache = uniques;
    return uniqueSourceCache;
  }
  if (uniques && typeof uniques === 'object') {
    if (Array.isArray(uniques.items) && uniques.items.length) {
      uniqueSourceCache = uniques.items;
      return uniqueSourceCache;
    }
    if (uniques.items && typeof uniques.items === 'object') {
      uniqueSourceCache = Object.values(uniques.items);
      return uniqueSourceCache;
    }
    if (uniques.by_key && typeof uniques.by_key === 'object') {
      uniqueSourceCache = Object.values(uniques.by_key);
      return uniqueSourceCache;
    }
  }
  return Array.isArray(uniqueSourceCache) ? uniqueSourceCache : [];
}

async function ensureUniqueSourceCollection() {
  const existing = getUniqueSourceCollection();
  if (existing.length) return existing;
  if (!uniqueSourcePromise) {
    uniqueSourcePromise = fetch('data/enriched/poe2db_uniques_min.json', { cache: 'force-cache' })
      .then((res) => res.ok ? res.json() : null)
      .then((payload) => {
        const items = payload?.items && typeof payload.items === 'object' ? Object.values(payload.items) : [];
        uniqueSourceCache = Array.isArray(items) ? items.filter(Boolean) : [];
        return uniqueSourceCache;
      })
      .catch(() => [])
      .finally(() => { uniqueSourcePromise = null; });
  }
  return uniqueSourcePromise;
}

function getUniqueRecord(name) {
  return getUniqueSourceCollection().find((item) => item?.name === name || item?.base_item?.display_name === name || item?.source?.label === name) || null;
}

function getUniqueTooltipPayload(name) {
  const found = getUniqueRecord(name);
  const base = found?.base || found?.base_item?.display_name || found?.slot || '';
  const lines = [base, ...(Array.isArray(found?.explicit_mods) ? found.explicit_mods : found?.lines || found?.explicit || [])]
    .map(stripBracketMarkup)
    .filter(Boolean)
    .slice(0, 7);
  return {
    title: name,
    lines
  };
}

function getAscendancyArtPath(ascendancy) {
  if (!ascendancy) return '';
  return `/images/ascendancies/${String(ascendancy).toLowerCase().replace(/\s+/g, '-')}.webp`;
}

function createNamedItem(name, slotKey, description, opts = {}) {
  return {
    name,
    slotKey,
    description: description || '',
    tipTitle: opts.tipTitle || name || '',
    tipLines: Array.isArray(opts.tipLines) ? opts.tipLines.filter(Boolean) : (description ? [description] : [])
  };
}

function dedupeNames(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.name || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readSavedList(storageKey) {
  try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
}

function isSavedBuild() {
  const snap = window.App?.state?.currentRoll || window.CURRENT_ROLL;
  const code = window.RandomancerEncodeSnapshot?.(snap);
  return !!(code && readSavedList(BUILD_SAVE_STORAGE_KEY).some((entry) => entry.code === code));
}

function isSavedChallenge() {
  const contract = window.CURRENT_CHALLENGE_CONTRACT;
  const code = window.RandomancerEncodeChallengeContract?.(contract);
  return !!(code && readSavedList(CHALLENGE_SAVE_STORAGE_KEY).some((entry) => entry.code === code));
}

function deriveBuildCardModel(snap) {
  if (!snap) return null;
  const primaryWeapons = formatWeaponLine(snap.weapon, snap.offhand);
  const secondaryWeapons = snap.weapon2 || snap.offhand2 ? formatWeaponLine(snap.weapon2, snap.offhand2) : '';
  const skills = (snap.recommendedSkills || [])
    .map((entry) => createNamedItem(getGemDisplayName(entry), 'ACTIVE_SKILL', getGemDescription(entry)))
    .filter((item) => item.name)
    .slice(0, 2);
  const supports = dedupeNames(
    [...(snap.synergySupports || []), ...(snap.synergySupports2 || [])]
      .map((entry) => createNamedItem(getGemDisplayName(entry), 'SUPPORT', getGemDescription(entry)))
      .filter((item) => item.name)
  );
  const persistentBuffName = snap.recommendedPersistentBuff ? getGemDisplayName(snap.recommendedPersistentBuff) : '';
  const uniqueNames = Array.isArray(snap.recommendedUniques)
    ? snap.recommendedUniques.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean)
    : [];
  const passivesRaw = snap.passives || {};
  const passives = dedupeNames(
    [
      ...(passivesRaw.ascendancyNodes || []),
      ...(passivesRaw.keystones || []),
      ...(passivesRaw.notables || [])
    ]
      .map((item) => createNamedItem(item?.name, 'PASSIVE', getPassiveDescription(item?.name)))
      .filter((item) => item.name)
  );

  return {
    type: CARD_TYPE_BUILD,
    title: snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' '),
    subtitle: snap.flavor || '',
    artPath: getAscendancyArtPath(snap.ascendancy),
    frontRows: [
      { label: 'Ascendancy', values: snap.ascendancy ? [createNamedItem(snap.ascendancy)] : [] },
      { label: 'Weapons', values: [primaryWeapons, secondaryWeapons ? `Set II — ${secondaryWeapons}` : ''].filter(Boolean).map((name) => createNamedItem(name)) },
      { label: 'Combat', values: [...(snap.ailmentList || []), ...(snap.tacticList || [])].filter(Boolean).map((name) => createNamedItem(name)) },
      { label: 'Defense', values: snap.defStrat ? [createNamedItem(snap.defStrat)] : [] },
      { label: 'Skills', values: skills }
    ],
    backSections: [
      { label: 'Supports', values: supports },
      { label: 'Persistent Buff', values: persistentBuffName ? [createNamedItem(persistentBuffName, 'PERSISTENT_BUFF', getGemDescription(snap.recommendedPersistentBuff))] : [] },
      {
        label: 'Uniques',
        values: uniqueNames.map((name) => {
          const tooltip = getUniqueTooltipPayload(name);
          return createNamedItem(name, 'UNIQUE', tooltip.lines.join(' '), { tipTitle: tooltip.title, tipLines: tooltip.lines });
        })
      },
      { label: 'Passives', values: passives }
    ]
  };
}

function getChallengeTooltipPayload(slotKey, value) {
  if (slotKey === 'ACTIVE_SKILL') {
    const description = getGemDescription(value);
    return description ? { title: value, lines: [description] } : null;
  }
  if (slotKey === 'KEYSTONE') {
    const description = getPassiveDescription(value);
    return description ? { title: value, lines: [description] } : null;
  }
  if (slotKey === 'SKILL_FAMILY' || slotKey === 'SKILL_FAMILY_2') {
    return getSkillFamilyTooltipPayload(value);
  }
  return null;
}

function deriveChallengeCardModel(contract) {
  if (!contract) return null;
  return {
    type: CARD_TYPE_CHALLENGE,
    title: contract.title || 'Challenge Contract',
    subtitle: contract.subtitle || '',
    clauses: (contract.tasks || []).map((task) => ({
      label: task.shortLabel || task.role || 'Clause',
      line: task.line || '',
      slotEntries: Object.entries(task.slots || {})
        .filter(([, value]) => value)
        .map(([slotKey, value]) => {
          const tooltip = getChallengeTooltipPayload(slotKey, String(value));
          return createNamedItem(
            String(value),
            slotKey,
            tooltip?.lines?.join(' ') || '',
            tooltip ? { tipTitle: tooltip.title, tipLines: tooltip.lines } : {}
          );
        })
    }))
  };
}

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'rc-inline-tooltip';
  tooltipEl.className = 'rc-tooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipEl);
  tooltipEl.addEventListener('pointerenter', (evt) => {
    if (tooltipPinned || (evt.pointerType && evt.pointerType !== 'mouse')) return;
    hoverPanel = true;
    clearTooltipHideTimer();
  });
  tooltipEl.addEventListener('pointerleave', (evt) => {
    if (tooltipPinned || (evt.pointerType && evt.pointerType !== 'mouse')) return;
    hoverPanel = false;
    scheduleTooltipHide();
  });
  return tooltipEl;
}

function clearTooltipHideTimer() {
  if (!tooltipHideTimer) return;
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = null;
}

function scheduleTooltipHide(delay = 200) {
  clearTooltipHideTimer();
  tooltipHideTimer = setTimeout(() => {
    tooltipHideTimer = null;
    if (tooltipPinned || hoverTrigger || hoverPanel) return;
    hideCardTooltip();
  }, delay);
}

function renderTooltipPayload(payload) {
  const el = ensureTooltipEl();
  el.innerHTML = `
    <div class="rc-tooltip__title">${escapeHtml(payload.title || '')}</div>
    <div class="rc-tooltip__lines">${(payload.lines || []).map((line) => `<div>${escapeHtml(line)}</div>`).join('')}<div class="rc-tooltip__fade" aria-hidden="true"></div></div>
    <div class="rc-tooltip__hint">Tap to pin</div>
  `;
}

function positionTooltip(target) {
  const el = ensureTooltipEl();
  if (!target) return;
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  el.classList.add('is-open');
  const rect = target.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  const pad = 10;
  let x = rect.left + rect.width / 2;
  x = Math.max(pad + tipRect.width / 2, Math.min(window.innerWidth - pad - tipRect.width / 2, x));
  let top = rect.top - tipRect.height - 10;
  if (top < pad) top = rect.bottom + 10;
  top = Math.max(pad, Math.min(window.innerHeight - tipRect.height - pad, top));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.transform = '';
}

function showCardTooltipFor(target, pinned = false) {
  const title = target?.dataset?.tipTitle || target?.textContent?.trim();
  let lines = [];
  try {
    lines = JSON.parse(target?.dataset?.tipLines || '[]');
  } catch {}
  if (!lines.length && target?.dataset?.tipBody) lines = [target.dataset.tipBody];
  if (!title || !lines.length) return;
  tooltipTarget = target;
  tooltipPinned = pinned;
  renderTooltipPayload({ title, lines });
  requestAnimationFrame(() => positionTooltip(target));
}

function hideCardTooltip() {
  ensureTooltipEl().classList.remove('is-open');
  tooltipTarget = null;
  tooltipPinned = false;
  hoverTrigger = false;
  hoverPanel = false;
  clearTooltipHideTimer();
}

function renderInteractiveName(item, variant = 'front') {
  const classes = ['rc-name'];
  if (variant === 'back') classes.push('rc-name--back');
  if (item?.tipLines?.length && SKILL_TOOLTIP_KEYS.has(item.slotKey)) classes.push('has-tip');
  const attrs = [`class="${classes.join(' ')}"`];
  if (classes.includes('has-tip')) {
    attrs.push(`data-tip-title="${escapeHtml(item.tipTitle || item.name)}"`);
    attrs.push(`data-tip-lines="${escapeHtml(JSON.stringify(item.tipLines || []))}"`);
    attrs.push('tabindex="0"');
  }
  return `<span ${attrs.join(' ')}>${escapeHtml(item?.name || '')}</span>`;
}

function renderDelimitedNames(values, variant = 'front') {
  return values.map((item, index) => `${index ? '<span class="rc-sep">, </span>' : ''}${renderInteractiveName(item, variant)}`).join('');
}

function renderActionButton({ action, label, icon, active = false, disabled = false, busy = false }) {
  return `<button type="button" class="icon-btn card-action-btn${active ? ' is-active' : ''}${busy ? ' is-busy' : ''}" data-card-action="${escapeHtml(action)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${disabled ? 'disabled' : ''} ${busy ? 'aria-busy="true"' : ''}><span aria-hidden="true">${icon}</span></button>`;
}

function renderCardHeader(actionsHtml, reactionHtml, title, subtitle) {
  return `
    <div class="rc-card__actions">${actionsHtml}</div>
    ${reactionHtml ? `<div class="rc-card__reactions">${reactionHtml}</div>` : ''}
    <header class="rc-card__hero">
      <h2 class="rc-card__title">${escapeHtml(title || 'Card')}</h2>
      ${subtitle ? `<p class="rc-card__subtitle">${escapeHtml(subtitle)}</p>` : ''}
    </header>
  `;
}

function getShareStateKey(type) {
  if (type === CARD_TYPE_CHALLENGE) {
    return window.RandomancerEncodeChallengeContract?.(window.CURRENT_CHALLENGE_CONTRACT) || '';
  }
  return window.RandomancerEncodeSnapshot?.(window.App?.state?.currentRoll || window.CURRENT_ROLL) || '';
}

function createEmptyShareState(type) {
  return {
    status: 'idle',
    url: null,
    errorMessage: null,
    feedbackMessage: '',
    feedbackTone: '',
    key: getShareStateKey(type)
  };
}

function createZeroReactionCounts() {
  return { fire: 0, cursed: 0, big_brain: 0, chaotic: 0 };
}

function normalizeReactionCounts(counts) {
  const base = createZeroReactionCounts();
  if (!counts || typeof counts !== 'object') return base;
  Object.keys(base).forEach((key) => {
    const value = Number(counts[key]);
    base[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  });
  return base;
}

function normalizeViewerReaction(value) {
  return REACTION_TYPES.some((reaction) => reaction.id === value) ? value : null;
}

function createEmptyReactionState(type, overrides = {}) {
  return {
    status: 'idle',
    slug: '',
    counts: createZeroReactionCounts(),
    viewerReaction: null,
    busy: false,
    key: getShareStateKey(type),
    ...overrides
  };
}

function getShareUiState(type) {
  const cardType = type || getCardOverlay()?.dataset.cardType || CARD_TYPE_BUILD;
  const expectedKey = getShareStateKey(cardType);
  const current = shareUiState[cardType] || createEmptyShareState(cardType);
  if (current.key !== expectedKey && !getSlugFromShareUrl(current.url)) {
    shareUiState[cardType] = createEmptyShareState(cardType);
  }
  return shareUiState[cardType];
}

function resetShareUiState(type) {
  const cardType = type || getCardOverlay()?.dataset.cardType || CARD_TYPE_BUILD;
  shareUiState[cardType] = createEmptyShareState(cardType);
}

function setShareUiState(type, next = {}) {
  const cardType = type || getCardOverlay()?.dataset.cardType || CARD_TYPE_BUILD;
  const current = getShareUiState(cardType);
  shareUiState[cardType] = {
    ...current,
    ...next,
    key: next.key || current.key || getShareStateKey(cardType)
  };
}

function getSlugFromShareUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/([bc]-[a-z0-9]{8})(?:$|[/?#])/i);
  return match ? match[1].toLowerCase() : '';
}

function getReactionUiState(type, options = {}) {
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const expectedKey = getShareStateKey(cardType);
  const sharedSlug = String(options.slug || getSlugFromShareUrl(getShareUiState(cardType).url) || '').toLowerCase();
  const current = reactionUiState[cardType] || createEmptyReactionState(cardType);
  const keyChanged = current.key !== expectedKey;
  const slugChanged = sharedSlug !== (current.slug || '');
  if (slugChanged || (keyChanged && !sharedSlug)) {
    reactionUiState[cardType] = createEmptyReactionState(cardType, { slug: sharedSlug, status: sharedSlug ? 'loading' : 'idle' });
  }
  return reactionUiState[cardType];
}

function setReactionUiState(type, next = {}) {
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const current = getReactionUiState(cardType, { slug: next.slug });
  reactionUiState[cardType] = {
    ...current,
    ...next,
    counts: next.counts ? normalizeReactionCounts(next.counts) : current.counts,
    viewerReaction: Object.prototype.hasOwnProperty.call(next, 'viewerReaction') ? normalizeViewerReaction(next.viewerReaction) : current.viewerReaction,
    key: next.key || current.key || getShareStateKey(cardType),
    slug: (next.slug || current.slug || '').toLowerCase()
  };
}

function normalizeReactionsResponse(data, fallbackSlug = '') {
  const slug = String(data?.slug || fallbackSlug || '').toLowerCase();
  return {
    slug,
    counts: normalizeReactionCounts(data?.counts),
    viewerReaction: normalizeViewerReaction(data?.viewer_reaction)
  };
}

function applyOptimisticReaction(state, reactionType) {
  const prev = normalizeViewerReaction(state?.viewerReaction);
  const nextViewerReaction = prev === reactionType ? null : reactionType;
  const nextCounts = { ...normalizeReactionCounts(state?.counts) };
  if (prev) nextCounts[prev] = Math.max(0, (nextCounts[prev] || 0) - 1);
  if (nextViewerReaction) nextCounts[nextViewerReaction] = Math.max(0, (nextCounts[nextViewerReaction] || 0) + 1);
  return { nextViewerReaction, nextCounts };
}

function renderShareStatus(type) {
  return '';
}

function renderReactionRail(type) {
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const shareState = getShareUiState(cardType);
  const slug = getSlugFromShareUrl(shareState.url);
  const reactionState = getReactionUiState(cardType, { slug });
  const isShared = Boolean(slug);
  const disabledReason = 'Share to enable reactions';
  const classes = [
    'rc-reaction-rail',
    isShared ? 'is-shared' : 'is-disabled',
    reactionState.busy ? 'is-busy' : '',
    reactionState.status === 'loading' ? 'is-loading' : ''
  ].filter(Boolean).join(' ');
  const rows = REACTION_TYPES.map((reaction) => {
    const selected = isShared && reactionState.viewerReaction === reaction.id;
    const count = reactionState.counts?.[reaction.id] ?? 0;
    return `
      <div class="rc-reaction-row${selected ? ' is-selected' : ''}">
        <span class="rc-reaction-count" aria-live="polite"${isShared ? '' : ' aria-hidden="true"'}>${isShared ? count : ''}</span>
        <button
          type="button"
          class="rc-reaction-btn${selected ? ' is-selected' : ''}"
          data-card-action="react-card"
          data-reaction-id="${reaction.id}"
          data-reaction-disabled="${isShared ? '0' : '1'}"
          role="radio"
          aria-checked="${selected ? 'true' : 'false'}"
          aria-disabled="${isShared ? 'false' : 'true'}"
          aria-label="${isShared ? `React ${reaction.label}` : `${reaction.label} — ${disabledReason}`}"
          title="${isShared ? reaction.label : disabledReason}"
        ><span aria-hidden="true">${reaction.icon}</span></button>
      </div>
    `;
  }).join('');

  return `
    <div class="${classes}" role="radiogroup" aria-label="Card reactions">
      ${rows}
    </div>
  `;
}

async function fetchReactionsForCard(type, slug, options = {}) {
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const safeSlug = String(slug || '').trim().toLowerCase();
  if (!safeSlug) {
    setReactionUiState(cardType, createEmptyReactionState(cardType));
    if (!options.skipRender) refreshOpenCardOverlay();
    return false;
  }
  setReactionUiState(cardType, { slug: safeSlug, status: 'loading', busy: false });
  if (!options.skipRender) refreshOpenCardOverlay();
  try {
    const response = await fetchCardReactions(safeSlug);
    const normalized = normalizeReactionsResponse(response, safeSlug);
    setReactionUiState(cardType, { slug: normalized.slug, status: 'ready', counts: normalized.counts, viewerReaction: normalized.viewerReaction, busy: false });
    if (!options.skipRender) refreshOpenCardOverlay();
    return true;
  } catch (error) {
    console.warn('[public-card] reaction fetch failed', error, { cardType, slug: safeSlug });
    setReactionUiState(cardType, { slug: safeSlug, status: 'error', busy: false });
    if (!options.skipRender) refreshOpenCardOverlay();
    return false;
  }
}

function setSharedCardSlug(type, slug) {
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const safeSlug = String(slug || '').trim().toLowerCase();
  const shareUrl = safeSlug ? `https://therandomancer.com/s/${cardType === CARD_TYPE_CHALLENGE ? 'challenge' : 'build'}/${safeSlug}` : null;
  setShareUiState(cardType, {
    status: safeSlug ? 'ready' : 'idle',
    url: shareUrl,
    errorMessage: null,
    feedbackMessage: '',
    feedbackTone: ''
  });
  if (!safeSlug) {
    syncUrlForSharedCardSlug('');
    setReactionUiState(cardType, createEmptyReactionState(cardType));
    return;
  }
  syncUrlForSharedCardSlug(safeSlug);
  fetchReactionsForCard(cardType, safeSlug);
}

async function toggleReactionForCard(type, reactionType) {
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const shareState = getShareUiState(cardType);
  const slug = getSlugFromShareUrl(shareState.url);
  if (!slug) {
    window.RandomancerShowToast?.('Share to enable reactions');
    return;
  }
  const reactionState = getReactionUiState(cardType, { slug });
  if (reactionState.busy) return;
  const previousCounts = normalizeReactionCounts(reactionState.counts);
  const previousViewerReaction = normalizeViewerReaction(reactionState.viewerReaction);
  const optimistic = applyOptimisticReaction(reactionState, reactionType);
  setReactionUiState(cardType, {
    slug,
    status: 'ready',
    busy: true,
    counts: optimistic.nextCounts,
    viewerReaction: optimistic.nextViewerReaction
  });
  refreshOpenCardOverlay();
  try {
    const response = await toggleCardReaction(slug, reactionType);
    const normalized = normalizeReactionsResponse(response, slug);
    setReactionUiState(cardType, {
      slug: normalized.slug || slug,
      status: 'ready',
      busy: false,
      counts: normalized.counts,
      viewerReaction: normalized.viewerReaction
    });
  } catch (error) {
    console.warn('[public-card] reaction update failed', error, { cardType, slug, reactionType });
    setReactionUiState(cardType, {
      slug,
      status: 'error',
      busy: false,
      counts: previousCounts,
      viewerReaction: previousViewerReaction
    });
    window.RandomancerShowToast?.('Could not update reaction right now.');
  }
  refreshOpenCardOverlay();
}

async function shareCurrentCard(type, options = {}) {
  const overlay = getCardOverlay();
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  if (!overlay) return false;
  const currentState = getShareUiState(cardType);
  if (currentState.status === 'loading') return false;

  const body = cardType === CARD_TYPE_CHALLENGE
    ? buildPublicChallengeCardRequest(window.CURRENT_CHALLENGE_CONTRACT)
    : buildPublicBuildCardRequest(window.App?.state?.currentRoll || window.CURRENT_ROLL);

  const missingPayload = cardType === CARD_TYPE_CHALLENGE ? !body?.payload?.contract?.tasks?.length : !body?.payload?.snapshot?.ascendancy;
  if (missingPayload) {
    setShareUiState(cardType, { status: 'error', url: null, errorMessage: 'Open a card before sharing it.', feedbackMessage: '', feedbackTone: '' });
    return false;
  }

  setShareUiState(cardType, { status: 'loading', errorMessage: null, feedbackMessage: '', feedbackTone: '' });

  try {
    const result = await sharePublicCard(body);
    const shareUrl = result?.share_url || '';
    if (!shareUrl) throw new Error('Share service did not return a share URL.');
    setShareUiState(cardType, {
      status: 'ready',
      url: shareUrl,
      errorMessage: null,
      feedbackMessage: options.silent ? '' : 'Shared link ready.',
      feedbackTone: 'success'
    });
    const sharedSlug = getSlugFromShareUrl(shareUrl);
    if (sharedSlug) await fetchReactionsForCard(cardType, sharedSlug, { skipRender: true });
    refreshOpenCardOverlay();
    return true;
  } catch (error) {
    console.error('[public-card] share failed', error, { appVersion: APP_VERSION, cardType });
    setShareUiState(cardType, {
      status: 'error',
      url: null,
      errorMessage: error?.message || 'Could not share this card right now.',
      feedbackMessage: '',
      feedbackTone: ''
    });
    return false;
  }
}

function renderBuildCard(model, face = 'front', actionsHtml = '', reactionHtml = '', stageClass = '') {
  const isBack = face === 'back';
  const style = model.artPath ? ` style="--card-art:url('${escapeHtml(model.artPath)}')"` : '';
  const flipLabel = isBack ? 'Back of build card. Click to flip to front.' : 'Front of build card. Click to flip to back.';
  const flipCue = `<button type="button" class="card-flip-indicator" data-card-action="flip" aria-label="${escapeHtml(flipLabel)}" title="Flip card">↺</button>`;
  const flipFooter = `<footer class="rc-card__fineprint">Flip over card for more details.</footer>`;
  if (!isBack) {
    return `
      <div class="card-stage card-stage--build ${stageClass}">
      <article class="rc-card rc-card--build rc-card--front" data-card-flip-surface="1" tabindex="0" role="button" aria-label="${escapeHtml(flipLabel)}"${style}>
        ${renderCardHeader(actionsHtml, reactionHtml, model.title, model.subtitle)}
        ${renderShareStatus(CARD_TYPE_BUILD)}
        <div class="rc-card__body rc-card__body--front">
          ${model.frontRows.filter((row) => row.values?.length).map((row) => `
            <section class="rc-print-row">
              <div class="rc-print-row__label">${escapeHtml(row.label)}</div>
              <div class="rc-print-row__value">${renderDelimitedNames(row.values, 'front')}</div>
            </section>
          `).join('')}
        </div>
        ${flipFooter}
      </article>
      ${flipCue}
      </div>
    `;
  }

  return `
    <div class="card-stage card-stage--build ${stageClass}">
    <article class="rc-card rc-card--build rc-card--back" data-card-flip-surface="1" tabindex="0" role="button" aria-label="${escapeHtml(flipLabel)}"${style}>
      ${renderCardHeader(actionsHtml, reactionHtml, model.title, model.subtitle)}
      ${renderShareStatus(CARD_TYPE_BUILD)}
      <div class="rc-card__body rc-card__body--back">
        ${model.backSections.filter((section) => section.values?.length).map((section) => `
          <section class="rc-print-block">
            <div class="rc-print-block__label">${escapeHtml(section.label)}</div>
            <div class="rc-print-block__value">${renderDelimitedNames(section.values, 'back')}</div>
          </section>
        `).join('')}
      </div>
      ${flipFooter}
    </article>
    ${flipCue}
    </div>
  `;
}

function renderChallengeClause(clause) {
  let line = escapeHtml(clause.line || '');
  clause.slotEntries.forEach((entry) => {
    if (!entry?.name) return;
    line = line.replace(escapeHtml(entry.name), renderInteractiveName(entry, 'challenge'));
  });
  return `
    <div class="rc-contract__clause">
      <div class="rc-print-block__label">${escapeHtml(clause.label)}</div>
      <div class="rc-contract__line">${line}</div>
    </div>
  `;
}

function renderChallengeCard(model, actionsHtml = '', reactionHtml = '') {
  return `
    <div class="card-stage">
    <article class="rc-card rc-card--challenge">
      ${renderCardHeader(actionsHtml, reactionHtml, model.title, model.subtitle)}
      ${renderShareStatus(CARD_TYPE_CHALLENGE)}
      <div class="rc-card__body rc-card__body--challenge">
        ${model.clauses?.length ? `<div class="rc-contract">${model.clauses.map(renderChallengeClause).join('')}</div>` : ''}
      </div>
    </article>
    </div>
  `;
}

function getCardOverlay() {
  return document.getElementById('card-overlay');
}

function getShareUrl(type) {
  return getShareUiState(type).url || '';
}

async function copyCurrentCardLink(type) {
  const text = getShareUrl(type);
  return text && window.RandomancerCopyTextToClipboard ? window.RandomancerCopyTextToClipboard(text) : false;
}

function syncUrlForOverlay(type, open) {
  const url = new URL(location.href);
  if (open) url.searchParams.set(CARD_PARAM, type);
  else url.searchParams.delete(CARD_PARAM);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function syncUrlForSharedCardSlug(slug) {
  const safeSlug = String(slug || '').trim().toLowerCase();
  const url = new URL(location.href);
  if (safeSlug) url.searchParams.set(SHARED_CARD_PARAM, safeSlug);
  else url.searchParams.delete(SHARED_CARD_PARAM);
  if (safeSlug && url.searchParams.get(CARD_PARAM) === safeSlug) {
    url.searchParams.delete(CARD_PARAM);
  }
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function attachTooltipHandlers(root) {
  if (!root || root.dataset.tooltipBound === '1') return;
  root.dataset.tooltipBound = '1';
  const selector = '.has-tip';
  root.addEventListener('pointerover', (evt) => {
    if (tooltipPinned || (evt.pointerType && evt.pointerType !== 'mouse')) return;
    const el = evt.target.closest(selector);
    if (!el || !root.contains(el)) return;
    hoverTrigger = true;
    clearTooltipHideTimer();
    showCardTooltipFor(el, false);
  });
  root.addEventListener('pointerout', (evt) => {
    if (tooltipPinned || (evt.pointerType && evt.pointerType !== 'mouse')) return;
    const el = evt.target.closest(selector);
    if (!el || !root.contains(el)) return;
    hoverTrigger = false;
    scheduleTooltipHide();
  });
  root.addEventListener('focusin', (evt) => {
    const el = evt.target.closest(selector);
    if (!el || !root.contains(el)) return;
    showCardTooltipFor(el, false);
  });
  root.addEventListener('focusout', (evt) => {
    const el = evt.target.closest(selector);
    if (!el || !root.contains(el)) return;
    hideCardTooltip();
  });
  root.addEventListener('pointerdown', (evt) => {
    const el = evt.target.closest(selector);
    if (!el || !root.contains(el) || evt.pointerType === 'mouse') return;
    evt.preventDefault();
    if (tooltipPinned && tooltipTarget === el) hideCardTooltip();
    else showCardTooltipFor(el, true);
  });
}

function setOverlayContent({ type, html, error = '', face = '' }) {
  const overlay = getCardOverlay();
  if (!overlay) return;
  overlay.dataset.cardType = type || '';
  overlay.dataset.cardFace = face || '';
  const body = overlay.querySelector('#card-overlay-body');
  const errorEl = overlay.querySelector('#card-overlay-error');
  if (body) body.innerHTML = html || '';
  if (errorEl) {
    errorEl.hidden = !error;
    errorEl.textContent = error || '';
  }
  if (body) attachTooltipHandlers(body);
}

function renderBuildCardOverlay(face = 'front', options = {}) {
  const model = deriveBuildCardModel(window.App?.state?.currentRoll || window.CURRENT_ROLL);
  if (!model) {
    setOverlayContent({ type: CARD_TYPE_BUILD, error: 'Build card could not be loaded.', html: '' });
    return false;
  }
  if (!getUniqueSourceCollection().length && model.backSections.some((section) => section.label === 'Uniques' && section.values?.length)) {
    ensureUniqueSourceCollection().then(() => refreshOpenCardOverlay()).catch(() => {});
  }
  const shareState = getShareUiState(CARD_TYPE_BUILD);
  const sharedSlug = getSlugFromShareUrl(shareState.url);
  const reactionState = getReactionUiState(CARD_TYPE_BUILD, { slug: sharedSlug });
  if (sharedSlug && (reactionState.status === 'idle' || (reactionState.slug !== sharedSlug && reactionState.status !== 'loading'))) {
    fetchReactionsForCard(CARD_TYPE_BUILD, sharedSlug, { skipRender: true }).then(() => refreshOpenCardOverlay()).catch(() => {});
  }
  const actions = [
    renderActionButton({ action: 'share-card', label: shareState.status === 'loading' ? 'Sharing card' : 'Share', icon: shareState.status === 'loading' ? '…' : '↗', disabled: shareState.status === 'loading', busy: shareState.status === 'loading' }),
    renderActionButton({ action: 'save', label: isSavedBuild() ? 'Saved' : 'Save', icon: isSavedBuild() ? '★' : '☆', active: isSavedBuild() })
  ].join('');
  const reactions = renderReactionRail(CARD_TYPE_BUILD);
  setOverlayContent({ type: CARD_TYPE_BUILD, html: renderBuildCard(model, face, actions, reactions, options.stageClass || ''), face });
  return true;
}

function renderChallengeCardOverlay() {
  const model = deriveChallengeCardModel(window.CURRENT_CHALLENGE_CONTRACT);
  if (!model) {
    setOverlayContent({ type: CARD_TYPE_CHALLENGE, error: 'Challenge card could not be loaded.', html: '' });
    return false;
  }
  const shareState = getShareUiState(CARD_TYPE_CHALLENGE);
  const sharedSlug = getSlugFromShareUrl(shareState.url);
  const reactionState = getReactionUiState(CARD_TYPE_CHALLENGE, { slug: sharedSlug });
  if (sharedSlug && (reactionState.status === 'idle' || (reactionState.slug !== sharedSlug && reactionState.status !== 'loading'))) {
    fetchReactionsForCard(CARD_TYPE_CHALLENGE, sharedSlug, { skipRender: true }).then(() => refreshOpenCardOverlay()).catch(() => {});
  }
  const actions = [
    renderActionButton({ action: 'share-card', label: shareState.status === 'loading' ? 'Sharing card' : 'Share', icon: shareState.status === 'loading' ? '…' : '↗', disabled: shareState.status === 'loading', busy: shareState.status === 'loading' }),
    renderActionButton({ action: 'save', label: isSavedChallenge() ? 'Saved' : 'Save', icon: isSavedChallenge() ? '★' : '☆', active: isSavedChallenge() })
  ].join('');
  const reactions = renderReactionRail(CARD_TYPE_CHALLENGE);
  setOverlayContent({ type: CARD_TYPE_CHALLENGE, html: renderChallengeCard(model, actions, reactions), face: '' });
  return true;
}

function openCardOverlay(type, options = {}) {
  const overlay = getCardOverlay();
  if (!overlay) return false;
  clearOverlayTimers();
  overlay.hidden = false;
  overlay.classList.remove('is-closing');
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const okay = cardType === CARD_TYPE_CHALLENGE ? renderChallengeCardOverlay() : renderBuildCardOverlay(options.face || 'front');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  document.body.classList.add('card-overlay-open');
  lastOpenFocus = document.activeElement;
  if (!options.skipUrl) syncUrlForOverlay(cardType, true);
  try { localStorage.setItem(CARD_STATE_KEY, cardType); } catch {}
  overlay.querySelector('[data-card-action="share-card"], [data-card-action="save"]')?.focus();
  return okay;
}

function closeCardOverlay({ skipUrl = false } = {}) {
  const overlay = getCardOverlay();
  if (!overlay || overlay.hidden) return;
  clearOverlayTimers();
  hideCardTooltip();
  if (prefersReducedMotion()) {
    finalizeOverlayClose(overlay, skipUrl);
    return;
  }
  overlay.classList.remove('is-open');
  overlay.classList.add('is-closing');
  closeOverlayTimer = setTimeout(() => finalizeOverlayClose(overlay, skipUrl), Math.max(120, getOverlayMotionMs(overlay, '--card-overlay-duration', 220) - 40));
}

function refreshOpenCardOverlay() {
  const overlay = getCardOverlay();
  if (!overlay || overlay.hidden) return;
  if (overlay.dataset.cardType === CARD_TYPE_CHALLENGE) renderChallengeCardOverlay();
  else renderBuildCardOverlay(overlay.dataset.cardFace || 'front');
}

function ensureFloatingPanel() {
  let panel = document.getElementById('summary-floating-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'summary-floating-panel';
  panel.className = 'summary-floating-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  return panel;
}

function positionFloatingPanel(anchor) {
  const panel = ensureFloatingPanel();
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  panel.style.width = `${width}px`;
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.min(window.innerHeight - panel.offsetHeight - 12, rect.bottom + 10)}px`;
}

function getOverlayShareAnchor(cardType) {
  const overlay = getCardOverlay();
  if (!overlay || overlay.hidden) return null;
  if ((overlay.dataset.cardType || '') !== (cardType || '')) return null;
  return overlay.querySelector('[data-card-action="share-card"]');
}

function closeFloatingPanel() {
  const panel = ensureFloatingPanel();
  panel.hidden = true;
  panel.innerHTML = '';
  floatingPanelState = { type: '', cardType: '', anchor: null };
}

function renderSharePanel(cardType) {
  const state = getShareUiState(cardType);
  const shareBody = state.status === 'loading'
    ? `<div class="card-share-popover__loading" role="status" aria-live="polite">Creating public share link…</div>`
    : state.status === 'ready' && state.url
      ? `<div class="card-share-popover__url">${escapeHtml(state.url)}</div>`
      : state.status === 'error'
        ? `<div class="card-share-status is-error" role="status" aria-live="polite">${escapeHtml(state.errorMessage || 'Could not generate a share link right now.')}</div>`
        : `<div class="card-share-popover__loading" role="status" aria-live="polite">Preparing share link…</div>`;
  const shareActions = state.status !== 'ready' || !state.url ? '' : `
    <div class="card-share-popover__actions">
      <button type="button" class="summary-utility-btn" data-panel-action="copy-link">Copy link</button>
      <button type="button" class="summary-utility-btn" data-panel-action="open-link">Open link</button>
      ${navigator.share ? `<button type="button" class="summary-utility-btn" data-panel-action="native-share">Share…</button>` : ''}
    </div>
  `;
  const retryAction = state.status === 'error'
    ? `<div class="card-share-popover__actions"><button type="button" class="summary-utility-btn" data-panel-action="retry-share">Retry</button></div>`
    : '';
  return `
    <div class="summary-floating-panel__section">
      <div class="summary-floating-panel__title">Share</div>
      <p class="card-share-popover__helper">Shared links open this exact card in Randomancer.</p>
      ${shareBody}
      ${shareActions}
      ${retryAction}
      ${state.feedbackMessage ? `<div class="card-share-status${state.feedbackTone ? ` is-${escapeHtml(state.feedbackTone)}` : ''}" role="status" aria-live="polite">${escapeHtml(state.feedbackMessage)}</div>` : ''}
    </div>
  `;
}

async function openSharePanel(cardType, anchor) {
  const panel = ensureFloatingPanel();
  floatingPanelState = { type: 'share', cardType, anchor };
  panel.innerHTML = renderSharePanel(cardType);
  panel.hidden = false;
  positionFloatingPanel(anchor);
  const state = getShareUiState(cardType);
  if (state.status === 'idle') {
    panel.innerHTML = renderSharePanel(cardType);
    positionFloatingPanel(anchor);
    await shareCurrentCard(cardType, { silent: true });
    if (floatingPanelState.type === 'share' && floatingPanelState.cardType === cardType) {
      floatingPanelState.anchor = getOverlayShareAnchor(cardType) || floatingPanelState.anchor;
      panel.innerHTML = renderSharePanel(cardType);
      positionFloatingPanel(floatingPanelState.anchor);
    }
  }
}

function bindCardOverlayUI() {
  const overlay = getCardOverlay();
  if (!overlay || overlay.dataset.bound === '1') return;
  overlay.dataset.bound = '1';
  overlay.addEventListener('click', (evt) => {
    const flipSurface = evt.target.closest('[data-card-flip-surface="1"]');
    if (flipSurface && !evt.target.closest('[data-card-action], .has-tip, a, input, button')) {
      renderBuildCardOverlay(overlay.dataset.cardFace === 'back' ? 'front' : 'back', { stageClass: prefersReducedMotion() ? '' : 'is-flipping' });
      requestAnimationFrame(triggerBuildCardFlip);
      return;
    }
    if (evt.target?.dataset?.close) closeCardOverlay();
    const action = evt.target.closest('[data-card-action]')?.dataset.cardAction;
    if (action === 'share-card') {
      openSharePanel(overlay.dataset.cardType, evt.target.closest('[data-card-action]'));
      return;
    }
    if (action === 'react-card') {
      const button = evt.target.closest('[data-reaction-id]');
      const reactionType = button?.dataset?.reactionId || '';
      if (!reactionType) return;
      if (button?.dataset?.reactionDisabled === '1') {
        window.RandomancerShowToast?.('Share to enable reactions');
        return;
      }
      toggleReactionForCard(overlay.dataset.cardType, reactionType);
      return;
    }
    if (action === 'save') {
      if (overlay.dataset.cardType === CARD_TYPE_CHALLENGE) window.RandomancerSaveCurrentChallenge?.();
      else window.RandomancerSaveCurrentBuild?.();
      refreshOpenCardOverlay();
      window.RandomancerShowToast?.('Saved locally.');
      return;
    }
    if (action === 'flip' || action === 'flip-surface') {
      renderBuildCardOverlay(overlay.dataset.cardFace === 'back' ? 'front' : 'back', { stageClass: prefersReducedMotion() ? '' : 'is-flipping' });
      requestAnimationFrame(triggerBuildCardFlip);
      return;
    }
  });
  overlay.addEventListener('keydown', (evt) => {
    if (!evt.target.closest('[data-card-flip-surface="1"]')) return;
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    renderBuildCardOverlay(overlay.dataset.cardFace === 'back' ? 'front' : 'back', { stageClass: prefersReducedMotion() ? '' : 'is-flipping' });
    requestAnimationFrame(triggerBuildCardFlip);
  });
  document.addEventListener('pointerdown', (evt) => {
    if (!tooltipPinned) return;
    const el = ensureTooltipEl();
    if (el.contains(evt.target) || tooltipTarget?.contains?.(evt.target)) return;
    hideCardTooltip();
  });
  document.addEventListener('pointerdown', (evt) => {
    const panel = ensureFloatingPanel();
    if (panel.hidden) return;
    if (panel.contains(evt.target) || floatingPanelState.anchor?.contains?.(evt.target)) return;
    closeFloatingPanel();
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && !ensureFloatingPanel().hidden) {
      closeFloatingPanel();
      return;
    }
    if (evt.key === 'Escape' && !overlay.hidden) closeCardOverlay();
  });
  ensureFloatingPanel().addEventListener('click', (evt) => {
    const action = evt.target.closest('[data-panel-action]')?.dataset.panelAction;
    if (!action) return;
    if (action === 'retry-share') {
      resetShareUiState(floatingPanelState.cardType);
      ensureFloatingPanel().innerHTML = renderSharePanel(floatingPanelState.cardType);
      positionFloatingPanel(floatingPanelState.anchor);
      openSharePanel(floatingPanelState.cardType, floatingPanelState.anchor);
      return;
    }
    if (action === 'copy-link') {
      copyCurrentCardLink(floatingPanelState.cardType).then((ok) => {
        setShareUiState(floatingPanelState.cardType, {
          feedbackMessage: ok ? 'Link copied to clipboard.' : 'Clipboard copy failed. You can still copy the URL manually.',
          feedbackTone: ok ? 'success' : 'error'
        });
        ensureFloatingPanel().innerHTML = renderSharePanel(floatingPanelState.cardType);
        positionFloatingPanel(floatingPanelState.anchor);
      });
      return;
    }
    if (action === 'open-link') {
      const url = getShareUiState(floatingPanelState.cardType).url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'native-share') {
      const url = getShareUiState(floatingPanelState.cardType).url;
      if (url && navigator.share) navigator.share({ url }).catch(() => {});
    }
  });
  window.addEventListener('resize', () => { if (tooltipTarget) requestAnimationFrame(() => positionTooltip(tooltipTarget)); });
  window.addEventListener('scroll', () => { if (tooltipTarget) requestAnimationFrame(() => positionTooltip(tooltipTarget)); }, true);
  window.addEventListener('resize', () => {
    if (!ensureFloatingPanel().hidden && floatingPanelState.anchor) positionFloatingPanel(floatingPanelState.anchor);
  });
}

function scheduleSummaryRefresh() {
  refreshOpenCardOverlay();
}

function installSummaryAutoRefresh() {
  bindCardOverlayUI();
}

function getSummaryTextFromSnapshot(snap) {
  const model = deriveBuildCardModel(snap);
  if (!model) return '';
  return [...model.frontRows, ...model.backSections]
    .filter((section) => section.values?.length)
    .map((section) => `${section.label.toUpperCase()}: ${section.values.map((item) => item.name).join(' · ')}`)
    .join('\n');
}

function renderSummaryFromSnapshot() {
  refreshOpenCardOverlay();
}

function getViewMode() { return 'detailed'; }
function setViewMode() {}
function toggleViewMode() {}
function isSummaryModeActive() { return false; }
function buildSummaryLinesFromSnapshot(snap) {
  const text = getSummaryTextFromSnapshot(snap);
  return text ? text.split('\n') : [];
}

document.addEventListener('DOMContentLoaded', () => {
  bindCardOverlayUI();
});

export {
  CARD_TYPE_BUILD,
  CARD_TYPE_CHALLENGE,
  shareCurrentCard,
  openSharePanel,
  deriveBuildCardModel,
  deriveChallengeCardModel,
  openCardOverlay,
  closeCardOverlay,
  refreshOpenCardOverlay,
  setSharedCardSlug,
  getShareUrl,
  getViewMode,
  setViewMode,
  toggleViewMode,
  isSummaryModeActive,
  scheduleSummaryRefresh,
  installSummaryAutoRefresh,
  buildSummaryLinesFromSnapshot,
  getSummaryTextFromSnapshot,
  renderSummaryFromSnapshot
};
