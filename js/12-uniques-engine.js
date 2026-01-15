import { TagUtils, defensePseudoTags } from './05-tags-and-scorer.js';

/* === Randomancer: Uniques Synergy — canonical engine (v0.8.2) === */
(function(){
  const TOKEN = 'u79b2m_' + Date.now();
  window.__u79_active = TOKEN; // last-wins flag

  // Use shared tag normalizer
  const norm = (s) => TagUtils.norm(s);
  const syncLocks = () => {
    if (typeof window !== 'undefined' && typeof window.syncLockUIFromState === 'function') {
      window.syncLockUIFromState();
    }
  };

  const splitNames = (s) => String(s||'')
    .replace(/\u00B7/g,'•')
    .split(/\s*(?:,|•|&|\band\b|\/|\+|;)\s*/i)
    .map(x => x.replace(/^['"]|['"]$/g,'').trim())
    .filter(Boolean);

  function dataIndex(){
    const DATA = window.DATA||{};
    const byName = new Map(), byNorm = new Map();
    const add = arr => (arr||[]).forEach(o=>{
      const name = String(o?.name||'').trim(); if(!name) return;
      const tags = Array.from(new Set((o?.tags||[]).map(norm))).filter(Boolean);
      byName.set(name, tags); byNorm.set(norm(name), tags);
    });
    add(DATA.Tactics); add(DATA.Ailments); add(DATA.DefensiveStrategies);
    return { get: (name) => byName.get(name) || byNorm.get(norm(name)) || [] };
  }

  function expandTags(arr){
    const out = new Set();
    for (let t of (arr||[])){
      if(!t) continue;
      const parts = String(t).split(/\s*(?:\/|&|\band\b|\+)\s*/i).map(p=>norm(p)).filter(Boolean);
      if (parts.length>1){ parts.forEach(p=>out.add(p)); continue; }
      const n = norm(t);
      if (n==='slowmaimhinder'){ out.add('slow'); out.add('maim'); out.add('hinder'); continue; }
      out.add(n);
    }
    return Array.from(out);
  }

  function deriveExtraTags(lines){
    const txt = (lines||[]).slice(2).join('\\n').toLowerCase();
    const out = [];
    if (/(?:break|broken|breaks)\s+armou?r/.test(txt) || /armou?r\s*(?:break|broken)/.test(txt)) out.push('armourbreak');
    if (/(armou?r.*shatter|shatter.*armou?r)/.test(txt)) out.push('armourbreak');
    if (/\bhinder(?:ed|ing|s)?\b|\bhindrance\b/.test(txt)) out.push('hinder');
    if (/\bslow(?:ed|ing|s)?\b|\bslowing\b/.test(txt)) out.push('slow');
    if (/\bmaim(?:ed|ing|s)?\b/.test(txt)) out.push('maim');
    if (/\blife\s+regen(eration)?\b|\bregenerat(e|es|ed|ing|ion)\b/.test(txt)) out.push('liferegeneration');
    if (/\bleech(ed|ing|es)?\b/.test(txt)) out.push('leech');
    if (/\bcrit(ical|s|ically| chance)?\b|\bcritical\s+strike\b/.test(txt)) out.push('critical');
    return out;
  }

  const RX = {
    Ignite: /\bignite(d|s|ing)?\b/i,
    Freeze: /\bfreez(e|es|ed|ing)\b|\bchill(ed|ing|s)?\b/i,
    Shock: /\bshock(ed|ing|s)?\b/i,
    Bleed: /\bbleed(ing|s|ed)?\b/i,
    Poison: /\bpoison(ed|ing|s)?\b/i,
    'Life Regeneration': /\blife\s+regen(eration)?\b|\bregenerat(e|es|ed|ing|ion)\b/i,
    Leech: /\bleech(ed|ing|es)?\b/i,
    'Culling Strike': /\bculling\s+strike\b/i,
    'Heavy Stun': /\bstun(ned|ning|s)?\b|\bheavy\s+stun\b|\bstun\s+threshold\b/i,
    Block: /\bchance\s+to\s+block\b|\bblock(ed|ing|s)?\b/i,
  };
  function filterCanonicalsByEvidence(item){
    const canon = (item.tags && item.tags.canonical) || [];
    if (!canon.length) return canon;
    const text = (item.lines||[]).slice(2).join('\\n');
    return canon.filter(lbl => {
      const r = RX[lbl];
      if (!r) return true;
      return r.test(text);
    });
  }
  
    function getRollSnapshot(snap){
	  // 1) Explicit snapshot (from App.onRoll or direct call)
	  if (snap && typeof snap === 'object') return snap;
	
	  // 2) App.state.currentRoll (DOM-driven snapshot)
	  const App = window.App;
	  if (App && App.state && App.state.currentRoll) return App.state.currentRoll;
	
	  // 3) Fallback to global CURRENT_ROLL if we’re using that
	  if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
		return window.CURRENT_ROLL;
	  }
	
	  return null;
	}

    function rolledByCategory(snap){
	  const state = getRollSnapshot(snap);
	  if (!state) {
		return { tactics: [], ailments: [], def: [] };
	  }
	
	  // ——— PREFER ENRICHED SNAPSHOT (tacticSet / ailmentSet / defStrat objects) ———
	  const hasEnriched =
		(Array.isArray(state.tacticSet) && state.tacticSet.length) ||
		(Array.isArray(state.ailmentSet) && state.ailmentSet.length) ||
		(state.defStrat && typeof state.defStrat === 'object');
	
	  if (hasEnriched){
		const tagsT = Array.from(
		  expandTags(
			(state.tacticSet || []).flatMap(t => t?.tags || [])
		  )
		);
	
		const tagsA = Array.from(
		  expandTags(
			(state.ailmentSet || []).flatMap(a => a?.tags || [])
		  )
		);
	
		const tagsD = Array.from(
		  expandTags([
			...(state.defStrat?.tags || []),
			...defensePseudoTags(state.defense && state.defense.name)
		  ])
		);
	
		return {
		  tactics: tagsT,
		  ailments: tagsA,
		  def: tagsD,
		};
	  }
	
	  // ——— LEGACY FALLBACK (text-only snapshot: tactics / ailments / defStrat names) ———
	  const idx = dataIndex();
	
	  const rawT = String(state.tactics || '').trim();
	  const rawA = String(state.ailments || '').trim();
	  const rawD = String(state.defStrat || '').trim();
	
	  const namesT = Array.from(new Set([...splitNames(rawT), rawT].filter(Boolean)));
	  const namesA = Array.from(new Set([...splitNames(rawA), rawA].filter(Boolean)));
	  const namesD = Array.from(new Set([...splitNames(rawD), rawD].filter(Boolean)));
	
	  const tagsT = Array.from(
		expandTags(namesT.flatMap(n => idx.get(n)))
	  );
	  const tagsA = Array.from(
		expandTags(namesA.flatMap(n => idx.get(n)))
	  );
	  const tagsD = Array.from(
		expandTags([
		  ...namesD.flatMap(n => idx.get(n)),
		  ...defensePseudoTags(state.defense || state.defenseName)
		])
	  );
	
	  return {
		tactics: tagsT,
		ailments: tagsA,
		def: tagsD,
	  };
	}

    function allowedSlots(snap){
		const state = getRollSnapshot(snap);
	
		// These are always allowed regardless of weapon
		const allow = new Set(['amulet','belt','ring','jewel','body','boots','gloves','helmet','flask','tincture']);
	
		if (!state) return allow;
	
		const weaponText = String(state.weapon || '').toLowerCase();
	
		const hasWord = (s) => {
		  if (!s) return false;
		  const re = new RegExp('\\b' + s + '\\b', 'i');
		  return re.test(weaponText);
		};
		const add = s => allow.add(s);
	
		const wantsQuarterstaff = hasWord('quarterstaff');
		const wantsStaff = hasWord('staff') && !wantsQuarterstaff;
	
		const hasBow = hasWord('bow');
		const hasCrossbow = hasWord('crossbow');
	
		// primary weapon types
		if (hasBow)         { add('bow'); add('quiver'); }
		if (hasCrossbow)    add('crossbow');
		if (wantsStaff || wantsQuarterstaff) add('staff');
		if (hasWord('spear'))  add('spear');
		if (hasWord('sword'))  add('sword');
		if (hasWord('mace'))   add('mace');
		if (hasWord('axe'))    add('axe');
		if (hasWord('claw'))   add('claw');
		if (hasWord('wand'))   add('wand');
		if (hasWord('sceptre')) add('sceptre');
	
		// off-hands
		if (hasWord('shield'))   add('shield');
		if (hasWord('buckler'))  add('buckler');
		if (hasWord('focus'))    add('focus');
		if (hasWord('soulcore')) add('soulcore');
		if (hasWord('trap tool') || hasWord('traptool')) add('traptool');
	
		// expose staff vs quarterstaff intent for weaponSlotAllowed, if you still use those
		allow.__wtxt = weaponText;
		allow.__wantsQuarterstaff = wantsQuarterstaff;
		allow.__wantsStaff = wantsStaff;
	
		return allow;
	  }


async function loadUniquesM(){
    const url = 'data/enriched/uniques_enriched.json?v=' + Date.now();
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    return Array.isArray(data) ? data : (data.items||[]);
  }

  function getItemTagSet(item){
    const raw = (item.tags && item.tags.raw) || [];
    const canon = filterCanonicalsByEvidence(item);
    const derived = deriveExtraTags(item.lines || []);
    const acc = [];

    // normalize raw + derived tags directly
    for (const t of [...raw, ...derived]){
      if (!t) continue;
      const n = norm(t);
      if (n) acc.push(n);
    }

    // expand canonical labels, including compound ones like "Slow/Maim/Hinder"
    for (const lbl of canon){
      if (!lbl) continue;
      const parts = String(lbl)
        .split(/\s*(?:\/|&|\band\b|\+)\s*/i)
        .filter(Boolean);
      if (parts.length > 1){
        for (const p of parts){
          const n = norm(p);
          if (n) acc.push(n);
        }
        continue;
      }
      const n = norm(lbl);
      if (n === 'slowmaimhinder'){
        acc.push('slow','maim','hinder');
      } else if (n){
        acc.push(n);
      }
    }

    return new Set(acc);
  }
  function scoreItem(it, rolled, slotAllow){
    const all = getItemTagSet(it);
    let s = 0;
    for (const t of rolled.tactics)  if (all.has(t)) s += 3.0;
    for (const t of rolled.ailments) if (all.has(t)) s += 1.7;
    for (const t of rolled.def)      if (all.has(t)) s += 1.2;
    if (slotAllow && slotAllow.has && slotAllow.has(it.slot)) s += 0.6;
    return s;
  }

function weaponSlotAllowed(it, slotAllow){
    if (!slotAllow || !slotAllow.has) return true;
    // Non-weapon slots just rely on presence in the allowed set
    if (!['bow','crossbow','staff','spear','sword','mace','axe','claw','wand','sceptre','shield','buckler','focus','soulcore','traptool'].includes(it.slot)) {
      return slotAllow.has(it.slot);
    }
    if (it.slot !== 'staff') {
      return slotAllow.has(it.slot);
    }
    // Staff vs Quarterstaff split
    if (!slotAllow.has('staff')) return false;
    const wantsQuarterstaff = !!slotAllow.__wantsQuarterstaff;
    const wantsStaff = !!slotAllow.__wantsStaff;
    const base = String(it.base || '').toLowerCase();
    const isQuarterstaffItem = base.includes('quarterstaff');
    if (wantsQuarterstaff && !isQuarterstaffItem) return false;
    if (wantsStaff && isQuarterstaffItem) return false;
    return true;
  }

  function pick(items, rolled, allow, limitMax=5, perSlotCap=2){
    const MIN = 2.8;
    const slotAllow = allow || new Set();
    const scored = items
      .map(it => ({ it, s: scoreItem(it, rolled, slotAllow) }))
      .filter(row => weaponSlotAllowed(row.it, slotAllow) && row.s >= MIN)
      .sort((a, b) => b.s - a.s);
    const out = [], per = new Map();
    for (const row of scored){
      const c = per.get(row.it.slot) || 0;
      if (c >= perSlotCap) continue;
      per.set(row.it.slot, c + 1);
      out.push(row.it);
      if (out.length >= limitMax) break;
    }
    return out;
  }

function ensureUniqueSection(){
    // Remove previous instances to avoid drift
    document.querySelectorAll('.unique-divider').forEach(el=>el.remove());
    document.querySelectorAll('#uniques-section').forEach(el=>el.remove());

    // Mount into the dedicated Uniques panel (keeps section borders consistent)
    const mount = document.getElementById('uniques-mount');
    if (!mount) return null;

    // Clear any previous content
    mount.innerHTML = '';

    // Insert Uniques section
    const wrap = document.createElement('div');
    wrap.id = 'uniques-section';
    wrap.className = 'sect';
    wrap.innerHTML = `
          <div class="sect-head">
                <h3 class="section-title">Recommended Uniques</h3>
                <div class="underline"></div>
                <p class="sub">Unique items tuned to the ailments, tactics, and defenses of this roll.</p>
          </div>
          <div id="uniques-grid" class="grid two uniques-grid"></div>
        `;

    mount.appendChild(wrap);

    const lockBtn = wrap.querySelector('.lock-toggle');
    if (lockBtn) wireLockButton(lockBtn);
    syncLocks();

    return wrap.querySelector('#uniques-grid');
  }

  function pillsFor(item, rolledSet){
    const tags = Array.from(getItemTagSet(item)).sort();
    return tags.map(t=>`<span class="tag-pill pill${rolledSet.has(t)?' matched':''}" data-tag="${t}">${t}</span>`).join('');
  }
  function highlight(lines, rolledSet){
	  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	  // Skip the first 2 lines (name + base) – they’re in the header
	  let out = (lines || []).slice(2).join('\n');
	
	  // Highlight any text that matches the rolled profile tags
	  rolledSet.forEach(t => {
		if (!t) return;
		const rx = new RegExp(esc(String(t)), 'ig');
		out = out.replace(rx, m => `<span class="hit">${m}</span>`);
	  });
	
	  return out
		.split('\n')
		.map(L => L.trim())
		.filter(L => L.length) // drop empty lines
		.map(L => `<div class="unique-line">${L}</div>`)
		.join('');
	}
	
	function buildUniqueReason(it, rolledSet) {
	  if (!it) return '';
	
	  // Use the same tag logic as scoring + pill rendering
	  const tagSet = getItemTagSet(it);        // returns a Set of normalized tags
	  const tags = Array.from(tagSet);
	  if (!tags.length) return '';
	
	  const hasRolled =
		rolledSet &&
		typeof rolledSet.has === 'function' &&
		rolledSet.size > 0;
	
	  const matched = [];
	  const unmatched = [];
	
	  for (const t of tags) {
		if (!t) continue;
	
		// rolledSet already holds normalized tags (from rolledByCategory/expandTags)
		if (hasRolled && rolledSet.has(t)) {
		  matched.push(t);
		} else {
		  unmatched.push(t);
		}
	  }
	
	  // Prefer tags that actually match the rolled profile; otherwise just
	  // describe the item by its own tags.
	  const source = (hasRolled && matched.length) ? matched : tags;
	  const main = source.slice(0, 3); // up to 3 tags
	
	  if (!main.length) return '';
	
	  const humanList = (arr) => {
		const pretty = (s) => {
		  s = String(s || '').trim();
		  if (!s) return s;
		  return s[0].toUpperCase() + s.slice(1);
		};
		const p = arr.map(pretty);
		if (p.length === 1) return p[0];
		if (p.length === 2) return `${p[0]} and ${p[1]}`;
		return `${p[0]}, ${p[1]} and ${p[2]}`;
	  };
	
	  const list = humanList(main);
	
	  if (hasRolled && matched.length) {
		return `Synergizes with your ${list} focus.`;
	  }
	  return `Adds ${list} to your build.`;
	}


  function renderUniques(items, rolledSet){
	  const grid = ensureUniqueSection();
	  if (!grid) {
		setTimeout(() => renderUniques(items, rolledSet), 120);
		return;
	  }
	
	  grid.innerHTML = items.map(it => {
		const pills = pillsFor(it, rolledSet);
		const lines = highlight(it.lines, rolledSet);
		const reason = buildUniqueReason(it, rolledSet);
	
		return `
		  <div class="unique-card">
			<div class="unique-header">
			  <div class="unique-name">${it.name}</div>
			  <div class="unique-base">${it.base}</div>
			</div>
			<div class="skill-divider"></div>
			<div class="tags-row">
			  ${pills}
			</div>
			<div class="unique-lines">
			  ${reason ? `<div class="unique-highlights">${reason}</div>` : ''}
			  ${lines}
			</div>
		  </div>
		`;

	  }).join('');
	}


    async function refreshUniques(snap){
          if (window.__u79_active !== TOKEN) return; // last-wins

          try{
                const items = await loadUniquesM();
                const rolled = rolledByCategory(snap);
                const rolledSet = new Set([
                  ...rolled.tactics,
                  ...rolled.ailments,
                  ...rolled.def,
                ]);
                const allow = allowedSlots(snap);
                const picks = pick(items, rolled, allow, 5, 2);

                if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
                  window.App.mergeCurrentRoll({ recommendedUniques: picks.map(p => p.name) });
                }
                if (typeof window.RandomancerUpdateBuildCodeUI === 'function') {
                  window.RandomancerUpdateBuildCodeUI();
                }

		renderUniques(picks, rolledSet);
	  }catch(e){
		console.error('[u79b2m] refresh error', e);
	  }
        }

        // Expose a global hook so the core roll engine can trigger uniques directly
    window.RandomancerRefreshUniques = refreshUniques;

    async function renderUniquesFromNames(names, snapOrRolledSet){
	  if (!Array.isArray(names) || !names.length) {
		ensureUniqueSection()?.replaceChildren();
		return;
	  }
	
	  // ✅ Build rolledSet from the snapshot we were passed
	  let rolledSet;
	  try {
		if (snapOrRolledSet && typeof snapOrRolledSet.has === 'function') {
		  rolledSet = snapOrRolledSet; // already a Set-like
		} else {
		  const snap =
			(snapOrRolledSet && typeof snapOrRolledSet === 'object')
			  ? snapOrRolledSet
			  : (window.App?.state?.currentRoll || window.CURRENT_ROLL || {});
		  const rolled = rolledByCategory(snap || {});
		  rolledSet = new Set([
			...(rolled?.tactics || []),
			...(rolled?.ailments || []),
			...(rolled?.def || []),
		  ]);
		}
	  } catch {
		rolledSet = new Set();
	  }
	
	  // (optional safety) normalize name list if you might get objects:
	  const nameList = names
		.map(u => (typeof u === 'string' ? u : (u && typeof u === 'object' ? u.name : null)))
		.filter(Boolean);
	
	  const items = await loadUniquesM();
	  const byName = new Map(items.map(it => [it.name, it]));
	  const ordered = nameList.map(n => byName.get(n)).filter(Boolean);
	
	  // ✅ THIS is what drives highlight() matching
	  renderUniques(ordered, rolledSet);
	}




    window.RandomancerRenderUniquesFromNames = renderUniquesFromNames;


      // Hook into App.roll when available (primary path for refresh)
        (function(){
	  function install(attempt){
		attempt = attempt || 0;
		if (attempt > 40) return; // ~2s max (40 * 50ms)
	
		try {
		  const App = window.App;
		  if (!App || typeof App.onRoll !== 'function') {
			// Try again shortly until App.onRoll is wired up
			setTimeout(() => install(attempt + 1), 50);
			return;
		  }
	
		  App.onRoll((snap) => {
			refreshUniques(snap);
		  });
	
		  // Optional: debug confirmation
		  // console.log('[u79b2m] App.onRoll hook installed');
		} catch (e) {
		  console.warn('[u79b2m] App.onRoll hook failed', e);
		}
	  }
	
	  if (document.readyState === 'complete' || document.readyState === 'interactive') {
		install();
	  } else {
		document.addEventListener('DOMContentLoaded', () => install());
	  }
	})();
})();

/* === Info Lightbox controller (v0.7.9_beta2m) === */
