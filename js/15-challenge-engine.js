import { ensureDataPreload } from './08-data-load.js';

const SEVERITY_ORDER = { mild: 1, cruel: 2, diabolical: 3 };

// V2: no more "taboo" role — 2 tasks is anchor+twist; 3 tasks is anchor+twist+twist
const STACK_PLAN = {
  1: ['anchor'],
  2: ['anchor', 'twist'],
  3: ['anchor', 'twist', 'twist']
};

let challengeLibraryPromise = null;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return [...new Set(toArray(items).filter(Boolean))];
}

function randomPick(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function weightedPick(items, severity) {
  const weighted = items.filter(item => Number(item?.weights?.[severity] || 0) > 0);
  if (!weighted.length) return null;

  const total = weighted.reduce((sum, item) => sum + Number(item.weights?.[severity] || 0), 0);
  let roll = Math.random() * total;

  for (const item of weighted) {
    roll -= Number(item.weights?.[severity] || 0);
    if (roll <= 0) return item;
  }
  return weighted[weighted.length - 1];
}

async function loadChallengeLibrary() {
  if (!challengeLibraryPromise) {
    challengeLibraryPromise = fetch('data/challenge_tasks.json')
      .then(res => {
        if (!res.ok) throw new Error(`Challenge task library failed to load (${res.status})`);
        return res.json();
      })
      .then(data => (Array.isArray(data) ? data : []))
      .catch(err => {
        console.error('[Randomancer][Challenge] failed to load challenge task library', err);
        challengeLibraryPromise = null;
        return [];
      });
  }

  return challengeLibraryPromise;
}

// -------------------------
// Lean / Opposite / Alternate matching
// -------------------------

const ATTR_ORDER = ['str', 'dex', 'int'];

function attrKeyFromCore(attrName) {
  if (attrName === 'strength') return 'str';
  if (attrName === 'dexterity') return 'dex';
  if (attrName === 'intelligence') return 'int';
  return null;
}

function leanKeyFromAttributes(attrs) {
  const keys = [];
  const obj = attrs && typeof attrs === 'object' ? attrs : {};
  for (const [k, v] of Object.entries(obj)) {
    if (!v) continue;
    const mapped = attrKeyFromCore(k);
    if (mapped) keys.push(mapped);
  }
  if (!keys.length) return null;
  const ordered = ATTR_ORDER.filter(k => keys.includes(k));
  return ordered.join('_');
}

function leanSetFromKey(key) {
  if (!key) return new Set();
  return new Set(String(key).split('_').filter(Boolean));
}

function leanKeyFromSet(set) {
  const ordered = ATTR_ORDER.filter(k => set.has(k));
  return ordered.length ? ordered.join('_') : null;
}

function oppositeLeanKey(key) {
  const set = leanSetFromKey(key);
  const all = new Set(ATTR_ORDER);
  for (const v of set) all.delete(v);
  return leanKeyFromSet(all);
}

function overlapCount(aKey, bKey) {
  const a = leanSetFromKey(aKey);
  const b = leanSetFromKey(bKey);
  let count = 0;
  for (const v of a) if (b.has(v)) count += 1;
  return count;
}

function pickByMatch({ options, optionLeanMap, targetLeanKey, mode }) {
  const target = targetLeanKey;
  if (!target) return [];

  if (mode === 'opposite') {
    const opposite = oppositeLeanKey(target);
    if (!opposite) return [];
    return options.filter(v => optionLeanMap?.[v] === opposite);
  }

  if (mode === 'aligned') {
    // For hybrids (e.g., dex_int), pick one component and match that.
    const parts = String(target).split('_').filter(Boolean);
    if (!parts.length) return [];
    const chosen = parts.length === 1 ? parts[0] : parts[Math.floor(Math.random() * parts.length)];
    return options.filter(v => optionLeanMap?.[v] === chosen);
  }

    if (mode === 'alternate') {
    // Prefer zero overlap; otherwise choose minimal overlap. Never return identical lean-key.
    const scored = options
      .map(v => ({ v, lean: optionLeanMap?.[v] || null }))
      .filter(row => row.lean && row.lean !== target)
      .map(row => ({ ...row, overlap: overlapCount(row.lean, target) }));

    if (!scored.length) return [];

    const zero = scored.filter(r => r.overlap === 0).map(r => r.v);
    if (zero.length) return zero;

    const min = Math.min(...scored.map(r => r.overlap));
    return scored.filter(r => r.overlap === min).map(r => r.v);
  }

  return [];
}

// -------------------------
// Picker Context (V2)
// -------------------------

async function buildPickerContext() {
  await ensureDataPreload();
  const core = window.DATA || {};

  // ----- Classes + Ascendancies
  const classes = Object.keys(core.Classes || {});
  const classLean = {};
  classes.forEach(name => {
    classLean[name] = leanKeyFromAttributes(core.Classes?.[name]?.attributes);
  });

  const ascendancyLean = {};
  const ascendancies = classes.flatMap(className => {
    return toArray(core.Classes?.[className]?.ascendancies)
      .map(a => String(a))
      .filter(Boolean)
      .map(a => {
        ascendancyLean[a] = classLean[className] || null;
        return a;
      });
  });

  // ----- Primary Defenses
  const defenseLean = {};
  const defenses = toArray(core.Defense)
    .map(d => {
      const name = d?.name;
      if (name) defenseLean[name] = leanKeyFromAttributes(d?.attributes);
      return name;
    })
    .filter(Boolean)
    .filter(name => ['Armour', 'Evasion', 'Energy Shield'].includes(name));

  // ----- Weapon Sets (derive from core weapons)
  const weaponSetLean = {};
  const weaponSets = [];

  // Two-handed weapons as standalone weapon sets
  const twoHanded = toArray(core.Weapons?.['Two-Handed']);
  twoHanded.forEach(w => {
    if (!w?.name) return;
    weaponSets.push(w.name);
    weaponSetLean[w.name] = leanKeyFromAttributes(w.attributes);
  });

  // One-handed + Off-hand combinations
  const oneHanded = toArray(core.Weapons?.['One-Handed']);
  const offHands = toArray(core.Weapons?.['Off-Hand']);

  function sumAttrs(a, b) {
    const out = { strength: 0, dexterity: 0, intelligence: 0 };
    const add = src => {
      if (!src || typeof src !== 'object') return;
      out.strength += Number(src.strength || 0);
      out.dexterity += Number(src.dexterity || 0);
      out.intelligence += Number(src.intelligence || 0);
    };
    add(a);
    add(b);
    return out;
  }

  oneHanded.forEach(main => {
    if (!main?.name) return;
    offHands.forEach(off => {
      const allowed = toArray(off?.['one-handed']);
      if (!allowed.includes(main.name)) return;
      if (!off?.name) return;

      const label = `${main.name} & ${off.name}`;
      weaponSets.push(label);
      weaponSetLean[label] = leanKeyFromAttributes(sumAttrs(main.attributes, off.attributes));
    });
  });

  // Always include Unarmed for explicit contracts
  weaponSets.push('Unarmed');
  weaponSetLean.Unarmed = null;

  const weaponSet = unique(weaponSets);

  // ----- Separate pools for 1H and Off-Hand (used by a few contracts)
  const oneHandedMain = unique(oneHanded.map(w => w?.name).filter(Boolean));
  const offHand = unique(offHands.map(w => w?.name).filter(Boolean));

  // ----- Lean maps for 1H + Off-hand (used by weaponLoadout picker)
  const oneHandedLean = {};
  oneHanded.forEach(w => {
    if (w?.name) oneHandedLean[w.name] = leanKeyFromAttributes(w.attributes);
  });

  const offHandLean = {};
  offHands.forEach(w => {
    if (w?.name) offHandLean[w.name] = leanKeyFromAttributes(w.attributes);
  });

  // ----- Weapon Loadouts (full / partial constraints)
  const weaponLoadoutLean = {};
  const weaponLoadout = [];

  const articleFor = (word) => (/^[aeiou]/i.test(String(word || '').trim()) ? 'an' : 'a');

  // Full weapon sets
  weaponSet.forEach(ws => {
    weaponLoadout.push(ws);
    weaponLoadoutLean[ws] = weaponSetLean[ws] || null;
  });

  // Main-hand only (e.g. "a Wand")
  oneHandedMain.forEach(mh => {
    const phr = /^(a|an)\s/i.test(mh) ? mh : `${articleFor(mh)} ${mh}`;
    weaponLoadout.push(phr);
    weaponLoadoutLean[phr] = oneHandedLean[mh] || null;
  });

  // Off-hand only (e.g. "a Shield")
  offHand.forEach(oh => {
    const phr = /^(a|an)\s/i.test(oh) ? oh : `${articleFor(oh)} ${oh}`;
    weaponLoadout.push(phr);
    weaponLoadoutLean[phr] = offHandLean[oh] || null;
  });

  // Diabolical-only extras (filtered out below diabolical severity in pickSlotValue)
  weaponLoadout.push('Empty Off-hand');
  weaponLoadoutLean['Empty Off-hand'] = 'str_dex_int';

  // Ensure Unarmed can participate in match logic (also filtered below diabolical)
  weaponLoadoutLean.Unarmed = 'str_dex_int';

  // ----- Armor slots (used for Normal-rarity slot contract)
  const armorSlot = ['Helmet', 'Body Armour', 'Gloves', 'Boots'];

  // ----- Ailments
  const ailmentLean = {};
  const ailment = unique(
    toArray(core.Ailments).map(a => {
      const name = a?.name;
      if (name) ailmentLean[name] = leanKeyFromAttributes(a?.attributes);
      return name;
    }).filter(Boolean)
  );

  // ----- Themes (damage types + tactics)
  const damageTypes = ['Physical Damage', 'Fire Damage', 'Cold Damage', 'Lightning Damage', 'Chaos Damage'];
  const tacticNames = unique(toArray(core.Tactics).map(t => t?.name).filter(Boolean));
  const theme = unique([...damageTypes, ...tacticNames, 'Triggers', 'Shapeshift']);

  // ----- Attributes / focus toggles
  const attribute = ['Strength', 'Dexterity', 'Intelligence'];
  const treeFocus = ['Offensive', 'Defensive'];
  const resistType = ['Elemental', 'Chaos'];
  const chargeType = ['Frenzy', 'Endurance', 'Power'];
  const elementResist = ['Fire', 'Cold', 'Lightning', 'Chaos'];

  // ----- Skills
  const gems = toArray(core.gems);
  const activeGems = gems.filter(g => g?.type === 'active');
  const supportGems = gems.filter(g => g?.type === 'support');

  const normalizeTag = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, '_');

  const isDevPlaceholderGem = (g) => {
    const s = String(g?.name || g?.base_item?.display_name || g?.id || '');
    return /(\bDNT\b|\bUNUSED\b|placeholder|coming\s*soon)/i.test(s);
  };

  const hasExplicitCraftingType = (g) => {
    const c = g?.crafting;
    return (
      (Array.isArray(c?.types_raw) && c.types_raw.length) ||
      (Array.isArray(c?.schools) && c.schools.length) ||
      (Array.isArray(c?.weapon_affinities) && c.weapon_affinities.length) ||
      (Array.isArray(g?.crafting_types) && g.crafting_types.length)
    );
  };

  const isTriggeredOnlyGem = (g) => {
    const st = Array.isArray(g?.taxonomy?.skill_types) ? g.taxonomy.skill_types.map(normalizeTag) : [];
    const set = new Set(st);
    return set.has('triggered') || set.has('inbuilttrigger') || set.has('invocation');
  };

  const isPersistentBuffGem = (g) => {
    const tags = Array.isArray(g?.tags) ? g.tags.map(normalizeTag) : [];
    const set = new Set(tags);
    return set.has('buff') && set.has('persistent');
  };

  const isSpiritGem = (g) => {
    const tags = Array.isArray(g?.tags) ? g.tags.map(normalizeTag) : [];
    if (tags.includes('spirit')) return true;
    const st = Array.isArray(g?.taxonomy?.skill_types) ? g.taxonomy.skill_types.map(normalizeTag) : [];
    if (st.includes('spirit')) return true;
    const desc = String(g?.description || '');
    return /\bspirit\b/i.test(desc);
  };

  // ACTIVE_SKILL picker pool: approximate Standard "Recommended Skills" eligibility
  const activeSkill = unique(
    activeGems
      .filter(g => !isDevPlaceholderGem(g))
      .filter(g => hasExplicitCraftingType(g))
      .filter(g => !isSpiritGem(g))
      .filter(g => !isTriggeredOnlyGem(g))
      .filter(g => !isPersistentBuffGem(g))
      .map(g => g?.base_item?.display_name || g?.name || g?.skill_name)
      .filter(Boolean)
  );

  const triggerSupport = unique(
    supportGems
      .filter(g => (g?.tags || []).includes('trigger') || String(g?.name || '').toLowerCase().includes('invocation'))
      .map(g => g?.base_item?.display_name || g?.name || g?.support_name)
      .filter(Boolean)
  );

  const persistentBuffSkill = unique(
    activeGems
      .filter(g => (g?.tags || []).includes('buff') && (g?.tags || []).includes('persistent'))
      .map(g => g?.base_item?.display_name || g?.name)
      .filter(Boolean)
  );

  const rawForms = unique(
    activeGems
      .map(g => String(g?.description || ''))
      .map(desc => {
        const m = desc.match(/\[Shapeshift\]\s+into\s+an?\s+\[([^\]]+)\]/i);
        return m ? m[1].trim() : null;
      })
      .filter(Boolean)
  );

  const shapeshiftForms = (() => {
    const singles = rawForms.map(f => `${f} form`);
    const pairs = [];
    for (let i = 0; i < rawForms.length; i += 1) {
      for (let j = i + 1; j < rawForms.length; j += 1) {
        pairs.push(`${rawForms[i]} and ${rawForms[j]} forms`);
      }
    }
    return unique([...singles, ...pairs]);
  })();


  // ----- Skill Archetypes (derived from gem tags, but presented as friendly labels)
  const archetypeDefs = [
    { label: 'Projectile Skill', tag: 'projectile' },
    { label: 'Strike Skill', tag: 'strike' },
    { label: 'Area Skill', tag: 'area' },
    { label: 'Channeling Skill', tag: 'channelling' },
    { label: 'Damage-over-time Skill', tag: 'dot' },
    { label: 'Totem Skill', tag: 'totem' },
    { label: 'Trap/Mine Skill', tag: 'trappable' },
    { label: 'Minion Skill', tag: 'minion' },
    { label: 'Warcry', tag: 'warcry' },
    { label: 'Curse', tag: 'curse' },
    { label: 'Aura/Reservation', tag: 'hasreservation' },
    { label: 'Movement Skill', tag: 'movement' }
  ];

  const tagCounts = {};
  archetypeDefs.forEach(def => tagCounts[def.tag] = 0);
  activeGems.forEach(g => {
    const tags = g?.tags || [];
    archetypeDefs.forEach(def => {
      if (tags.includes(def.tag)) tagCounts[def.tag] += 1;
    });
  });

  const skillArchetype = archetypeDefs.filter(def => (tagCounts[def.tag] || 0) > 0).map(def => def.label);

  // ----- Deep mechanics (curated; for vibe + clarity)
  const deepMechanic = [
    'Trigger / Proc Engine',
    'Combo / Finishers',
    'Channeling',
    'Totems',
    'Minions',
    'Traps & Mines',
    'Warcry',
    'Curses',
    'Marks',
    'Reservation / Auras',
    'Shapeshift Forms'
  ];

  // ----- Keystones
  const passives = toArray(core.passivesEnriched?.nodes || []);
  const keystones = unique(
    passives
      .filter(node => node?.isKeystone || node?.type === 'keystone')
      // Exclude Atlas keystones (map/endgame), as Challenge contracts should focus on character identity
      .filter(node => {
        const id = String(node?.id || '');
        const icon = String(node?.icon || '');
        return !(id.startsWith('Atlas') || icon.includes('AtlasTrees/'));
      })
      .map(node => node?.name)
      .filter(Boolean)
  );

  return {
    class: unique(classes),
    ascendancy: unique(ascendancies),
    defense: unique(defenses),
    weaponSet,
    oneHandedMain,
    offHand,
    weaponLoadout: unique(weaponLoadout),
    shapeshiftForms: unique(shapeshiftForms),
    armorSlot,
    ailment,
    theme,
    attribute,
    treeFocus,
    resistType,
    chargeType,
    elementResist,
    triggerSupport,
    persistentBuffSkill,
    deepMechanic,
    skillArchetype: unique(skillArchetype),
    activeSkill: unique(activeSkill),
    keystone: unique(keystones),

    // Per-picker lean lookups (used for match logic)
    __lean: {
      class: classLean,
      ascendancy: ascendancyLean,
      defense: defenseLean,
      weaponSet: weaponSetLean,
      weaponLoadout: weaponLoadoutLean,
      ailment: ailmentLean
    }
  };
}

