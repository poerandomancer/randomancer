import { formatWeaponLine } from './01-meta-and-domready.js';
import { buildGemDictionary, lookupGem } from './05-tags-and-scorer.js';

const CARD_TYPE_BUILD = 'build';
const BUILD_CARD_FACES = Object.freeze({ FRONT: 'front', BACK: 'back' });
const TOOLTIP_KEYS = new Set(['ACTIVE_SKILL', 'UNIQUE', 'ASCENDANCY_PASSIVE', 'NOTABLE']);
const mountedCards = new WeakMap();

let tooltipEl = null;
let tooltipTarget = null;
let tooltipPinned = false;
let uniqueSourceCache = null;
let uniqueSourcePromise = null;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripMarkup(value) {
  return String(value == null ? '' : value)
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBalance(attributes) {
  const raw = attributes && typeof attributes === 'object' ? attributes : {};
  const clamp = (value) => Math.max(0, Number(value) || 0);
  const strength = clamp(raw.strength);
  const dexterity = clamp(raw.dexterity);
  const intelligence = clamp(raw.intelligence);
  const total = strength + dexterity + intelligence;
  if (!(total > 0)) return { strength: 1 / 3, dexterity: 1 / 3, intelligence: 1 / 3 };
  return {
    strength: strength / total,
    dexterity: dexterity / total,
    intelligence: intelligence / total
  };
}

function getGem(entry) {
  if (!entry) return null;
  const key = entry?.id || entry?.name || entry;
  return lookupGem(buildGemDictionary(window.DATA?.gems || []), key) || null;
}

function getGemName(entry) {
  const gem = getGem(entry);
  return gem?.name || entry?.name || String(entry?.id || entry || '');
}

function getGemDescription(entry) {
  const gem = getGem(entry);
  return stripMarkup(gem?.description || gem?.support_text || gem?.grants || '');
}

function skillRolePrefix(entry, index, weaponSet) {
  const role = entry?.recommendationV3?.assignedRole;
  const roleLabel = {
    primary_damage: 'Primary',
    secondary_damage: 'Secondary',
    setup_control: 'Setup',
    payoff: 'Payoff',
    enabler: 'Enabler'
  }[role] || (index === 0 ? 'Primary' : 'Setup');
  return weaponSet ? `${weaponSet} · ${roleLabel}` : roleLabel;
}

function getPassiveDescription(entry) {
  const name = entry?.name || '';
  const fromData = (window.DATA?.passivesEnriched?.nodes || []).find((node) => node?.name === name);
  const lines = Array.isArray(fromData?.lines) && fromData.lines.length ? fromData.lines : (entry?.lines || []);
  return (Array.isArray(lines) ? lines : []).map(stripMarkup).filter(Boolean).join(' ');
}

function normalizeUniqueSource(source) {
  if (Array.isArray(source)) return source.filter(Boolean);
  if (Array.isArray(source?.items)) return source.items.filter(Boolean);
  if (source?.items && typeof source.items === 'object') return Object.values(source.items).filter(Boolean);
  if (source?.by_key && typeof source.by_key === 'object') return Object.values(source.by_key).filter(Boolean);
  return [];
}

function getUniqueSourceCollection() {
  if (Array.isArray(uniqueSourceCache) && uniqueSourceCache.length) return uniqueSourceCache;
  const source = window.DATA?.uniques || window.DATA?.poe2dbUniques || window.DATA?.poe2db_uniques_min || [];
  const items = normalizeUniqueSource(source);
  if (items.length) uniqueSourceCache = items;
  return items.length ? items : (Array.isArray(uniqueSourceCache) ? uniqueSourceCache : []);
}

async function ensureBuildCardUniqueData() {
  const existing = getUniqueSourceCollection();
  if (existing.length) return existing;
  if (!uniqueSourcePromise) {
    uniqueSourcePromise = fetch('data/enriched/poe2db_uniques_min.json', { cache: 'force-cache' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        uniqueSourceCache = normalizeUniqueSource(payload);
        return uniqueSourceCache;
      })
      .catch(() => [])
      .finally(() => { uniqueSourcePromise = null; });
  }
  return uniqueSourcePromise;
}

function getUniqueDescription(name) {
  const items = getUniqueSourceCollection();
  const found = items.find((entry) => entry?.name === name || entry?.base_item?.display_name === name || entry?.source?.label === name);
  const base = found?.base || found?.base_item?.display_name || found?.slot || '';
  const mods = Array.isArray(found?.explicit_mods) ? found.explicit_mods : (found?.lines || found?.explicit || []);
  return [base, ...(Array.isArray(mods) ? mods : [])].map(stripMarkup).filter(Boolean).slice(0, 7);
}

function getAscendancyArtPath(ascendancy) {
  if (!ascendancy) return '';
  const slug = String(ascendancy).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `/images/ascendancies/${slug}.webp`;
}

function item(name, options = {}) {
  return {
    name: String(name || '').trim(),
    prefix: options.prefix || '',
    meta: options.meta || '',
    slotKey: options.slotKey || '',
    tipTitle: options.tipTitle || String(name || '').trim(),
    tipLines: Array.isArray(options.tipLines) ? options.tipLines.filter(Boolean) : []
  };
}

function deriveBuildCardModel(snapshot) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
  if (!snap) return null;

  const weapon1 = formatWeaponLine(snap.weapon, snap.offhand);
  const weapon2 = snap.weapon2 || snap.offhand2 ? formatWeaponLine(snap.weapon2, snap.offhand2) : '';
  const mechanics = [...(snap.ailmentList || []), ...(snap.tacticList || [])].filter(Boolean);

  const skillItems = (entries, weaponSet) => (entries || []).slice(0, 2).map((entry, index) =>
    {
      const supports = Array.isArray(entry?.recommendationV3?.supports)
        ? entry.recommendationV3.supports.slice(0, 2)
        : [];
      const supportNames = supports.map(getGemName).filter(Boolean);
      const supportLines = supports.map((support) => {
        const name = getGemName(support);
        const description = getGemDescription(support);
        return [name, description].filter(Boolean).join(': ');
      }).filter(Boolean);
      return item(getGemName(entry), {
        prefix: skillRolePrefix(entry, index, weaponSet),
        meta: supportNames.length ? ` · Supports: ${supportNames.join(' + ')}` : '',
        slotKey: 'ACTIVE_SKILL',
        tipLines: [getGemDescription(entry), ...supportLines].filter(Boolean)
      });
    }
  );
  const hasSecondWeaponSet = Boolean((snap.recommendedSkills2 || []).length);
  const skills = [
    ...skillItems(snap.recommendedSkills, hasSecondWeaponSet ? 'Set I' : ''),
    ...skillItems(snap.recommendedSkills2, 'Set II')
  ];

  const uniques = (snap.recommendedUniques || [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.name)
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => item(name, { slotKey: 'UNIQUE', tipLines: getUniqueDescription(name) }));

  const passives = snap.passives && typeof snap.passives === 'object' ? snap.passives : {};
  const passiveIdeas = [
    ...(passives.ascendancyNodes || []).slice(0, 2).map((entry) => item(entry?.name, {
      prefix: 'Ascendancy',
      slotKey: 'ASCENDANCY_PASSIVE',
      tipLines: [getPassiveDescription(entry)].filter(Boolean)
    })),
    ...(passives.notables || []).slice(0, 3).map((entry) => item(entry?.name, {
      prefix: 'Notable',
      slotKey: 'NOTABLE',
      tipLines: [getPassiveDescription(entry)].filter(Boolean)
    }))
  ].filter((entry) => entry.name);

  return {
    type: CARD_TYPE_BUILD,
    title: snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' '),
    subtitle: snap.flavor || '',
    artPath: getAscendancyArtPath(snap.ascendancy),
    frontRows: [
      { label: 'Ascendancy', values: snap.ascendancy ? [item(snap.ascendancy, { meta: snap.className || '' })] : [] },
      { label: 'Weapons', values: [weapon1 ? item(weapon1, { prefix: 'Set I' }) : null, weapon2 ? item(weapon2, { prefix: 'Set II' }) : null].filter(Boolean) },
      { label: 'Combat', values: mechanics.map((name) => item(name)) }
    ],
    balance: normalizeBalance(snap.attributes || snap.rollAttr),
    backSections: [
      { label: 'Skill Ideas', values: skills },
      { label: 'Unique Ideas', values: uniques },
      { label: 'Passive Ideas', values: passiveIdeas }
    ]
  };
}

