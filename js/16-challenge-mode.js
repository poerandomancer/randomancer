import { loadChallengeLibrary } from './15-challenge-engine.js';
import { generateContracts, renewalLabel } from './contracts.js';
import { getFamilySkillNames, resolveSkillFamily } from './17-skill-family-utils.js';
import { transitionAmbianceBackground } from './ascendancy-visuals.js';

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
let __RC_STRICT_UNIQUE_BY_SKILL = null;
let __RC_STRICT_UNIQUE_BY_NAME = null;
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

function strictUniquePoolIndexes() {
  if (__RC_STRICT_UNIQUE_BY_SKILL && __RC_STRICT_UNIQUE_BY_NAME) {
    return {
      bySkill: __RC_STRICT_UNIQUE_BY_SKILL,
      byUnique: __RC_STRICT_UNIQUE_BY_NAME
    };
  }
  const bySkill = Object.create(null);
  const byUnique = Object.create(null);
  const rows = window.DATA?.challengePools?.strictUniqueGrantedSkills || [];
  rows.forEach((row) => {
    const skill = String(row?.skillName || '').trim();
    const unique = String(row?.uniqueName || '').trim();
    if (skill && !bySkill[skill]) bySkill[skill] = row;
    if (unique && !byUnique[unique]) byUnique[unique] = row;
  });
  __RC_STRICT_UNIQUE_BY_SKILL = bySkill;
  __RC_STRICT_UNIQUE_BY_NAME = byUnique;
  return { bySkill, byUnique };
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

  if (slotKey === 'SKILL') {
    const strict = strictUniquePoolIndexes().bySkill?.[value];
    if (strict?.skillDescription) {
      return { title: value, lines: [stripBracketMarkup(strict.skillDescription)] };
    }
    const gem = gemIndexByName()[value];
    const desc = stripBracketMarkup(gem?.description || gem?.support_text || '');
    return desc ? { title: value, lines: [desc] } : null;
  }

  if (slotKey === 'UNIQUE') {
    const strict = strictUniquePoolIndexes().byUnique?.[value];
    if (strict?.uniqueSummary) {
      const lines = [stripBracketMarkup(strict.uniqueSummary)];
      if (strict?.requiredLevel) lines.push(`Required Level: ${strict.requiredLevel}`);
      return { title: value, lines };
    }
  }

  if (slotKey === 'KEYSTONE') {
    const node = passiveIndexByName()[value];
    let lines = Array.isArray(node?.lines) ? node.lines.slice() : [];

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


const MODES = { STANDARD: 'standard', CODEX: 'codex' };
const MODE_KEY = 'randomancer_mode';
const STANDARD_LEDE_HTML = '<strong>Draw Your Fate</strong> to randomly select an ascendancy, weapon, and one Offense concept. <strong>Flip the Card</strong> to reveal build ideas and suggestions. <strong>Bind the Fates</strong> to favor or ban certain options.';
const CODEX_LEDE_TEXT = '<strong>Codex Mode</strong> is a non-random library for browsing Path of Exile 2 data. Explore <strong>Ascendancy</strong>, <strong>Skills</strong>, <strong>Passives</strong>, and <strong>Gear</strong> with search and tags. <strong>Pin</strong> entries to create a poe.ninja filter to view endgame builds.<br><strong>---</strong><br>Select an entry to inspect full details.';
let contracts = null;
let activeCadence = 'daily';
let restoreFocus = null;
let renewalTimer = null;
let previousBackgroundPath = '';

function getMode() {
  try {
    if (new URLSearchParams(location.search).get('mode') === MODES.CODEX) return MODES.CODEX;
    return localStorage.getItem(MODE_KEY) === MODES.CODEX ? MODES.CODEX : MODES.STANDARD;
  } catch { return MODES.STANDARD; }
}
function setMode(mode) {
  const next = mode === MODES.CODEX ? MODES.CODEX : MODES.STANDARD;
  try { localStorage.setItem(MODE_KEY, next); } catch {}
  try {
    const params = new URLSearchParams(location.search);
    next === MODES.CODEX ? params.set('mode', next) : params.delete('mode');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  } catch {}
  document.body.dataset.mode = next === MODES.CODEX ? 'codex' : 'build';
  document.body.classList.toggle('codex-mode', next === MODES.CODEX);
  const codex = next === MODES.CODEX;
  document.getElementById('codex-panel')?.classList.toggle('is-hidden', !codex);
  ['primary-build-card-stage','build-roll-banner','build-panel','skills-panel','uniques-panel','passives-panel'].forEach(id => document.getElementById(id)?.classList.toggle('is-hidden', codex));
  const empty = document.getElementById('empty-state');
  empty?.classList.toggle('is-hidden', codex || document.getElementById('app')?.dataset.hasRoll === 'true');
  document.getElementById('standard-controls')?.classList.toggle('is-hidden', codex);
  const instructions = document.querySelector('[data-app-lede-instructions]');
  if (instructions) instructions.innerHTML = codex ? CODEX_LEDE_TEXT : STANDARD_LEDE_HTML;
  document.querySelectorAll('[data-mode-target]').forEach(btn => {
    const on = btn.dataset.modeTarget === next;
    btn.classList.toggle('is-active', on); btn.setAttribute('aria-selected', String(on));
  });
  document.dispatchEvent(new CustomEvent('randomancer:mode-change', { detail: { mode: next } }));
  return next;
}

function renderContractCard(card, item) {
  card.querySelector('.contracts-card__title').textContent = item.contract.title;
  card.querySelector('.contracts-card__renewal').textContent = renewalLabel(item.period, new Date());
  const list = card.querySelector('.contracts-card__lines');
  list.innerHTML = '';
  item.contract.tasks.forEach(task => {
    const row = document.createElement('div'); row.className = 'summary-row';
    const label = document.createElement('span'); label.className = 'summary-label'; label.textContent = task.shortLabel || task.role;
    const content = document.createElement('span'); content.className = 'summary-content';
    const template = CHALLENGE_TEMPLATE_BY_ID[task.id];
    const segments = template ? buildTemplateSegments(template, task.slots || {}) : null;
    (segments || [{ t: task.line }]).forEach(seg => {
      if (!seg.hi) return content.append(document.createTextNode(seg.t));
      const value = document.createElement('span');
      const tipKeys = ['ACTIVE_SKILL','SKILL','UNIQUE','KEYSTONE','SKILL_FAMILY','SKILL_FAMILY_2'];
      value.className = tipKeys.includes(seg.k) ? 'task-val has-tip' : 'task-val';
      value.textContent = seg.t;
      if (tipKeys.includes(seg.k)) { value.dataset.slotKey = seg.k; value.tabIndex = 0; }
      content.append(value);
    });
    row.append(label, document.createTextNode(' • '), content); list.append(row);
  });
}

function selectContract(cadence, focus = false) {
  activeCadence = cadence;
  document.querySelectorAll('.contracts-card').forEach(card => {
    const selected = card.dataset.cadence === cadence;
    card.classList.toggle('is-front', selected);
    card.setAttribute('aria-selected', String(selected));
    card.style.setProperty('--stack-order', selected ? 3 : 1);
  });
  if (focus) document.querySelector(`.contracts-card[data-cadence="${cadence}"]`)?.focus();
}

async function openContracts() {
  const overlay = document.getElementById('contracts-overlay');
  if (!overlay || !overlay.hidden) return;
  restoreFocus = document.activeElement;
  const backgroundHost = document.getElementById('asc-art');
  previousBackgroundPath = backgroundHost?.classList.contains('show')
    ? (backgroundHost.dataset.ascPath || '')
    : '';
  if (!contracts) contracts = await generateContracts(new Date());
  contracts.forEach(item => renderContractCard(overlay.querySelector(`[data-cadence="${item.period.cadence}"]`), item));
  selectContract('daily');
  overlay.hidden = false;
  document.body.classList.add('contracts-open');
  transitionAmbianceBackground('/images/challenge-background-blur.webp');
  overlay.querySelector('.contracts-close')?.focus();
  renewalTimer = setInterval(() => contracts.forEach(item => {
    overlay.querySelector(`[data-cadence="${item.period.cadence}"] .contracts-card__renewal`).textContent = renewalLabel(item.period, new Date());
  }), 60000);
}
function closeContracts() {
  const overlay = document.getElementById('contracts-overlay');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true; document.body.classList.remove('contracts-open');
  transitionAmbianceBackground(previousBackgroundPath);
  clearInterval(renewalTimer); renewalTimer = null;
  restoreFocus?.focus?.(); restoreFocus = null;
}

async function init() {
  initChallengeInlineTooltips();
  setMode(getMode());
  try {
    const lib = await loadChallengeLibrary();
    CHALLENGE_TEMPLATE_BY_ID = Object.create(null);
    lib.forEach(t => { if (t?.id && t?.template) CHALLENGE_TEMPLATE_BY_ID[t.id] = t.template; });
  } catch {}
  document.getElementById('randomancer-mode-control')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-mode-target]'); if (btn) setMode(btn.dataset.modeTarget);
  });
  document.getElementById('contracts-button')?.addEventListener('click', openContracts);
  document.querySelector('.contracts-close')?.addEventListener('click', closeContracts);
  document.querySelector('.contracts-backdrop')?.addEventListener('click', closeContracts);
  document.querySelectorAll('.contracts-card').forEach(card => card.addEventListener('click', () => selectContract(card.dataset.cadence)));
  document.addEventListener('keydown', e => {
    const overlay = document.getElementById('contracts-overlay');
    if (!overlay || overlay.hidden) return;
    if (e.key === 'Escape') return closeContracts();
    if (e.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button:not([disabled])')];
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
document.addEventListener('DOMContentLoaded', init);
window.RandomancerGetMode = getMode;
window.RandomancerSetMode = setMode;
