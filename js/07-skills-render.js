import {
  buildGemDictionary,
  buildRolledTagProfileCtx,
  buildTagIDF,
  defensePseudoTags,
  deriveWeaponHints,
  dominantAttr,
  lookupGem,
  normTagPlus,
  normalizeTag,
  pickTwoDiverse,
  scoreGemSynergy,
  synergyTunings
} from './05-tags-and-scorer.js';
import { buildBuildContext, cohesionThreshold } from './06-cohesion.js';

const SHOW_EMPTY_SYNERGY_SUPPORTS = true; // set false later if you want to hide again

// ---------- anti-repeat (recent history) ----------
const RECENT_PICK_WINDOW = 60; // last N picks per category (keeps penalty "local" to the session)

function _ensurePickHistory(){
  if (!window.__PICK_HISTORY) {
    window.__PICK_HISTORY = { skills: [], buffs: [], supports: [] };
  }
  return window.__PICK_HISTORY;
}
function _pickKey(x){
  return String(x || '').trim().toLowerCase();
}
function _recentCount(kind, key){
  if (!key) return 0;
  const hist = (_ensurePickHistory()[kind] || []);
  let c = 0;
  for (const k of hist) if (k === key) c++;
  return c;
}

function applyRepeatPenalty(score, kind, key, coh, meta){
  const k = _pickKey(key);
  const n = _recentCount(kind, k);
  if (!n) return score;

  const c = (typeof coh === 'number' && Number.isFinite(coh)) ? coh : 0.75;
  const base =
    (kind === 'skills') ? (0.10 + 0.22 * c) :
    (kind === 'buffs')  ? (0.12 + 0.25 * c) :
                          (0.08 + 0.18 * c);

  let pen = Math.min(0.45, base * Math.log1p(n));

  // If a skill helps cover rolled mechanics (esp. multi-mechanic rolls), soften the penalty.
  if (kind === 'skills' && meta && (meta.totalMechs|0) >= 2 && (meta.mechHits|0) > 0) {
    const shield = 0.10 + 0.45 * c;  // 0.10..0.55
    pen *= (1 - shield);            // reduce penalty more at high cohesion
  }

  return score - pen;
}


function pushPickHistory(kind, keys){
  const hist = _ensurePickHistory();
  const arr = hist[kind] || (hist[kind] = []);
  const list = Array.isArray(keys) ? keys : [keys];
  for (const x of list) {
    const k = _pickKey(x);
    if (!k) continue;
    arr.push(k);
  }
  while (arr.length > RECENT_PICK_WINDOW) arr.shift();
}

// ---------- mechanic-aware 2-skill selection ----------
function pickTwoDiverseTopKWithMechanics(sorted, lambda = 0.7, coh = 0.75, mechSets = []){
  if (sorted.length <= 1) return sorted.slice(0, 2).map(s => s.item);

  const c = (typeof coh === 'number' && Number.isFinite(coh)) ? coh : 0.75;
  const hasMechs = Array.isArray(mechSets) && mechSets.length >= 2;

  // Higher cohesion => smaller K. Lower cohesion => larger K.
  const baseK =
    (c >= 0.85) ? 5 :
    (c >= 0.70) ? 6 :
    (c >= 0.55) ? 8 :
    (c >= 0.40) ? 10 : 12;

  // If mechanics are in play, widen the "first pick" pool a bit so we can find at least one mechanic-covering option.
  const K = Math.min(sorted.length, hasMechs ? (baseK + 4) : baseK);
  const top = sorted.slice(0, K);

  const maskFor = (item) => {
    if (!hasMechs) return 0;
    const S = new Set((item.tags || []).map(normTagPlus));
    let mask = 0;
    for (let i = 0; i < mechSets.length; i++){
      const ms = mechSets[i];
      let hit = false;
      for (const t of ms){ if (S.has(t)) { hit = true; break; } }
      if (hit) mask |= (1 << i);
    }
    return mask;
  };

  // --- Pick #1: prefer something that covers at least one rolled mechanic (if available in top-K) ---
  let firstPool = top;
  if (hasMechs) {
    const mechCovering = top.filter(s => maskFor(s.item) !== 0);
    if (mechCovering.length) firstPool = mechCovering;
  }

  const minScore = firstPool[firstPool.length - 1].score;

  // Higher cohesion => more peaked weights.
  const pow = 1.0 + c;
  const weights = firstPool.map(s => Math.pow(Math.max(0, s.score - minScore) + 1e-6, pow));
  const idx = weightedPickIndex(weights);
  const first = firstPool[idx];

  const S1 = new Set((first.item.tags || []).map(normTagPlus));
  const cov1 = hasMechs ? mechSets.map(ms => {
    for (const t of ms) { if (S1.has(t)) return true; }
    return false;
  }) : [];

  // IMPORTANT: For exactly-2 mechanics, always try to cover the uncovered mechanic with #2 (even at low cohesion).
  const requireUncovered =
    hasMechs &&
    cov1.some(v => !v) &&
    (mechSets.length === 2 || c >= 0.65);

  let best = -Infinity, bestItem = null;

  for (let i = 0; i < sorted.length; i++){
    const cand = sorted[i];
    if (cand === first) continue;

    const g = cand.item;
    const S2 = new Set((g.tags || []).map(normTagPlus));

    // Diversity overlap penalty
    let inter = 0;
    for (const t of S2){ if (S1.has(t)) inter++; }
    const union = new Set([...S1, ...S2]).size || 1;
    const overlap = inter / union;

    // Mechanic coverage nudging (favor covering uncovered mechanics)
    let uncoveredHits = 0;
    if (hasMechs && cov1.length) {
      const cov2 = mechSets.map(ms => {
        for (const t of ms) { if (S2.has(t)) return true; }
        return false;
      });
      for (let mi = 0; mi < cov1.length; mi++){
        if (!cov1[mi] && cov2[mi]) uncoveredHits++;
      }
      if (requireUncovered && uncoveredHits === 0) continue;
    }

    // Stronger uncovered bonus when we specifically have 2 mechanics (we want both represented)
    const perUncovered = (mechSets.length === 2)
      ? (0.25 + 0.35 * c)
      : (0.12 + 0.25 * c);

    const uncoveredBonus = uncoveredHits * perUncovered;
    const mmr = lambda * (cand.score + uncoveredBonus) - (1 - lambda) * overlap;

    if (mmr > best){ best = mmr; bestItem = g; }
  }

  if (!bestItem) return pickTwoDiverseTopK(sorted, lambda, coh);
  return [first.item, bestItem];
}


// ---------- synergy support "meaningful mechanic match" ----------
const WEAK_MECH_TAGS = new Set([
  'attack','attacks','spell','spells','melee','ranged',
  'projectile','projectiles','area','aoe',
  'damage','hit','hits','duration','physical','elemental'
]);
function isMeaningfulMechanicTag(t){
  const k = normTagPlus(t);
  if (!k) return false;
  if (WEAK_MECH_TAGS.has(k)) return false;
  return true;
}


