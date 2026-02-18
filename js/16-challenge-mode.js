import { ensureDataPreload } from './08-data-load.js';
import { generateChallengeContract, loadChallengeLibrary } from './15-challenge-engine.js';
import { getFamilySkillNames, resolveSkillFamily } from './17-skill-family-utils.js';

const MODE_KEY = 'randomancer_mode';
const MODES = {
  STANDARD: 'standard',
  CHALLENGE: 'challenge'
};
const SEVERITY_ORDER = ['mild', 'cruel', 'diabolical'];
let challengeHasRoll = false;
let challengeTaskCount = 2;
let challengeSeverity = 'cruel';

const STANDARD_LEDE_HTML = 'Tune <strong>Cohesion</strong> for tighter themes or wilder chaos. Use <strong>Bind the Fates</strong> to favor or ban certain options. Toggle <strong>Weapon Set II</strong> for an additional weapon set, and choose <strong>Combat Mechanics</strong>: 1-3 for ailment/tactic depth.<br><strong>---</strong><br>Click <strong>Roll Your Fate</strong> to begin.';
const CHALLENGE_LEDE_TEXT = '<strong>Challenge Mode</strong> rolls a <strong>Contract</strong>, not a build. Choose 1–3 <strong>Tasks</strong>, set <strong>Severity</strong>, then <strong>Roll Your Fate</strong> to receive a stacked set of constraints to overcome.<br><strong>---</strong><br>Click <strong>Roll Your Fate</strong> to begin.';

let CHALLENGE_TEMPLATE_BY_ID = Object.create(null);

function buildTemplateSegments(template, slots) {
  const str = String(template || '');
  const re = /\{([A-Z0-9_]+)\}/g;
  const out = [];
  let last = 0;
  let m;

  while ((m = re.exec(str))) {
    const start = m.index;
    const key = m[1];
    if (start > last) out.push({ t: str.slice(last, start), hi: false });

    const has = slots && slots[key] != null;
    const val = has ? String(slots[key]) : `{${key}}`;
    out.push({ t: val, hi: has, k: key });

    last = start + m[0].length;
  }
  if (last < str.length) out.push({ t: str.slice(last), hi: false });

  return out;
}


// -------------------------
// Inline tooltips for Contract values (Active Skills / Keystones)
// -------------------------
let __RC_TIP_EL = null;
let __RC_TIP_PINNED = false;
let __RC_TIP_TARGET = null;
let __RC_GEM_BY_NAME = null;
let __RC_PASSIVE_BY_NAME = null;
let __RC_TIP_BOUND = false;

// Hover persistence: keep tooltip open while either the trigger or the tooltip panel is hovered.
let __RC_TIP_HIDE_TIMER = null;
let __RC_TIP_HOVER_TRIGGER = false;
let __RC_TIP_HOVER_PANEL = false;

// Scroll affordances for long tooltip lists
const __RC_TIP_SCROLL_MAX_PX = 280;

function clearTipHideTimer() {
  if (!__RC_TIP_HIDE_TIMER) return;
  clearTimeout(__RC_TIP_HIDE_TIMER);
  __RC_TIP_HIDE_TIMER = null;
}

function scheduleTipHide(delayMs = 220) {
  clearTipHideTimer();
  __RC_TIP_HIDE_TIMER = setTimeout(() => {
    __RC_TIP_HIDE_TIMER = null;
    if (__RC_TIP_PINNED) return;
    if (__RC_TIP_HOVER_TRIGGER) return;
    if (__RC_TIP_HOVER_PANEL) return;
    hideTooltip();
  }, delayMs);
}

function syncTooltipScrollState() {
  const tip = ensureTooltipEl();
  const linesEl = tip.querySelector('.rc-tooltip__lines');
  if (!linesEl) {
    tip.classList.remove('is-scroll', 'is-at-bottom');
    return false;
  }

  // Reset scroll each time we show a tooltip.
  linesEl.scrollTop = 0;

  // Default CSS has no max-height; compare natural height against our cap.
  const needsScroll = linesEl.scrollHeight > (__RC_TIP_SCROLL_MAX_PX + 2);
  tip.classList.toggle('is-scroll', needsScroll);

  if (!needsScroll) {
    tip.classList.remove('is-at-bottom');
    return false;
  }

  // After enabling scroll, compute bottom-state for the fade.
  requestAnimationFrame(() => updateTooltipAtBottom());
  return true;
}