function renderName(entry, face) {
  const classes = ['rc-name'];
  if (face === BUILD_CARD_FACES.BACK) classes.push('rc-name--back');
  const hasTip = entry?.tipLines?.length && TOOLTIP_KEYS.has(entry.slotKey);
  if (hasTip) classes.push('has-tip');
  const attrs = [`class="${classes.join(' ')}"`];
  if (hasTip) {
    attrs.push(`tabindex="0"`);
    attrs.push(`data-tip-title="${escapeHtml(entry.tipTitle || entry.name)}"`);
    attrs.push(`data-tip-lines="${escapeHtml(JSON.stringify(entry.tipLines))}"`);
  }
  const prefix = entry?.prefix ? `<span class="rc-name__prefix">${escapeHtml(entry.prefix)} — </span>` : '';
  const meta = entry?.meta ? `<span class="rc-name__meta">${escapeHtml(entry.meta)}</span>` : '';
  return `<span ${attrs.join(' ')}>${prefix}${escapeHtml(entry?.name || '')}${meta}</span>`;
}

function renderValues(values, face) {
  return (values || []).map((entry, index) => `${index ? '<span class="rc-sep">, </span>' : ''}${renderName(entry, face)}`).join('');
}

function renderBalance(balance) {
  const b = normalizeBalance(balance);
  const strength = Math.round(b.strength * 100);
  const dexterity = Math.round(b.dexterity * 100);
  const intelligence = Math.max(0, 100 - strength - dexterity);
  return `
    <section class="rc-card-balance" aria-label="Attribute balance: Strength ${strength}%, Dexterity ${dexterity}%, Intelligence ${intelligence}%">
      <div class="rc-card-balance__label">Balance</div>
      <div class="rc-card-balance__bar" style="--rc-balance-str:${strength}%;--rc-balance-dex:${dexterity}%;" aria-hidden="true"></div>
      <div class="rc-card-balance__values" aria-hidden="true"><span>STR ${strength}%</span><span>DEX ${dexterity}%</span><span>INT ${intelligence}%</span></div>
    </section>
  `;
}

