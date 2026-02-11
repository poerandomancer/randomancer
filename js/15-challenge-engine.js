import { ensureDataPreload } from './08-data-load.js';

const SEVERITY_ORDER = { mild: 1, cruel: 2, diabolical: 3 };
const STACK_PLAN = {
  1: ['anchor'],
  2: ['anchor', 'taboo'],
  3: ['anchor', 'twist', 'taboo']
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

async function buildPickerContext() {
  await ensureDataPreload();
  const core = window.DATA || {};

  const classes = Object.keys(core.Classes || {});
  const ascendancies = classes.flatMap(className => toArray(core.Classes?.[className]?.ascendancies).map(a => a?.name).filter(Boolean));
  const defenses = toArray(core.Defense).map(d => d?.name).filter(Boolean);
  const ailments = toArray(core.Ailments).map(a => a?.name).filter(Boolean);
  const tactics = toArray(core.Tactics).map(t => t?.name).filter(Boolean);

  const weaponSet = unique([
    'Bow + Quiver',
    'Crossbow + Quiver',
    'Wand + Focus',
    'Staff',
    'Two-Handed Mace',
    'Two-Handed Sword',
    'Spear + Shield',
    'One-Handed + Shield',
    ...Object.keys(core.Weapons?.['Two-Handed'] || {}).map(k => `${k} (2H)`),
    ...Object.keys(core.Weapons?.['One-Handed'] || {}).map(k => `${k} + Off-Hand`)
  ]);

  const weaponType = unique([
    'Unarmed',
    ...Object.keys(core.Weapons?.['Two-Handed'] || {}),
    ...Object.keys(core.Weapons?.['One-Handed'] || {}),
    ...Object.keys(core.Weapons?.['Off-Hand'] || {})
  ]);

  const gems = toArray(core.gems);
  const activeSkill = unique(gems
    .filter(g => !g?.support)
    .map(g => g?.base_item?.display_name || g?.name || g?.skill_name)
    .filter(Boolean));

  let uniques = [];
  try {
    const uniqueData = await fetch('data/enriched/uniques_enriched.json').then(res => (res.ok ? res.json() : []));
    uniques = unique(toArray(uniqueData).map(item => item?.name).filter(Boolean));
  } catch {
    uniques = [];
  }

  const passives = toArray(core.passivesEnriched?.nodes || []);
  const keystones = unique(passives
    .filter(node => node?.isKeystone || node?.type === 'keystone')
    .map(node => node?.name)
    .filter(Boolean));

  return {
    ascOrClass: unique([...ascendancies, ...classes]),
    defense: unique([...defenses, 'Armour', 'Evasion', 'Energy Shield', 'Block']),
    weaponSet,
    weaponType: unique([...weaponType, 'Spear', 'Quarterstaff', 'Crossbow', 'Bow', 'Claws']),
    activeSkill: unique([...activeSkill, 'Lightning Arrow', 'Bone Storm', 'Earthquake', 'Ice Shot', 'Tempest Flurry']),
    unique: unique([...uniques, 'Goldrim', 'Lifesprig', 'Tabula Rasa', 'Facebreaker']),
    keystone: unique([...keystones, 'Chaos Inoculation', 'Resolute Technique', 'Mind Over Matter', 'Blood Magic']),
    archetype: ['Totem specialist', 'Self-cast nuker', 'Hit-and-run skirmisher', 'Frontline bruiser', 'Ailment stacker'],
    deepMechanic: ['Snapshotting defensive windows', 'Mana-stacking conversion', 'Corpse scaling', 'Trigger cadence optimization', 'Low-life aura stacking'],
    ailment: unique([...ailments, 'Freeze', 'Ignite', 'Shock', 'Poison', 'Bleed']),
    damageType: ['Physical', 'Fire', 'Cold', 'Lightning', 'Chaos'],
    attribute: ['Strength', 'Dexterity', 'Intelligence', 'Strength/Dexterity', 'Dexterity/Intelligence'],
    tactics
  };
}

function fillTemplate(template, slots) {
  return String(template || '').replace(/\{([A-Z0-9_]+)\}/g, (_m, key) => slots?.[key] ?? `{${key}}`);
}

function minSeverityAllowed(userSeverity, taskSeverity) {
  return (SEVERITY_ORDER[userSeverity] || 0) >= (SEVERITY_ORDER[taskSeverity] || 0);
}

function matchesWith(task, matcher) {
  if (!task || !matcher) return false;
  if (matcher.category && task.category !== matcher.category) return false;
  if (!matcher.tag || matcher.tag === '*') return true;
  return toArray(task.tags).includes(matcher.tag);
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

function applyEffects(state, task, slotValues) {
  const effects = task.effects || {};
  for (const [k, rawValue] of Object.entries(effects.locks || {})) {
    state.locks[k] = fillTemplate(rawValue, slotValues);
  }
  for (const [k, rawValue] of Object.entries(effects.bans || {})) {
    state.bans[k] = fillTemplate(rawValue, slotValues);
  }
  for (const [k, rawValue] of Object.entries(effects.limits || {})) {
    state.limits[k] = fillTemplate(rawValue, slotValues);
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
    const resolved = fillTemplate(rawValue, slotValues);
    const current = state.locks?.[key];
    if (current != null && current !== resolved) return true;
  }
  return false;
}

function failsBanLockSanity(task, slotValues, state) {
  const text = fillTemplate(task.template || '', slotValues);
  if (state.bans?.uniques && (slotValues.UNIQUE_ITEM || /unique/i.test(text))) return true;
  if (state.bans?.weaponSwap && (task.effects?.locks?.requiresWeaponSwap || /weapon\s*-?swap/i.test(text))) return true;
  if (state.locks?.mainSkill && slotValues.ACTIVE_SKILL && state.locks.mainSkill !== slotValues.ACTIVE_SKILL) return true;
  return false;
}

function pickSlotValue(slotConfig, slots, context) {
  const pickerName = slotConfig?.picker;
  let options = toArray(context[pickerName]);
  const notEqualTo = slotConfig?.filters?.notEqualTo;
  if (notEqualTo && slots[notEqualTo]) {
    options = options.filter(option => option !== slots[notEqualTo]);
  }
  return randomPick(options);
}

function resolveSlots(task, context, maxRetries = 25) {
  const defs = task?.slots || {};
  const keys = Object.keys(defs);
  const slots = {};
  if (!keys.length) return slots;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    let ok = true;
    for (const key of keys) {
      const value = pickSlotValue(defs[key], slots, context);
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

function buildContractTitle({ picks, slots, severity }) {
  const poolBySeverity = {
    mild: ['Wayward', 'Unquiet', 'Odd', 'Restless'],
    cruel: ['Cursed', 'Bloodbound', 'Blight-Touched', 'Grim'],
    diabolical: ['Doomsworn', 'Maledict', 'Abyssal', 'Accursed']
  };
  const nouns = ['Contract', 'Covenant', 'Edict', 'Writ', 'Decree', 'Oath'];
  const ids = picks.map(p => p.task.id);

  const getFirstSlot = key => picks.find(p => p.slots?.[key])?.slots?.[key];

  if (getFirstSlot('UNIQUE_ITEM')) return `The ${getFirstSlot('UNIQUE_ITEM')} Covenant`;
  if (getFirstSlot('KEYSTONE')) return `The ${getFirstSlot('KEYSTONE')} Decree`;
  if (getFirstSlot('ACTIVE_SKILL')) return `The ${getFirstSlot('ACTIVE_SKILL')} Edict`;
  if (ids.includes('mandate_unarmed_class')) return 'The Empty Hand Oath';
  if (ids.includes('prohibit_uniques')) return 'The Poverty Oath';
  if (ids.includes('mandate_dual_weapon_sets')) return 'The Twin Arsenal Contract';

  return `The ${randomPick(poolBySeverity[severity] || poolBySeverity.cruel)} ${randomPick(nouns)}`;
}

async function generateChallengeContract({ taskCount = 2, severity = 'cruel', maxAttempts = 120 } = {}) {
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
      if (failsBanLockSanity(chosen, slots, state)) continue;

      const nextState = cloneState(state);
      applyEffects(nextState, chosen, slots);
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
