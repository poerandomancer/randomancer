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
    .filter(Boolean);

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

  // ----- Skills
  const gems = toArray(core.gems);
  const activeGems = gems.filter(g => g?.type === 'active');
  const supportGems = gems.filter(g => g?.type === 'support');

  const activeSkill = unique(
    activeGems
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
    armorSlot,
    ailment,
    theme,
    attribute,
    treeFocus,
    resistType,
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
  for (const existing of selected) {
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

  // Basic filters
  const notEqualTo = slotConfig?.filters?.notEqualTo;
  if (notEqualTo && slots[notEqualTo]) {
    options = options.filter(option => option !== slots[notEqualTo]);
  }

  // Match logic (opposite / alternate)
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

  return randomPick(options);
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