// -------------------------
// Template + severity helpers
// -------------------------

function fillTemplate(template, slots) {
  return String(template || '').replace(/\{([A-Z0-9_]+)\}/g, (_m, key) => slots?.[key] ?? `{${key}}`);
}

function formatZeroDefense(defenseName) {
  const name = String(defenseName || '').trim();
  if (/^armou?r$/i.test(name)) return '0% Armour Rating';
  if (/^evasion$/i.test(name)) return '0% Evasion Rating';
  if (/^energy\s*shield$/i.test(name)) return '0 Energy Shield';
  return `0 ${name}`;
}


function minSeverityAllowed(userSeverity, taskSeverity) {
  return (SEVERITY_ORDER[userSeverity] || 0) >= (SEVERITY_ORDER[taskSeverity] || 0);
}

// -------------------------
// Conflicts (V2: directive + domainTags)
// -------------------------

function matchesWith(task, matcher) {
  if (!task || !matcher) return false;

  // Back-compat (old schema)
  if (matcher.category && task.category && task.category !== matcher.category) return false;
  if (matcher.tag && task.tags && matcher.tag !== '*' && !toArray(task.tags).includes(matcher.tag)) return false;

  // V2 schema
  if (matcher.directive && task.directive !== matcher.directive) return false;
  if (matcher.domainTag && matcher.domainTag !== '*' && !toArray(task.domainTags).includes(matcher.domainTag)) return false;

  return true;
}