// ---------- passives helpers ----------
function buildPassiveIndex(passivesData) {
  const index = {
    byAscendancyName: new Map(),
    keystones: [],
    notables: [],
    ascendancyNodes: []
  };

  try {
    const nodes = Array.isArray(passivesData?.nodes) ? passivesData.nodes : [];
    for (const node of nodes) {
      if (!node || !node.type) continue;
      if (node.type === 'ascendancy' && node.ascendancy) {
        index.ascendancyNodes.push(node);
        const key = String(node.ascendancy);
        if (!index.byAscendancyName.has(key)) index.byAscendancyName.set(key, []);
        index.byAscendancyName.get(key).push(node);
      }
      if (node.type === 'keystone') index.keystones.push(node);
      if (node.type === 'notable') index.notables.push(node);
    }
  } catch (err) {
    console.error('[passives] failed to build index', err);
  }

  return index;
}

// ---------- passive UI renderer ----------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
}

function resolvePassiveIcon(iconPath) {
  if (!iconPath) return 'images/dice.png';
  const file = iconPath.split('/').pop() || '';
  const base = file.replace(/\.dds$/i, '') || 'default';
  return `images/passives/${base}.png`;
}

// ---------- Recommended passives: unified constellation layout + tooltips ----------
let passiveTooltipHandlerInstalled = false;

function installPassiveTooltipHandler() {
  if (passiveTooltipHandlerInstalled) return;
  passiveTooltipHandlerInstalled = true;

  document.addEventListener('click', (evt) => {
    const panel = document.getElementById('passives-panel');
    if (!panel) return;
    const target = evt.target;
    if (panel.contains(target)) {
      // Let per-node handlers deal with toggling when we click inside the panel
      return;
    }
    panel.querySelectorAll('.passive-node.is-active').forEach((nodeEl) => {
      nodeEl.classList.remove('is-active');
    });
  });
}

function shouldAdjustPassiveTooltip() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    // Prefer coarse pointer, fall back to narrow screens
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    if (window.matchMedia('(max-width: 768px)').matches) return true;
  } catch (e) {
    // ignore matchMedia errors
  }
  return false;
}

function adjustPassiveTooltipPosition(wrapper) {
  if (!shouldAdjustPassiveTooltip()) return;

  const tooltip = wrapper.querySelector('.passive-node__tooltip');
  if (!tooltip) return;

  // Reset any previous shift so we measure a "default" position
  tooltip.style.setProperty('--tooltip-shift-x', '0px');

  const rect = tooltip.getBoundingClientRect();
  const viewportPadding = 12; // a little breathing room from the edge
  const viewportLeft = viewportPadding;
  const viewportRight = window.innerWidth - viewportPadding;

  let shift = 0;
  if (rect.left < viewportLeft) {
    shift = viewportLeft - rect.left;           // shift right
  } else if (rect.right > viewportRight) {
    shift = viewportRight - rect.right;         // shift left
  }

  tooltip.style.setProperty('--tooltip-shift-x', `${shift}px`);
}


function createPassiveNodeElement(node, type, buildTagSet) {
  const wrapper = document.createElement('div');
  wrapper.className = `passive-node passive-node--${type}`;

  let iconSrc;
  if (type === 'ascendancy') {
    // Placeholder for all ascendancy notables
    iconSrc = 'images/ascendancy.png';
  } else if (type === 'notable') {
    // Placeholder for all regular notables
    iconSrc = 'images/plusattribute.png';
  } else if (type === 'keystone') {
    // Placeholder for all keystone nodes (until bespoke art exists)
    iconSrc = 'images/plusattribute.png';
  } else {
    // Fallback to the generic resolver
    iconSrc = resolvePassiveIcon(node?.icon);
  }

  const name = node?.name || 'Unknown Passive';
  let lines = Array.isArray(node?.lines) ? node.lines.filter(Boolean) : [];
  const tags = Array.isArray(node?.tags) ? node.tags.filter(Boolean) : [];



  const typeLabel =
    type === 'ascendancy'
      ? 'Ascendancy'
      : type === 'keystone'
        ? 'Keystone'
        : 'Notable';

  const linesHtml = lines.length
    ? `<div class="passive-node__lines">${lines.map((l) => escapeHtml(l)).join('<br>')}</div>`
    : '';

  const tagsHtml = tags.length
    ? `<div class="passive-node__tags">${tags
        .map((t) => {
          const norm = normTagPlus(t);
          const matched = buildTagSet?.has(norm);
          return `<span class="passive-tag${matched ? ' is-match' : ''}">${escapeHtml(t)}</span>`;
        })
        .join('')}</div>`
    : '';

  wrapper.innerHTML = `
    <div class="passive-node__orb">
      <div class="passive-node__orb-inner">
        <img class="passive-node__icon" src="${iconSrc}" alt="${escapeHtml(name)}">
      </div>
    </div>
    <div class="passive-node__label">
      <div class="passive-node__name">${escapeHtml(name)}</div>
    </div>
    <div class="passive-node__tooltip" data-passive-type="${type}">
      <div class="passive-tooltip passive-tooltip--${type}">
        <div class="passive-tooltip__header">
          <div class="passive-tooltip__name">${escapeHtml(name)}</div>
          <div class="passive-tooltip__stamp passive-tooltip__stamp--${type}">
            <span>${typeLabel}</span>
          </div>
        </div>
        ${linesHtml}
        ${tagsHtml}
      </div>
    </div>
  `;

  const img = wrapper.querySelector('.passive-node__icon');
  if (img) {
    img.addEventListener(
      'error',
      () => {
        img.src = 'images/dice.png';
      },
      { once: true }
    );
  }

  // Mobile / click interaction: tap to lock / unlock tooltip
  wrapper.addEventListener('click', (evt) => {
  evt.stopPropagation();
  const panel = document.getElementById('passives-panel');
  if (!panel) return;

  const alreadyActive = wrapper.classList.contains('is-active');

  // Close any other open tooltip
  panel.querySelectorAll('.passive-node.is-active').forEach((nodeEl) => {
    nodeEl.classList.remove('is-active');
  });

  if (!alreadyActive) {
    wrapper.classList.add('is-active');
    // On mobile, clamp the tooltip so it stays fully on-screen
    adjustPassiveTooltipPosition(wrapper);
  }
});


  return wrapper;
}

