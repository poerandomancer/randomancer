import { formatWeaponLine } from './01-meta-and-domready.js';
import { buildGemDictionary, lookupGem } from './05-tags-and-scorer.js';

const CARD_PARAM = 'card';
const CARD_TYPE_BUILD = 'build';
const CARD_TYPE_CHALLENGE = 'challenge';
const CARD_STATE_KEY = 'rm_card_overlay';
const SKILL_TOOLTIP_KEYS = new Set(['ACTIVE_SKILL', 'SUPPORT', 'PERSISTENT_BUFF', 'UNIQUE', 'PASSIVE']);

let tooltipEl = null;
let tooltipTarget = null;
let tooltipPinned = false;
let tooltipHideTimer = null;
let hoverTrigger = false;
let hoverPanel = false;
let lastOpenFocus = null;

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

function getUniqueDescription(name) {
  const uniques = window.DATA?.uniques || window.DATA?.poe2dbUniques || window.DATA?.poe2db_uniques_min || [];
  const found = Array.isArray(uniques)
    ? uniques.find((item) => item?.name === name || item?.base_item?.display_name === name)
    : null;
  const lines = Array.isArray(found?.lines) ? found.lines : Array.isArray(found?.explicit) ? found.explicit : [];
  return lines.map(stripBracketMarkup).filter(Boolean).join(' ');
}

function getAscendancyArtPath(ascendancy) {
  if (!ascendancy) return '';
  return `/images/ascendancies/${String(ascendancy).toLowerCase().replace(/\s+/g, '-')}.webp`;
}

function createNamedItem(name, slotKey, description) {
  return { name, slotKey, description: description || '' };
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
    ascendancy: snap.ascendancy || '',
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
      { label: 'Uniques', values: uniqueNames.map((name) => createNamedItem(name, 'UNIQUE', getUniqueDescription(name))) },
      { label: 'Passives', values: passives }
    ]
  };
}

function describeChallengeSlot(slotKey, value) {
  if (slotKey === 'ACTIVE_SKILL') return getGemDescription(value);
  if (slotKey === 'KEYSTONE') return getPassiveDescription(value);
  return '';
}