function conflictRejects(level, severity) {
  if (level === 'hard') return true;
  return level === 'soft' && severity === 'diabolical';
}

function hasConflict(candidate, selected, severity) {
  const candTags = new Set(toArray(candidate?.conflictTags));
  for (const existing of selected) {
    // Conflict tags: simple overlap-based hard conflicts (e.g. support_policy, skill_policy)
    if (candTags.size) {
      for (const tag of toArray(existing.task?.conflictTags)) {
        if (candTags.has(tag)) return true;
      }
    }

    // Structured conflicts (optional, for future fine-grained rules)
    for (const conflict of toArray(candidate.conflicts)) {
      if (matchesWith(existing.task, conflict.with) && conflictRejects(conflict.level, severity)) {
        return true;
      }
    }
    for (const conflict of toArray(existing.task?.conflicts)) {
      if (matchesWith(candidate, conflict.with) && conflictRejects(conflict.level, severity)) {
        return true;
      }
    }
  }
  return false;
}

// -------------------------
// Effects + state
// -------------------------

function applyEffects(state, task, slotValues) {
  const effects = task.effects || {};
  const resolveValue = (raw) => (typeof raw === 'string' ? fillTemplate(raw, slotValues) : raw);

  for (const [k, rawValue] of Object.entries(effects.locks || {})) {
    state.locks[k] = resolveValue(rawValue);
  }
  for (const [k, rawValue] of Object.entries(effects.bans || {})) {
    state.bans[k] = resolveValue(rawValue);
  }
  for (const [k, rawValue] of Object.entries(effects.limits || {})) {
    state.limits[k] = resolveValue(rawValue);
  }
}