function updateTooltipAtBottom() {
  const tip = ensureTooltipEl();
  if (!tip.classList.contains('is-scroll')) {
    tip.classList.remove('is-at-bottom');
    return;
  }
  const linesEl = tip.querySelector('.rc-tooltip__lines');
  if (!linesEl) return;
  const atBottom = (linesEl.scrollTop + linesEl.clientHeight) >= (linesEl.scrollHeight - 2);
  tip.classList.toggle('is-at-bottom', atBottom);
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
  const s = String(str == null ? '' : str);
  return s
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function gemIndexByName() {
  if (__RC_GEM_BY_NAME) return __RC_GEM_BY_NAME;
  const map = Object.create(null);
  const gems = window.DATA?.gems || [];
  gems.forEach(g => {
    const name = g?.base_item?.display_name || g?.name;
    if (!name) return;
    if (!map[name]) map[name] = g;
  });
  __RC_GEM_BY_NAME = map;
  return map;
}

function passiveIndexByName() {
  if (__RC_PASSIVE_BY_NAME) return __RC_PASSIVE_BY_NAME;
  const map = Object.create(null);
  const nodes = window.DATA?.passivesEnriched?.nodes || [];
  nodes.forEach(n => {
    if (!n?.name) return;
    if (!map[n.name]) map[n.name] = n;
  });
  __RC_PASSIVE_BY_NAME = map;
  return map;
}

function getTooltipPayload(slotKey, value) {
  if (!slotKey || !value) return null;

  if (slotKey === 'ACTIVE_SKILL') {
    const gem = gemIndexByName()[value];
    if (!gem) return null;

    const desc = stripBracketMarkup(gem.description || gem.support_text || '');
    if (!desc) return null;

    return { title: value, lines: [desc] };
  }

  if (slotKey === 'KEYSTONE') {
    const lib = window.DATA?.keystoneTooltips || {};
    const entry = lib[value] || lib[value?.replace(/[’]/g, "'")];
    let lines = Array.isArray(entry?.lines) ? entry.lines.slice() : null;

    if (!lines || !lines.length) {
      const node = passiveIndexByName()[value];
      lines = Array.isArray(node?.lines) ? node.lines.slice() : [];
    }

    lines = (lines || [])
      .map(l => String(l))
      .map(l => stripBracketMarkup(l))
      .filter(Boolean);

    if (!lines.length) return null;
    return { title: value, lines };
  }


  if (slotKey.startsWith('SKILL_FAMILY')) {
    const core = window.DATA || {};
    const lib = core.skillFamilyLib;
    const index = core.skillFamilyIndex;
    if (!lib || !index) return null;

    // Prefer exact match (names are authored). Fallback to case-insensitive lookup.
    let fam = core.skillFamilyByName?.[value] || null;
    if (!fam) {
      const keys = Object.keys(core.skillFamilyByName || {});
      const hit = keys.find(k => String(k).toLowerCase() === String(value).toLowerCase());
      fam = hit ? core.skillFamilyByName[hit] : null;
    }
    if (!fam) return null;

    let matchIds = null;
    if (core.skillFamilyResolved && typeof core.skillFamilyResolved.get === 'function') {
      matchIds = core.skillFamilyResolved.get(fam.name);
    }
    if (!matchIds) {
      matchIds = resolveSkillFamily(fam, index, lib);
    }
    if (!matchIds || matchIds.size === 0) return null;

    const { names, total, remaining } = getFamilySkillNames(fam, index, matchIds, { max: 28 });
    const lines = names.slice();
    if (remaining > 0) lines.push(`… +${remaining} more`);
    return { title: `${fam.name} (${total})`, lines };
  }
  return null;
}

function ensureTooltipEl() {
  if (__RC_TIP_EL) return __RC_TIP_EL;
  const el = document.createElement('div');
  el.id = 'rc-inline-tooltip';
  el.className = 'rc-tooltip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);

  // Option B: tooltip stays open while hovered (desktop mouse), enabling scroll.
  el.addEventListener('pointerenter', (evt) => {
    if (__RC_TIP_PINNED) return;
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    __RC_TIP_HOVER_PANEL = true;
    clearTipHideTimer();
  });

  el.addEventListener('pointerleave', (evt) => {
    if (__RC_TIP_PINNED) return;
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    __RC_TIP_HOVER_PANEL = false;
    scheduleTipHide(220);
  });

  __RC_TIP_EL = el;
  return el;
}

function renderTooltip(payload) {
  const el = ensureTooltipEl();
  const title = payload?.title || '';
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  el.innerHTML = `
    <div class="rc-tooltip__title">${escapeHtml(title)}</div>
    <div class="rc-tooltip__lines">
      ${lines.map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      <div class="rc-tooltip__fade" aria-hidden="true"></div>
    </div>
    <div class="rc-tooltip__hint"></div>
  `;

  // Only show scroll styling (and the “scroll” hint) if the list actually overflows.
  const needsScroll = syncTooltipScrollState();

  // Wire scroll listener to update fade visibility.
  const linesEl = el.querySelector('.rc-tooltip__lines');
  if (linesEl) {
    linesEl.addEventListener('scroll', () => updateTooltipAtBottom(), { passive: true });
  }

  const hintEl = el.querySelector('.rc-tooltip__hint');
  if (hintEl) {
    hintEl.textContent = needsScroll ? 'Move into panel to scroll • Tap to pin' : 'Tap to pin';
  }
}

function positionTooltip(target) {
  const el = ensureTooltipEl();
  if (!target || !document.body.contains(target)) return;

  // Stage offscreen to measure
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  el.style.transform = 'translate(-50%, -110%)';
  el.classList.add('is-open');

  const rect = target.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();

  const margin = 10;
  const pad = 10;

  let x = rect.left + rect.width / 2;
  const half = tipRect.width / 2;
  x = Math.max(pad + half, Math.min(window.innerWidth - pad - half, x));

  // Prefer above; flip below if needed
  let aboveTop = rect.top - tipRect.height - margin;
  const canFitAbove = aboveTop > pad;
  const y = canFitAbove ? (rect.top - margin) : (rect.bottom + margin);

  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  el.style.transform = canFitAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
}

function showTooltipFor(target, pinned = false) {
  const slotKey = target?.dataset?.slotKey;
  const value = (target?.textContent || '').trim();
  const payload = getTooltipPayload(slotKey, value);
  if (!payload) return;

  clearTipHideTimer();

  __RC_TIP_TARGET = target;
  __RC_TIP_PINNED = Boolean(pinned);

  renderTooltip(payload);

  // Next frame for stable layout
  requestAnimationFrame(() => positionTooltip(target));
}

function hideTooltip() {
  const el = ensureTooltipEl();
  el.classList.remove('is-open', 'is-scroll', 'is-at-bottom');
  __RC_TIP_TARGET = null;
  __RC_TIP_PINNED = false;
  __RC_TIP_HOVER_TRIGGER = false;
  __RC_TIP_HOVER_PANEL = false;
  clearTipHideTimer();
}

function initChallengeInlineTooltips() {
  if (__RC_TIP_BOUND) return;
  __RC_TIP_BOUND = true;

  const host = document.getElementById('challenge-contract-lines');
  if (!host) return;

  const isTipTarget = (evtTarget) => {
    const el = evtTarget?.closest?.('.task-val.has-tip');
    if (!el) return null;
    if (!host.contains(el)) return null;
    return el;
  };

  // Hover (mouse)
  host.addEventListener('pointerover', (evt) => {
    if (__RC_TIP_PINNED) return;
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    const el = isTipTarget(evt.target);
    if (!el) return;
    __RC_TIP_HOVER_TRIGGER = true;
    clearTipHideTimer();
    showTooltipFor(el, false);
  });

  host.addEventListener('pointerout', (evt) => {
    if (__RC_TIP_PINNED) return;
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    const from = isTipTarget(evt.target);
    if (!from) return;
    const toEl = evt.relatedTarget && isTipTarget(evt.relatedTarget);
    if (toEl === from) return;

    // Leaving the trigger: allow time to move into the tooltip panel.
    __RC_TIP_HOVER_TRIGGER = false;
    scheduleTipHide(220);
  });

  // Keyboard focus
  host.addEventListener('focusin', (evt) => {
    if (__RC_TIP_PINNED) return;
    const el = isTipTarget(evt.target);
    if (!el) return;
    showTooltipFor(el, false);
  });

  host.addEventListener('focusout', (evt) => {
    if (__RC_TIP_PINNED) return;
    const el = isTipTarget(evt.target);
    if (!el) return;
    hideTooltip();
  });

  // Tap / touch pinning
  host.addEventListener('pointerdown', (evt) => {
    const el = isTipTarget(evt.target);
    if (!el) return;

    // For touch/pen, toggle pin. For mouse, leave hover behavior.
    if (evt.pointerType === 'mouse') return;
    evt.preventDefault();
    evt.stopPropagation();

    if (__RC_TIP_PINNED && __RC_TIP_TARGET === el) {
      hideTooltip();
      return;
    }
    showTooltipFor(el, true);
  });

  // Click outside closes pinned tooltip
  document.addEventListener('pointerdown', (evt) => {
    if (!__RC_TIP_PINNED) return;
    const el = ensureTooltipEl();
    if (el.contains(evt.target)) return;
    if (__RC_TIP_TARGET && __RC_TIP_TARGET.contains(evt.target)) return;
    hideTooltip();
  });

  // Keep tooltip positioned during layout changes
  window.addEventListener('resize', () => {
    if (!__RC_TIP_TARGET) return;
    requestAnimationFrame(() => positionTooltip(__RC_TIP_TARGET));
  });
  window.addEventListener('scroll', () => {
    if (!__RC_TIP_TARGET) return;
    requestAnimationFrame(() => positionTooltip(__RC_TIP_TARGET));
  }, true);
}


function stabilizeLedeHeight() {
  const lede = document.getElementById('app-lede');
  if (!lede) return;

  const previous = lede.innerHTML;
  const previousMinHeight = lede.style.minHeight;
  lede.style.minHeight = '';

  lede.innerHTML = STANDARD_LEDE_HTML;
  const standardHeight = lede.offsetHeight;

  lede.innerHTML = CHALLENGE_LEDE_TEXT;
  const challengeHeight = lede.offsetHeight;

  lede.innerHTML = previous;
  const targetHeight = Math.max(standardHeight, challengeHeight);
  lede.style.minHeight = `${targetHeight}px`;

  if (previousMinHeight && Number.parseFloat(previousMinHeight) > targetHeight) {
    lede.style.minHeight = previousMinHeight;
  }
}

function getMode() {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === MODES.CHALLENGE) return MODES.CHALLENGE;
  } catch {}
  return MODES.STANDARD;
}