function renderPassiveRecommendations(currentRoll, dataWrap) {
  const panel = document.getElementById('passives-panel');
  const grid = document.getElementById('passives-grid');

  const hideAll = () => {
    if (grid) grid.innerHTML = '';
    if (panel) panel.classList.add('hidden');
  };

  const passivesData =
    dataWrap?.passivesEnriched || (window.DATA && window.DATA.passivesEnriched);
  const hasPassiveData = passivesData && Array.isArray(passivesData.nodes);
  if (!panel || !grid || !hasPassiveData || !currentRoll || !currentRoll.passives) {
    hideAll();
    return;
  }

  const ctx = buildBuildContext(currentRoll);
  const buildTagSet = new Set();
  (ctx?.tags || []).forEach((t) => buildTagSet.add(normTagPlus(t)));
  (ctx?.defenseTags || []).forEach((t) => buildTagSet.add(normTagPlus(t)));

  const passives = currentRoll.passives || {};
  const ascendancyNodes = Array.isArray(passives.ascendancyNodes)
    ? passives.ascendancyNodes.slice(0, 2)
    : [];

  // ⛔ Keystones still exist in data, but we don't display them for now
  const keystones = Array.isArray(passives.keystones)
    ? passives.keystones.slice(0, 2)
    : [];

  const notables = Array.isArray(passives.notables)
    ? passives.notables.slice(0, 8)
    : [];

  // When keystones are hidden, only check asc + notables to decide if the panel is empty
  if (!ascendancyNodes.length && !notables.length) {
    hideAll();
    return;
  }

  grid.innerHTML = '';
  panel.classList.remove('hidden');

  // Inner cross: we *reserve* top/bottom slots for keystones, but just don't fill them.
  const ascSlots = ['4 / 3', '4 / 5']; // left / right
  const keySlots = ['3 / 4', '5 / 4']; // top / bottom (unused for now, kept for future)

  // Outer star ring (notables) – unchanged
  const noteSlots = [
    '1 / 4', // N
    '2 / 6', // NE
    '4 / 7', // E
    '6 / 6', // SE
    '7 / 4', // S
    '6 / 2', // SW
    '4 / 1', // W
    '2 / 2', // NW
  ];

  const place = (node, type, slot) => {
    if (!node) return;
    const el = createPassiveNodeElement(node, type, buildTagSet);
    if (slot) el.style.gridArea = slot;
    grid.appendChild(el);
  };

  ascendancyNodes.forEach((node, idx) =>
    place(node, 'ascendancy', ascSlots[idx] || null)
  );

  // 🔇 Keystones intentionally not rendered:
  // keystones.forEach((node, idx) =>
  //   place(node, 'keystone', keySlots[idx] || null)
  // );

  notables.forEach((node, idx) =>
    place(node, 'notable', noteSlots[idx] || null)
  );

  installPassiveTooltipHandler();
}





function isDevPlaceholderGem(g){
  const s = (g?.name || g?.base_item?.display_name || g?.id || '').toString();
  const sourceTags = Array.isArray(g?.source_tags) ? g.source_tags : [];
  return sourceTags.some((tag) => normalizeTag(tag) === 'derived_template') ||
    /(\bDNT\b|\bUNUSED\b|Coming\s*Soon|\{\d+\})/i.test(s);
}

function isKalguuranGem(g){
  const tags = []
    .concat(Array.isArray(g?.source_tags) ? g.source_tags : [])
    .concat(Array.isArray(g?.tags) ? g.tags : []);
  return tags.some((tag) => normalizeTag(tag) === 'kalguuran');
}

function isExcludedBuildSupport(g){
  return isDevPlaceholderGem(g) || isKalguuranGem(g);
}

function filterRecommendedSupportIds(supportEntries, gemDict){
  return (supportEntries || []).filter((entry) => {
    const gem = lookupGem(gemDict, entry);
    if (gem) return !isExcludedBuildSupport(gem);
    return !isDevPlaceholderGem({ id: String(entry || '') });
  });
}


function weaponContext(weapon, offhand){
  const wName = String(weapon?.name || '');
  const oName = String(offhand?.name || '');

  const wTagsArr = Array.isArray(weapon?.tags) ? weapon.tags : [];
  const oTagsArr = Array.isArray(offhand?.tags) ? offhand.tags : [];

  const wTags = new Set(wTagsArr.map(t => String(t).toLowerCase()));
  const oTags = new Set(oTagsArr.map(t => String(t).toLowerCase()));

  // Fallback: if tags are missing, include display names so compatibility checks still work
  if (!wTags.size && wName) wTags.add(wName.toLowerCase());
  if (!oTags.size && oName) oTags.add(oName.toLowerCase());
  
    // Add canonical hint tags from names (keeps gating robust even if tags are missing)
    const addHintsFromName = (name, set) => {
    const n = String(name || '').toLowerCase();
    if (!n) return;

    // specificity first to avoid collisions
    if (n.includes('crossbow')) set.add('crossbow');
    else if (n.includes('bow')) set.add('bow');

    if (n.includes('quarterstaff')) set.add('quarterstaff');
    else if (n.includes('staff')) set.add('staff');

    if (n.includes('sceptre') || n.includes('scepter')) set.add('sceptre');
    if (n.includes('wand')) set.add('wand');
    if (n.includes('spear')) set.add('spear');
    if (n.includes('flail')) set.add('flail');
    if (n.includes('talisman')) set.add('talisman');

    if (n.includes('buckler')) set.add('buckler');
    if (n.includes('shield')) set.add('shield');
    if (n.includes('quiver')) set.add('quiver');
    if (n.includes('focus')) set.add('focus');

    if (n.includes('unarmed')) set.add('unarmed');

    if (n.includes('mace') || n.includes('hammer')) set.add('mace');
    if (n.includes('axe')) set.add('axe');
    if (n.includes('sword')) set.add('sword');
    if (n.includes('dagger')) set.add('dagger');
    if (n.includes('claw')) set.add('claw');
  };

  addHintsFromName(wName, wTags);
  addHintsFromName(oName, oTags);

  return { weaponName: wName, offhandName: oName, weaponTags: wTags, offhandTags: oTags };
}

// ---- Gem/offhand compatibility helpers ----
// Some active skills in skills_enriched.json carry the tag "requiresshield".
// These should ONLY be eligible when the build has rolled a Shield/Buckler in the off-hand slot.
function offhandIsShieldOrBuckler(offhand){
  const n = String(offhand?.name || '').toLowerCase();
  return n.includes('shield') || n.includes('buckler');
}
function gemRequiresShield(g){
  const tags = Array.isArray(g?.tags) ? g.tags : [];
  return tags.some(t => String(t).toLowerCase() === 'requiresshield');
}
function isGemShieldCompatible(g, offhand){
  if (!gemRequiresShield(g)) return true;
  return offhandIsShieldOrBuckler(offhand);
}