function deriveStateFromPicks(picks) {
  const state = { locks: {}, bans: {}, limits: {} };
  picks.forEach(item => applyEffects(state, item.task, item.slots));
  return state;
}

function cloneState(state) {
  return {
    locks: { ...(state.locks || {}) },
    bans: { ...(state.bans || {}) },
    limits: { ...(state.limits || {}) }
  };
}

function failsLockCollision(task, slotValues, state) {
  const incomingLocks = task.effects?.locks || {};
  for (const [key, rawValue] of Object.entries(incomingLocks)) {
    const resolved = (typeof rawValue === 'string') ? fillTemplate(rawValue, slotValues) : rawValue;
    const current = state.locks?.[key];
    if (current != null && current !== resolved) return true;
  }
  return false;
}

function failsBanLockSanity(task, slotValues, state) {
  // Minimal sanity checks (mostly for obvious contradictions).
  const text = fillTemplate(task.template || '', slotValues);

  // If a contract already bans uniques, don't allow tasks that explicitly require or reference them.
  if (state.bans?.uniques && /\bunique\b/i.test(text)) {
    // Allow the banning task itself.
    if (!/may not equip unique/i.test(text)) return true;
  }

  // Default-attack-only should not coexist with tasks that mandate an active main skill.
  if (state.locks?.mainDamageMode === 'defaultWeapon' && (slotValues.ACTIVE_SKILL || slotValues.SKILL_ARCHETYPE)) return true;

  return false;
}