function setMode(mode) {
  const next = mode === MODES.CHALLENGE ? MODES.CHALLENGE : MODES.STANDARD;
  try { localStorage.setItem(MODE_KEY, next); } catch {}
  try { document.dispatchEvent(new CustomEvent('randomancer:mode-change', { detail: { mode: next } })); } catch {}
  return next;
}

function setChallengeVisibility(active) {
  const standardControls = document.getElementById('standard-controls');
  const challengeControls = document.getElementById('challenge-controls');

  standardControls?.classList.toggle('is-hidden', active);
  challengeControls?.classList.toggle('is-hidden', !active);
}

function setHeaderLede(mode) {
  const lede = document.getElementById('app-lede');
  if (!lede) return;
  if (mode === MODES.CHALLENGE) {
    lede.innerHTML = CHALLENGE_LEDE_TEXT;
  } else {
    lede.innerHTML = STANDARD_LEDE_HTML;
  }
}

function setChallengePanels(active) {
  const challengePanel = document.getElementById('challenge-panel');
  const challengeDivider = document.getElementById('challenge-empty-divider');
  const challengeFlavor = document.getElementById('challenge-empty-flavor');
  const buildBanner = document.getElementById('build-roll-banner');
  const buildPanel = document.getElementById('build-panel');
  const skillsPanel = document.getElementById('skills-panel');
  const uniquesPanel = document.getElementById('uniques-panel');
  const passivesPanel = document.getElementById('passives-panel');
  const emptyState = document.getElementById('empty-state');
  const hasStandardRoll = document.getElementById('app')?.dataset?.hasRoll === 'true';

  const showChallengeEmpty = active && !challengeHasRoll;
  const showChallengePanel = active && challengeHasRoll;
  const showStandardEmpty = !active && !hasStandardRoll;

  challengePanel?.classList.toggle('is-hidden', !showChallengePanel);
  challengeDivider?.classList.toggle('is-hidden', !showChallengeEmpty);
  challengeFlavor?.classList.toggle('is-hidden', !showChallengeEmpty);
  buildBanner?.classList.toggle('is-hidden', active);
  buildPanel?.classList.toggle('is-hidden', active);
  skillsPanel?.classList.toggle('is-hidden', active);
  uniquesPanel?.classList.toggle('is-hidden', active);
  passivesPanel?.classList.toggle('is-hidden', active);

  if (emptyState) {
    emptyState.classList.toggle('is-hidden', !showStandardEmpty);
  }
}

