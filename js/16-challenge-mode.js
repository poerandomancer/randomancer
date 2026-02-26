import { ensureDataPreload } from './08-data-load.js';
import { generateChallengeContract, loadChallengeLibrary } from './15-challenge-engine.js';
import { getFamilySkillNames, resolveSkillFamily } from './17-skill-family-utils.js';

const MODE_KEY = 'randomancer_mode';
const STASHED_BUILD_KEY = 'stashedBuildState';
const STASHED_CHALLENGE_KEY = 'stashedChallengeState';
const MODE_TRANSITION_MS = 380;
const MODES = {
  STANDARD: 'standard',
  CHALLENGE: 'challenge'
};
const SEVERITY_ORDER = ['mild', 'cruel', 'diabolical'];
let challengeHasRoll = false;
let challengeTaskCount = 2;
let challengeSeverity = 'cruel';
let stashedBuildState = null;
let stashedChallengeState = null;

const STANDARD_LEDE_HTML = 'Tune <strong>Cohesion</strong> for tighter themes or wilder chaos. Use <strong>Bind the Fates</strong> to favor or ban certain options. Toggle <strong>Weapon Set II</strong> for an additional weapon set, and choose <strong>Combat Mechanics</strong>: 1-3 for ailment/tactic depth.<br><strong>---</strong><br>Click <strong>Roll Your Fate</strong> to begin.';
const CHALLENGE_LEDE_TEXT = '<strong>Challenge Mode</strong> rolls a <strong>Contract</strong>, not a build. Use <strong>Bind the Fates</strong> to favor or ban certain options. Choose 1–3 <strong>Tasks</strong>, set <strong>Severity</strong>, then <strong>Draft a Contract</strong> to receive a stacked set of constraints to overcome.<br><strong>---</strong><br>Click <strong>Draft Contract</strong> to begin.';

let CHALLENGE_TEMPLATE_BY_ID = Object.create(null);

function getSkillFamilyCountByName(familyName) {
  const core = window.DATA || {};
  const byName = core.skillFamilyByName || {};
  const lib = core.skillFamilyLib;
  const index = core.skillFamilyIndex;
  if (!familyName || !lib || !index) return 0;

  let fam = byName[familyName] || null;
  if (!fam) {
    const keys = Object.keys(byName);
    const hit = keys.find(k => String(k).toLowerCase() === String(familyName).toLowerCase());
    fam = hit ? byName[hit] : null;
  }
  if (!fam) return 0;

  let matchIds = null;
  if (core.skillFamilyResolved && typeof core.skillFamilyResolved.get === 'function') {
    matchIds = core.skillFamilyResolved.get(fam.name);
  }
  if (!matchIds) matchIds = resolveSkillFamily(fam, index, lib);
  return matchIds?.size || 0;
}

function skillFamilyRulePhrase(count) {
  if (count >= 12) return 'use only';
  if (count >= 5) return 'primarily use';
  return 'use at least one skill from';
}

function inferSkillFamilyRulePhrase(familyName) {
  const n = getSkillFamilyCountByName(familyName);
  if (!n) return null;
  return skillFamilyRulePhrase(n);
}

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

    let has = slots && slots[key] != null;
    let val = has ? String(slots[key]) : `{${key}}`;

    // Back-compat: older saved contracts won't have *_RULE filled
    if (!has && (key === 'SKILL_FAMILY_RULE' || key === 'SKILL_FAMILY_2_RULE')) {
      const baseKey = (key === 'SKILL_FAMILY_RULE') ? 'SKILL_FAMILY' : 'SKILL_FAMILY_2';
      const inferred = inferSkillFamilyRulePhrase(slots?.[baseKey]);
      if (inferred) {
        has = true;
        val = inferred;
      }
    }

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
let __RC_TIP_FAMILY_SELECTED = null;
let __RC_TIP_FAMILY_PINNED = false;

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


  if (slotKey === 'SKILL_FAMILY' || slotKey === 'SKILL_FAMILY_2') {
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
    return {
      kind: 'family',
      title: `${fam.name} (${total})`,
      skills: names,
      remaining,
      defaultSkill: names[0] || null
    };
  }
  return null;
}