// -------------------------
// Slot resolution (V2: match logic)
// -------------------------

function buildSlotOrder(defs) {
  const keys = Object.keys(defs || {});
  const deps = {};
  keys.forEach(k => {
    const d = [];
    const cfg = defs[k] || {};
    const notEq = cfg?.filters?.notEqualTo;
    if (notEq) d.push(notEq);
    const against = cfg?.match?.againstSlot;
    if (against) d.push(against);
    const fallbackAgainst = cfg?.fallback?.againstSlot;
    if (fallbackAgainst) d.push(fallbackAgainst);
    deps[k] = unique(d);
  });

  const ordered = [];
  const remaining = new Set(keys);

  // Simple topological ordering
  while (remaining.size) {
    let progressed = false;
    for (const k of [...remaining]) {
      const need = deps[k] || [];
      const ok = need.every(dep => ordered.includes(dep) || !keys.includes(dep));
      if (ok) {
        ordered.push(k);
        remaining.delete(k);
        progressed = true;
      }
    }
    if (!progressed) {
      // Cycle or unresolved dependency; fall back to original order for remaining.
      for (const k of keys) {
        if (remaining.has(k)) {
          ordered.push(k);
          remaining.delete(k);
        }
      }
    }
  }

  return ordered;
}

function resolveMatchOptions({ pickerName, options, optionLeanMap, defs, slots, matchCfg, context }) {
  const againstSlot = matchCfg?.againstSlot;
  if (!againstSlot) return options;

  const againstValue = slots[againstSlot];
  if (!againstValue) return options;

  const againstPickerName = defs?.[againstSlot]?.picker;
  if (!againstPickerName) return options;

  const targetLean = context.__lean?.[againstPickerName]?.[againstValue] || null;
  if (!targetLean) return [];

  const matched = pickByMatch({ options, optionLeanMap, targetLeanKey: targetLean, mode: matchCfg.mode });
  return matched;
}

