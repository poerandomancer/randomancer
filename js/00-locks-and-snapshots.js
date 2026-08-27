import {
  formatWeaponLine,
  hasSecondaryWeaponSet,
  getQueryParams,
  onDomReady,
  setActiveSkillsTab,
  setSkillsTabsAvailability,
  SUPPORT,
} from './01-meta-and-domready.js';
import { fetchPublicCardBySlug } from './publicCardApi.js';
import { hydrateSharedBuildCard, validatePublicCardRecord } from './publicCardHydration.js';
import {
  closeCardOverlay,
  getSummaryTextFromSnapshot,
  installSummaryAutoRefresh,
  openCardOverlay,
  setSharedCardSlug,
  renderSummaryFromSnapshot
} from './02-summary-view.js';
import { buildGemDictionary, lookupGem } from './05-tags-and-scorer.js';
import { buildBuildContext } from './06-build-context.js';
import { applyGemBorderFromReqWeights, grantLine, renderSupportCards } from './07-skills-render.js';
import { ensureDataPreload } from './08-data-load.js';
import { renderPassiveRecommendations } from './07-skills-render.js';
import { updateAscendancyAmbiance } from './ascendancy-visuals.js';
import {
  pickRecommendedAscendancyNodes,
  pickRecommendedKeystones,
  pickRecommendedNotables,
} from '../passivesEngine.js';

