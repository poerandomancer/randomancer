import { buildGemDictionary, lookupGem } from './gem-utils.js';
import { buildBuildContext } from './06-build-context.js';
import { toMatchKey } from './tag-normalization.js';


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
          const norm = toMatchKey(t);
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

function renderPassiveRecommendations(currentDraw, dataWrap) {
  const panel = document.getElementById('passives-panel');
  const grid = document.getElementById('passives-grid');

  const hideAll = () => {
    if (grid) grid.innerHTML = '';
    if (panel) panel.classList.add('hidden');
  };

  const passivesData =
    dataWrap?.passivesEnriched || (window.DATA && window.DATA.passivesEnriched);
  const hasPassiveData = passivesData && Array.isArray(passivesData.nodes);
  if (!panel || !grid || !hasPassiveData || !currentDraw || !currentDraw.passives) {
    hideAll();
    return;
  }

  const ctx = buildBuildContext(currentDraw);
  const buildTagSet = new Set();
  (ctx?.tags || []).forEach((t) => buildTagSet.add(toMatchKey(t)));
  (ctx?.defenseTags || []).forEach((t) => buildTagSet.add(toMatchKey(t)));

  const passives = currentDraw.passives || {};
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

  // Spell skills: allowed if you have a “spell weapon” (wand/staff/sceptre) — enforce strongly only at higher affinity
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
};


// ---------- data preload helper ----------