function isGemWeaponCompatible(g, ctx){
  // v2 schema: gate by weapon_requirements (hard restriction)
  const wr = g?.weapon_requirements;

  const wName = String(ctx?.weaponName || '').toLowerCase();
  const oName = String(ctx?.offhandName || '').toLowerCase();
  const wTags = (ctx?.weaponTags instanceof Set) ? ctx.weaponTags : new Set();
  const oTags = (ctx?.offhandTags instanceof Set) ? ctx.offhandTags : new Set();
  
  // --- Special weapon rules (your requested distinctions) ---
  const tagList = Array.isArray(g?.tags) ? g.tags.map(t => String(t).toLowerCase()) : [];
  const tagSet = new Set(tagList);
  const skillTypes = (g?.taxonomy?.skill_types || []).map(t => String(t).toLowerCase());
  const typeSet = new Set(skillTypes);

  const hasTalisman = wTags.has('talisman') || wName.includes('talisman');
  const isShapeshift = tagSet.has('shapeshift') || tagSet.has('shapeshifting');

  // If you're holding a Talisman, ONLY shapeshift skills are allowed
  if (hasTalisman && !isShapeshift) return false;

  // Minion skills: ONLY sceptres (mainhand OR offhand)
  const isMinion = typeSet.has('minion');
  const hasSceptre = wTags.has('sceptre') || oTags.has('sceptre') || wName.includes('sceptre') || oName.includes('sceptre');
  if (isMinion && !hasSceptre) return false;

  // Spell skills: allowed if you have a “spell weapon” (wand/staff/sceptre) — enforce strongly only at higher cohesion
  const isSpell = typeSet.has('spell') || tagSet.has('spell');
  const hasSpellWeapon = wTags.has('spell') || oTags.has('spell') || wTags.has('wand') || oTags.has('wand') || wTags.has('staff') || oTags.has('staff') || hasSceptre;

  if (isSpell && !hasSpellWeapon) return false;

  if (wr && wr.is_unrestricted) return true;

  if (wr) {
    const mhNames = Array.isArray(wr.mainhand_names_any_of) ? wr.mainhand_names_any_of : [];
    const mhTags = Array.isArray(wr.mainhand_tags_any_of) ? wr.mainhand_tags_any_of : [];
    const ohNames = Array.isArray(wr.offhand_names_any_of) ? wr.offhand_names_any_of : [];
    const ohTags = Array.isArray(wr.offhand_tags_any_of) ? wr.offhand_tags_any_of : [];
    const disOhTags = Array.isArray(wr.disallow_offhand_tags_any_of) ? wr.disallow_offhand_tags_any_of : [];
    
	const anyTags = Array.isArray(wr.allowed_weapon_tags_any_of) ? wr.allowed_weapon_tags_any_of : [];

    if (mhNames.length) {
      const ok = mhNames.some(n => String(n).toLowerCase() === wName);
      if (!ok) return false;
    }
    if (mhTags.length) {
      const ok = mhTags.some(t => wTags.has(String(t).toLowerCase()));
      if (!ok) return false;
    }
    if (ohNames.length) {
      const ok = ohNames.some(n => String(n).toLowerCase() === oName);
      if (!ok) return false;
    }
    if (ohTags.length) {
      const ok = ohTags.some(t => oTags.has(String(t).toLowerCase()));
      if (!ok) return false;
    }
    if (disOhTags.length) {
      const bad = disOhTags.some(t => oTags.has(String(t).toLowerCase()));
      if (bad) return false;
    }
    
	// If this requirement only provides a union list (no per-hand constraints), enforce it here.
    if (!mhNames.length && !mhTags.length && !ohNames.length && !ohTags.length && anyTags.length) {
      const all = new Set([...wTags, ...oTags, wName, oName].filter(Boolean));
      const ok = anyTags.some(t => all.has(String(t).toLowerCase()));
      if (!ok) return false;
    }


    return true;
  }

  // Legacy fallback (pre-v2): use required_weapon_types / crafting_types
  const req = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
    ? g.required_weapon_types
    : (Array.isArray(g.crafting_types) ? g.crafting_types : []);

  if (!req.length) return true;

  const reqLower = req.map(x => String(x).toLowerCase());

  // Old logic expected display names; check tags + names to stay permissive.
  const wTokens = new Set([...wTags, wName].filter(Boolean));
  const oTokens = new Set([...oTags, oName].filter(Boolean));
  const all = new Set([...wTokens, ...oTokens]);

  // Mace generic
  if (reqLower.includes('mace') && [...all].some(r => r.includes('mace'))) return true;

  // Occult/Elemental special-cases (sceptre, wand, staff) in legacy data
  const hasOccult = reqLower.includes('occult');
  const hasElemental = reqLower.includes('elemental');
  if ((hasOccult || hasElemental) && all.has('sceptre')) return true;
  if (hasElemental && (all.has('wand') || all.has('staff'))) return true;

  return reqLower.some(r => all.has(r));
}


// ---------- support gems renderer ----------
function renderSupportCards(supportEntries, gemDict){
  const items=[];
  filterRecommendedSupportIds(supportEntries, gemDict).forEach(n=>{
    const g = lookupGem(gemDict, n);
    const title = g ? (g?.base_item?.display_name || g?.support_name || g?.name || String(n)) : String(n);
    const desc  = g ? (g?.support_text || g?.description || (g?.granted_effect && g?.granted_effect.description) || '') : '';
    const cls   = g ? dominantAttr(g.requirement_weights||g.attributes||{}) : 'int';
    if (g) {
      items.push(`<div class="support-item ${cls}"><div class="support-title">${title}</div>${desc?`<p class="support-desc">${desc}</p>`:''}</div>`);
    } else {
      // Minimal graceful fallback
      items.push(`<div class="support-item ${cls}"><div class="support-title">${title}</div></div>`);
    }
  });
  return items.join('');

}



// ---------- cross-mechanic support suggestions (strong) ----------

function _mechTagSetsFromCtx(ctx){
  const tactics = Array.isArray(ctx?.tacticSet) ? ctx.tacticSet : [];
  const ailments = Array.isArray(ctx?.ailmentSet) ? ctx.ailmentSet : [];

  const out = [];
  tactics.forEach((t, i) => {
    const tags = new Set((t?.tags || []).map(normTagPlus).filter(Boolean));
    if (tags.size) out.push({ kind: 'tactic', idx: i, tags });
  });
  ailments.forEach((a, i) => {
    const tags = new Set((a?.tags || []).map(normTagPlus).filter(Boolean));
    if (tags.size) out.push({ kind: 'ailment', idx: i, tags });
  });

  return {
    sets: out,
    tacticCount: tactics.length,
    ailmentCount: ailments.length,
    mechCount: tactics.length + ailments.length
  };
}