function setChallengeFlavorLine() {
  const challengeFlavor = document.getElementById('challenge-empty-flavor');
  if (!challengeFlavor) return;
  const pool = Array.isArray(window.RandomancerIntroLines) ? window.RandomancerIntroLines : [];
  if (!pool.length) return;
  challengeFlavor.textContent = pool[Math.floor(Math.random() * pool.length)];
}

function renderChallengeContract(contract) {
  if (!contract || typeof contract !== 'object') return;
  const title = document.getElementById('challenge-contract-title');
  const subtitle = document.getElementById('challenge-contract-subtitle');
  const list = document.getElementById('challenge-contract-lines');

  if (title) title.textContent = contract.title;
  if (subtitle) subtitle.textContent = contract.subtitle;
  if (list) {
    list.innerHTML = '';
    contract.tasks.forEach(task => {
      const row = document.createElement('div');
      row.className = 'summary-row';

      const label = document.createElement('span');
      label.className = 'summary-label';
      label.textContent = String(task.shortLabel || task.role || 'Clause');

      const dash = document.createElement('span');
      dash.className = 'summary-dash';
      dash.textContent = ' • ';

      const content = document.createElement('span');
			content.className = 'summary-content';
			
			// Build segments from the authoritative template (so saved codes highlight correctly)
			const template = task?.id ? CHALLENGE_TEMPLATE_BY_ID[task.id] : null;
			const segments = template ? buildTemplateSegments(template, task?.slots || {}) : null;
			
			if (Array.isArray(segments) && segments.length) {
				segments.forEach(seg => {
					if (!seg || seg.t == null) return;
					if (seg.hi) {
						const v = document.createElement('span');
						const slotKey = seg.k;
						const wantsTip = slotKey === 'ACTIVE_SKILL' || slotKey === 'KEYSTONE' || slotKey.startsWith('SKILL_FAMILY');
						v.className = wantsTip ? 'task-val has-tip' : 'task-val';
						if (wantsTip) {
							v.dataset.slotKey = slotKey;
							v.tabIndex = 0;
						}
						v.textContent = seg.t;
						content.appendChild(v);
					} else {
						content.appendChild(document.createTextNode(seg.t));
					}
				});
			} else {
				// Fallback (should be rare): render the prefilled line
				content.textContent = task.line;
			}
			
			row.append(label, dash, content);
			list.appendChild(row);

    });
  }

  challengeHasRoll = true;
  window.CURRENT_CHALLENGE_CONTRACT = contract;
  try { document.dispatchEvent(new CustomEvent('randomancer:challenge-rendered')); } catch {}

  setChallengePanels(true);
}