/* === Build Codes + Saved Builds (v0.9 preview) === */
(function(){
  const STORAGE_KEY = 'randomancer_saved_builds_v1';
  const CHALLENGE_STORAGE_KEY = 'randomancer_saved_challenges_v1';
  const MAX_SAVED = 10;

  const safeBtoa = (str) => {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return ''; }
  };
  const safeAtob = (str) => {
    try { return decodeURIComponent(escape(atob(str))); } catch { return ''; }
  };

  const currentSnap = () => (window.App?.state?.currentDraw) ? window.App.state.currentDraw : null;
  const currentChallenge = () => (window.CURRENT_CHALLENGE_CONTRACT && typeof window.CURRENT_CHALLENGE_CONTRACT === 'object') ? window.CURRENT_CHALLENGE_CONTRACT : null;
  const savedOverlay = document.getElementById('saved-overlay');
  const savedCloseBtn = document.getElementById('saved-close');
  const savedFab = document.getElementById('saved-fab');
  let lastSavedFocus = null;

  const isChallengeMode = () => {
    const mode = window.RandomancerGetMode?.();
    if (mode) return mode === 'challenge';
    try { return localStorage.getItem('randomancer_mode') === 'challenge'; } catch { return false; }
  };

  function encodeSnapshot(draw){
    if (!draw || draw.schema !== 'randomancer-draw-v1') return '';
    return safeBtoa(JSON.stringify(draw));
  }

  function decodeSnapshot(code){
    if (!code) return null;
    try {
      const draw = JSON.parse(safeAtob(code));
      if (draw?.schema === 'randomancer-draw-v1') return draw;

      // Links produced by the short-lived compact-link implementation use
      // abbreviated keys. Continue accepting them so already-copied links do
      // not become dead links.
      if (!draw || typeof draw !== 'object' || (!draw.c && !draw.b)) return null;
      return {
        schema: 'randomancer-draw-v1',
        snapshotVersion: 2,
        className: draw.c || '', ascendancy: draw.a || '', ascendancyId: draw.ai,
        weapon: draw.w || '', offhand: draw.o || '', weapon2: draw.w2 || '', offhand2: draw.o2 || '',
        ailmentList: Array.isArray(draw.al) ? draw.al : [], tacticList: Array.isArray(draw.tl) ? draw.tl : [],
        defense: draw.d || '', defStrat: draw.ds || '', buildName: draw.b || '', flavor: draw.f || '',
        attributes: draw.attr || {}, recommendedSkills: draw.rs || [], recommendedSkills2: draw.rs2 || [],
        recommendedUniques: draw.u || [],
        recommendedJewelryUniques: Array.isArray(draw.ju) ? draw.ju.map((entry) => typeof entry === 'string'
          ? entry : ({ name: entry?.n || '', ...(entry?.t ? { itemType: entry.t } : {}) })).filter((entry) => entry && (typeof entry === 'string' || entry.name)) : [],
        passives: draw.p ? {
          ascendancyNodes: draw.p.a || [], keystones: draw.p.k || [], notables: draw.p.n || []
        } : undefined
      };
    } catch { return null; }
  }

  function encodeChallengeContract(contract){
    if (!contract || typeof contract !== 'object') return '';
    const compact = {
      v: 1,
      title: contract.title || '',
      subtitle: contract.subtitle || '',
      tasks: Array.isArray(contract.tasks)
        ? contract.tasks.map(t => ({
            id: t?.id || '',
            role: t?.role || '',
            shortLabel: t?.shortLabel || '',
            line: t?.line || '',
            slots: t?.slots && typeof t.slots === 'object' ? t.slots : {}
          }))
        : [],
      cf: contract.challengeFates && typeof contract.challengeFates === 'object'
        ? contract.challengeFates
        : { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } }
    };
    return safeBtoa(JSON.stringify(compact));
  }

  function decodeChallengeContract(code){
    if (!code) return null;
    const json = safeAtob(code);
    if (!json) return null;
    try {
      const raw = JSON.parse(json);
      if (!raw || typeof raw !== 'object') return null;
      return {
        mode: 'challenge',
        title: raw.title || '',
        subtitle: raw.subtitle || '',
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        challengeFates: raw.cf && typeof raw.cf === 'object'
          ? raw.cf
          : { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } }
      };
    } catch {
      return null;
    }
  }

  async function applyChallengeCode(code){
    const contract = decodeChallengeContract(code);
    if (!contract) return false;
    if (typeof window.RandomancerSetMode === 'function') {
      window.RandomancerSetMode('challenge');
    }
    document.dispatchEvent(new CustomEvent('randomancer:card-restore-start'));
    const render = () => {
      if (typeof window.RandomancerRenderChallengeContract === 'function') {
        window.RandomancerRenderChallengeContract(contract);
        return true;
      }
      return false;
    };
    if (render()) return true;
    await new Promise(r => setTimeout(r, 40));
    return render();
  }

  function challengeSummaryText(contract){
    if (!contract) return '';
    const lines = (contract.tasks || []).map(t => `• ${t.line || ''}`.trim()).filter(Boolean);
    return [contract.title || 'Challenge Contract', contract.subtitle || '', ...lines].filter(Boolean).join('\n');
  }

  function setElText(sel, txt){ const el = document.querySelector(sel); if (el) el.textContent = txt || ''; }

  function renderAttributesFromSnapshot(attr){
    if (!attr) return;
    const S = Number(attr.strength) || 0;
    const D = Number(attr.dexterity) || 0;
    const I = Number(attr.intelligence) || 0;
    const bar = document.getElementById('balance-bar');
    const grad=`linear-gradient(90deg, rgba(176,48,48,1) 0%, rgba(176,48,48,1) ${S*100}%, rgba(45,122,45,1) ${S*100}%, rgba(45,122,45,1) ${(S+D)*100}%, rgba(47,79,157,1) ${(S+D)*100}%, rgba(47,79,157,1) 100%)`;
    if (bar) {
      bar.style.setProperty('--balance-gradient', grad);
      bar.classList.add('glow');
    }
    setElText('#balance-text', `Strength ${Math.round(S*100)}%  |  Dexterity ${Math.round(D*100)}%  | Intelligence ${Math.round(I*100)}%`);
  }


  function renderSkillCardsFromSnapshot(entries, grid, gemDict){
    if (!grid) return;
    grid.innerHTML = '';
    (entries || []).forEach(entry => {
      const key = entry.id || entry.name || '';
      const g = lookupGem(gemDict, key);
      if (!g) {
        console.warn('[skills] No gem match for recommended skill', entry);
        return;
      }

      const card = document.createElement('div');
      card.className = 'skill-card';

      const requiresText = (g?.weapon_requirements?.display)
        ? String(g.weapon_requirements.display)
        : (typeof g.req_text === 'string' && g.req_text)
          ? g.req_text
          : (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
            ? g.required_weapon_types.map(x => x[0].toUpperCase() + x.slice(1)).join(', ')
            : '';

      const requiresSubtitle = requiresText
        ? `<div class="skill-subtitle">${requiresText}</div>`
        : '';

      const allTags = Array.isArray(g.tags) ? g.tags.slice() : [];
      const br = Array.isArray(g.bracket_tags) ? g.bracket_tags : [];
      const rest = allTags.filter(t => !br.includes(t));
      const displayTags = [...br, ...rest].slice(0, 10);
      const pills = displayTags.map(t => `<span class="tag-pill">${t}</span>`).join('');

      const supports = Array.isArray(entry.recommended_supports) && entry.recommended_supports.length
        ? entry.recommended_supports
        : g.recommended_supports;

      card.innerHTML = `
        <div class="skill-title">${g.name || '(Unnamed Gem)'}</div>
        ${requiresSubtitle}
        <div class="skill-divider"></div>
        ${grantLine(g)}
        <div class="skill-tags">${pills}</div>
        <div class="supports-label">Recommended Supports</div>
        <div class="supports">${renderSupportCards(supports, gemDict)}</div>
      `;
      applyGemBorderFromReqWeights(card, g.requirement_weights);
      grid.appendChild(card);
    });
  }

  

  function renderSynergySupportsFromSnapshot(supportEntries, grid, gemDict){
    if (!grid) return;
    const ids = Array.isArray(supportEntries) ? supportEntries.filter(Boolean) : [];
    if (!ids.length) return;

    const card = document.createElement('div');
    card.className = 'skill-card wide';
    card.id = (grid.id === 'skills-grid-2') ? 'synergy-supports-section-2' : 'synergy-supports-section';
    card.innerHTML = `
      <div class="skill-title">Synergy Supports</div>
      <div class="skill-subtitle">Supports that reinforce multiple rolled mechanics.</div>
      <div class="supports">${renderSupportCards(ids, gemDict)}</div>
    `;
    grid.appendChild(card);
  }

function renderSkillsFromSnapshot(snap){
    const grid = document.getElementById('skills-grid');
    const grid2 = document.getElementById('skills-grid-2');
    if (!grid) return;

    const gems = (window.DATA && window.DATA.gems) || [];
    const gemDict = buildGemDictionary(gems);

    renderSkillCardsFromSnapshot(snap.recommendedSkills || [], grid, gemDict);
    renderSynergySupportsFromSnapshot(snap.synergySupports || [], grid, gemDict);
    if (grid2) {
      renderSkillCardsFromSnapshot(snap.recommendedSkills2 || [], grid2, gemDict);
      renderSynergySupportsFromSnapshot(snap.synergySupports2 || [], grid2, gemDict);
    }

    if (snap.recommendedPersistentBuff) {
      const buffKey = snap.recommendedPersistentBuff.id || snap.recommendedPersistentBuff.name || '';
      const buffGem = lookupGem(gemDict, buffKey);
      if (buffGem) {
        renderSnapshotPersistentBuff(buffGem, gemDict);
      } else {
        console.warn('[skills] No gem match for persistent buff', snap.recommendedPersistentBuff);
      }
    } else {
      document.querySelectorAll('#persistent-buff-section').forEach(el => el.remove());
    }
  }


  function renderSnapshotPersistentBuff(g, gemDict){
    document.querySelectorAll('#persistent-buff-section').forEach(el => el.remove());
    const skillsGrid = document.getElementById('skills-grid');
    const skillsSect = skillsGrid ? skillsGrid.closest('.sect') : null;
    const main = document.querySelector('main') || document.body;
    const parent = (skillsSect && skillsSect.parentNode) || main;

    const wrap = document.createElement('div');
    wrap.id = 'persistent-buff-section';
    wrap.className = 'sect';
    wrap.innerHTML = `
      <div class="sect-head">
        <h3>Recommended Persistent Buff</h3>
        <div class="underline"></div>
        <p class="sub">A long-lasting buff skill that supports this build</p>
      </div>
      <div id="persistent-buff-grid" class="grid persistent-buff-grid"></div>
    `;

    if (skillsSect) skillsSect.insertAdjacentElement('afterend', wrap); else parent.appendChild(wrap);
    const grid = wrap.querySelector('#persistent-buff-grid');
    if (!grid) return;

    const requiresText = (g?.weapon_requirements?.display)
        ? String(g.weapon_requirements.display)
        : (typeof g.req_text === 'string' && g.req_text)
          ? g.req_text
          : (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
            ? g.required_weapon_types.map(x => x[0].toUpperCase() + x.slice(1)).join(', ')
            : '';

      const requiresSubtitle = requiresText
        ? `<div class="skill-subtitle">${requiresText}</div>`
        : '';
    const allTags = Array.isArray(g.tags) ? g.tags.slice() : [];
    const br = Array.isArray(g.bracket_tags) ? g.bracket_tags : [];
    const rest = allTags.filter(t => !br.includes(t));
    const displayTags = [...br, ...rest].slice(0, 10);
    const pills = displayTags.map(t => `<span class="tag-pill">${t}</span>`).join('');

    const card = document.createElement('div');
    card.className = 'skill-card persistent-buff-card';
    card.innerHTML = `
      <div class="skill-title">${g.name || '(Unnamed Gem)'}</div>
      ${requiresSubtitle}
      <div class="skill-divider"></div>
      ${grantLine(g)}
      <div class="skill-tags">${pills}</div>
      <div class="supports-label">Recommended Supports</div>
      <div class="supports">${renderSupportCards(g.recommended_supports, gemDict)}</div>
    `;
    applyGemBorderFromReqWeights(card, g.requirement_weights);
    grid.appendChild(card);
  }

function renderSnapshotToDom(snap){
    if (!snap) return;
    setElText('#class', snap.className || '');
    setElText('#ascendancy', snap.ascendancy || '');
    updateAscendancyAmbiance(snap.ascendancy || '');
    const appEl = document.getElementById('app');
    if (appEl) appEl.dataset.hasRoll = 'true';
    const weaponsTxt = formatWeaponLine(snap.weapon, snap.offhand);
    setElText('#weapons', weaponsTxt);
    const weapons2Txt = formatWeaponLine(snap.weapon2, snap.offhand2);
    const weapons2El = document.getElementById('weapons-set2');
    if (weapons2El) {
      weapons2El.textContent = weapons2Txt;
      weapons2El.hidden = !weapons2Txt;
    }
    const hasSet2 = hasSecondaryWeaponSet(snap);

    setElText('#defense', snap.defense || '');
    setElText('#defstrat', snap.defStrat || '');
    setElText('#ailments', Array.isArray(snap.ailmentList) ? snap.ailmentList.join(' & ') : (snap.ailments || ''));
    setElText('#tactics', Array.isArray(snap.tacticList) ? snap.tacticList.join(' & ') : (snap.tactics || ''));
    setElText('#build-name', snap.buildName || '');
    setElText('#build-subtext', snap.flavor || '');
    // Keep the Summary view in sync on every roll (and do this early so it still updates even if later renderers fail).
    renderSummaryFromSnapshot(snap);

    try {
      renderAttributesFromSnapshot(snap.attributes);
    } catch (e) {
      console.warn('[render] attribute breakdown failed', e);
    }

    try {
      renderSkillsFromSnapshot(snap);
    } catch (e) {
      console.warn('[render] skills panel failed', e);
    }
    setSkillsTabsAvailability(hasSet2);
    setActiveSkillsTab('1');
    try {
      renderPassiveRecommendations((window.App && window.App.state && window.App.state.currentDraw) || snap, window.DATA);
    } catch (e) {
      console.warn('[render] passives panel failed', e);
    }

    try {
      if (Array.isArray(snap.recommendedUniques) && snap.recommendedUniques.length && window.RandomancerRenderUniquesFromNames) {
        window.RandomancerRenderUniquesFromNames(snap.recommendedUniques, snap);
      }
    } catch (e) {
      console.warn('[render] uniques panel failed', e);
    }

  }

  async function applyBuildCode(code){
  const snap = decodeSnapshot(code);
  if (!snap) return false;

  const dataWrap = await ensureDataPreload();
  document.dispatchEvent(new CustomEvent('randomancer:card-restore-start'));

  // Back-compat: older build codes didn't store passives; rebuild them from the snapshot context.
  if (!snap.passives) {
    try {
      const passivesData =
        dataWrap?.passivesEnriched || (window.DATA && window.DATA.passivesEnriched);
      const passiveIndex =
        dataWrap?.passiveIndex || (window.DATA && window.DATA.passiveIndex);

      if (passivesData && Array.isArray(passivesData.nodes)) {
        const passiveCtx = buildBuildContext(snap);
        const ascendancyNodes = pickRecommendedAscendancyNodes(passivesData, passiveIndex, passiveCtx, 2);
        const keystones = pickRecommendedKeystones(passivesData, passiveIndex, passiveCtx, 2);
        const notables = pickRecommendedNotables(passivesData, passiveIndex, passiveCtx, 8);
        snap.passives = { ascendancyNodes, keystones, notables };
      }
    } catch (e) {
      console.warn('[build code] passive recompute failed', e);
    }
  }

  // Replace global roll state so restored snapshots do not leak prior roll fields.
  const rollPayload = { ...snap };
  if (window.App?.replaceCurrentDraw) {
    window.App.replaceCurrentDraw(rollPayload);
  } else if (window.App?.mergeCurrentDraw) {
    window.App.mergeCurrentDraw(rollPayload);
  }

  renderSnapshotToDom(rollPayload);
  updateCodeUI(code);
  return true;
}



  function loadSaved(){
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
  }
  function loadSavedChallenges(){
    try {
      return JSON.parse(localStorage.getItem(CHALLENGE_STORAGE_KEY) || '[]');
    } catch { return []; }
  }
  function persistSaved(list){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); } catch {}
  }
  function persistSavedChallenges(list){
    try { localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); } catch {}
  }

  function isBuildSaved(snapshot = currentSnap()){
    const code = encodeSnapshot(snapshot);
    return !!(code && loadSaved().some(entry => entry.code === code));
  }

  function isChallengeSaved(contract = currentChallenge()){
    const code = encodeChallengeContract(contract);
    return !!(code && loadSavedChallenges().some(entry => entry.code === code));
  }

  function syncSaveButtonState(code){
	  const btn = document.getElementById('build-actions-save');
	  if (!btn) return;
	
	  const ico = btn.querySelector('.copy-menu-ico, .summary-utility-btn__icon, span');
	  const label = btn.querySelector('.copy-menu-label, .summary-utility-btn__label');
	
	  const list = loadSaved();
	  const activeCode = code || (() => { const snap = currentSnap(); return encodeSnapshot(snap); })();
	  const saved = !!(activeCode && list.some(e => e.code === activeCode));
	
	  if (ico) ico.textContent = saved ? '★' : '☆';
	  if (label) label.textContent = saved ? 'Saved' : 'Save';
	
	  btn.classList.toggle('is-saved', saved);
	  btn.dataset.saved = saved ? '1' : '0';
	  btn.setAttribute('aria-label', saved ? 'Saved' : 'Save');
	  btn.setAttribute('title', saved ? 'Saved' : 'Save');
	}


  function updateCodeUI(code){
    syncSaveButtonState(code);
  }

  function openSavedOverlay(){
    if (!savedOverlay) return;
    updateSavedLabels();
    renderSavedList();
    lastSavedFocus = document.activeElement;
    savedOverlay.hidden = false;
    (savedCloseBtn || savedOverlay.querySelector('.rm-info-dialog'))?.focus?.();
  }

  function closeSavedOverlay(){
    if (!savedOverlay) return;
    savedOverlay.hidden = true;
    if (lastSavedFocus?.focus) lastSavedFocus.focus();
  }

  function renderSavedList(){
    const challengeMode = isChallengeMode();
    const list = challengeMode ? loadSavedChallenges() : loadSaved();
    const wrap = document.getElementById('saved-builds-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = challengeMode ? 'No saved challenges yet.' : 'No saved builds yet.';
      wrap.appendChild(empty);
      return;
    }
    list.forEach(entry => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'saved-item';
      btn.innerHTML = `<span class="name">${entry.name || (challengeMode ? 'Saved Challenge' : 'Saved Build')}</span><span class="meta">${entry.meta || ''}</span>`;
      btn.addEventListener('click', async () => {
        const ok = challengeMode
          ? await applyChallengeCode(entry.code)
          : await applyBuildCode(entry.code);
        if (ok) closeSavedOverlay();
      });
      wrap.appendChild(btn);
    });
  }

  function updateSavedLabels(){
    const challengeMode = isChallengeMode();
    const savedTitle = document.getElementById('saved-title');
    const savedSubtitle = document.querySelector('.saved-subtitle');
    const savedFabEl = document.getElementById('saved-fab');
    const menuSavedLabel = document.querySelector('.header-menu-item[data-action="saved"] .header-menu-label');

    const noun = challengeMode ? 'Challenges' : 'Builds';
    if (savedTitle) savedTitle.textContent = `Saved ${noun}`;
    if (savedSubtitle) savedSubtitle.textContent = `Preserves your last 10 Saved ${noun}`;
    if (savedFabEl) {
      savedFabEl.setAttribute('aria-label', `View Saved ${noun}`);
      savedFabEl.setAttribute('title', `View Saved ${noun}`);
    }
    if (menuSavedLabel) menuSavedLabel.textContent = `Saved ${noun}`;
  }

  function saveCurrentBuild(){
    const snap = currentSnap();
    if (!snap) return;
    const code = encodeSnapshot(snap);
    if (!code) return;

    const list = loadSaved();
    const existingIndex = list.findIndex(e => e.code === code);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
      persistSaved(list);
    } else {
      const entry = {
        code,
        name: snap.buildName || `${snap.className} ${snap.ascendancy}`.trim(),
        meta: [snap.ascendancy, formatWeaponLine(snap.weapon, snap.offhand)].filter(Boolean).join(' • ')
      };
      const existing = list.filter(e => e.code !== code);
      existing.unshift(entry);
      persistSaved(existing);
    }
    renderSavedList();
    updateCodeUI(code);
    syncSaveButtonState(code);
  }

  function saveCurrentChallenge(){
    const contract = currentChallenge();
    if (!contract) return;
    const code = encodeChallengeContract(contract);
    if (!code) return;

    const list = loadSavedChallenges();
    const existingIndex = list.findIndex(e => e.code === code);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
      persistSavedChallenges(list);
    } else {
      const entry = {
        code,
        name: contract.title || 'Challenge Contract',
        meta: contract.subtitle || ''
      };
      const existing = list.filter(e => e.code !== code);
      existing.unshift(entry);
      persistSavedChallenges(existing);
    }
    renderSavedList();
    syncChallengeSaveButtonState(code);
  }

  function syncChallengeSaveButtonState(code){
    const btn = document.getElementById('challenge-actions-save');
    if (!btn) return;

    const ico = btn.querySelector('.copy-menu-ico, .summary-utility-btn__icon, span');
    const label = btn.querySelector('.copy-menu-label, .summary-utility-btn__label');
    const list = loadSavedChallenges();
    const activeCode = code || (() => { const c = currentChallenge(); return encodeChallengeContract(c); })();
    const saved = !!(activeCode && list.some(e => e.code === activeCode));

    if (ico) ico.textContent = saved ? '★' : '☆';
    if (label) label.textContent = saved ? 'Saved' : 'Save';
    btn.classList.toggle('is-saved', saved);
    btn.dataset.saved = saved ? '1' : '0';
    btn.setAttribute('aria-label', saved ? 'Saved' : 'Save');
    btn.setAttribute('title', saved ? 'Saved' : 'Save');
  }
  
  function normalizeHandedWeaponLabel(label) {
	  return label
		.replace(/-/g, " ")                 // One-handed → One handed
		.replace(/\b\w/g, c => c.toUpperCase()); // → One Handed
	}

  
  function normalizePoeNinjaWeaponMode(weapon, offhand) {
	  const display = formatWeaponLine(weapon, offhand); 
	  if (!display) return "";
	
	  const parts = display
		.split(/&|\//g)
		.map(s => s.trim())
		.filter(Boolean);
	
	  // --------------------------------------------------
	  // SINGLE WEAPON CASE
	  // --------------------------------------------------
	  if (parts.length === 1) {
		return normalizeHandedWeaponLabel(parts[0]);
	  }
	
	  // --------------------------------------------------
	  // Dual same-weapon case
	  // --------------------------------------------------
	  if (
		parts.length === 2 &&
		parts[0].toLowerCase() === parts[1].toLowerCase()
	  ) {
		return `Dual ${normalizeHandedWeaponLabel(parts[0])}`;
	  }
	
	  // --------------------------------------------------
	  // Wand / Sceptre special-case
	  // --------------------------------------------------
	  const lower = parts.map(p => p.toLowerCase());
	  const hasWand = lower.includes("wand");
	  const hasSceptre = lower.includes("sceptre") || lower.includes("scepter");
	
	  if (hasWand && hasSceptre) return "Wand / Sceptre";
	
	  // --------------------------------------------------
	  // DEFAULT MIXED-WEAPON CASE
	  // 🔑 FIX: normalize EACH part before joining
	  // --------------------------------------------------
	  const normalizedParts = parts.map(normalizeHandedWeaponLabel);
	  return normalizedParts.join(" / ");
	}
	
	function buildPoeNinjaUrlFromSnapshot(snap) {
	  if (!snap) return "";
	
	  const base = `https://poe.ninja/poe2/builds/${SUPPORT.league.poeNinjaSlug}`;
	  const params = new URLSearchParams();
	
	  const asc = (snap.ascendancyName || snap.ascendancy || "").trim();
	  if (asc) params.set("class", asc);
	
	  const weaponmode = normalizePoeNinjaWeaponMode(snap.weapon, snap.offhand);
	  if (weaponmode) params.set("weaponmode", weaponmode);
	
	  const skills = Array.isArray(snap.recommendedSkills) ? snap.recommendedSkills : [];
	  const skillNames = skills
		.map(s => (s && typeof s === "object" ? s.name : String(s || "")))
		.filter(Boolean)
		.slice(0, 2);
	
	  if (skillNames.length) params.set("skills", skillNames.join(","));
	
	  return `${base}?${params.toString()}`;
	}


  function bindUI(){
    const buildViewCardBtn = document.getElementById('build-open-card');
    const buildSaveBtn = document.getElementById('build-actions-save');
    const buildPoeBtn = document.getElementById('build-actions-poe');
    const challengeSaveBtn = document.getElementById('challenge-actions-save');
    const savedListFab = savedFab;

    installSummaryAutoRefresh();

    buildViewCardBtn?.addEventListener('click', () => openCardOverlay('build'));
    buildSaveBtn?.addEventListener('click', () => {
      saveCurrentBuild();
      window.RandomancerShowToast?.('Saved locally.');
    });
    buildPoeBtn?.addEventListener('click', () => {
      const snap = window.App?.state?.currentDraw;
      const url = window.RandomancerBuildPoeNinjaUrl?.(snap);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    });
    challengeSaveBtn?.addEventListener('click', () => {
      saveCurrentChallenge();
      window.RandomancerShowToast?.('Saved locally.');
    });

    savedListFab?.addEventListener('click', openSavedOverlay);
    savedCloseBtn?.addEventListener('click', closeSavedOverlay);
    savedOverlay?.addEventListener('click', (e) => {
      const t = e.target;
      if (t?.dataset?.close) closeSavedOverlay();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && savedOverlay && !savedOverlay.hidden) closeSavedOverlay();
    });

    document.addEventListener('randomancer:mode-change', () => {
      updateSavedLabels();
      if (savedOverlay && !savedOverlay.hidden) renderSavedList();
      closeCardOverlay({ skipUrl: true });
    });

    document.addEventListener('randomancer:challenge-rendered', () => {
      syncChallengeSaveButtonState();
      renderSummaryFromSnapshot();
    });

    updateSavedLabels();
  }

  let __toastTimer = null;

	function showToast(msg, ms = 1600){
	  const el = document.getElementById('rm-toast');
	  if (!el) return;
	
	  el.textContent = msg;
	  el.hidden = false;
	  el.classList.add('is-show');
	
	  clearTimeout(__toastTimer);
	  __toastTimer = setTimeout(() => {
		el.classList.remove('is-show');
		setTimeout(() => { el.hidden = true; }, 220);
	  }, ms);
	}
	
	async function copyTextToClipboard(text){
	  if (!text) return false;
	
	  // Modern API
	  try {
		if (navigator.clipboard?.writeText) {
		  await navigator.clipboard.writeText(text);
		  return true;
		}
	  } catch {}
	
	  // Fallback
	  try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		ta.style.top = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return !!ok;
	  } catch {}
	
	  return false;
	}




  function cloneJsonSafe(value){
    if (!value || typeof value !== 'object') return null;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {}
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
  }

  async function openSharedCardBySlug(slug){
    const safeSlug = String(slug || '').trim().toLowerCase();
    const slugPattern = /^b-[a-z0-9]{8}$/i;
    if (!slugPattern.test(safeSlug)) throw new Error('Shared card slug was invalid.');

    const shared = validatePublicCardRecord(await fetchPublicCardBySlug(safeSlug));

    if (typeof window.RandomancerSetMode === 'function') window.RandomancerSetMode('standard');
    const snapshot = hydrateSharedBuildCard(shared.payload);
    document.dispatchEvent(new CustomEvent('randomancer:card-restore-start'));
    if (typeof window.RandomancerRenderBuildSnapshot === 'function') {
      window.RandomancerRenderBuildSnapshot(snapshot);
    }
    setSharedCardSlug('build', shared.slug);
    openCardOverlay('build', { skipUrl: true });
    return shared;
  }

  async function autoLoadFromQuery(){
    // Other modules install the primary-card animation controller during the
    // same DOM-ready turn. Let those listeners mount before restoring a URL.
    await new Promise(resolve => requestAnimationFrame(resolve));
    const q = getQueryParams();
    const slugPattern = /^b-[a-z0-9]{8}$/i;
    const cardParam = q.get('card');
    const requestedSharedCard = q.get('sharedCard');
    const requestedCard = requestedSharedCard || (slugPattern.test(cardParam || '') ? cardParam : '');
    const requestedOverlay = slugPattern.test(cardParam || '') ? '' : cardParam;

    if (requestedCard && slugPattern.test(requestedCard)) {
      window.RandomancerShowToast?.('Loading shared card…', 1800);
      try {
        await openSharedCardBySlug(requestedCard);
        return;
      } catch (error) {
        console.warn('[public-card] shared restore failed', error);
        window.RandomancerShowToast?.('Shared card could not be restored.');
      }
    }

    const challengeCode = q.get('challenge') || q.get('challengeCode');
    if (challengeCode) {
      const ok = await applyChallengeCode(challengeCode);
      if (requestedOverlay === 'challenge') openCardOverlay('challenge', { skipUrl: true });
      else if (!ok && requestedOverlay === 'challenge') openCardOverlay('challenge', { skipUrl: true });
      return;
    }
    const code = q.get('build') || q.get('buildCode');
    if (code) {
      const ok = await applyBuildCode(code);
      if (requestedOverlay === 'build') openCardOverlay('build', { skipUrl: true });
      else if (!ok && requestedOverlay === 'build') openCardOverlay('build', { skipUrl: true });
    }
  }

  function subscribeToRolls(){
    // App.onRoll is attached by a later bootstrap layer; retry briefly if it's not ready yet.
    if (!subscribeToRolls._attempts) subscribeToRolls._attempts = 0;
    if (!subscribeToRolls._unsub) subscribeToRolls._unsub = null;

    const App = window.App;
    if (!App || typeof App.onRoll !== 'function') {
      if (subscribeToRolls._attempts++ < 25) {
        setTimeout(subscribeToRolls, 120);
      }
      return;
    }

    // Only subscribe once.
    if (subscribeToRolls._unsub) return;

    subscribeToRolls._unsub = App.onRoll((snap) => {
      const s = snap || currentSnap();
      try { renderSummaryFromSnapshot(s); } catch {}
      const code = encodeSnapshot(s);
      updateCodeUI(code);
    });

    // Hydrate summary immediately if we already have a roll loaded (e.g., via build code).
    const s0 = currentSnap();
    if (s0) {
      try { renderSummaryFromSnapshot(s0); } catch {}
      const code0 = encodeSnapshot(s0);
      updateCodeUI(code0);
    }
  }

  onDomReady(() => {
    bindUI();
    renderSavedList();
    subscribeToRolls();
    syncSaveButtonState();
    syncChallengeSaveButtonState();
    autoLoadFromQuery();
  });


  window.RandomancerEncodeChallengeContract = encodeChallengeContract;
  window.RandomancerIsBuildSaved = isBuildSaved;
  window.RandomancerIsChallengeSaved = isChallengeSaved;
  window.RandomancerApplyChallengeCode = applyChallengeCode;
  window.RandomancerSaveCurrentBuild = saveCurrentBuild;
  window.RandomancerSaveCurrentChallenge = saveCurrentChallenge;
  window.RandomancerShowToast = showToast;
  window.RandomancerCopyTextToClipboard = copyTextToClipboard;
  window.RandomancerBuildPoeNinjaUrl = buildPoeNinjaUrlFromSnapshot;
  window.RandomancerEncodeSnapshot = encodeSnapshot;
  window.RandomancerApplyBuildCode = applyBuildCode;
  window.RandomancerGetCurrentBuildSnapshot = () => cloneJsonSafe(currentSnap());
  window.RandomancerRenderBuildSnapshot = (snap) => {
    if (!snap || typeof snap !== 'object') return false;
    const safeSnap = cloneJsonSafe(snap) || { ...snap };
    let canonical = safeSnap;
    if (window.App?.replaceCurrentDraw) canonical = window.App.replaceCurrentDraw(safeSnap) || safeSnap;
    else if (window.App?.mergeCurrentDraw) canonical = window.App.mergeCurrentDraw({ ...safeSnap }) || safeSnap;
    renderSnapshotToDom(canonical);
    return true;
  };
  window.RandomancerOpenSharedCardBySlug = (slug) => openSharedCardBySlug(slug);
  window.RandomancerUpdateBuildCodeUI = () => {
    const snap = currentSnap();
    const code = encodeSnapshot(snap);
    updateCodeUI(code);
    return code;
  };
})();