function _supportTagSet(g){
  const raw = []
    .concat(Array.isArray(g?.effect_tags) ? g.effect_tags : [])
    .concat(Array.isArray(g?.tags) ? g.tags : [])
    // Optional: include bracket_tags explicitly (usually redundant if you've merged them into tags)
    .concat(Array.isArray(g?.bracket_tags) ? g.bracket_tags : [])
    // taxonomy fields are not sourced from brackets and tend to be higher-signal
    .concat(Array.isArray(g?.taxonomy?.gem_tags) ? g.taxonomy.gem_tags : [])
    .concat(Array.isArray(g?.taxonomy?.skill_types) ? g.taxonomy.skill_types : [])
    .concat(Array.isArray(g?.taxonomy?.damage_types) ? g.taxonomy.damage_types : [])
    .concat(Array.isArray(g?.taxonomy?.delivery) ? g.taxonomy.delivery : [])
    .concat(Array.isArray(g?.taxonomy?.role) ? g.taxonomy.role : []);

  return new Set(raw.map(normTagPlus).filter(Boolean));
}


function selectSynergySupports(picks, ctx, gemDict, maxCount=4){
  try{
    const mech = _mechTagSetsFromCtx(ctx);
    if (!mech || mech.mechCount < 2) return [];
    
    const coh = (typeof cohesionThreshold === 'number' && Number.isFinite(cohesionThreshold)) ? cohesionThreshold : 0.75;

    // Candidate pool = ALL supports, EXCEPT supports already in the two skills' recommended_supports lists
	const excluded = new Set();
	(picks || []).forEach(g => {
	  (g?.recommended_supports || []).forEach(sid => {
		const sg = lookupGem(gemDict, sid);
		// Prefer canonical id exclusion if possible
		if (sg?.id != null) excluded.add(String(sg.id));
		else if (sid != null) excluded.add(String(sid));
	  });
	});
	
	// Collect unique supports by id from the gem dictionary (Map has many alias keys)
	const cand = new Map(); // id -> gem
	if (gemDict && typeof gemDict.values === 'function') {
	  for (const g of gemDict.values()) {
		if (!g || g.type !== 'support') continue;
		if (isExcludedBuildSupport(g)) continue;
		const id = (g.id != null) ? String(g.id) : null;
		if (!id) continue;
		if (excluded.has(id)) continue;     // <-- the inversion
		if (cand.has(id)) continue;         // de-dupe
		cand.set(id, g);
	  }
	}
	
	const scored = [];
	for (const [sid, sg] of cand) {
	  // NOTE: sg is already the support gem object; no lookup needed.
	  if (!sg || sg.type !== 'support') continue;
	
	  const stags = _supportTagSet(sg);
	  if (!stags.size) continue;
	
	  let hits = 0, tacticHits = 0, ailmentHits = 0;
	  const matchedTags = new Set();
	  const covered = new Set();
	
	  mech.sets.forEach((mset, mi) => {
		let hit = false;
		for (const t of mset.tags) {
		  if (!isMeaningfulMechanicTag(t)) continue;
		  if (stags.has(t)) {
			matchedTags.add(t);
			hit = true;
		  }
		}

		if (hit) {
		  hits++;
		  covered.add(mi);
		  if (mset.kind === 'tactic') tacticHits++;
		  else ailmentHits++;
		}
	  });
	
	  if (hits < 2) continue;
	
	  let idfScore = 0;
	  matchedTags.forEach(t => {
		const v = (window.TAG_IDF && typeof window.TAG_IDF.get === 'function') ? window.TAG_IDF.get(t) : 0;
		idfScore += (typeof v === 'number' && isFinite(v)) ? v : 0.15;
	  });
	
	  let score = hits * 2.0 + idfScore;
	  if (tacticHits > 0 && ailmentHits > 0) score += 1.0; // cross-category bonus
	  score += Math.min(0.3, (Array.isArray(sg?.effect_tags) ? sg.effect_tags.length : 0) * 0.03);
	  
	  score = applyRepeatPenalty(score, 'supports', sid, coh);
	
	  scored.push({ sid, score, hits, covered, matched: matchedTags });
	}


    scored.sort((a,b) => b.score - a.score);

    // Greedy diversity pass: prefer candidates that cover new mechanics
    const picked = [];
    const coveredAll = new Set();
    const usedTags = new Set();

    for (const c of scored) {
      if (picked.length >= maxCount) break;

      let addsNewMechanic = false;
      c.covered.forEach(i => { if (!coveredAll.has(i)) addsNewMechanic = true; });

      // If it doesn't add new mechanic coverage, require it to add at least one new matched tag.
      let addsNewTag = false;
      c.matched.forEach(t => { if (!usedTags.has(t)) addsNewTag = true; });

      if (picked.length && !addsNewMechanic && !addsNewTag) continue;

      picked.push(c.sid);
      c.covered.forEach(i => coveredAll.add(i));
      c.matched.forEach(t => usedTags.add(t));
    }

    return picked.slice(0, maxCount);
  }catch(e){
    console.warn('[skills] synergy support selection failed', e);
    return [];
  }
}

function renderSynergySupportsCard(grid, supportIds, gemDict, mechCount = 0){
  if (!grid) return;

  const ids = Array.isArray(supportIds) ? supportIds.filter(Boolean) : [];
  const shouldShowEmpty = SHOW_EMPTY_SYNERGY_SUPPORTS && (mechCount >= 2);

  // If we have nothing and we're not in "show empty" mode, do nothing.
  if (!ids.length && !shouldShowEmpty) return;

  const card = document.createElement('div');
  card.className = 'skill-card';
  card.style.gridColumn = '1 / -1'; // full width

  const body = ids.length
    ? `<div class="supports">${renderSupportCards(ids, gemDict)}</div>`
    : `<div class="skill-note" style="opacity:.85; font-style:italic;">
         No cross-mechanic support gems found for this roll.
       </div>`;

  card.innerHTML = `
    <div class="skill-title">Synergy Supports</div>
    <div class="skill-subtitle">Optional supports that reinforce multiple rolled mechanics — these may apply to other skills you choose.</div>
    <div class="skill-divider"></div>
    ${body}
  `;

  grid.appendChild(card);
}


// ---------- skill cards (with Grants + Req. Weapon) ----------

function isPersistentBuffGem(g){
  if (!g) return false;
  const tags = Array.isArray(g.tags) ? g.tags.map(normalizeTag) : [];
  const set = new Set(tags);
  return set.has('buff') && set.has('persistent');
}

// ---------- recommended-skill eligibility filters ----------

function isMinionSkill(g){
  const st = Array.isArray(g?.taxonomy?.skill_types) ? g.taxonomy.skill_types.map(normalizeTag) : [];
  return new Set(st).has('minion');
}

function hasExplicitCraftingType(g){
  // Allow minion skills even if crafting types are missing (many minion gems are like this)
  if (isMinionSkill(g)) return true;

  // v2 schema
  const c = g?.crafting;
  const v2 =
    (Array.isArray(c?.types_raw) && c.types_raw.length) ||
    (Array.isArray(c?.schools) && c.schools.length) ||
    (Array.isArray(c?.weapon_affinities) && c.weapon_affinities.length);

  // legacy schema
  const legacy = Array.isArray(g?.crafting_types) && g.crafting_types.length;

  return !!(v2 || legacy);
}


