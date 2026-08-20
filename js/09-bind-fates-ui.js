import { getBindFatesFromApp } from './04-app-state.js';
import { ensureDataPreload } from './08-data-load.js';
import { loadChallengeLibrary } from './15-challenge-engine.js';

const BIND_FATES_STORAGE_KEY = 'randomancer_bind_fates_v1';
const CHALLENGE_FATES_STORAGE_KEY = 'randomancer_challenge_fates_v1';
const CHALLENGE_TWIST_CATEGORIES = ['Gearing', 'Gear Rarity', 'Defensive', 'Passive Tree', 'Skills', 'Attributes'];

function normalizeTemplateText(templateString) {
  return String(templateString || '')
    .replace(/\{SKILL_FAMILY_RULE\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCategory(task, cat) {
  const categories = Array.isArray(task?.categories) ? task.categories : [];
  return categories.includes(cat);
}

function ensureMode() {
  if (document.body?.classList.contains('challenge-mode')) return 'challenge';
  const mode = window.RandomancerGetMode?.();
  return mode === 'challenge' ? 'challenge' : 'standard';
}

function countBindFatesSelections(bind){
  const counts = { oaths: 0, abominations: 0 };
  Object.values(bind || {}).forEach((cfg) => {
    counts.oaths += Array.isArray(cfg?.oaths) ? cfg.oaths.length : 0;
    counts.abominations += Array.isArray(cfg?.abominations) ? cfg.abominations.length : 0;
  });
  return counts;
}

function countChallengeFatesSelections(fates) {
  const counts = { oaths: 0, abominations: 0 };
  Object.values(fates || {}).forEach((cfg) => {
    counts.oaths += Array.isArray(cfg?.favor) ? cfg.favor.length : 0;
    counts.abominations += Array.isArray(cfg?.ban) ? cfg.ban.length : 0;
  });
  return counts;
}

function updateBindFatesSummary(explicitMode){
  const summaryEl = document.getElementById('bind-fates-summary');
  const mode = explicitMode || ensureMode();
  const counts = mode === 'challenge'
    ? countChallengeFatesSelections(window.App?.getChallengeFates?.())
    : countBindFatesSelections(window.App?.getBindFates ? window.App.getBindFates() : getBindFatesFromApp());

  if (summaryEl) {
    summaryEl.textContent = (counts.oaths + counts.abominations) > 0
      ? `${counts.oaths} Oath${counts.oaths === 1 ? '' : 's'} | ${counts.abominations} Abomination${counts.abominations === 1 ? '' : 's'}`
      : 'No Fates Bound';
  }
}

function showBindFatesError(msg){
  const el = document.getElementById('bind-fates-error');
  if (!el) return;
  el.textContent = msg || '';
}

if (typeof window !== 'undefined') {
  window.showBindFatesError = showBindFatesError;
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ---------- wireup ----------
document.addEventListener('DOMContentLoaded', ()=>{
  const bindBar = document.getElementById('bind-fates-bar');
  const toggleBtn = bindBar?.querySelector('.bind-fates-toggle');
  const clearBtn = document.getElementById('bind-fates-clear');

  const modal = document.getElementById('bind-fates-modal');
  const modalBackdrop = modal?.querySelector('.bind-fates-backdrop');
  const modalClose = document.getElementById('bind-fates-close');
  const sectionEls = {
    ascendancy: modal?.querySelector('[data-category="ascendancy"]'),
    weapon: modal?.querySelector('[data-category="weapon"]'),
    combat: modal?.querySelector('[data-category="combat"]')
  };
  const dividerEls = Array.from(modal?.querySelectorAll('.bind-fates-divider') || []);

  const standardSections = {
    ascendancy: { listEl: document.getElementById('bind-fates-list-ascendancy'), heading: 'Ascendancy', hint: 'Swear Oaths to favored ascendancies, or name Abominations that fate will never grant.' },
    weapon: { listEl: document.getElementById('bind-fates-list-weapon'), heading: 'Weapon', hint: 'Bind yourself to chosen arms, or curse weapons you will never wield.' },
    combat: { listEl: document.getElementById('bind-fates-list-combat'), heading: 'Combat Mechanics', hint: 'Favor certain ailments or tactics, or name those that are forbidden.' }
  };

  const challengeSections = {
    anchors: { slot: 'ascendancy', heading: 'Anchor Templates', hint: 'Favor templates you want included, or ban templates you never want to see.' },
    twistCategories: { slot: 'weapon', heading: 'Twist Categories', hint: 'Favor or ban the challenge twist categories used during contract drafting.' }
  };

  let challengeLibrary = [];
  let originButton = null;

  const resolveData = async () => {
    const fromState = (window.App && window.App.state && window.App.state.DATA) || window.DATA;
    if (fromState) return fromState;
    try {
      const preload = await ensureDataPreload();
      return preload?.core || preload;
    } catch (e) {
      console.error('[BindFates] Unable to resolve data', e);
      return null;
    }
  };

  const getSectionMeta = (sectionEl) => {
    if (!sectionEl) return {};
    return {
      titleEl: sectionEl.querySelector('h4'),
      hintEl: sectionEl.querySelector('.bind-fates-hint')
    };
  };

  const setSectionWarning = (sectionEl, show) => {
    if (!sectionEl) return;
    let warningEl = sectionEl.querySelector('.bind-fates-warning');
    if (!warningEl) {
      warningEl = document.createElement('p');
      warningEl.className = 'bind-fates-hint bind-fates-warning';
      sectionEl.querySelector('.bind-fates-section-head')?.appendChild(warningEl);
    }
    warningEl.textContent = show ? 'No valid options match your current Oaths/Abominations.' : '';
    warningEl.hidden = !show;
  };

  const cycleOptionState = (btn) => {
    if (!btn) return;
    if (btn.classList.contains('is-oath')) {
      btn.classList.remove('is-oath');
      btn.classList.add('is-abomination');
    } else if (btn.classList.contains('is-abomination')) {
      btn.classList.remove('is-abomination');
    } else {
      btn.classList.add('is-oath');
    }
  };

  const renderOptions = (options, cfg, listEl, modeType) => {
    if (!listEl) return;
    listEl.innerHTML = '';
    options.forEach((opt) => {
      const name = typeof opt === 'string' ? opt : opt?.name;
      const label = typeof opt === 'string' ? opt : (opt?.label || opt?.name);
      if (!name || !label) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bind-option';
      btn.dataset.name = name;
      if (opt?.kind) btn.dataset.kind = opt.kind;
      if (modeType === 'challenge') {
        if (cfg?.favor?.includes(name)) btn.classList.add('is-oath');
        else if (cfg?.ban?.includes(name)) btn.classList.add('is-abomination');
      } else if (cfg?.oaths?.includes(name)) btn.classList.add('is-oath');
      else if (cfg?.abominations?.includes(name)) btn.classList.add('is-abomination');
      btn.textContent = label;
      btn.addEventListener('click', () => cycleOptionState(btn));
      listEl.appendChild(btn);
    });
  };

  const buildStandardOptions = (category, data) => {
    if (category === 'ascendancy') {
      const ascSet = new Set();
      Object.values(data.Classes || {}).forEach((cls) => {
        (cls?.ascendancies || []).forEach((name) => ascSet.add(name));
      });
      return Array.from(ascSet).sort();
    }
    if (category === 'weapon') {
      const two = Array.isArray(data.Weapons?.['Two-Handed']) ? data.Weapons['Two-Handed'] : [];
      const one = Array.isArray(data.Weapons?.['One-Handed']) ? data.Weapons['One-Handed'] : [];
      return [...two, ...one].map((w) => w.name);
    }
    if (category === 'defensiveStrategy') {
      return (data.DefensiveStrategies || []).map((strategy) => strategy?.name).filter(Boolean);
    }
    if (category === 'combat') {
      const ail = (data.Ailments || []).map((a) => ({ name: a.name, kind: 'ailment' }));
      const tac = (data.Tactics || []).map((t) => ({ name: t.name, kind: 'tactic' }));
      return [...ail, ...tac];
    }
    return [];
  };

  const buildChallengeOptions = () => {
    const anchorTemplateById = new Map();
    challengeLibrary
      .filter(task => task?.role === 'anchor')
      .forEach(task => {
        if (!task?.id || anchorTemplateById.has(task.id)) return;
        anchorTemplateById.set(task.id, { name: task.id, label: normalizeTemplateText(task.template || task.shortLabel || task.id) });
      });

    return {
      anchors: Array.from(anchorTemplateById.values()),
      twistCategories: CHALLENGE_TWIST_CATEGORIES.map(cat => ({ name: cat, label: cat }))
    };
  };

  const applyModeLayout = (mode) => {
    const isChallenge = mode === 'challenge';
    const asc = sectionEls.ascendancy;
    const weapon = sectionEls.weapon;
    const combat = sectionEls.combat;

    if (combat) combat.hidden = isChallenge;
    if (dividerEls[1]) dividerEls[1].hidden = isChallenge;
    if (dividerEls[2]) dividerEls[2].hidden = isChallenge;

    const setMeta = (sectionEl, heading, hint) => {
      const meta = getSectionMeta(sectionEl);
      if (meta.titleEl) meta.titleEl.textContent = heading;
      if (meta.hintEl) meta.hintEl.textContent = hint;
    };

    if (isChallenge) {
      setMeta(asc, challengeSections.anchors.heading, challengeSections.anchors.hint);
      setMeta(weapon, challengeSections.twistCategories.heading, challengeSections.twistCategories.hint);
      setSectionWarning(asc, false);
      setSectionWarning(weapon, false);
    } else {
      setMeta(asc, standardSections.ascendancy.heading, standardSections.ascendancy.hint);
      setMeta(weapon, standardSections.weapon.heading, standardSections.weapon.hint);
      setMeta(combat, standardSections.combat.heading, standardSections.combat.hint);
      setSectionWarning(asc, false);
      setSectionWarning(weapon, false);
      setSectionWarning(combat, false);
    }
  };

  const getChallengeWarningState = () => {
    const fates = window.App?.getChallengeFates?.() || {};
    const anchorCfg = fates.anchors || { favor: [], ban: [] };
    const twistCfg = fates.twistCategories || { favor: [], ban: [] };

    const anchorPool = challengeLibrary.filter(task => task?.role === 'anchor');
    const anchorAllowed = anchorPool.filter(task => !anchorCfg.ban.includes(task.id));
    const anchorFavoredAllowed = anchorAllowed.filter(task => anchorCfg.favor.includes(task.id));

    const twistPool = challengeLibrary.filter(task => task?.role === 'twist' && Array.isArray(task.categories) && task.categories.length);
    const allowedTwists = twistPool.filter(task => !twistCfg.ban.some(cat => hasCategory(task, cat)));
    const favoredAllowedTwists = allowedTwists.filter(task => twistCfg.favor.some(cat => hasCategory(task, cat)));

    return {
      anchors: anchorCfg.favor.length > 0 && !anchorFavoredAllowed.length,
      twistCategories: twistCfg.favor.length > 0 && !favoredAllowedTwists.length
    };
  };

  const hydrateFatesFromStorage = () => {
    const bind = readJsonStorage(BIND_FATES_STORAGE_KEY);
    if (bind && window.App?.setBindFatesCategory) {
      ['ascendancy', 'weapon', 'combat'].forEach((k) => window.App.setBindFatesCategory(k, bind[k] || {}));
    }
    const challenge = readJsonStorage(CHALLENGE_FATES_STORAGE_KEY);
    if (challenge && window.App?.setChallengeFates) {
      window.App.setChallengeFates(challenge);
    }
  };

  const persistBindFatesSelection = (mode) => {
    if (mode === 'challenge') {
      const next = { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } };

      const anchorsList = standardSections.ascendancy.listEl;
      anchorsList?.querySelectorAll('.bind-option').forEach((opt) => {
        const name = opt?.dataset?.name;
        if (!name) return;
        if (opt.classList.contains('is-oath')) next.anchors.favor.push(name);
        else if (opt.classList.contains('is-abomination')) next.anchors.ban.push(name);
      });

      const twistList = standardSections.weapon.listEl;
      twistList?.querySelectorAll('.bind-option').forEach((opt) => {
        const name = opt?.dataset?.name;
        if (!name) return;
        if (opt.classList.contains('is-oath')) next.twistCategories.favor.push(name);
        else if (opt.classList.contains('is-abomination')) next.twistCategories.ban.push(name);
      });

      window.App?.setChallengeFates?.(next);
      writeJsonStorage(CHALLENGE_FATES_STORAGE_KEY, next);
      const warn = getChallengeWarningState();
      setSectionWarning(sectionEls.ascendancy, warn.anchors);
      setSectionWarning(sectionEls.weapon, warn.twistCategories);
      return;
    }

    const payload = {};
    Object.entries(standardSections).forEach(([category, def]) => {
      const oaths = [];
      const abominations = [];
      def.listEl?.querySelectorAll('.bind-option').forEach((opt) => {
        const name = opt?.dataset?.name;
        if (!name) return;
        if (opt.classList.contains('is-oath')) oaths.push(name);
        else if (opt.classList.contains('is-abomination')) abominations.push(name);
      });
      payload[category] = { oaths, abominations };
      if (window.App?.setBindFatesCategory) window.App.setBindFatesCategory(category, { oaths, abominations });
    });
    writeJsonStorage(BIND_FATES_STORAGE_KEY, payload);
  };

  const clearBindFatesSelections = () => {
    const mode = ensureMode();
    if (mode === 'challenge') {
      window.App?.setChallengeFates?.({
        anchors: { favor: [], ban: [] },
        twistCategories: { favor: [], ban: [] }
      });
      writeJsonStorage(CHALLENGE_FATES_STORAGE_KEY, {
        anchors: { favor: [], ban: [] },
        twistCategories: { favor: [], ban: [] }
      });
      [standardSections.ascendancy.listEl, standardSections.weapon.listEl].forEach((listEl) => {
        listEl?.querySelectorAll('.bind-option').forEach((opt) => opt.classList.remove('is-oath', 'is-abomination'));
      });
    } else {
      Object.keys(standardSections).forEach((category) => {
        window.App?.setBindFatesCategory?.(category, { oaths: [], abominations: [] });
        standardSections[category].listEl?.querySelectorAll('.bind-option').forEach((opt) => {
          opt.classList.remove('is-oath', 'is-abomination');
        });
      });
      writeJsonStorage(BIND_FATES_STORAGE_KEY, {
        ascendancy: { oaths: [], abominations: [] },
        weapon: { oaths: [], abominations: [] },
        combat: { oaths: [], abominations: [] }
      });
    }
    updateBindFatesSummary();
    showBindFatesError('');
  };

  const openBindFatesModal = async (originBtn) => {
    const mode = ensureMode();
    const data = await resolveData();
    if (!modal || !data) return;
    originButton = originBtn || null;

    if (!challengeLibrary.length) {
      challengeLibrary = await loadChallengeLibrary();
    }

    applyModeLayout(mode);

    if (mode === 'challenge') {
      const current = window.App?.getChallengeFates?.() || { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } };
      const options = buildChallengeOptions();
      renderOptions(options.anchors, current.anchors, standardSections.ascendancy.listEl, 'challenge');
      renderOptions(options.twistCategories, current.twistCategories, standardSections.weapon.listEl, 'challenge');
      const warn = getChallengeWarningState();
      setSectionWarning(sectionEls.ascendancy, warn.anchors);
      setSectionWarning(sectionEls.weapon, warn.twistCategories);
    } else {
      const current = window.App?.getBindFates ? window.App.getBindFates() : getBindFatesFromApp();
      Object.entries(standardSections).forEach(([category, def]) => {
        const cfg = current?.[category] || { oaths: [], abominations: [] };
        const options = buildStandardOptions(category, data);
        renderOptions(options, cfg, def.listEl, 'standard');
      });
    }

    modal.hidden = false;
    (modal.querySelector('.bind-option') || modalClose || modal)?.focus?.();
  };

  const closeBindFatesModal = () => {
    if (!modal) return;
    persistBindFatesSelection(ensureMode());
    modal.hidden = true;
    updateBindFatesSummary();
    showBindFatesError('');
    if (originButton?.focus) originButton.focus();
    originButton = null;
  };

  modalClose?.addEventListener('click', closeBindFatesModal);
  modalBackdrop?.addEventListener('click', closeBindFatesModal);
  modal?.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      evt.preventDefault();
      closeBindFatesModal();
    }
  });

  toggleBtn?.addEventListener('click', () => openBindFatesModal(toggleBtn));
  clearBtn?.addEventListener('click', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    clearBindFatesSelections();
  });

  document.addEventListener('randomancer:mode-change', (evt) => updateBindFatesSummary(evt?.detail?.mode));

  if (window.App && typeof window.App.bootstrap === 'function') {
    window.App.bootstrap().then(() => {
      hydrateFatesFromStorage();
      updateBindFatesSummary();
    }).catch(err => {
      console.error('[Randomancer] App bootstrap failed', err);
    });
  } else {
    ensureDataPreload().catch(err => {
      console.error('[Randomancer] Preload on DOMContentLoaded failed', err);
    });
    hydrateFatesFromStorage();
    updateBindFatesSummary();
  }
});

export { showBindFatesError, normalizeTemplateText, hasCategory, CHALLENGE_TWIST_CATEGORIES };
