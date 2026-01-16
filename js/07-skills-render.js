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
import { buildBuildContext } from './06-cohesion.js';

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
  const lines = Array.isArray(node?.lines) ? node.lines.filter(Boolean) : [];
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
  return /(\bDNT\b|\bUNUSED\b|Coming\s*Soon)/i.test(s);
}


function weaponsToTypes(weapon, offhand){
  const arr = [];
  if(weapon && weapon.name) arr.push(weapon.name);
  if(offhand && offhand.name) arr.push(offhand.name);
  return arr.map(x=>String(x).toLowerCase());
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

function isGemWeaponCompatible(g, rolledTypesLower){
  const req = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
    ? g.required_weapon_types
    : (Array.isArray(g.crafting_types) ? g.crafting_types : []);
  if(!req.length) return true;

  const reqLower = req.map(x => String(x).toLowerCase());

  const hasOccult = reqLower.includes("occult");
  const hasElemental = reqLower.includes("elemental");
  const hasMaceGeneric = reqLower.includes("mace");
  const hasPrimal = reqLower.includes("primal");

  // NEW: use gem tags to split Primal into spell vs non-spell
  if (hasPrimal) {
    const tagLower = Array.isArray(g.tags) ? g.tags.map(t => String(t).toLowerCase()) : [];
    const isSpellGem = tagLower.includes("spell");

    const hasTalisman = rolledTypesLower.includes("talisman");
    const hasCasterWeapon = rolledTypesLower.some(r => ["wand", "staff", "sceptre"].includes(r));

    // Primal spells => wand/staff/sceptre only; non-spell primal => talisman only
    return isSpellGem ? hasCasterWeapon : hasTalisman;
  }

  if ((hasOccult || hasElemental) && rolledTypesLower.some(r => r === "sceptre")) return true;
  if (hasElemental && rolledTypesLower.some(r => ["wand", "staff"].includes(r))) return true;
  if (hasMaceGeneric && rolledTypesLower.some(r => r.includes('mace'))) return true;

  return reqLower.some(r => rolledTypesLower.includes(r));
}


// ---------- support gems renderer ----------
function renderSupportCards(supportEntries, gemDict){
  const items=[];
  (supportEntries||[]).forEach(n=>{
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

// ---------- skill cards (with Grants + Req. Weapon) ----------

function isPersistentBuffGem(g){
  if (!g) return false;
  const tags = Array.isArray(g.tags) ? g.tags.map(normalizeTag) : [];
  const set = new Set(tags);
  return set.has('buff') && set.has('persistent');
}

function rollRecommendedSkills(dataWrap, baseAttrs, picked, rollCtx, opts = {}){
  try{
    const options = opts || {};
    const targetGridId = options.gridId || 'skills-grid';
    const includePersistentBuff = options.includePersistentBuff !== false;
    const assignTagProfile = options.assignTagProfile !== false;
    const rolledTypesLower = weaponsToTypes(picked.weapon, picked.offhand);
    const gems = (window.DATA && window.DATA.gems) ? window.DATA.gems : (dataWrap.gems || []);
    const actives = gems.filter(g =>
      g.type === 'active' &&
      Array.isArray(g.crafting_types) && g.crafting_types.length > 0 &&
      !isDevPlaceholderGem(g)
    );

    // Separate persistent buff skills from general pool
    const persistentPool = actives.filter(g => isPersistentBuffGem(g) && isGemWeaponCompatible(g, rolledTypesLower) && isGemShieldCompatible(g, picked.offhand));
    const eligibleBase = actives.filter(g =>
      isGemWeaponCompatible(g, rolledTypesLower) &&
      isGemShieldCompatible(g, picked.offhand) &&
      !isPersistentBuffGem(g)
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

    // Score all eligibles for main recommended skills
    const scored = eligible.map(g => {
      const s = scoreGemSynergy(g, rolledProfile, window.TAG_IDF, knobs);
      return { item:g, score:s.score, raw:s.raw };
    }).sort((a,b)=>b.score - a.score);

    // Pick two with diversity
    const picks = pickTwoDiverse(scored, 0.7);

    const grid = document.getElementById(targetGridId);
    if(!grid){ return; }
    grid.innerHTML = '';

    const gemDict = buildGemDictionary(gems);

    // Render main recommended skills
	picks.forEach(g => {
	  const card = document.createElement('div');
	  card.className = 'skill-card';
	
	  // Subtle inline "requires" subtitle directly under the title
	  const requiresSubtitle = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
		? `<div class="skill-subtitle">${g.required_weapon_types
			.map(x => x[0].toUpperCase() + x.slice(1))
			.join(', ')}</div>`
		: '';
	
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


    // Render a dedicated persistent buff skill section (single card, full-width)
    const persistent = includePersistentBuff
      ? renderPersistentBuffSkill(persistentPool, rolledProfile, window.TAG_IDF, knobs, gems)
      : null;

    return {
      tagProfile: rolledProfile,
      skills: picks.map(g => ({
        id: g.id || g.base_item?.id || g.name || '',
        name: g.name || '',
        recommended_supports: Array.isArray(g.recommended_supports) ? g.recommended_supports.slice(0, 6) : []
      })),
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

    // Score persistent buff candidates with the same synergy engine
    const scoredPB = actives.map(g => {
      const s = scoreGemSynergy(g, rolledProfile, tagIDF, knobs);
      return { item:g, score:s.score, raw:s.raw };
    }).sort((a,b) => b.score - a.score);

    const top = scoredPB[0];
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
	const requiresSubtitle = (Array.isArray(g.required_weapon_types) && g.required_weapon_types.length)
	  ? `<div class="skill-subtitle">${g.required_weapon_types
		  .map(x => x[0].toUpperCase() + x.slice(1))
		  .join(', ')}</div>`
	  : '';
	
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