function isTriggeredOnlyGem(g){
  const st = Array.isArray(g?.taxonomy?.skill_types) ? g.taxonomy.skill_types.map(normalizeTag) : [];
  const set = new Set(st);
  // NOTE: we do NOT exclude "triggerable" or "triggers" (castable skills can have those)
  return set.has('triggered') || set.has('inbuilttrigger');
}

function isSpiritOrPersistentGem(g){
  // Persistent/spirit is allowed for minion skills (sceptre-only gate handles the rest)
  if (isMinionSkill(g)) return false;

  const tags = Array.isArray(g?.tags) ? g.tags.map(normalizeTag) : [];
  const set = new Set(tags);
  return set.has('persistent') || set.has('spirit');
}


function excludeFromRecommendedCoreSkills(g){
  if (!hasExplicitCraftingType(g)) return true;
  if (isTriggeredOnlyGem(g)) return true;
  if (isSpiritOrPersistentGem(g)) return true;
  return false;
}

// ---------- selection variance helpers ----------
function weightedPickIndex(weights){
  let sum = 0;
  for (const w of weights) sum += w;
  if (!(sum > 0)) return Math.floor(Math.random() * Math.max(1, weights.length));
  let r = Math.random() * sum;
  for (let i = 0; i < weights.length; i++){
    r -= weights[i];
    if (r <= 0) return i;
  }
  return Math.max(0, weights.length - 1);
}

// Pick #1 from top-K (weighted), then pick #2 via the same MMR-ish overlap penalty as pickTwoDiverse.
function pickTwoDiverseTopK(sorted, lambda = 0.7, coh = 0.75){
  if (sorted.length <= 1) return sorted.slice(0, 2).map(s => s.item);

  const c = (typeof coh === 'number' && Number.isFinite(coh)) ? coh : 0.75;

  // Higher cohesion => smaller K (more deterministic). Lower cohesion => larger K (more variance).
  const K =
    (c >= 0.85) ? 5 :
    (c >= 0.70) ? 6 :
    (c >= 0.55) ? 8 :
    (c >= 0.40) ? 10 : 12;

  const top = sorted.slice(0, Math.min(K, sorted.length));
  const minScore = top[top.length - 1].score;

  // Higher cohesion => more peaked weights (more likely to pick the top entries).
  const pow = 1.0 + c; // ~1.0–2.0

  const weights = top.map(s => Math.pow(Math.max(0, s.score - minScore) + 1e-6, pow));
  const idx = weightedPickIndex(weights);
  const first = top[idx];

  const S1 = new Set((first.item.tags || []).map(normTagPlus));
  let best = -Infinity, bestItem = null;

  for (let i = 0; i < sorted.length; i++){
    const cand = sorted[i];
    if (cand === first) continue;

    const g = cand.item;
    const S2 = new Set((g.tags || []).map(normTagPlus));
    let inter = 0;
    for (const t of S2){ if (S1.has(t)) inter++; }
    const union = new Set([...S1, ...S2]).size || 1;
    const overlap = inter / union;

    const mmr = lambda * cand.score - (1 - lambda) * overlap;
    if (mmr > best){ best = mmr; bestItem = g; }
  }

  return [first.item, bestItem || sorted[0].item];
}