function updateChallengeTaskButton() {
  const btn = document.getElementById('challenge-task-count-btn');
  if (!btn) return;
  btn.setAttribute('aria-label', `Tasks: ${challengeTaskCount}`);
  btn.querySelectorAll('.rm-dotstep__dot').forEach(dot => {
    const n = Number(dot.dataset.dot || 0);
    dot.classList.toggle('is-on', n <= challengeTaskCount);
  });
}

function titleCaseSeverity(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function updateChallengeSeverityButton() {
  const btn = document.getElementById('challenge-severity-btn');
  const text = document.getElementById('challenge-severity-value');
  if (btn) btn.setAttribute('aria-label', `Severity: ${titleCaseSeverity(challengeSeverity)}`);
  if (text) text.textContent = titleCaseSeverity(challengeSeverity);
}

function bindChallengeControls() {
  const taskBtn = document.getElementById('challenge-task-count-btn');
  const severityBtn = document.getElementById('challenge-severity-btn');

  taskBtn?.addEventListener('click', () => {
    challengeTaskCount = challengeTaskCount >= 3 ? 1 : challengeTaskCount + 1;
    updateChallengeTaskButton();
  });

  severityBtn?.addEventListener('click', () => {
    const idx = SEVERITY_ORDER.indexOf(challengeSeverity);
    challengeSeverity = SEVERITY_ORDER[(idx + 1) % SEVERITY_ORDER.length];
    updateChallengeSeverityButton();
  });

  updateChallengeTaskButton();
  updateChallengeSeverityButton();
}

async function handleChallengeRoll({ statusEl }) {
  await ensureDataPreload();
  const contract = await generateChallengeContract({ taskCount: challengeTaskCount, severity: challengeSeverity });

  renderChallengeContract(contract);
  if (statusEl) statusEl.textContent = '';
  return true;
}

function syncMode(mode) {
  const isChallenge = mode === MODES.CHALLENGE;
  const modeToggle = document.getElementById('randomancer-mode-toggle');
  const modeToggleControl = document.getElementById('randomancer-mode-control');
  const app = document.getElementById('app');

  document.body?.classList.toggle('challenge-mode', isChallenge);
  setHeaderLede(mode);
  setChallengeVisibility(isChallenge);
  setChallengePanels(isChallenge);

  if (app) {
    app.classList.remove('mode-content-fade');
    void app.offsetWidth;
    app.classList.add('mode-content-fade');
  }

  if (modeToggle) modeToggle.checked = isChallenge;
  modeToggleControl?.classList.toggle('is-challenge', isChallenge);
}

document.addEventListener('DOMContentLoaded', async () => {
  const modeToggle = document.getElementById('randomancer-mode-toggle');
  const initialMode = getMode();

  stabilizeLedeHeight();
  setChallengeFlavorLine();
  bindChallengeControls();
  initChallengeInlineTooltips();
  syncMode(initialMode);
  try { document.dispatchEvent(new CustomEvent('randomancer:mode-change', { detail: { mode: initialMode } })); } catch {}

  window.addEventListener('resize', stabilizeLedeHeight);

  modeToggle?.addEventListener('change', event => {
    const nextMode = setMode(event.target?.checked ? MODES.CHALLENGE : MODES.STANDARD);
    syncMode(nextMode);
  });

	try {
		const lib = await loadChallengeLibrary();
		CHALLENGE_TEMPLATE_BY_ID = Object.create(null);
		(Array.isArray(lib) ? lib : []).forEach(t => {
			if (t?.id && t?.template) CHALLENGE_TEMPLATE_BY_ID[t.id] = t.template;
		});
	} catch {}

});

window.RandomancerHandleRollOverride = async ({ statusEl }) => {
  if (getMode() !== MODES.CHALLENGE) return false;

  try {
    if (statusEl) statusEl.textContent = 'Forging your contract…';
    await handleChallengeRoll({ statusEl });
  } catch (err) {
    console.error('[Randomancer][Challenge] roll failed', err);
    if (statusEl) statusEl.textContent = 'Challenge generation failed. Try again.';
  }
  return true;
};

window.RandomancerRenderChallengeContract = (contract) => {
  renderChallengeContract(contract);
};

window.RandomancerSetMode = (mode) => {
  const next = setMode(mode);
  syncMode(next);
  return next;
};
