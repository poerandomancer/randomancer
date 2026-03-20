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
  if (!key) return '';
  const gem = lookupGem(getGemDict(), key);
  return gem?.name || entry.name || key;
}

function getGemDescription(entry) {
  const key = entry?.id || entry?.name || entry;
  if (!key) return '';
  const gem = lookupGem(getGemDict(), key);
  return stripBracketMarkup(gem?.description || gem?.support_text || gem?.grants || '');
}

function getPassiveDescription(name) {
  const nodes = window.DATA?.passivesEnriched?.nodes || [];
  const node = nodes.find((item) => item?.name === name) || null;
  const lines = Array.isArray(node?.lines) ? node.lines.map(stripBracketMarkup).filter(Boolean) : [];
  return lines.join(' ');
}

function getUniqueDescription(name) {
  const uniques = window.DATA?.uniques || window.DATA?.poe2dbUniques || window.DATA?.poe2db_uniques_min || [];
  const found = Array.isArray(uniques) ? uniques.find((item) => item?.name === name || item?.base_item?.display_name === name) : null;
  const lines = Array.isArray(found?.lines) ? found.lines : Array.isArray(found?.explicit) ? found.explicit : [];
  return lines.map(stripBracketMarkup).filter(Boolean).join(' ');
}

function createNamedItem(name, slotKey, description) {
  return { name, slotKey, description: description || '' };
}

function deriveBuildCardModel(snap) {
  if (!snap) return null;
  const skills = (snap.recommendedSkills || []).map((entry) => createNamedItem(getGemDisplayName(entry), 'ACTIVE_SKILL', getGemDescription(entry))).filter((item) => item.name).slice(0, 2);
  const weaponLines = [
    formatWeaponLine(snap.weapon, snap.offhand),
    snap.weapon2 || snap.offhand2 ? `Set II — ${formatWeaponLine(snap.weapon2, snap.offhand2)}` : ''
  ].filter(Boolean);
  const combat = [...(snap.ailmentList || []), ...(snap.tacticList || [])].filter(Boolean);
  const supports = [...(snap.synergySupports || []), ...(snap.synergySupports2 || [])]
    .map((entry) => createNamedItem(getGemDisplayName(entry), 'SUPPORT', getGemDescription(entry)))
    .filter((item) => item.name);
  const buffName = snap.recommendedPersistentBuff ? getGemDisplayName(snap.recommendedPersistentBuff) : '';
  const persistentBuff = buffName ? createNamedItem(buffName, 'PERSISTENT_BUFF', getGemDescription(snap.recommendedPersistentBuff)) : null;
  const uniqueNames = Array.isArray(snap.recommendedUniques) ? snap.recommendedUniques.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean) : [];
  const passivesRaw = snap.passives || {};
  const passiveNames = [
    ...(passivesRaw.ascendancyNodes || []),
    ...(passivesRaw.keystones || []),
    ...(passivesRaw.notables || [])
  ]
    .map((item) => item?.name)
    .filter(Boolean)
    .filter((name, idx, arr) => arr.indexOf(name) === idx);

  return {
    type: CARD_TYPE_BUILD,
    title: snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' '),
    subtitle: snap.flavor || '',
    shareCode: window.RandomancerEncodeSnapshot?.(snap) || '',
    frontSections: [
      { label: 'Ascendancy', values: snap.ascendancy ? [createNamedItem(snap.ascendancy)] : [] },
      { label: 'Weapons', values: weaponLines.map((name) => createNamedItem(name)) },
      { label: 'Combat', values: combat.map((name) => createNamedItem(name)) },
      { label: 'Defense', values: snap.defStrat ? [createNamedItem(snap.defStrat)] : [] },
      { label: 'Skills', values: skills }
    ],
    backSections: [
      { label: 'Supports', values: supports },
      { label: 'Persistent Buff', values: persistentBuff ? [persistentBuff] : [] },
      { label: 'Uniques', values: uniqueNames.map((name) => createNamedItem(name, 'UNIQUE', getUniqueDescription(name))) },
      { label: 'Passives', values: passiveNames.map((name) => createNamedItem(name, 'PASSIVE', getPassiveDescription(name))) }
    ]
  };
}