// ----- subtitle helpers (crafting type / school) -----
function humanizeLabel(x){
  return String(x || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function gemCraftingLabel(g){
  // v2 schema: crafting.weapon_affinities / crafting.schools / crafting.types_raw
  const c = g && g.crafting;
  if (c) {
    const wa = Array.isArray(c.weapon_affinities) ? c.weapon_affinities.filter(Boolean) : [];
    const sc = Array.isArray(c.schools) ? c.schools.filter(Boolean) : [];
    const raw = Array.isArray(c.types_raw) ? c.types_raw.filter(Boolean) : [];
    const pick = wa.length ? wa : (sc.length ? sc : raw);
    if (pick.length) return pick.map(humanizeLabel).join(' / ');
  }

  // legacy schema: crafting_types
  if (Array.isArray(g?.crafting_types) && g.crafting_types.length) {
    return g.crafting_types.filter(Boolean).map(humanizeLabel).join(' / ');
  }

  // fallback to taxonomy
  const st = (g?.taxonomy?.skill_types || []).map(x => String(x).toLowerCase());
  if (st.includes('spell')) return 'Spell';
  if (st.includes('attack')) return 'Attack';
  return '';
}

function gemSubtitleHTML(g){
  const label = gemCraftingLabel(g);
  return label ? `<div class="skill-subtitle">${label}</div>` : '';
}


function rollRecommendedSkills(dataWrap, baseAttrs, picked, rollCtx, opts = {}){
  try{
    const options = opts || {};
    const targetGridId = options.gridId || 'skills-grid';
    const includePersistentBuff = options.includePersistentBuff !== false;
    const assignTagProfile = options.assignTagProfile !== false;
    const weaponCtx = weaponContext(picked.weapon, picked.offhand);
    const gems = (window.DATA && window.DATA.gems) ? window.DATA.gems : (dataWrap.gems || []);
    // Do NOT require crafting_types here; some valid actives have no crafting types in newer datasets.
	const hasCraftingTypes = (g) => {
	  const v2 = Array.isArray(g?.crafting?.types_raw) && g.crafting.types_raw.length > 0;
	  const v1 = Array.isArray(g?.crafting_types) && g.crafting_types.length > 0;
	  return v2 || v1;
	};

	const hasSpirit = (g) => {
	  const st = Array.isArray(g?.taxonomy?.skill_types) ? g.taxonomy.skill_types : [];
	  const tg = Array.isArray(g?.tags) ? g.tags : [];
	  return [...st, ...tg].some(t => String(t).toLowerCase().includes('spirit'));
	};
	
	const actives = gems.filter(g =>
	  g.type === 'active' &&
	  hasCraftingTypes(g) &&
	  !isDevPlaceholderGem(g) &&
	  !isKalguuranGem(g) &&
	  !hasSpirit(g)
	);



    // Separate persistent buff skills from general pool
    const persistentPool = actives.filter(g => isPersistentBuffGem(g) && isGemWeaponCompatible(g, weaponCtx) && isGemShieldCompatible(g, picked.offhand));
    const eligibleBase = actives.filter(g =>
      isGemWeaponCompatible(g, weaponCtx) &&
      isGemShieldCompatible(g, picked.offhand) &&
      !isPersistentBuffGem(g) &&
      !excludeFromRecommendedCoreSkills(g)
    );
    const avoidRaw = options.avoidSkills || [];
    const avoidSet = new Set(
      (avoidRaw instanceof Set ? Array.from(avoidRaw) : avoidRaw)
        .filter(Boolean)
        .map(x => String(x).toLowerCase())
    );
    const eligibleAvoid = eligibleBase.filter(g => {
      const key = String(g.id || g.base_item?.id || g.name || '').toLowerCase();
      return !avoidSet.has(key);
    });
    const eligible = eligibleAvoid.length >= 2 ? eligibleAvoid : eligibleBase;

    // Build/ensure global IDF
    if(!window.TAG_IDF){
      window.TAG_IDF = buildTagIDF(actives);
    }

    // Build rolled profile context
    const ctx = rollCtx || window.CURRENT_ROLL || {};
    const rolledProfile = buildRolledTagProfileCtx({
      tacticsTags: (ctx.tacticSet||[]).flatMap(t=>t?.tags||[]),
      ailmentsTags: (ctx.ailmentSet||[]).flatMap(a=>a?.tags||[]),
      defStratTags: (ctx.defStrat?.tags)||[],
      defensePseudoTags: defensePseudoTags(ctx.defense?.name),
      weaponPseudoTags: Array.from(deriveWeaponHints(picked.weapon, picked.offhand))
    });

    if (assignTagProfile && rollCtx && typeof rollCtx === 'object') {
      rollCtx.tagProfile = rolledProfile;
    }

    // Scoring knobs from cohesion mode
    const knobs = synergyTunings();
    knobs.rollAttr = ctx.rollAttr || baseAttrs || {strength:0.33,dexterity:0.33,intelligence:0.33};
    knobs.weaponHints = deriveWeaponHints(picked.weapon, picked.offhand);
    
        // ---------- mechanic coverage bonus (scales with cohesion + mechanic count) ----------
    const coh = (typeof cohesionThreshold === 'number' && Number.isFinite(cohesionThreshold))
      ? cohesionThreshold
      : 0.75;

    // Each rolled tactic/ailment counts as a "mechanic". We reward gems that cover more of them.
    const tacticMechs = (ctx.tacticSet || []).map(t => new Set((t?.tags || []).map(normTagPlus)));
    const ailmentMechs = (ctx.ailmentSet || []).map(a => new Set((a?.tags || []).map(normTagPlus)));
    const totalMechs = tacticMechs.length + ailmentMechs.length;

    const coverageBonusForGem = (g) => {
      if (!totalMechs) return 0;

      const gSet = new Set((g.tags || []).map(normTagPlus));

      let tHits = 0;
      for (const mech of tacticMechs){
        for (const tag of mech){
          if (gSet.has(tag)){ tHits++; break; }
        }
      }

      let aHits = 0;
      for (const mech of ailmentMechs){
        for (const tag of mech){
          if (gSet.has(tag)){ aHits++; break; }
        }
      }

      const coverage = tHits + aHits;
      if (!coverage) return 0;

      // Per-mechanic bonus scales with cohesion (more strict => more "match the roll")
      const per = 0.08 + 0.12 * coh;   // ~0.08–0.20
      let bonus = coverage * per;

      // Extra reward for hitting BOTH a tactic + an ailment (build feels more "real")
      if (tHits > 0 && aHits > 0) bonus += 0.10 * coh;

      // Cap to avoid a single gem overpowering everything (still lets attributes matter)
      const cap = 0.20 + 0.70 * coh;   // ~0.20–0.90
      if (bonus > cap) bonus = cap;

      return bonus;
    };


    // Score all eligibles for main recommended skills (+ mechanic coverage bonus)
    const scored = eligible.map(g => {
	  const s = scoreGemSynergy(g, rolledProfile, window.TAG_IDF, knobs);
	  const cov = coverageBonusForGem(g); // see note below if you keep it returning a number
		const covBonus = (typeof cov === 'number') ? cov : (cov.bonus || 0);
		const mechHits = (typeof cov === 'number') ? 0 : (cov.mechHits || 0);
		
		const key = g.id || g.base_item?.id || g.name || '';
		let score = s.score + covBonus;
		
		score = applyRepeatPenalty(score, 'skills', key, coh, {
		  totalMechs,
		  mechHits
		});
		
		return { item:g, score, raw:s.raw };

	}).sort((a,b)=>b.score - a.score);
	
	// Pick #1 from top-K (weighted), then #2 with diversity + mechanic coverage
	const mechSets = [...tacticMechs, ...ailmentMechs];
	const picks = pickTwoDiverseTopKWithMechanics(scored, 0.7, coh, mechSets);


    const grid = document.getElementById(targetGridId);
    if(!grid){ return; }
    grid.innerHTML = '';

    const gemDict = buildGemDictionary(gems);

    const synergySupports = selectSynergySupports(picks, ctx, gemDict, 4);

    // Render main recommended skills
	picks.forEach(g => {
	  const card = document.createElement('div');
	  card.className = 'skill-card';
	
	  // Subtle inline "requires" subtitle directly under the title
	  const requiresSubtitle = gemSubtitleHTML(g);
	
	  const allTags = Array.isArray(g.tags) ? g.tags.slice() : [];
	  const br = Array.isArray(g.bracket_tags) ? g.bracket_tags : [];
	  const rest = allTags.filter(t => !br.includes(t));
	  const displayTags = [...br, ...rest].slice(0, 10);
	
	  // mark matched tags
	  const matched = new Set();
	  for (const t of displayTags) {
		const k = normTagPlus(t);
		if (rolledProfile.profile.has(k)) matched.add(k);
	  }
	  const pills = displayTags.map(t => {
		const k = normTagPlus(t);
		const cls = matched.has(k) ? 'tag-pill matched' : 'tag-pill';
		return `<span class="${cls}">${t}</span>`;
	  }).join('');
	
	  card.innerHTML = `
		  <div class="skill-title">${g.name || '(Unnamed Gem)'}</div>
		  ${requiresSubtitle}
		  <div class="skill-divider"></div>
		  ${grantLine(g)}
		  <div class="skill-tags">${pills}</div>
		  <div class="supports-label">Recommended Supports</div>
		  <div class="supports">
			${renderSupportCards(g.recommended_supports, gemDict)}
		  </div>
		`;
	  applyGemBorderFromReqWeights(card, g.requirement_weights);
	  grid.appendChild(card);
	});

    // Cross-mechanic support suggestions (0-4)
    const mechCount =
	  (ctx?.tacticSet?.length || 0) +
	  (ctx?.ailmentSet?.length || 0);
	
	renderSynergySupportsCard(grid, synergySupports, gemDict, mechCount);




    // Render a dedicated persistent buff skill section (single card, full-width)
    const persistent = includePersistentBuff
      ? renderPersistentBuffSkill(persistentPool, rolledProfile, window.TAG_IDF, knobs, gems)
      : null;
      
    // Update recent-pick history (anti-repeat)
	pushPickHistory('skills', picks.map(g => (g.id || g.base_item?.id || g.name || '')));
	if (includePersistentBuff && persistent) {
	  pushPickHistory('buffs', (persistent.id || persistent.base_item?.id || persistent.name || ''));
	}
	if (Array.isArray(synergySupports) && synergySupports.length) {
	  pushPickHistory('supports', synergySupports);
	}

    return {
      tagProfile: rolledProfile,
      skills: picks.map(g => ({
        id: g.id || g.base_item?.id || g.name || '',
        name: g.name || '',
        recommended_supports: filterRecommendedSupportIds(g.recommended_supports, gemDict).slice(0, 6)
      })),
      synergySupports: Array.isArray(synergySupports) ? synergySupports.slice(0, 4) : [],
      persistentBuff: (includePersistentBuff && persistent) ? {
        id: persistent.id || persistent.base_item?.id || persistent.name || '',
        name: persistent.name || ''
      } : null
    };
  }catch(e){
    console.error("[skills] render error", e);
  }
  }


function renderPersistentBuffSkill(persistentPool, rolledProfile, tagIDF, knobs, gems){
  try {
    // Clear any previous persistent buff section
    document.querySelectorAll('#persistent-buff-section').forEach(el => el.remove());

    if (!Array.isArray(persistentPool) || !persistentPool.length) return;

    const actives = persistentPool.filter(g => g && g.type === 'active');
    if (!actives.length) return;
    
    const coh = (typeof cohesionThreshold === 'number' && Number.isFinite(cohesionThreshold)) ? cohesionThreshold : 0.75;

    // Score persistent buff candidates with the same synergy engine
    const scoredPB = actives.map(g => {
	  const s = scoreGemSynergy(g, rolledProfile, tagIDF, knobs);
	  const key = g.id || g.base_item?.id || g.name || '';
	  let score = s.score;
	  score = applyRepeatPenalty(score, 'buffs', key, coh);
	  return { item:g, score, raw:s.raw };
	}).sort((a,b) => b.score - a.score);
	
	const K =
	  (coh >= 0.85) ? 4 :
	  (coh >= 0.70) ? 5 :
	  (coh >= 0.55) ? 6 :
	  (coh >= 0.40) ? 8 : 10;
	
	const topPB = scoredPB.slice(0, Math.min(K, scoredPB.length));
	const minScore = topPB[topPB.length - 1].score;
	const pow = 1.0 + coh;
	const weightsPB = topPB.map(s => Math.pow(Math.max(0, s.score - minScore) + 1e-6, pow));
	const top = topPB[weightedPickIndex(weightsPB)];

    if (!top || !isFinite(top.raw)) return;

    const skillsGrid = document.getElementById('skills-grid');
    const skillsSect = skillsGrid ? skillsGrid.closest('.sect') : null;
    const main = document.querySelector('main') || document.body;
    const parent = (skillsSect && skillsSect.parentNode) || main;

    // Build section container
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

    if (skillsSect) {
      skillsSect.insertAdjacentElement('afterend', wrap);
    } else {
      parent.appendChild(wrap);
    }

    const grid = wrap.querySelector('#persistent-buff-grid');
	if (!grid) return;
	grid.innerHTML = '';
	
	const g = top.item;
	const gemDict = buildGemDictionary(gems || []);
	const card = document.createElement('div');
	card.className = 'skill-card persistent-buff-card';
	
	// Subtle inline "requires" subtitle directly under the title
	const requiresSubtitle = gemSubtitleHTML(g);
	
	const allTags = Array.isArray(g.tags) ? g.tags.slice() : [];
	const br = Array.isArray(g.bracket_tags) ? g.bracket_tags : [];
	const rest = allTags.filter(t => !br.includes(t));
	const displayTags = [...br, ...rest].slice(0, 10);
	
	const matched = new Set();
	for (const t of displayTags) {
	  const k = normTagPlus(t);
	  if (rolledProfile.profile.has(k)) matched.add(k);
	}
	const pills = displayTags.map(t => {
	  const k = normTagPlus(t);
	  const cls = matched.has(k) ? 'tag-pill matched' : 'tag-pill';
	  return `<span class="${cls}">${t}</span>`;
	}).join('');
	
        card.innerHTML = `
          <div class="skill-title">${g.name || '(Unnamed Gem)'}</div>
          ${requiresSubtitle}
          <div class="skill-divider"></div>
          ${grantLine(g)}
          <div class="skill-tags">${pills}</div>
          <div class="supports-label">Recommended Supports</div>
          <div class="supports">
                ${renderSupportCards(g.recommended_supports, gemDict)}
          </div>
        `;
        applyGemBorderFromReqWeights(card, g.requirement_weights);
        grid.appendChild(card);

        return g;
  } catch (e) {
    console.error('[persistent buff] render error', e);
  }
}

// ---- Active gem border color from requirement_weights ----
function applyGemBorderFromReqWeights(el, weights){
  if(!el) return;
  const w = weights||{};
  const s = Number(w.strength||0), d = Number(w.dexterity||0), i = Number(w.intelligence||0);
  const max = Math.max(s,d,i);
  const colors = [];
  if(s===max && max>0) colors.push('rgba(176,48,48,0.9)');
  if(d===max && max>0) colors.push('rgba(45,122,45,0.9)');
  if(i===max && max>0) colors.push('rgba(47,79,157,0.9)');
  if(colors.length<=1){
    const c = colors[0] || 'rgba(200,200,200,0.35)';
    el.style.border = '1px solid ' + c;
    el.style.boxShadow = '0 0 8px rgba(255,255,255,0.06)';
    return;
  }
  // gradient for ties
  el.style.border = '1px solid transparent';
  el.style.borderImage = `linear-gradient(90deg, ${colors.join(', ')}) 1`;
  el.style.boxShadow = '0 0 10px rgba(255,255,255,0.06)';
}

// Small helper to render grant line (shared by main skills + persistent buff)
const grantLine = (g) => {
  // v2 schema: description is on the gem itself
  const descV2 = String(g?.description || '').trim();
  if (descV2){
    return `
      <div class="grant-wrap">
        <div class="grant">
          <div class="grant-desc">${descV2}</div>
        </div>
      </div>
    `;
  }

  // legacy fallback
  const list = Array.isArray(g.granted_skills_full) ? g.granted_skills_full : [];
  if (!list.length) return '';
  const first = list[0];
  const desc = first?.description || g.grant_description || '';
  const dn   = first?.display_name || g.grant_display || '';
  if (!dn && !desc) return '';
  return `
    <div class="grant-wrap">
      <div class="grant">
        <div class="grant-title">${dn || ''}</div>
        <div class="grant-desc">${desc || ''}</div>
      </div>
    </div>
  `;
};



export {
  applyGemBorderFromReqWeights,
  buildPassiveIndex,
  grantLine,
  renderPassiveRecommendations,
  renderSupportCards,
  rollRecommendedSkills
};


// ---------- data preload helper ----------