function getSkillDescription(skillName) {
  const gem = gemIndexByName()[skillName];
  const desc = stripBracketMarkup(gem?.description || gem?.support_text || '');
  return desc || 'No description available.';
}

function setFamilySelected(skillName, { pinned = false } = {}) {
  const tip = ensureTooltipEl();
  if (!tip.classList.contains('rc-tooltip--family')) return;

  __RC_TIP_FAMILY_SELECTED = skillName || null;
  if (pinned) __RC_TIP_FAMILY_PINNED = true;

  const selectedName = __RC_TIP_FAMILY_SELECTED;
  const buttons = tip.querySelectorAll('.rc-tip-skill');
  buttons.forEach(btn => {
    const on = btn.dataset.skill === selectedName;
    btn.classList.toggle('is-selected', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const titleEl = tip.querySelector('.rc-tooltip__detail-title');
  const bodyEl = tip.querySelector('.rc-tooltip__detail-body');
  if (titleEl) titleEl.textContent = selectedName || '';
  if (bodyEl) bodyEl.textContent = selectedName ? getSkillDescription(selectedName) : '';
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
  const isFamily = payload?.kind === 'family' && Array.isArray(payload?.skills);

  el.classList.toggle('rc-tooltip--family', isFamily);

  if (isFamily) {
    const skills = payload.skills;
    const defaultSkill = payload.defaultSkill || skills[0] || null;
    __RC_TIP_FAMILY_PINNED = false;
    
    el.classList.remove('is-scroll', 'is-at-bottom');

    el.innerHTML = `
      <div class="rc-tooltip__title">${escapeHtml(payload?.title || '')}</div>
      <div class="rc-tooltip__grid">
        <div class="rc-tooltip__skilllist" role="listbox" aria-label="Skills in family">
          ${skills.map((skill, idx) => `
            <button
              type="button"
              class="rc-tip-skill${skill === defaultSkill || (idx === 0 && !defaultSkill) ? ' is-selected' : ''}"
              data-skill="${escapeHtml(skill)}"
              role="option"
              aria-selected="${skill === defaultSkill || (idx === 0 && !defaultSkill) ? 'true' : 'false'}"
            >${escapeHtml(skill)}</button>
          `).join('')}
          ${payload.remaining > 0 ? `<div class="rc-tip-more">… +${payload.remaining} more</div>` : ''}
        </div>

        <div class="rc-tooltip__detail" aria-live="polite">
          <div class="rc-tooltip__detail-title"></div>
          <div class="rc-tooltip__detail-body"></div>
        </div>
      </div>
      <div class="rc-tooltip__hint">Hover a skill to preview • Click to pin/unpin selection • Tap to pin tooltip</div>
    `;

    setFamilySelected(defaultSkill);
    return;
  }

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
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = rect.left + rect.width / 2;
  const half = tipRect.width / 2;
  x = Math.max(pad + half, Math.min(vw - pad - half, x));

  const aboveTop = rect.top - tipRect.height - margin;
  const belowTop = rect.bottom + margin;
  const canFitAbove = aboveTop >= pad;
  const canFitBelow = (belowTop + tipRect.height) <= (vh - pad);

  let yTop = canFitAbove ? aboveTop : belowTop;
  if (!canFitAbove && !canFitBelow) {
    const spaceAbove = rect.top - pad;
    const spaceBelow = vh - rect.bottom - pad;
    yTop = (spaceBelow >= spaceAbove) ? belowTop : aboveTop;
  }

  const maxTop = Math.max(pad, vh - pad - tipRect.height);
  yTop = Math.max(pad, Math.min(maxTop, yTop));

  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(yTop)}px`;
  el.style.transform = 'translate(-50%, 0)';
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
  el.classList.remove('is-open', 'is-scroll', 'is-at-bottom', 'rc-tooltip--family');
  __RC_TIP_TARGET = null;
  __RC_TIP_PINNED = false;
  __RC_TIP_HOVER_TRIGGER = false;
  __RC_TIP_HOVER_PANEL = false;
  __RC_TIP_FAMILY_SELECTED = null;
  __RC_TIP_FAMILY_PINNED = false;
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

  // Family tooltip interaction (single popover, list->detail)
  document.addEventListener('pointerover', (evt) => {
    const tip = __RC_TIP_EL;
    if (!tip || !tip.classList.contains('rc-tooltip--family')) return;
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    const btn = evt.target?.closest?.('.rc-tip-skill');
    if (!btn || !tip.contains(btn)) return;
    if (__RC_TIP_FAMILY_PINNED) return;
    setFamilySelected(btn.dataset.skill || null);
  });

  document.addEventListener('focusin', (evt) => {
    const tip = __RC_TIP_EL;
    if (!tip || !tip.classList.contains('rc-tooltip--family')) return;
    const btn = evt.target?.closest?.('.rc-tip-skill');
    if (!btn || !tip.contains(btn)) return;
    if (__RC_TIP_FAMILY_PINNED) return;
    setFamilySelected(btn.dataset.skill || null);
  });

	document.addEventListener('click', (evt) => {
		const tip = __RC_TIP_EL;
		if (!tip || !tip.classList.contains('rc-tooltip--family')) return;
	
		const btn = evt.target?.closest?.('.rc-tip-skill');
		if (!btn || !tip.contains(btn)) return;
	
		const skill = btn.dataset.skill || null;
		if (!skill) return;
	
		const isKeyboardClick = evt.detail === 0; // Enter/Space-triggered click
	
		// Keyboard: treat as "select only" (no pinning side effects)
		if (isKeyboardClick) {
			setFamilySelected(skill); // does not change pinned state
		} else {
			// Mouse/tap: click pins; clicking the selected skill again toggles pin on/off
			const clickedSame = (skill === __RC_TIP_FAMILY_SELECTED);
	
			if (clickedSame) {
				__RC_TIP_FAMILY_PINNED = !__RC_TIP_FAMILY_PINNED; // toggle
				// If toggling ON, pass pinned:true to ensure internal state is consistent.
				setFamilySelected(skill, { pinned: __RC_TIP_FAMILY_PINNED });
			} else {
				__RC_TIP_FAMILY_PINNED = true;          // force pin on new selection
				setFamilySelected(skill, { pinned: true });
			}
		}
	
		// Update hint copy to reflect pinned state
		const hintEl = tip.querySelector('.rc-tooltip__hint');
		if (hintEl) {
			hintEl.textContent = __RC_TIP_FAMILY_PINNED
				? 'Pinned selection • Click selected skill again to unpin • Tap to pin tooltip'
				: 'Hover a skill to preview • Click to pin/unpin selection • Tap to pin tooltip';
		}
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

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runModeTransition(label, swapFn) {
  const overlay = document.getElementById('modeTransition');
  const labelEl = document.getElementById('modeTransitionLabel');
  if (!overlay || prefersReducedMotion()) {
    swapFn?.();
    return;
  }

  if (labelEl) labelEl.textContent = label || '';
  overlay.classList.add('is-on');
  await sleep(MODE_TRANSITION_MS);
  swapFn?.();
  await sleep(MODE_TRANSITION_MS);
  overlay.classList.remove('is-on');
}

function cloneJsonSafe(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {}
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function persistStash() {
  try {
    if (stashedBuildState) localStorage.setItem(STASHED_BUILD_KEY, JSON.stringify(stashedBuildState));
    else localStorage.removeItem(STASHED_BUILD_KEY);
    if (stashedChallengeState) localStorage.setItem(STASHED_CHALLENGE_KEY, JSON.stringify(stashedChallengeState));
    else localStorage.removeItem(STASHED_CHALLENGE_KEY);
  } catch {}
}

function hydrateStash() {
  try {
    stashedBuildState = JSON.parse(localStorage.getItem(STASHED_BUILD_KEY) || 'null');
    stashedChallengeState = JSON.parse(localStorage.getItem(STASHED_CHALLENGE_KEY) || 'null');
    if (!isValidStashableBuildState(stashedBuildState)) stashedBuildState = null;
    if (!isValidStashableChallengeState(stashedChallengeState)) stashedChallengeState = null;
    persistStash();
  } catch {
    stashedBuildState = null;
    stashedChallengeState = null;
  }
}

function isValidStashableBuildState(snap) {
  if (!snap || typeof snap !== 'object') return false;
  const hasCoreIdentity = !!(snap.className || snap.ascendancy || snap.buildName);
  const hasCoreSelections = !!(snap.weapon || snap.defense || snap.tactics || snap.ailments);
  const hasSkills = Array.isArray(snap.recommendedSkills) && snap.recommendedSkills.length > 0;
  return hasCoreIdentity || hasCoreSelections || hasSkills;
}

function isValidStashableChallengeState(contract) {
  if (!contract || typeof contract !== 'object') return false;
  const hasTitle = typeof contract.title === 'string' && contract.title.trim().length > 0;
  const hasTasks = Array.isArray(contract.tasks) && contract.tasks.length > 0;
  return hasTitle && hasTasks;
}

function clearChallengeResultsToEmpty() {
  challengeHasRoll = false;
  window.CURRENT_CHALLENGE_CONTRACT = null;
  const title = document.getElementById('challenge-contract-title');
  const subtitle = document.getElementById('challenge-contract-subtitle');
  const list = document.getElementById('challenge-contract-lines');
  if (title) title.textContent = '';
  if (subtitle) subtitle.textContent = '';
  if (list) list.innerHTML = '';
}

function updateResumePrompts(mode) {
  const app = document.getElementById('app');
  const hasBuildRoll = app?.dataset?.hasRoll === 'true';
  const resumeBtn = document.getElementById('resumeRollBtn');

  const showBuildResume = mode === MODES.STANDARD && !hasBuildRoll && !!stashedBuildState;
  const showChallengeResume = mode === MODES.CHALLENGE && !challengeHasRoll && !!stashedChallengeState;
  const isChallengeResume = showChallengeResume && !showBuildResume;

  if (!resumeBtn) return;
  const show = showBuildResume || showChallengeResume;
  resumeBtn.classList.toggle('is-hidden', !show);
  if (!show) return;

  const label = isChallengeResume ? 'Resume last Contract' : 'Resume last Build';
  resumeBtn.setAttribute('title', label);
  resumeBtn.setAttribute('aria-label', label);
  resumeBtn.dataset.resumeMode = isChallengeResume ? MODES.CHALLENGE : MODES.STANDARD;
}

function stashCurrentBuildState() {
  const hasBuildRoll = document.getElementById('app')?.dataset?.hasRoll === 'true';
  if (!hasBuildRoll) return;
  const snap = typeof window.RandomancerGetCurrentBuildSnapshot === 'function'
    ? window.RandomancerGetCurrentBuildSnapshot()
    : cloneJsonSafe(window.App?.state?.currentRoll || window.CURRENT_ROLL);
  if (!isValidStashableBuildState(snap)) return;
  stashedBuildState = snap;
  persistStash();
}

function stashCurrentChallengeState() {
  if (!challengeHasRoll) return;
  const contract = cloneJsonSafe(window.CURRENT_CHALLENGE_CONTRACT);
  if (!isValidStashableChallengeState(contract)) return;
  stashedChallengeState = contract;
  persistStash();
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

  if (standardControls) {
    Array.from(standardControls.children || []).forEach((child) => {
      const keepVisible = child.classList?.contains('bind-fates-row');
      child.classList.toggle('is-hidden', active && !keepVisible);
    });
  }
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

  updateResumePrompts(active ? MODES.CHALLENGE : MODES.STANDARD);
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
						const wantsTip =
							slotKey === 'ACTIVE_SKILL' ||
							slotKey === 'KEYSTONE' ||
							slotKey === 'SKILL_FAMILY' ||
							slotKey === 'SKILL_FAMILY_2';
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
  if (window.App?.setChallengeFates && contract?.challengeFates) {
    window.App.setChallengeFates(contract.challengeFates);
  }
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
  const contract = await generateChallengeContract({
    taskCount: challengeTaskCount,
    severity: challengeSeverity,
    challengeFates: window.App?.getChallengeFates?.()
  });

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
  if (document.body) document.body.dataset.mode = isChallenge ? 'challenge' : 'build';
  setHeaderLede(mode);
  setChallengeVisibility(isChallenge);
  setChallengePanels(isChallenge);

  if (app && !isChallenge && app.dataset.hasRoll !== 'true') {
    app.dataset.hasRoll = 'false';
    const ascArt = document.getElementById('asc-art');
    if (ascArt) {
      ascArt.classList.remove('show');
      ascArt.style.removeProperty('--asc-img');
      delete ascArt.dataset.ascPath;
    }
  }

  const rollText = document.querySelector('#roll .roll-text');
  if (rollText) rollText.textContent = isChallenge ? 'Draft Contract' : 'Roll Your Fate';

  if (modeToggle) modeToggle.checked = isChallenge;
  modeToggleControl?.classList.toggle('is-challenge', isChallenge);
}

document.addEventListener('DOMContentLoaded', async () => {
  const modeToggle = document.getElementById('randomancer-mode-toggle');
  const initialMode = getMode();

  // Mode toggle labels
  const stdLabel = document.querySelector('.mode-toggle-text[data-mode="standard"]');
  const chLabel  = document.querySelector('.mode-toggle-text[data-mode="challenge"]');
  if (stdLabel) stdLabel.textContent = 'Build Mode';
  if (chLabel)  chLabel.textContent  = 'Challenge Mode';

  hydrateStash();
  stabilizeLedeHeight();
  setChallengeFlavorLine();
  bindChallengeControls();
  initChallengeInlineTooltips();
  syncMode(initialMode);
  try { document.dispatchEvent(new CustomEvent('randomancer:mode-change', { detail: { mode: initialMode } })); } catch {}

  window.addEventListener('resize', stabilizeLedeHeight);


  const resumeRollBtn = document.getElementById('resumeRollBtn');
  resumeRollBtn?.addEventListener('click', () => {
    const target = resumeRollBtn.dataset.resumeMode;
    if (target === MODES.STANDARD) {
      if (!stashedBuildState) return;
      if (typeof window.RandomancerRenderBuildSnapshot === 'function') {
        window.RandomancerRenderBuildSnapshot(cloneJsonSafe(stashedBuildState));
        stashedBuildState = null;
        persistStash();
        updateResumePrompts(MODES.STANDARD);
      }
      return;
    }

    if (target === MODES.CHALLENGE) {
      if (!stashedChallengeState) return;
      renderChallengeContract(cloneJsonSafe(stashedChallengeState));
      stashedChallengeState = null;
      persistStash();
      updateResumePrompts(MODES.CHALLENGE);
    }
  });

  modeToggle?.addEventListener('change', async event => {
    const targetMode = event.target?.checked ? MODES.CHALLENGE : MODES.STANDARD;
    const label = targetMode === MODES.CHALLENGE
      ? 'Entering Challenge Mode…'
      : 'Returning to Build Mode…';

    await runModeTransition(label, () => {
      const nextMode = setMode(targetMode);
      syncMode(nextMode);
    });
  });

	try {
		const lib = await loadChallengeLibrary();
		CHALLENGE_TEMPLATE_BY_ID = Object.create(null);
		(Array.isArray(lib) ? lib : []).forEach(t => {
			if (t?.id && t?.template) CHALLENGE_TEMPLATE_BY_ID[t.id] = t.template;
		});
	} catch {}

});


window.RandomancerPrepareBuildRoll = () => {
  stashCurrentChallengeState();
  clearChallengeResultsToEmpty();
  updateResumePrompts(MODES.STANDARD);
};

window.RandomancerPrepareChallengeRoll = () => {
  stashCurrentBuildState();
  if (typeof window.RandomancerClearBuildResults === 'function') {
    window.RandomancerClearBuildResults();
  }
  updateResumePrompts(MODES.CHALLENGE);
};

window.RandomancerGetMode = getMode;
window.RandomancerClearChallengeResults = clearChallengeResultsToEmpty;
window.RandomancerAfterBuildRoll = () => {
  updateResumePrompts(MODES.STANDARD);
};


window.RandomancerHandleRollOverride = async ({ statusEl }) => {
  if (getMode() !== MODES.CHALLENGE) return false;

  try {
    if (typeof window.RandomancerPrepareChallengeRoll === 'function') {
      window.RandomancerPrepareChallengeRoll();
    }
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