function renderHeader(model, actionsHtml) {
  return `
    ${actionsHtml ? `<div class="rc-card__actions">${actionsHtml}</div>` : ''}
    <header class="rc-card__hero">
      <h2 class="rc-card__title">${escapeHtml(model.title || 'Build')}</h2>
      ${model.subtitle ? `<p class="rc-card__subtitle">${escapeHtml(model.subtitle)}</p>` : ''}
    </header>
  `;
}

function renderBuildCard(model, options = {}) {
  if (!model) return '';
  const face = options.face === BUILD_CARD_FACES.BACK ? BUILD_CARD_FACES.BACK : BUILD_CARD_FACES.FRONT;
  const isBack = face === BUILD_CARD_FACES.BACK;
  const style = model.artPath ? ` style="--card-art:url('${escapeHtml(model.artPath)}')"` : '';
  const label = isBack ? 'Return to Build' : 'Flip for Build Ideas';
  const flipCue = `<button type="button" class="card-flip-indicator" data-card-action="flip" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">↺</button>`;
  const footer = `<footer class="rc-card__fineprint">${escapeHtml(label)}</footer>`;
  const stageClass = options.stageClass || '';

  if (!isBack) {
    return `
      <div class="card-stage card-stage--build ${stageClass}">
        <article class="rc-card rc-card--build rc-card--front" data-card-flip-surface="1" tabindex="0" role="button" aria-label="${escapeHtml(label)}"${style}>
          ${renderHeader(model, options.actionsHtml || '')}
          <div class="rc-card__body rc-card__body--front">
            ${model.frontRows.filter((row) => row.values?.length).map((row) => `<section class="rc-print-row"><div class="rc-print-row__label">${escapeHtml(row.label)}</div><div class="rc-print-row__value">${renderValues(row.values, face)}</div></section>`).join('')}
            ${renderBalance(model.balance)}
          </div>
          ${footer}
        </article>
        ${flipCue}
      </div>
    `;
  }

  const sections = model.backSections.filter((section) => section.values?.length);
  return `
    <div class="card-stage card-stage--build ${stageClass}">
      <article class="rc-card rc-card--build rc-card--back" data-card-flip-surface="1" tabindex="0" role="button" aria-label="${escapeHtml(label)}"${style}>
        ${renderHeader(model, options.actionsHtml || '')}
        <div class="rc-card__body rc-card__body--back">
          <div class="rc-card-ideas__intro">Optional starting points, not build requirements.</div>
          ${sections.length ? sections.map((section) => `<section class="rc-print-block"><div class="rc-print-block__label">${escapeHtml(section.label)}</div><div class="rc-print-block__value">${renderValues(section.values, face)}</div></section>`).join('') : '<div class="rc-card-ideas__empty">No strong build ideas were found for this roll.</div>'}
        </div>
        ${footer}
      </article>
      ${flipCue}
    </div>
  `;
}

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'rc-build-card-tooltip';
  tooltipEl.className = 'rc-tooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function hideBuildCardTooltip() {
  tooltipEl?.classList.remove('is-open');
  tooltipTarget = null;
  tooltipPinned = false;
}