function deriveChallengeCardModel(contract) {
  if (!contract) return null;
  const anchor = (contract.tasks || []).find((task) => task?.role === 'anchor') || null;
  const twist = (contract.tasks || []).find((task) => task?.role === 'twist') || null;
  return {
    type: CARD_TYPE_CHALLENGE,
    title: contract.title || 'Challenge Contract',
    subtitle: contract.subtitle || '',
    severity: contract.severity || '',
    anchor: anchor?.line || '',
    twist: twist?.line || '',
    clauses: (contract.tasks || []).map((task) => ({
      label: task.shortLabel || task.role || 'Clause',
      line: task.line || '',
      slotEntries: Object.entries(task.slots || {})
        .filter(([, value]) => value)
        .map(([slotKey, value]) => createNamedItem(String(value), slotKey, describeChallengeSlot(slotKey, value)))
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
  el.style.transform = 'translate(-50%, 0)';
}

function showCardTooltipFor(target, pinned = false) {
  const title = target?.dataset?.tipTitle || target?.textContent?.trim();
  const body = target?.dataset?.tipBody || '';
  if (!title || !body) return;
  tooltipTarget = target;
  tooltipPinned = pinned;
  renderTooltipPayload({ title, lines: [body] });
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
  if (item?.description && SKILL_TOOLTIP_KEYS.has(item.slotKey)) classes.push('has-tip');
  const attrs = [`class="${classes.join(' ')}"`];
  if (classes.includes('has-tip')) {
    attrs.push(`data-tip-title="${escapeHtml(item.name)}"`);
    attrs.push(`data-tip-body="${escapeHtml(item.description)}"`);
    attrs.push('tabindex="0"');
  }
  return `<span ${attrs.join(' ')}>${escapeHtml(item?.name || '')}</span>`;
}

function renderDelimitedNames(values, variant = 'front') {
  return values.map((item, index) => `${index ? '<span class="rc-sep">, </span>' : ''}${renderInteractiveName(item, variant)}`).join('');
}

function renderBuildCard(model, face = 'front') {
  const isBack = face === 'back';
  const style = model.artPath ? ` style="--card-art:url('${escapeHtml(model.artPath)}')"` : '';
  if (!isBack) {
    return `
      <article class="rc-card rc-card--build rc-card--front"${style}>
        <div class="rc-card__hero">
          <div class="rc-card__type">${escapeHtml(model.ascendancy || 'Build')}</div>
          <h2 class="rc-card__title">${escapeHtml(model.title || 'Build Card')}</h2>
          ${model.subtitle ? `<p class="rc-card__subtitle">${escapeHtml(model.subtitle)}</p>` : ''}
        </div>
        <div class="rc-card__rows">
          ${model.frontRows.filter((row) => row.values?.length).map((row) => `
            <div class="rc-row">
              <div class="rc-row__label">${escapeHtml(row.label)}</div>
              <div class="rc-row__value">${renderDelimitedNames(row.values, 'front')}</div>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }

  return `
    <article class="rc-card rc-card--build rc-card--back"${style}>
      <header class="rc-card__backhead">
        <div class="rc-card__type">${escapeHtml(model.title || 'Build Card')}</div>
        ${model.subtitle ? `<p class="rc-card__subline">${escapeHtml(model.subtitle)}</p>` : ''}
      </header>
      <div class="rc-card__dossier">
        ${model.backSections.filter((section) => section.values?.length).map((section) => `
          <section class="rc-card__region">
            <div class="rc-card__region-label">${escapeHtml(section.label)}</div>
            <div class="rc-card__region-values">${renderDelimitedNames(section.values, 'back')}</div>
          </section>
        `).join('')}
      </div>
    </article>
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
      <div class="rc-contract__label">${escapeHtml(clause.label)}</div>
      <div class="rc-contract__line">${line}</div>
    </div>
  `;
}

function renderChallengeCard(model) {
  return `
    <article class="rc-card rc-card--challenge">
      <div class="rc-card__hero rc-card__hero--challenge">
        <div class="rc-card__type">Challenge Contract</div>
        <h2 class="rc-card__title">${escapeHtml(model.title || 'Challenge Contract')}</h2>
        ${model.subtitle ? `<p class="rc-card__subtitle">${escapeHtml(model.subtitle)}</p>` : ''}
      </div>
      <div class="rc-card__rows rc-card__rows--challenge">
        ${model.anchor ? `<div class="rc-row"><div class="rc-row__label">Anchor</div><div class="rc-row__value">${escapeHtml(model.anchor)}</div></div>` : ''}
        ${model.twist ? `<div class="rc-row"><div class="rc-row__label">Twist</div><div class="rc-row__value">${escapeHtml(model.twist)}</div></div>` : ''}
        ${model.severity ? `<div class="rc-row"><div class="rc-row__label">Severity</div><div class="rc-row__value">${escapeHtml(model.severity)}</div></div>` : ''}
      </div>
      ${model.clauses?.length ? `<div class="rc-card__contract">${model.clauses.map(renderChallengeClause).join('')}</div>` : ''}
    </article>
  `;
}

function getCardOverlay() {
  return document.getElementById('card-overlay');
}

function getShareUrl(type) {
  const url = new URL(location.href);
  if (type === CARD_TYPE_BUILD) {
    const snap = window.App?.state?.currentRoll || window.CURRENT_ROLL;
    const code = window.RandomancerEncodeSnapshot?.(snap);
    if (!code) return '';
    url.searchParams.delete('challenge');
    url.searchParams.set('build', code);
    url.searchParams.delete('mode');
    url.searchParams.set(CARD_PARAM, CARD_TYPE_BUILD);
    return url.toString();
  }
  const contract = window.CURRENT_CHALLENGE_CONTRACT;
  const code = window.RandomancerEncodeChallengeContract?.(contract);
  if (!code) return '';
  url.searchParams.delete('build');
  url.searchParams.set('challenge', code);
  url.searchParams.set('mode', CARD_TYPE_CHALLENGE);
  url.searchParams.set(CARD_PARAM, CARD_TYPE_CHALLENGE);
  return url.toString();
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

function renderActionButton({ action, label, icon, hidden = false }) {
  if (hidden) return '';
  return `<button type="button" class="icon-btn card-action-btn" data-card-action="${escapeHtml(action)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span aria-hidden="true">${icon}</span></button>`;
}

function setOverlayContent({ type, html, actionsHtml, error = '', face = '' }) {
  const overlay = getCardOverlay();
  if (!overlay) return;
  overlay.dataset.cardType = type || '';
  overlay.dataset.cardFace = face || '';
  const body = overlay.querySelector('#card-overlay-body');
  const actions = overlay.querySelector('#card-overlay-actions');
  const errorEl = overlay.querySelector('#card-overlay-error');
  if (body) body.innerHTML = html || '';
  if (actions) actions.innerHTML = actionsHtml || '';
  if (errorEl) {
    errorEl.hidden = !error;
    errorEl.textContent = error || '';
  }
  if (body) attachTooltipHandlers(body);
}

function renderBuildCardOverlay(face = 'front') {
  const model = deriveBuildCardModel(window.App?.state?.currentRoll || window.CURRENT_ROLL);
  if (!model) {
    setOverlayContent({ type: CARD_TYPE_BUILD, error: 'Build card could not be loaded.', html: '', actionsHtml: '' });
    return false;
  }
  const actions = [
    renderActionButton({ action: 'copy-link', label: 'Copy Link', icon: '⧉' }),
    renderActionButton({ action: 'save', label: 'Save', icon: '★' }),
    renderActionButton({ action: 'poe', label: 'Poe.ninja', icon: '🥷' }),
    renderActionButton({ action: 'flip', label: face === 'front' ? 'Flip to back' : 'Flip to front', icon: '↺' })
  ].join('');
  setOverlayContent({ type: CARD_TYPE_BUILD, html: renderBuildCard(model, face), actionsHtml: actions, face });
  return true;
}

function renderChallengeCardOverlay() {
  const model = deriveChallengeCardModel(window.CURRENT_CHALLENGE_CONTRACT);
  if (!model) {
    setOverlayContent({ type: CARD_TYPE_CHALLENGE, error: 'Challenge card could not be loaded.', html: '', actionsHtml: '' });
    return false;
  }
  const actions = [
    renderActionButton({ action: 'copy-link', label: 'Copy Link', icon: '⧉' }),
    renderActionButton({ action: 'save', label: 'Save', icon: '★' })
  ].join('');
  setOverlayContent({ type: CARD_TYPE_CHALLENGE, html: renderChallengeCard(model), actionsHtml: actions, face: '' });
  return true;
}

function openCardOverlay(type, options = {}) {
  const overlay = getCardOverlay();
  if (!overlay) return false;
  const cardType = type === CARD_TYPE_CHALLENGE ? CARD_TYPE_CHALLENGE : CARD_TYPE_BUILD;
  const okay = cardType === CARD_TYPE_CHALLENGE ? renderChallengeCardOverlay() : renderBuildCardOverlay(options.face || 'front');
  overlay.hidden = false;
  overlay.classList.add('is-open');
  document.body.classList.add('card-overlay-open');
  lastOpenFocus = document.activeElement;
  if (!options.skipUrl) syncUrlForOverlay(cardType, true);
  try { localStorage.setItem(CARD_STATE_KEY, cardType); } catch {}
  overlay.querySelector('#card-overlay-close')?.focus();
  return okay;
}

function closeCardOverlay({ skipUrl = false } = {}) {
  const overlay = getCardOverlay();
  if (!overlay) return;
  overlay.hidden = true;
  overlay.classList.remove('is-open');
  document.body.classList.remove('card-overlay-open');
  hideCardTooltip();
  if (!skipUrl) syncUrlForOverlay(overlay.dataset.cardType || '', false);
  try { localStorage.removeItem(CARD_STATE_KEY); } catch {}
  lastOpenFocus?.focus?.();
}

function refreshOpenCardOverlay() {
  const overlay = getCardOverlay();
  if (!overlay || overlay.hidden) return;
  if (overlay.dataset.cardType === CARD_TYPE_CHALLENGE) renderChallengeCardOverlay();
  else renderBuildCardOverlay(overlay.dataset.cardFace || 'front');
}

function bindCardOverlayUI() {
  const overlay = getCardOverlay();
  if (!overlay || overlay.dataset.bound === '1') return;
  overlay.dataset.bound = '1';
  overlay.querySelector('#card-overlay-close')?.addEventListener('click', () => closeCardOverlay());
  overlay.addEventListener('click', (evt) => {
    if (evt.target?.dataset?.close) closeCardOverlay();
    const action = evt.target.closest('[data-card-action]')?.dataset.cardAction;
    if (action === 'copy-link') {
      copyCurrentCardLink(overlay.dataset.cardType).then((ok) => window.RandomancerShowToast?.(ok ? 'Card link copied to clipboard!' : 'Could not copy card link.'));
      return;
    }
    if (action === 'save') {
      if (overlay.dataset.cardType === CARD_TYPE_CHALLENGE) window.RandomancerSaveCurrentChallenge?.();
      else window.RandomancerSaveCurrentBuild?.();
      refreshOpenCardOverlay();
      window.RandomancerShowToast?.('Saved locally.');
      return;
    }
    if (action === 'poe') {
      const snap = window.App?.state?.currentRoll || window.CURRENT_ROLL;
      const url = window.RandomancerBuildPoeNinjaUrl?.(snap);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'flip') {
      renderBuildCardOverlay(overlay.dataset.cardFace === 'back' ? 'front' : 'back');
    }
  });
  document.addEventListener('pointerdown', (evt) => {
    if (!tooltipPinned) return;
    const el = ensureTooltipEl();
    if (el.contains(evt.target) || tooltipTarget?.contains?.(evt.target)) return;
    hideCardTooltip();
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && !overlay.hidden) closeCardOverlay();
  });
  window.addEventListener('resize', () => { if (tooltipTarget) requestAnimationFrame(() => positionTooltip(tooltipTarget)); });
  window.addEventListener('scroll', () => { if (tooltipTarget) requestAnimationFrame(() => positionTooltip(tooltipTarget)); }, true);
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
  deriveBuildCardModel,
  deriveChallengeCardModel,
  openCardOverlay,
  closeCardOverlay,
  refreshOpenCardOverlay,
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