function pickSlotValue(slotKey, slotConfig, slots, defs, context) {
  const pickerName = slotConfig?.picker;
  let options = toArray(context[pickerName]);
  const severity = context.__severity || 'cruel';

  // Picker-specific, severity-aware behavior
  if (pickerName === 'weaponLoadout') {
    // Occasionally require two weapon sets (Cruel/Diabolical only)
    const dualChance = severity === 'diabolical' ? 0.18 : (severity === 'cruel' ? 0.08 : 0);
    if (dualChance && Math.random() < dualChance && slots?.CLASS && Array.isArray(context.weaponSet)) {
      const ws = toArray(context.weaponSet).filter(v => v && v !== 'Unarmed');
      const classLean = context.__lean?.class?.[slots.CLASS] || null;
      const wsLean = context.__lean?.weaponSet || {};

      const pickAlt = (pool) => {
        const matched = pickByMatch({ options: pool, optionLeanMap: wsLean, targetLeanKey: classLean, mode: 'alternate' });
        return randomPick(matched.length ? matched : pool);
      };

      const set1 = pickAlt(ws);
      const pool2 = ws.filter(v => v !== set1);
      const set2 = pool2.length ? pickAlt(pool2) : null;
      if (set1 && set2) return `Weapon Set I: ${set1}; Weapon Set II: ${set2}`;
    }

    // Diabolical-only extras
    if (severity !== 'diabolical') {
      options = options.filter(v => v !== 'Unarmed' && v !== 'Empty Off-hand');
    }
  }

  // Basic filters
  const notEqualTo = slotConfig?.filters?.notEqualTo;
  if (notEqualTo && slots[notEqualTo]) {
    options = options.filter(option => option !== slots[notEqualTo]);
  }

  // Match logic (opposite / alternate / aligned)
  const optionLeanMap = context.__lean?.[pickerName] || null;
  if (slotConfig?.match) {
    const matched = resolveMatchOptions({
      pickerName,
      options,
      optionLeanMap,
      defs,
      slots,
      matchCfg: slotConfig.match,
      context
    });

    if (matched.length) {
      options = matched;
    } else if (slotConfig?.fallback) {
      const fallbackMatched = resolveMatchOptions({
        pickerName,
        options,
        optionLeanMap,
        defs,
        slots,
        matchCfg: slotConfig.fallback,
        context
      });
      options = fallbackMatched.length ? fallbackMatched : [];
    } else {
      options = [];
    }
  }

  const picked = randomPick(options);
  if (!picked) return null;

  if (slotConfig?.format === 'zeroDefense') {
    return formatZeroDefense(picked);
  }

  return picked;
}

