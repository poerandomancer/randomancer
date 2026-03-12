import { TagUtils, defensePseudoTags } from './05-tags-and-scorer.js';
import { adaptPoe2dbUniquesPayload } from './19-uniques-adapter.js';

/* === Randomancer: Uniques Synergy — canonical engine (v0.8.2) === */
(function(){
  const TOKEN = 'u79b2m_' + Date.now();
  window.__u79_active = TOKEN; // last-wins flag

  // Use shared tag normalizer
  const norm = (s) => TagUtils.norm(s);

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
    if (/\blife\s+regen(?:eration)?\b/.test(txt)) out.push('liferegeneration');
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
    'Life Regeneration': /\blife\s+regen(?:eration)?\b/i,
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
		return { tactics: [], ailments: [], def: [], defStrat: [], defPrimary: [] };
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
	
		const tagsDStrat = Array.from(
		  expandTags(state.defStrat?.tags || [])
		);
		const tagsDPrimary = Array.from(
		  expandTags(defensePseudoTags(state.defense && state.defense.name))
		);
		const tagsD = Array.from(new Set([...tagsDStrat, ...tagsDPrimary]));
	
		return {
		  tactics: tagsT,
		  ailments: tagsA,
		  def: tagsD,
		  defStrat: tagsDStrat,
		  defPrimary: tagsDPrimary,
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
	  const tagsDStrat = Array.from(
		expandTags(namesD.flatMap(n => idx.get(n)))
	  );
	  const tagsDPrimary = Array.from(
		expandTags(defensePseudoTags(state.defense || state.defenseName))
	  );
	  const tagsD = Array.from(new Set([...tagsDStrat, ...tagsDPrimary]));
	
	  return {
		tactics: tagsT,
		ailments: tagsA,
		def: tagsD,
		defStrat: tagsDStrat,
		defPrimary: tagsDPrimary,
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
		if (hasWord('talisman')) add('talisman');
	
		// expose staff vs quarterstaff intent for weaponSlotAllowed, if you still use those
		allow.__wtxt = weaponText;
		allow.__wantsQuarterstaff = wantsQuarterstaff;
		allow.__wantsStaff = wantsStaff;
	
		return allow;
	  }


async function loadUniquesM(){
    const primaryUrl = 'data/enriched/poe2db_uniques_min.json?v=' + Date.now();
    const fallbackUrl = 'data/enriched/uniques_enriched.json?v=' + Date.now();

    try {
      const r = await fetch(primaryUrl, { cache:'no-store' });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      const adapted = adaptPoe2dbUniquesPayload(data);
      if (adapted.length) return adapted;
      throw new Error('No compatible uniques in poe2db payload');
    } catch (err) {
      console.warn('[u79b2m] failed to load poe2db uniques for build mode, using legacy fallback', err);
      const r = await fetch(fallbackUrl, { cache:'no-store' });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      return Array.isArray(data) ? data : (data.items || []);
    }
  }

  const UNIQUE_TAG_DEBUG = {
    seen: new Set(),
    matched: new Set(),
    mismatches: new Map(),
    primarySeen: new Set(),
    defensiveSeen: new Set(),
    defensiveOnlyMatches: 0
  };

  function maybeLogUniqueTagDiagnostics(items, rolledSet){
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('debug') !== '1') return;

    const rolled = new Set(Array.from(rolledSet || []).map((t) => norm(t)));

    items.forEach((item) => {
      const buckets = getItemTagBuckets(item);
      const tags = Array.from(buckets.all);
      const matchedPrimary = Array.from(buckets.primary).some((tag) => rolled.has(tag));
      const matchedDefensive = Array.from(buckets.defensive).some((tag) => rolled.has(tag));
      if (!matchedPrimary && matchedDefensive) UNIQUE_TAG_DEBUG.defensiveOnlyMatches += 1;

      buckets.primary.forEach((tag) => UNIQUE_TAG_DEBUG.primarySeen.add(tag));
      buckets.defensive.forEach((tag) => UNIQUE_TAG_DEBUG.defensiveSeen.add(tag));

      tags.forEach((tag) => {
        UNIQUE_TAG_DEBUG.seen.add(tag);
        if (rolled.has(tag)) {
          UNIQUE_TAG_DEBUG.matched.add(tag);
        } else {
          UNIQUE_TAG_DEBUG.mismatches.set(tag, (UNIQUE_TAG_DEBUG.mismatches.get(tag) || 0) + 1);
        }
      });
    });

    const unmatchedCount = UNIQUE_TAG_DEBUG.seen.size - UNIQUE_TAG_DEBUG.matched.size;
    const top = Array.from(UNIQUE_TAG_DEBUG.mismatches.entries())
      .filter(([tag]) => !UNIQUE_TAG_DEBUG.matched.has(tag))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => `${tag}:${count}`)
      .join(', ');

    console.info(
      `[u79b2m][debug] unique tag coverage seen=${UNIQUE_TAG_DEBUG.seen.size} matched=${UNIQUE_TAG_DEBUG.matched.size} unmatched=${unmatchedCount} primary_seen=${UNIQUE_TAG_DEBUG.primarySeen.size} defensive_seen=${UNIQUE_TAG_DEBUG.defensiveSeen.size} defensive_only_matches=${UNIQUE_TAG_DEBUG.defensiveOnlyMatches}${top ? ` top_unmatched=${top}` : ''}`
    );
  }

  function getGrantedSkillTags(item){
    if (!item) return [];
    if (Array.isArray(item.__grantedSkillTags)) return item.__grantedSkillTags;

    const entries = getGrantedSkillEntries(item);
    const out = new Set();

    entries.forEach((entry) => {
      const skillTags = Array.isArray(entry?.tags) ? entry.tags : [];
      skillTags.forEach((t) => {
        const n = norm(t);
        if (n) out.add(n);
      });
    });

    const tags = Array.from(out);
    item.__grantedSkillTags = tags;
    return tags;
  }

  function normalizeUniqueTagPattern(value){
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function isDefensiveUniqueTag(tag){
    const p = normalizeUniqueTagPattern(tag);
    if (!p) return false;

    return (
      p.endsWith('_resistance') ||
      (p.startsWith('maximum_') && p.endsWith('_resistance')) ||
      p.includes('_duration_on_you') ||
      p.includes('_effect_on_you') ||
      p.startsWith('cannot_be_') ||
      p.startsWith('avoid_') ||
      p.includes('chance_to_avoid')
    );
  }

  function getItemTagBuckets(item){
    if (item && item.__tagBuckets) return item.__tagBuckets;

    const raw = (item.tags && item.tags.raw) || [];
    const canon = filterCanonicalsByEvidence(item);
    const derived = deriveExtraTags(item.lines || []);
    const grantedSkillTags = getGrantedSkillTags(item);
    const entries = [];

    // normalize raw + derived tags directly
    for (const t of [...raw, ...derived, ...grantedSkillTags]){
      if (!t) continue;
      const n = norm(t);
      if (n) entries.push({ raw: t, n });
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
          if (n) entries.push({ raw: p, n });
        }
        continue;
      }
      const n = norm(lbl);
      if (n === 'slowmaimhinder'){
        entries.push({ raw: 'slow', n: 'slow' });
        entries.push({ raw: 'maim', n: 'maim' });
        entries.push({ raw: 'hinder', n: 'hinder' });
      } else if (n){
        entries.push({ raw: lbl, n });
      }
    }

    const all = new Set();
    const primary = new Set();
    const defensive = new Set();
    for (const entry of entries){
      if (!entry?.n) continue;
      all.add(entry.n);
      if (isDefensiveUniqueTag(entry.raw)) defensive.add(entry.n);
      else primary.add(entry.n);
    }

    const buckets = { all, primary, defensive };
    if (item) item.__tagBuckets = buckets;
    return buckets;
  }

  function getItemTagSet(item){
    return getItemTagBuckets(item).all;
  }
  function scoreItem(it, rolled, slotAllow){
    const primary = getItemTagBuckets(it).primary;
    let s = 0;
    for (const t of rolled.tactics)  if (primary.has(t)) s += 3.0;
    for (const t of rolled.ailments) if (primary.has(t)) s += 1.7;
    for (const t of rolled.def)      if (primary.has(t)) s += 1.2;
    if (slotAllow && slotAllow.has && slotAllow.has(it.slot)) s += 0.6;
    return s;
  }