function showBuildCardTooltip(target, pinned = false) {
  let lines = [];
  try { lines = JSON.parse(target?.dataset?.tipLines || '[]'); } catch {}
  const title = target?.dataset?.tipTitle || target?.textContent?.trim();
  if (!title || !lines.length) return;
  const tooltip = ensureTooltip();
  const renderedLines = lines.map((line) => {
    const text = String(line || '');
    const synergyClass = /^Synergies:/i.test(text) ? ' rc-tooltip__line--synergy' : '';
    return `<div class="rc-tooltip__line${synergyClass}">${escapeHtml(text)}</div>`;
  }).join('');
  tooltip.innerHTML = `<div class="rc-tooltip__title">${escapeHtml(title)}</div><div class="rc-tooltip__lines">${renderedLines}</div><div class="rc-tooltip__hint">Tap to pin</div>`;
  tooltipTarget = target;
  tooltipPinned = pinned;
  tooltip.classList.add('is-open');
  const rect = target.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const pad = 10;
  let left = rect.left + rect.width / 2;
  left = Math.max(pad + tipRect.width / 2, Math.min(window.innerWidth - pad - tipRect.width / 2, left));
  let top = rect.top - tipRect.height - 10;
  if (top < pad) top = rect.bottom + 10;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(Math.max(pad, Math.min(window.innerHeight - tipRect.height - pad, top)))}px`;
}

function bindInteractions(root) {
  if (!root || root.dataset.buildCardBound === '1') return;
  root.dataset.buildCardBound = '1';

  root.addEventListener('mouseover', (event) => {
    if (tooltipPinned) return;
    const target = event.target.closest('.has-tip');
    if (target && root.contains(target)) showBuildCardTooltip(target, false);
  });
  root.addEventListener('mouseout', (event) => {
    const target = event.target.closest('.has-tip');
    if (target && root.contains(target) && !tooltipPinned) hideBuildCardTooltip();
  });
  root.addEventListener('focusin', (event) => {
    const target = event.target.closest('.has-tip');
    if (target && root.contains(target)) showBuildCardTooltip(target, false);
  });
  root.addEventListener('focusout', (event) => {
    const target = event.target.closest('.has-tip');
    if (target && root.contains(target) && !tooltipPinned) hideBuildCardTooltip();
  });
  root.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('.has-tip');
    if (!target || !root.contains(target) || event.pointerType === 'mouse') return;
    event.preventDefault();
    if (tooltipPinned && tooltipTarget === target) hideBuildCardTooltip();
    else showBuildCardTooltip(target, true);
  });

  const flip = () => {
    const state = mountedCards.get(root);
    if (!state) return;
    const nextFace = state.face === BUILD_CARD_FACES.BACK ? BUILD_CARD_FACES.FRONT : BUILD_CARD_FACES.BACK;
    mountBuildCard(root, state.model, { ...state.options, face: nextFace, animate: true });
    state.options.onFaceChange?.(nextFace);
  };

  root.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-card-action]');
    if (actionEl && root.contains(actionEl)) {
      const action = actionEl.dataset.cardAction || '';
      if (action === 'flip') return flip();
      return mountedCards.get(root)?.options?.onAction?.(action, actionEl, event);
    }
    const surface = event.target.closest('[data-card-flip-surface="1"]');
    if (!surface || !root.contains(surface) || event.target.closest('.has-tip, a, input, button')) return;
    flip();
  });
  root.addEventListener('keydown', (event) => {
    if (!event.target.closest('[data-card-flip-surface="1"]')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    flip();
  });
}

function mountBuildCard(root, model, options = {}) {
  if (!root || !model) return false;
  const face = options.face === BUILD_CARD_FACES.BACK ? BUILD_CARD_FACES.BACK : BUILD_CARD_FACES.FRONT;
  const animate = Boolean(options.animate) && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const storedOptions = { ...options, face, animate: false };
  mountedCards.set(root, { model, face, options: storedOptions });
  root.dataset.cardFace = face;
  root.innerHTML = renderBuildCard(model, { ...options, face, stageClass: animate ? 'is-flipping' : (options.stageClass || '') });
  bindInteractions(root);
  if (animate) window.setTimeout(() => root.querySelector('.card-stage--build')?.classList.remove('is-flipping'), 340);
  return true;
}

function mountBuildCardSnapshot(root, snapshot, options = {}) {
  return mountBuildCard(root, deriveBuildCardModel(snapshot), options);
}

function getBuildCardSummaryText(snapshot) {
  const model = deriveBuildCardModel(snapshot);
  if (!model) return '';
  return [...model.frontRows, ...model.backSections]
    .filter((section) => section.values?.length)
    .map((section) => `${section.label.toUpperCase()}: ${section.values.map((entry) => entry.name).join(' · ')}`)
    .join('\n');
}

if (typeof window !== 'undefined') {
  window.RandomancerBuildCard = Object.freeze({
    deriveModel: deriveBuildCardModel,
    render: renderBuildCard,
    mount: mountBuildCard,
    mountSnapshot: mountBuildCardSnapshot,
    ensureUniqueData: ensureBuildCardUniqueData,
    summaryText: getBuildCardSummaryText
  });
  document.addEventListener('pointerdown', (event) => {
    if (!tooltipPinned) return;
    const tooltip = ensureTooltip();
    if (tooltip.contains(event.target) || tooltipTarget?.contains?.(event.target)) return;
    hideBuildCardTooltip();
  });
}

export {
  CARD_TYPE_BUILD,
  BUILD_CARD_FACES,
  deriveBuildCardModel,
  renderBuildCard,
  mountBuildCard,
  mountBuildCardSnapshot,
  ensureBuildCardUniqueData,
  bindInteractions as bindBuildCardInteractions,
  hideBuildCardTooltip,
  getBuildCardSummaryText
};