function resolveSlots(task, context, maxRetries = 40) {
  const defs = task?.slots || {};
  const keys = Object.keys(defs);
  const slots = {};
  if (!keys.length) return slots;

  const order = buildSlotOrder(defs);

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    let ok = true;
    for (const key of order) {
      const value = pickSlotValue(key, defs[key], slots, defs, context);
      if (!value) {
        ok = false;
        break;
      }
      slots[key] = value;
    }
    if (ok) return slots;
    Object.keys(slots).forEach(k => delete slots[k]);
  }

  return null;
}

// -------------------------
// Title helper
// -------------------------

function buildContractTitle({ picks, severity }) {
  const poolBySeverity = {
    mild: ['Wayward', 'Unquiet', 'Odd', 'Restless'],
    cruel: ['Cursed', 'Bloodbound', 'Blight-Touched', 'Grim'],
    diabolical: ['Doomsworn', 'Maledict', 'Abyssal', 'Accursed']
  };
  const nouns = ['Contract', 'Covenant', 'Edict', 'Writ', 'Decree', 'Oath'];
  const ids = picks.map(p => p.task.id);

  const getFirstSlot = key => picks.find(p => p.slots?.[key])?.slots?.[key];

  if (getFirstSlot('KEYSTONE')) return `The ${getFirstSlot('KEYSTONE')} Decree`;
  if (getFirstSlot('ACTIVE_SKILL')) return `The ${getFirstSlot('ACTIVE_SKILL')} Edict`;
  if (ids.includes('G1_unarmed')) return 'The Empty Hand Oath';
  if (ids.includes('F3_ironman_normals_only_pickup')) return 'The Ironman Covenant';

  return `The ${randomPick(poolBySeverity[severity] || poolBySeverity.cruel)} ${randomPick(nouns)}`;
}