function deriveChallengeCardModel(contract) {
  if (!contract) return null;
  const anchor = (contract.tasks || []).find((task) => task?.role === 'anchor') || null;
  const twist = (contract.tasks || []).find((task) => task?.role === 'twist') || null;
  const clauses = (contract.tasks || []).map((task) => ({
    label: task.shortLabel || task.role || 'Clause',
    line: task.line || '',
    slotEntries: Object.entries(task.slots || {})
      .filter(([, value]) => value)
      .map(([slotKey, value]) => createNamedItem(String(value), slotKey, slotKey === 'ACTIVE_SKILL' ? getGemDescription(value) : getPassiveDescription(value)))
  }));
  return {
    type: CARD_TYPE_CHALLENGE,
    title: contract.title || 'Challenge Contract',
    subtitle: contract.subtitle || '',
    severity: contract.severity || '',
    anchor: anchor?.line || '',
    twist: twist?.line || '',
    clauses,
    shareCode: window.RandomancerEncodeChallengeContract?.(contract) || ''
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

function renderNamedChip(item, dense = false) {
  const attrs = [];
  if (item?.description && SKILL_TOOLTIP_KEYS.has(item.slotKey)) {
    attrs.push('class="card-chip has-tip"');
    attrs.push(`data-tip-title="${escapeHtml(item.name)}"`);
    attrs.push(`data-tip-body="${escapeHtml(item.description)}"`);
    attrs.push('tabindex="0"');
  } else {
    attrs.push('class="card-chip"');
  }
  if (dense) attrs.push('data-dense="1"');
  return `<span ${attrs.join(' ')}>${escapeHtml(item?.name || '')}</span>`;
}

function renderBuildCard(model, face = 'front') {
  const isBack = face === 'back';
  const sections = isBack ? model.backSections : model.frontSections;
  return `
    <article class="rc-card rc-card--build${isBack ? ' is-back' : ' is-front'}">
      <header class="rc-card__header">
        <div class="rc-card__eyebrow">${isBack ? 'Build Card — Back' : 'Build Card'}</div>
        <h2 class="rc-card__title">${escapeHtml(model.title || 'Build Card')}</h2>
        ${model.subtitle ? `<p class="rc-card__subtitle">${escapeHtml(model.subtitle)}</p>` : ''}
      </header>
      <div class="rc-card__sections">
        ${sections.filter((section) => section.values?.length).map((section) => `
          <section class="rc-card__section">
            <div class="rc-card__section-label">${escapeHtml(section.label)}</div>
            <div class="rc-card__chiplist${isBack ? ' rc-card__chiplist--dense' : ''}">
              ${section.values.map((item) => renderNamedChip(item, isBack)).join('')}
            </div>
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
    const replacement = renderNamedChip(entry);
    line = line.replace(escapeHtml(entry.name), replacement);
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
      <header class="rc-card__header">
        <div class="rc-card__eyebrow">Challenge Card</div>
        <h2 class="rc-card__title">${escapeHtml(model.title || 'Challenge Contract')}</h2>
        ${model.subtitle ? `<p class="rc-card__subtitle">${escapeHtml(model.subtitle)}</p>` : ''}
      </header>
      <div class="rc-card__sections rc-card__sections--contract">
        ${model.anchor ? `<section class="rc-card__section"><div class="rc-card__section-label">Anchor</div><div class="rc-contract__line">${escapeHtml(model.anchor)}</div></section>` : ''}
        ${model.twist ? `<section class="rc-card__section"><div class="rc-card__section-label">Twist</div><div class="rc-contract__line">${escapeHtml(model.twist)}</div></section>` : ''}
        ${model.severity ? `<section class="rc-card__section"><div class="rc-card__section-label">Severity</div><div class="rc-contract__line">${escapeHtml(model.severity)}</div></section>` : ''}
        ${model.clauses?.length ? `<section class="rc-card__section"><div class="rc-card__section-label">Contract</div><div class="rc-contract__clauses">${model.clauses.map(renderChallengeClause).join('')}</div></section>` : ''}
      </div>
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
  if (!text) return false;
  return window.RandomancerCopyTextToClipboard ? window.RandomancerCopyTextToClipboard(text) : false;
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

function setOverlayContent({ type, html, actionsHtml, faceControlsHtml = '', error = '' }) {
  const overlay = getCardOverlay();
  if (!overlay) return;
  overlay.dataset.cardType = type || '';
  const body = overlay.querySelector('#card-overlay-body');
  const actions = overlay.querySelector('#card-overlay-actions');
  const controls = overlay.querySelector('#card-overlay-face-controls');
  const errorEl = overlay.querySelector('#card-overlay-error');
  if (body) body.innerHTML = html || '';
  if (actions) actions.innerHTML = actionsHtml || '';
  if (controls) controls.innerHTML = faceControlsHtml || '';
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
  const actions = `
    <button type="button" class="copy-menu-item" data-card-action="copy-link"><span class="copy-menu-label">Copy Link</span></button>
    <button type="button" class="copy-menu-item" data-card-action="save"><span class="copy-menu-label">Save</span></button>
    <button type="button" class="copy-menu-item" data-card-action="poe"><span class="copy-menu-label">Poe.ninja</span></button>
  `;
  const controls = `
    <button type="button" class="rc-face-toggle${face === 'front' ? ' is-active' : ''}" data-card-face="front">Front</button>
    <button type="button" class="rc-face-toggle${face === 'back' ? ' is-active' : ''}" data-card-face="back">Back</button>
  `;
  setOverlayContent({ type: CARD_TYPE_BUILD, html: renderBuildCard(model, face), actionsHtml: actions, faceControlsHtml: controls });
  return true;
}

function renderChallengeCardOverlay() {
  const model = deriveChallengeCardModel(window.CURRENT_CHALLENGE_CONTRACT);
  if (!model) {
    setOverlayContent({ type: CARD_TYPE_CHALLENGE, error: 'Challenge card could not be loaded.', html: '', actionsHtml: '' });
    return false;
  }
  const actions = `
    <button type="button" class="copy-menu-item" data-card-action="copy-link"><span class="copy-menu-label">Copy Link</span></button>
    <button type="button" class="copy-menu-item" data-card-action="save"><span class="copy-menu-label">Save</span></button>
  `;
  setOverlayContent({ type: CARD_TYPE_CHALLENGE, html: renderChallengeCard(model), actionsHtml: actions });
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
  else renderBuildCardOverlay(overlay.querySelector('[data-card-face].is-active')?.dataset.cardFace || 'front');
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
    }
    if (action === 'save') {
      if (overlay.dataset.cardType === CARD_TYPE_CHALLENGE) window.RandomancerSaveCurrentChallenge?.();
      else window.RandomancerSaveCurrentBuild?.();
      refreshOpenCardOverlay();
      window.RandomancerShowToast?.('Saved locally.');
    }
    if (action === 'poe') {
      const snap = window.App?.state?.currentRoll || window.CURRENT_ROLL;
      const url = window.RandomancerBuildPoeNinjaUrl?.(snap);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
    const face = evt.target.closest('[data-card-face]')?.dataset.cardFace;
    if (face) renderBuildCardOverlay(face);
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
  return [...model.frontSections, ...model.backSections]
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