function weaponSlotAllowed(it, slotAllow){
    if (!slotAllow || !slotAllow.has) return true;
    // Non-weapon slots just rely on presence in the allowed set
    if (!['bow','crossbow','staff','spear','sword','mace','axe','claw','wand','sceptre','shield','buckler','focus','soulcore','traptool','talisman'].includes(it.slot)) {
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

  function pickGeneral(items, rolled, allow, limitMax=5, perSlotCap=2, seedPicks=[]){
    const MIN = 2.8;
    const slotAllow = allow || new Set();

    const seed = Array.isArray(seedPicks) ? seedPicks : [];
    const usedNames = new Set(seed.map(p => p && p.name).filter(Boolean));
    const per = new Map();
    for (const p of seed){
      if (!p || !p.slot) continue;
      per.set(p.slot, (per.get(p.slot) || 0) + 1);
    }

    const scored = items
      .map(it => ({ it, s: scoreItem(it, rolled, slotAllow) }))
      .filter(row => weaponSlotAllowed(row.it, slotAllow) && row.s >= MIN && !usedNames.has(row.it.name))
      .sort((a, b) => b.s - a.s);

    const out = [];
    for (const row of scored){
      const c = per.get(row.it.slot) || 0;
      const cap = Math.min(perSlotCap, slotHardCap(row.it.slot, 1));
      if (c >= cap) continue;
      per.set(row.it.slot, c + 1);
      out.push(row.it);
      if (out.length >= limitMax) break;
    }
    return out;
}


  // -------------------------
  // Pass-based unique selection (Weapon pass + Armour pass)
  // - Tactics carry the most weight in every pass
  // - No anti-tags influence (ignored entirely for matching)
  // - No recency penalty (deferred)
  // -------------------------

  const WEAPON_SLOTS = new Set(['bow','crossbow','staff','spear','sword','mace','axe','claw','wand','sceptre','shield','buckler','focus','soulcore','traptool','talisman','quiver']);
  const ARMOUR_SLOTS = new Set(['helmet','body','gloves','boots']);

  // Hard caps per slot (prevents duplicate armour slots like double body).
  // Rings/jewels may appear more than once; everything else is 1.
  const SLOT_HARD_CAPS = Object.freeze({ ring: 2, jewel: 2 });
  const slotHardCap = (slot, fallback=1) => {
    const k = String(slot || '').toLowerCase();
    return (SLOT_HARD_CAPS[k] ?? fallback);
  };
  
    // Normalized resistance tags (TagUtils.norm strips underscores/spaces)
	  const TAG_ALL_ELE_RES = norm('all_elemental_resistance');
	  const TAG_FIRE_RES = norm('fire_resistance');
	  const TAG_COLD_RES = norm('cold_resistance');
	  const TAG_LIGHTNING_RES = norm('lightning_resistance');
	  const TAG_CHAOS_RES = norm('chaos_resistance');
	
	  // Common utility-style tags (used as light tie-breakers in Pass 3)
	  const UTILITY_BONUS_TAGS = new Set([
		norm('movement speed'),
		norm('action speed'),
		norm('attack speed'),
		norm('cast speed'),
		norm('cooldown recovery'),
		norm('cooldown recovery rate'),
	  ]);



  function weaponAllowFromState(state, useSecond=false){
    const w = useSecond ? (state?.weapon2 ?? state?.weaponTwo ?? state?.weaponSet2) : (state?.weapon ?? state?.weapon1 ?? state?.weaponOne);
    const o = useSecond ? (state?.offhand2 ?? state?.offhandTwo ?? state?.offhandSet2) : (state?.offhand ?? state?.offhand1 ?? state?.offhandOne);
    const wName = (w && typeof w === 'object') ? (w.name || w.display || w.label || '') : (w || '');
    const oName = (o && typeof o === 'object') ? (o.name || o.display || o.label || '') : (o || '');
    const weaponText = String(((wName||'') + ' ' + (oName||'')).trim()).toLowerCase();
    if (!weaponText) return null;

    const allow = new Set();
    const hasWord = (s) => {
      if (!s) return false;
      const re = new RegExp('\\b' + s + '\\b', 'i');
      return re.test(weaponText);
    };
    const add = (s) => allow.add(s);

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
    if (hasWord('talisman')) add('talisman');

    allow.__wtxt = weaponText;
    allow.__wantsQuarterstaff = wantsQuarterstaff;
    allow.__wantsStaff = wantsStaff;

    return allow;
  }

  function weightedPickFromBand(rows, relMin=0.75, absMin=0){
    if (!rows || !rows.length) return null;
    const best = rows[0].s || 0;
    const min = Math.max(absMin, best * relMin);
    const band = rows.filter(r => (r.s || 0) >= min);
    if (!band.length) return null;

    // Weighted roulette (score^2)
    let total = 0;
    for (const r of band) total += Math.max(0, r.s) ** 2;
    if (total <= 0) return band[0].it;

    let roll = Math.random() * total;
    for (const r of band){
      roll -= Math.max(0, r.s) ** 2;
      if (roll <= 0) return r.it;
    }
    return band[band.length - 1].it;
  }
  
  function expandedWeaponAilmentTags(rolled){
	  const a = new Set(rolled?.ailments || []);
	
	  // Map ailments -> element tags (and "damage" tags) so ailment builds can match weapons
	  // that scale the underlying element even if they don't mention the ailment itself.
	  if (a.has('ignite')) { a.add('fire'); a.add(norm('fire damage')); }
	  if (a.has('freeze') || a.has('chill')) { a.add('cold'); a.add(norm('cold damage')); }
	  if (a.has('shock') || a.has('electrocute')) { a.add('lightning'); a.add(norm('lightning damage')); }
	
	  return Array.from(a);
	}


  function scoreWeaponPass(it, rolled){
	  const all = getItemTagBuckets(it).primary;
	  let s = 0;
	
	  // Tactics are still the strongest signal.
	  for (const t of rolled.tactics) if (all.has(t)) s += 4.0;
	
	  // Ailments + mapped elements (ignite -> fire, etc.)
	  for (const t of expandedWeaponAilmentTags(rolled)) if (all.has(t)) s += 2.0;
	
	  return s;
	}


  function scoreArmourPass(it, rolled, state){
    const { all, primary } = getItemTagBuckets(it);
    let s = 0;

    // Offense-first, tactics lead
    for (const t of rolled.tactics)  if (primary.has(t)) s += 4.0;
    for (const t of rolled.ailments) if (primary.has(t)) s += 2.0;

    // Defensive strategy / primary defense (secondary, strategy favored)
    for (const t of (rolled.defStrat || rolled.def || []))   if (primary.has(t)) s += 1.5;
    for (const t of (rolled.defPrimary || []))                if (primary.has(t)) s += 1.0;

    // Small bump for resistance coverage (tie-breaker, not a primary driver)
    if (all.has(TAG_ALL_ELE_RES)) s += 0.6;
	else {
	  const r =
		(all.has(TAG_FIRE_RES)?1:0) +
		(all.has(TAG_COLD_RES)?1:0) +
		(all.has(TAG_LIGHTNING_RES)?1:0) +
		(all.has(TAG_CHAOS_RES)?1:0);
	  if (r) s += Math.min(0.6, r * 0.2);
	}

    // Attribute leaning (very light; stronger at higher cohesion)
    const th = (typeof window.cohesionThreshold === 'number') ? window.cohesionThreshold : 0.75;
    const attr = it?.meta?.attributes;
    const rollAttr = state?.rollAttr;
    if (attr && rollAttr){
      const us = (attr.str || 0) + (attr.all || 0);
      const ud = (attr.dex || 0) + (attr.all || 0);
      const ui = (attr.int || 0) + (attr.all || 0);

      const bs = rollAttr.strength || 0;
      const bd = rollAttr.dexterity || 0;
      const bi = rollAttr.intelligence || 0;

      const dot = us*bs + ud*bd + ui*bi;
      const nu = Math.sqrt(us*us + ud*ud + ui*ui) || 0;
      const nb = Math.sqrt(bs*bs + bd*bd + bi*bi) || 0;
      const sim = (nu > 0 && nb > 0) ? (dot / (nu * nb)) : 0;

      const w = (th >= 0.70) ? 0.8 : 0.35;
      s += sim * w;
    }

    return s;
  }

  function pickWeaponPass(items, rolled, allow){
    if (!allow || !allow.size) return null;

    const scored = items
      .filter(it => WEAPON_SLOTS.has(it.slot) && allow.has(it.slot) && weaponSlotAllowed(it, allow))
      .map(it => ({ it, s: scoreWeaponPass(it, rolled) }))
      .sort((a,b)=>b.s-a.s);

    if (!scored.length) return null;

    // Require at least a meaningful match (typically >= 1 tactic hit)
    // With weights, 1 tactic match = 4.0.
    const MIN_BEST = 2.0; // allow a single ailment OR mapped element match (2.0)
	const best = scored[0].s || 0;
	if (best < MIN_BEST) return null;
	
	return weightedPickFromBand(scored, 0.75, MIN_BEST);

  }

  function pickArmourPass(items, rolled, state, seedPicks=[]){
    const ARMOUR_SCORE_MIN = 1.5;
    const used = new Set((seedPicks||[]).map(p => p && p.name).filter(Boolean));
    const scored = items
      .filter(it => ARMOUR_SLOTS.has(it.slot) && !used.has(it.name))
      .map(it => ({ it, s: scoreArmourPass(it, rolled, state) }))
      .sort((a,b)=>b.s-a.s);

    if (!scored.length) return [];

    const best = scored[0].s || 0;
    if (best < ARMOUR_SCORE_MIN) return [];

    const pick1 = weightedPickFromBand(scored, 0.70, ARMOUR_SCORE_MIN);
    if (!pick1) return [];

    used.add(pick1.name);

    // Second armour pick: different slot, slightly lower bar
    const scored2 = scored
      .filter(r => r.it && r.it.slot !== pick1.slot && !used.has(r.it.name));

    if (!scored2.length) return [pick1];

    const best2 = scored2[0].s || 0;
    const abs2 = Math.max(2.6, best * 0.55);
    if (best2 < abs2) return [pick1];

    const pick2 = weightedPickFromBand(scored2, 0.75, abs2);
    return [pick1, ...(pick2 ? [pick2] : [])];
  }
  
    // -------------------------
  // Pass 3: Utility (rings / amulets / belts / flasks / charms / jewels)
  // - Tactics carry the most weight
  // - Offense (ailments + mapped elements) next
  // - Defensive strategy secondary
  // - Resistances + utility tags are light tie-breakers (do not qualify on their own)
  // -------------------------

  function scoreUtilityPass(it, rolled, state){
    const { all, primary } = getItemTagBuckets(it);
    let match = 0;
    let s = 0;

    // Tactics (primary driver)
    for (const t of rolled.tactics){
      if (primary.has(t)){ s += 4.0; match += 4.0; }
    }

    // Offense: ailments + mapped elements (ignite->fire, freeze->cold, shock->lightning)
    for (const t of expandedWeaponAilmentTags(rolled)){
      if (primary.has(t)){ s += 2.0; match += 2.0; }
    }

    // Defensive strategy / primary defense (secondary, strategy favored)
    for (const t of (rolled.defStrat || rolled.def || [])){
      if (primary.has(t)){ s += 1.5; match += 1.5; }
    }
    for (const t of (rolled.defPrimary || [])){
      if (primary.has(t)){ s += 1.0; match += 1.0; }
    }

    // Resistances as light tie-breaker (never part of match qualification)
    if (all.has(TAG_ALL_ELE_RES)) s += 0.45;
    else {
      const r =
        (all.has(TAG_FIRE_RES)?1:0) +
        (all.has(TAG_COLD_RES)?1:0) +
        (all.has(TAG_LIGHTNING_RES)?1:0) +
        (all.has(TAG_CHAOS_RES)?1:0);
      if (r) s += Math.min(0.45, r * 0.12);
    }

    // Utility-style tags (light bump, capped)
    let ub = 0;
    for (const t of UTILITY_BONUS_TAGS){
      if (all.has(t)) ub += 0.18;
    }
    if (ub) s += Math.min(0.45, ub);

    // Attribute leaning (very light; a nudge, not a driver)
    const th = (typeof window.cohesionThreshold === 'number') ? window.cohesionThreshold : 0.75;
    const attr = it?.meta?.attributes;
    const rollAttr = state?.rollAttr;
    if (attr && rollAttr){
      const us = (attr.str || 0) + (attr.all || 0);
      const ud = (attr.dex || 0) + (attr.all || 0);
      const ui = (attr.int || 0) + (attr.all || 0);

      const bs = rollAttr.strength || 0;
      const bd = rollAttr.dexterity || 0;
      const bi = rollAttr.intelligence || 0;

      const dot = us*bs + ud*bd + ui*bi;
      const nu = Math.sqrt(us*us + ud*ud + ui*ui) || 0;
      const nb = Math.sqrt(bs*bs + bd*bd + bi*bi) || 0;
      const sim = (nu > 0 && nb > 0) ? (dot / (nu * nb)) : 0;

      const w = (th >= 0.70) ? 0.35 : 0.18;
      s += sim * w;
    }

    return { s, match };
  }

  function pickUtilityPass(items, rolled, state, seedPicks=[], limitMax=3){
    const seed = Array.isArray(seedPicks) ? seedPicks : [];
    const usedNames = new Set(seed.map(p => p && p.name).filter(Boolean));

    const per = new Map();
    for (const p of seed){
      if (!p || !p.slot) continue;
      per.set(p.slot, (per.get(p.slot) || 0) + 1);
    }

    const pool = items.filter(it => !WEAPON_SLOTS.has(it.slot) && !ARMOUR_SLOTS.has(it.slot));

    // Score once
    const scoredAll = pool
      .filter(it => !usedNames.has(it.name))
      .map(it => {
        const r = scoreUtilityPass(it, rolled, state);
        return { it, s: r.s, match: r.match };
      })
      .sort((a,b)=>b.s-a.s);

    const out = [];
    const ABS_MATCH_MIN = 1.5; // allow def-strat-only utility matches
    const REL_BAND = 0.60;

    // Iterative pick: each time, re-filter by remaining slot caps and match threshold.
    for (let step=0; step<limitMax; step++){
      const eligible = scoredAll
        .filter(r => r.match >= ABS_MATCH_MIN && !usedNames.has(r.it.name))
        .filter(r => {
          const c = per.get(r.it.slot) || 0;
          const cap = slotHardCap(r.it.slot, 1);
          return c < cap;
        });

      if (!eligible.length) break;

      eligible.sort((a,b)=>b.s-a.s);
      const pick = weightedPickFromBand(eligible, REL_BAND, ABS_MATCH_MIN);
      if (!pick) break;

      usedNames.add(pick.name);
      per.set(pick.slot, (per.get(pick.slot) || 0) + 1);
      out.push(pick);
    }

    return out;
  }


  function pickPasses(items, rolled, snap){
    const state = getRollSnapshot(snap) || {};
    const out = [];

    // Pass 1: Weapons (try weapon set 1, then set 2 fallback)
    const allowW1 = weaponAllowFromState(state, false);
    let weaponPick = pickWeaponPass(items, rolled, allowW1);
    if (!weaponPick){
      const allowW2 = weaponAllowFromState(state, true);
      weaponPick = pickWeaponPass(items, rolled, allowW2);
    }
    if (weaponPick) out.push(weaponPick);

    // Pass 2: Armour (offense-first with defensive secondary)
    const armourPicks = pickArmourPass(items, rolled, state, out);
    out.push(...armourPicks);

	// Pass 3: Utility (rings / amulets / belts / flasks / charms / jewels)
    // Fill up to 5 overall, but don't force weak matches.
    const MAX = 5;
    const remaining = Math.max(0, MAX - out.length);
    if (remaining > 0){
      const utilLimit = Math.min(3, remaining);
      const utilPicks = pickUtilityPass(items, rolled, state, out, utilLimit);
      out.push(...utilPicks);
    }


    // Final safety: avoid duplicate slots (except rings/jewels) to prevent double-body etc.
    const seenSlot = new Map();
    const pruned = [];
    for (const it of out){
      if (!it || !it.slot) continue;
      const slot = String(it.slot).toLowerCase();
      const cap = slotHardCap(slot, 1);
      const used = seenSlot.get(slot) || 0;
      if (used >= cap) continue;
      seenSlot.set(slot, used + 1);
      pruned.push(it);
      if (pruned.length >= MAX) break;
    }

    return pruned;
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

    return wrap.querySelector('#uniques-grid');
  }

  function pillsFor(item, rolledSet){
    const tags = Array.from(getItemTagSet(item)).sort();
    return tags.map(t=>`<span class="tag-pill pill${rolledSet.has(t)?' matched':''}" data-tag="${t}">${t}</span>`).join('');
  }

  function highlightText(text, rolledSet){
    const esc = s => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    let out = String(text || '');
    rolledSet.forEach((t) => {
      if (!t) return;
      const rx = new RegExp(esc(String(t)), 'ig');
      out = out.replace(rx, m => `<span class="hit">${m}</span>`);
    });
    return out;
  }

  function renderLines(lines, rolledSet, lineClass='unique-line'){
    return (Array.isArray(lines) ? lines : [])
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .map((line) => `<div class="${lineClass}">${highlightText(line, rolledSet)}</div>`)
      .join('');
  }

  function getSectionLines(it, kind){
    const fromMeta = Array.isArray(it?.meta?.[kind]) ? it.meta[kind] : [];
    if (fromMeta.length) return fromMeta;

    if (kind === 'explicit_mods') {
      return Array.isArray(it?.lines) ? it.lines.slice(2).filter(Boolean) : [];
    }
    return [];
  }

  function formatRequirements(it){
    const req = it?.requirements || {};
    const pairs = [
      ['level', 'Level'],
      ['str', 'STR'],
      ['dex', 'DEX'],
      ['int', 'INT']
    ];

    const parts = pairs
      .map(([key, label]) => {
        const val = req[key];
        if (val == null || val === '' || Number(val) === 0) return null;
        return `${label} ${val}`;
      })
      .filter(Boolean);

    return parts.length ? `Requires: ${parts.join(', ')}` : '';
  }


  function normalizeSkillKey(value){
    return String(value || '')
      .toLowerCase()
      .replace(/\[[^\]]+\|([^\]]+)\]/g, '$1')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getSkillLookup(){
    if (window.__uniqueSkillLookup && window.__uniqueSkillLookup.size) return window.__uniqueSkillLookup;

    const map = new Map();
    const gems = Array.isArray(window.DATA?.gems) ? window.DATA.gems : [];

    gems.forEach((g) => {
      const names = [g?.name, g?.base_item?.display_name, g?.support_name].filter(Boolean);
      names.forEach((n) => {
        const key = normalizeSkillKey(n);
        if (!key || map.has(key)) return;
        map.set(key, g);
      });
    });

    window.__uniqueSkillLookup = map;
    return map;
  }

  function getGrantedSkillEntries(it){
    const granted = Array.isArray(it?.granted_skills) ? it.granted_skills : [];
    if (!granted.length) return [];

    const skillsByName = getSkillLookup();
    return granted
      .map((entry) => {
        const name = String(entry?.name || entry?.raw || entry || '').trim();
        if (!name) return null;

        const key = normalizeSkillKey(name);
        const g = key ? skillsByName.get(key) : null;
        const desc = String(g?.description || g?.support_text || '').trim();
        const tags = Array.isArray(g?.tags) ? g.tags : [];

        return {
          name,
          description: desc,
          tags
        };
      })
      .filter(Boolean);
  }

  function renderGrantedSkills(it){
    const entries = getGrantedSkillEntries(it);
    if (!entries.length) return '';

    return entries
      .map((entry) => {
        const line = `Grants: ${entry.name}`;
        const detail = entry.description ? `<div class="unique-granted-desc">${highlightText(entry.description, new Set())}</div>` : '';
        return `<div class="unique-granted-item"><div class="unique-line">${highlightText(line, new Set())}</div>${detail}</div>`;
      })
      .join('');
  }

  function buildUniqueReason(it, rolledSet) {
    if (!it) return '';

    const buckets = getItemTagBuckets(it);
    const tags = Array.from(buckets.primary.size ? buckets.primary : buckets.all);
    if (!tags.length) return '';

    const hasRolled =
      rolledSet &&
      typeof rolledSet.has === 'function' &&
      rolledSet.size > 0;

    const matched = [];
    for (const t of tags) {
      if (!t) continue;
      if (hasRolled && rolledSet.has(t)) matched.push(t);
    }

    const source = (hasRolled && matched.length) ? matched : tags;
    const main = source.slice(0, 3);
    if (!main.length) return '';

    const humanList = (arr) => {
      const p = arr.map((s) => {
        s = String(s || '').trim();
        return s ? s[0].toUpperCase() + s.slice(1) : s;
      });
      if (p.length === 1) return p[0];
      if (p.length === 2) return `${p[0]} and ${p[1]}`;
      return `${p[0]}, ${p[1]} and ${p[2]}`;
    };

    const list = humanList(main);
    if (hasRolled && matched.length) return `Synergizes with your ${list} focus.`;
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
      const reason = buildUniqueReason(it, rolledSet);
      const requirements = formatRequirements(it);
      const flavourLines = getSectionLines(it, 'flavour_text');
      const implicitLines = getSectionLines(it, 'implicit_mods');
      const explicitLines = getSectionLines(it, 'explicit_mods');
      const grantedSkillsHtml = renderGrantedSkills(it);
      const hasGrantedSkills = !!grantedSkillsHtml;

      return `
        <div class="unique-card">
          <div class="unique-header">
            <div class="unique-name">${it.name}</div>
            <div class="unique-base">${it.base}</div>
            ${requirements ? `<div class="unique-req">${requirements}</div>` : ''}
          </div>
          <div class="skill-divider"></div>
          <div class="unique-lines">
            ${reason ? `<div class="unique-highlights">${reason}</div>` : ''}
            ${flavourLines.length ? `<div class="unique-flavour">${renderLines(flavourLines, rolledSet, 'unique-flavour-line')}</div>` : ''}
            ${implicitLines.length ? `<div class="unique-gold-divider"></div><div class="unique-section unique-section--implicit">${renderLines(implicitLines, rolledSet)}</div>` : ''}
            ${(!implicitLines.length && flavourLines.length && explicitLines.length) ? `<div class="unique-gold-divider"></div>` : ''}
            ${implicitLines.length && explicitLines.length ? `<div class="unique-gold-divider"></div>` : ''}
            ${explicitLines.length ? `<div class="unique-section unique-section--explicit">${renderLines(explicitLines, rolledSet)}</div>` : ''}
            ${hasGrantedSkills && explicitLines.length ? `<div class="unique-gold-divider"></div>` : ''}
            ${hasGrantedSkills && !explicitLines.length && (implicitLines.length || flavourLines.length) ? `<div class="unique-gold-divider"></div>` : ''}
            ${hasGrantedSkills ? `<div class="unique-section unique-section--granted">${grantedSkillsHtml}</div>` : ''}
            ${pills ? `<div class="unique-gold-divider"></div><div class="tags-row tags-row--bottom">${pills}</div>` : ''}
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
                const picks = pickPasses(items, rolled, snap);
                maybeLogUniqueTagDiagnostics(items, rolledSet);

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