// -------------------------
// Generator
// -------------------------

async function generateChallengeContract({ taskCount = 2, severity = 'cruel', maxAttempts = 140 } = {}) {
  const normalizedCount = [1, 2, 3].includes(Number(taskCount)) ? Number(taskCount) : 2;
  const normalizedSeverity = SEVERITY_ORDER[severity] ? severity : 'cruel';
  const rolePlan = STACK_PLAN[normalizedCount];

  const library = await loadChallengeLibrary();
  const pickerContext = await buildPickerContext();
  pickerContext.__severity = normalizedSeverity;

  const tasksByRole = rolePlan.map(role =>
    library.filter(task => task.role === role && minSeverityAllowed(normalizedSeverity, task.minSeverity))
  );

  function backtrack(index, selected, state, attempts) {
    if (index >= rolePlan.length) return selected;
    if (attempts.count >= maxAttempts) return null;

    const candidates = tasksByRole[index].filter(task => !selected.some(entry => entry.task.id === task.id));
    if (!candidates.length) return null;

    const queue = [...candidates];
    while (queue.length) {
      attempts.count += 1;
      const picked = weightedPick(queue, normalizedSeverity);
      const chosen = picked || queue[0];
      queue.splice(queue.findIndex(item => item.id === chosen.id), 1);

      const slots = resolveSlots(chosen, pickerContext);
      if (!slots) continue;
      if (hasConflict(chosen, selected, normalizedSeverity)) continue;
      if (failsLockCollision(chosen, slots, state)) continue;

      const nextState = cloneState(state);
      applyEffects(nextState, chosen, slots);

      if (failsBanLockSanity(chosen, slots, nextState)) continue;

      const next = [...selected, { task: chosen, slots, line: fillTemplate(chosen.template, slots) }];
      const resolved = backtrack(index + 1, next, nextState, attempts);
      if (resolved) return resolved;
    }
    return null;
  }

  const attempts = { count: 0 };
  const initialState = { locks: {}, bans: {}, limits: {} };
  const picks = backtrack(0, [], initialState, attempts) || [];

  if (!picks.length) {
    throw new Error('Unable to generate a compatible challenge contract.');
  }

  return {
    mode: 'challenge',
    severity: normalizedSeverity,
    taskCount: normalizedCount,
    title: buildContractTitle({ picks, severity: normalizedSeverity }),
    subtitle: picks.map(item => item.task.shortLabel).join(' • '),
    tasks: picks.map(item => ({
      id: item.task.id,
      role: item.task.role,
      directive: item.task.directive,
      strength: item.task.strength,
      shortLabel: item.task.shortLabel,
      line: item.line,
      slots: item.slots
    })),
    state: deriveStateFromPicks(picks)
  };
}

window.RandomancerChallenge = {
  loadChallengeLibrary,
  generateChallengeContract
};

export {
  loadChallengeLibrary,
  generateChallengeContract
};
