// Path of Exile 2 build-generator primary equipment-family migration.
import { ensureDataPreload } from './08-data-load.js';
import { validOffhands } from './06-cohesion.js';

const EQUIPMENT_FAMILY_CONTRACT = 'WEAPON_FAMILY_V1';
const UNARMED_POOL_RATE = 0.40;
const PRIMARY_CARD_STAGE_ID = 'primary-build-card-stage';

let coreRef = null;
let families = [];
let savedPools = null;
let savedValidOffhands = new Map();
let projectionActive = false;
let previousPoeNinjaBuilder = null;
let cardObserver = null;
let cardObserverRetry = 0;

const getMode = () => window.RandomancerGetMode?.() || 'standard';
const getBindFates = () => window.App?.getBindFates?.() || {};

function familyName(raw){
  return String(raw?.name || raw || '').trim()
    .replace(/^(?:one|two)-handed\s+/i, '')
    .replace(/^(?:one|two) handed\s+/i, '')
    .trim();
}

function makeSyntheticOffhand(name){
  if (name === 'None') return { name, tags: [], attributes: {} };
  if (name === 'Quiver') return { name, tags: ['quiver', 'ranged'], attributes: { dexterity: 1 } };
  return null;
}

function deriveFamilies(core){
  const two = Array.isArray(core?.Weapons?.['Two-Handed']) ? core.Weapons['Two-Handed'] : [];
  const one = Array.isArray(core?.Weapons?.['One-Handed']) ? core.Weapons['One-Handed'] : [];
  const off = Array.isArray(core?.Weapons?.['Off-Hand']) ? core.Weapons['Off-Hand'] : [];
  const byName = new Map();

  for (const source of [...two, ...one].filter(Boolean)) {
    const name = familyName(source);
    if (!name) continue;
    let entry = byName.get(name);
    if (!entry) {
      entry = {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        name,
        aliases: [],
        tags: [],
        attributes: { ...(source.attributes || {}) },
        legacyOffhands: [],
        poeNinjaModes: []
      };
      byName.set(name, entry);
    }
    if (!entry.aliases.includes(source.name)) entry.aliases.push(source.name);
    for (const tag of (source.tags || [])) if (!entry.tags.includes(tag)) entry.tags.push(tag);
    for (const allowed of (validOffhands[source.name] || [])) {
      if (!entry.legacyOffhands.includes(allowed)) entry.legacyOffhands.push(allowed);
    }
  }

  for (const entry of byName.values()) {
    const hasOne = entry.aliases.some((name) => /^one[- ]handed\s+/i.test(name));
    const hasTwo = entry.aliases.some((name) => /^two[- ]handed\s+/i.test(name));
    const modes = [entry.name];
    if (hasOne && hasTwo) modes.push(`Two Handed ${entry.name}`);
    if (entry.legacyOffhands.length) entry.legacyOffhands.unshift('None');

    for (const rawOffhand of entry.legacyOffhands) {
      if (!rawOffhand || rawOffhand === 'None') continue;
      const other = familyName(rawOffhand);
      if (!other) continue;
      if (other === entry.name) {
        modes.push(`Dual ${entry.name}`);
        continue;
      }
      const pair = [entry.name, other];
      const lower = pair.map((value) => value.toLowerCase());
      modes.push(lower.includes('wand') && lower.includes('sceptre') ? 'Wand / Sceptre' : `${entry.name} / ${other}`);
    }

    if ((entry.tags || []).includes('bow')) modes.push(`${entry.name} / Quiver`);
    entry.poeNinjaModes = Array.from(new Set(modes));
    entry.legacyOffhands = Array.from(new Set(entry.legacyOffhands));
  }

  const unarmedOffhands = off
    .filter((item) => {
      const tags = new Set(item?.tags || []);
      return tags.has('defense') || tags.has('focus') || tags.has('sceptre');
    })
    .map((item) => item.name)
    .filter(Boolean);

  byName.set('Unarmed', {
    id: 'unarmed',
    name: 'Unarmed',
    aliases: ['No Weapon'],
    // Temporary Hollow Palm hint for the current recommendation layer.
    tags: ['unarmed', 'melee', 'quarterstaff'],
    attributes: { dexterity: 0.5, intelligence: 0.5 },
    baseWeight: UNARMED_POOL_RATE,
    legacyOffhands: ['None', 'Quiver', ...unarmedOffhands],
    poeNinjaModes: ['Unarmed', 'Unarmed / Quiver', ...unarmedOffhands.map((name) => `Unarmed / ${name}`)]
  });

  return Array.from(byName.values());
}

function resolveEquipmentFamily(raw){
  const key = familyName(raw).toLowerCase();
  if (!key) return null;
  return families.find((entry) =>
    entry.name.toLowerCase() === key
    || entry.id === key
    || (entry.aliases || []).some((alias) => String(alias).toLowerCase() === String(raw?.name || raw || '').trim().toLowerCase())
  ) || null;
}

function rememberLegacyState(){
  if (!coreRef?.Weapons || savedPools) return;
  savedPools = {
    two: coreRef.Weapons['Two-Handed'].slice(),
    one: coreRef.Weapons['One-Handed'].slice(),
    off: coreRef.Weapons['Off-Hand'].slice()
  };
  families = deriveFamilies(coreRef);
  for (const entry of families) {
    savedValidOffhands.set(entry.name,
      Object.prototype.hasOwnProperty.call(validOffhands, entry.name) ? validOffhands[entry.name] : undefined
    );
  }
}

function canonicalizeEquipmentFates(){
  const current = getBindFates()?.weapon || {};
  const normalize = (values) => {
    const out = [];
    for (const raw of (Array.isArray(values) ? values : [])) {
      const entry = resolveEquipmentFamily(raw);
      if (entry && !out.includes(entry.name)) out.push(entry.name);
    }
    return out;
  };
  const next = { oaths: normalize(current.oaths), abominations: normalize(current.abominations) };
  const before = { oaths: current.oaths || [], abominations: current.abominations || [] };
  if (JSON.stringify(before) !== JSON.stringify(next)) window.App?.setBindFatesCategory?.('weapon', next);
  return next;
}

function restoreLegacyEquipment(){
  if (!coreRef?.Weapons || !savedPools || !projectionActive) return;
  coreRef.Weapons['Two-Handed'].splice(0, coreRef.Weapons['Two-Handed'].length, ...savedPools.two);
  coreRef.Weapons['One-Handed'].splice(0, coreRef.Weapons['One-Handed'].length, ...savedPools.one);
  coreRef.Weapons['Off-Hand'].splice(0, coreRef.Weapons['Off-Hand'].length, ...savedPools.off);
  for (const entry of families) {
    const prior = savedValidOffhands.get(entry.name);
    if (prior === undefined) delete validOffhands[entry.name];
    else validOffhands[entry.name] = prior;
  }
  projectionActive = false;
}

function projectEquipmentFamilies(){
  if (!coreRef?.Weapons && window.DATA?.Weapons) coreRef = window.DATA;
  if (!coreRef?.Weapons) return;
  restoreLegacyEquipment();
  rememberLegacyState();

  const fate = canonicalizeEquipmentFates();
  const aboms = new Set(fate.abominations || []);
  const oaths = new Set(fate.oaths || []);
  const allowed = families.filter((entry) => !aboms.has(entry.name));
  const projectedFamilies = allowed.filter((entry) => {
    if (entry.name !== 'Unarmed') return true;
    if (oaths.has(entry.name) || allowed.length === 1) return true;
    return Math.random() < UNARMED_POOL_RATE;
  });

  const projected = projectedFamilies.map((entry) => ({
    name: entry.name,
    tags: [...entry.tags],
    attributes: { ...entry.attributes },
    equipmentFamilyId: entry.id
  }));
  coreRef.Weapons['Two-Handed'].splice(0, coreRef.Weapons['Two-Handed'].length, ...projected);
  coreRef.Weapons['One-Handed'].splice(0, coreRef.Weapons['One-Handed'].length);

  const offhands = savedPools.off.slice();
  for (const name of ['None', 'Quiver']) {
    if (!offhands.some((item) => item?.name === name)) offhands.push(makeSyntheticOffhand(name));
  }
  coreRef.Weapons['Off-Hand'].splice(0, coreRef.Weapons['Off-Hand'].length, ...offhands.filter(Boolean));

  for (const entry of projectedFamilies) {
    if (entry.legacyOffhands.length) validOffhands[entry.name] = [...entry.legacyOffhands];
    else delete validOffhands[entry.name];
  }
  projectionActive = true;
}

function norm(attrs){
  const out = {
    strength: Number(attrs?.strength) || 0,
    dexterity: Number(attrs?.dexterity) || 0,
    intelligence: Number(attrs?.intelligence) || 0
  };
  const total = out.strength + out.dexterity + out.intelligence;
  if (!total) return { strength: 0, dexterity: 0, intelligence: 0 };
  return { strength: out.strength / total, dexterity: out.dexterity / total, intelligence: out.intelligence / total };
}

function recomputeBalance(snapshot, family){
  const total = { strength: 0, dexterity: 0, intelligence: 0 };
  const add = (attrs, weight = 1) => {
    const a = norm(attrs);
    total.strength += a.strength * weight;
    total.dexterity += a.dexterity * weight;
    total.intelligence += a.intelligence * weight;
  };
  add(coreRef?.Classes?.[snapshot?.className]?.attributes || {});
  add(family?.attributes || {});
  add(snapshot?.defenseObj?.attributes || {});
  add(snapshot?.defStratObj?.attributes || {});
  const offense = Array.isArray(snapshot?.offenseSet) && snapshot.offenseSet.length
    ? snapshot.offenseSet
    : [...(snapshot?.ailmentSet || []), ...(snapshot?.tacticSet || [])];
  for (const entry of offense.filter(Boolean)) add(entry.attributes || {}, 0.5);
  const sum = total.strength + total.dexterity + total.intelligence || 1;
  return { strength: total.strength / sum, dexterity: total.dexterity / sum, intelligence: total.intelligence / sum };
}

function paintBalance(attrs){
  const S = attrs.strength || 0, D = attrs.dexterity || 0, I = attrs.intelligence || 0;
  const bar = document.getElementById('balance-bar');
  if (bar) {
    bar.style.setProperty('--balance-gradient', `linear-gradient(90deg, rgba(176,48,48,1) 0%, rgba(176,48,48,1) ${S*100}%, rgba(45,122,45,1) ${S*100}%, rgba(45,122,45,1) ${(S+D)*100}%, rgba(47,79,157,1) ${(S+D)*100}%, rgba(47,79,157,1) 100%)`);
    bar.classList.add('glow');
  }
  const text = document.getElementById('balance-text');
  if (text) text.textContent = `Strength ${Math.round(S*100)}% | Dexterity ${Math.round(D*100)}% | Intelligence ${Math.round(I*100)}%`;
}

function canonicalizeCurrentEquipment(){
  const snapshot = window.App?.state?.currentRoll || window.CURRENT_ROLL || {};
  const family = resolveEquipmentFamily(snapshot.weapon);
  if (!family) return null;
  const attrs = recomputeBalance(snapshot, family);
  const fields = {
    weaponContractVersion: EQUIPMENT_FAMILY_CONTRACT,
    weaponFamily: family.name,
    weapon: family.name,
    offhand: '', weapon2: '', offhand2: '',
    recommendedSkills2: [], synergySupports2: [],
    attributes: attrs, rollAttr: attrs
  };
  if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') Object.assign(window.CURRENT_ROLL, fields, { className: snapshot.className || '' });
  window.App?.mergeCurrentRoll?.(fields);
  const primary = document.getElementById('weapons');
  if (primary) primary.textContent = family.name;
  const secondary = document.getElementById('weapons-set2');
  if (secondary) { secondary.textContent = ''; secondary.hidden = true; }
  paintBalance(attrs);
  return fields;
}

function cycle(button){
  if (button.classList.contains('is-oath')) {
    button.classList.remove('is-oath'); button.classList.add('is-abomination');
  } else if (button.classList.contains('is-abomination')) button.classList.remove('is-abomination');
  else button.classList.add('is-oath');
}

function renderEquipmentBindFates(){
  if (getMode() === 'challenge' || !families.length) return;
  const section = document.querySelector('[data-category="weapon"]');
  const list = document.getElementById('bind-fates-list-weapon');
  if (!section || !list) return;
  const heading = section.querySelector('h4');
  const hint = section.querySelector('.bind-fates-hint');
  if (heading) heading.textContent = 'Primary Weapon';
  if (hint) hint.textContent = 'Favor a broad equipment identity, or bar one that fate will never grant.';
  const fate = canonicalizeEquipmentFates();
  const oaths = new Set(fate.oaths || []), aboms = new Set(fate.abominations || []);
  list.innerHTML = '';
  for (const entry of families) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'bind-option'; button.dataset.name = entry.name;
    if (oaths.has(entry.name)) button.classList.add('is-oath');
    else if (aboms.has(entry.name)) button.classList.add('is-abomination');
    button.textContent = entry.name; button.addEventListener('click', () => cycle(button));
    list.appendChild(button);
  }
}

function buildFamilyPoeNinjaUrl(snapshot){
  if (!snapshot) return '';
  if (snapshot.offhand || snapshot.weapon2 || snapshot.offhand2) return previousPoeNinjaBuilder?.(snapshot) || '';
  const family = resolveEquipmentFamily(snapshot.weaponFamily || snapshot.weapon);
  const prior = previousPoeNinjaBuilder?.(snapshot) || '';
  if (!family) return prior;
  try {
    const url = new URL(prior || 'https://poe.ninja/poe2/builds/runesofaldur');
    if (family.poeNinjaModes.length) url.searchParams.set('weaponmode', family.poeNinjaModes.join(','));
    return url.toString();
  } catch { return prior; }
}

function patchPrimaryCard(){
  const snap = window.App?.state?.currentRoll || {};
  if (snap.offhand || snap.weapon2 || snap.offhand2) return;
  document.querySelectorAll('.rc-card--front .rc-print-row__label').forEach((label) => {
    if (String(label.textContent || '').trim() === 'Weapons') label.textContent = 'Weapon';
  });
  document.querySelectorAll(`#${PRIMARY_CARD_STAGE_ID} .rc-name__prefix`).forEach((prefix) => {
    if (/^(Set I|Weapon Set I)\b/i.test(String(prefix.textContent || '').trim())) prefix.remove();
  });
}

function installCardObserver(){
  if (cardObserver) return;
  const stage = document.getElementById(PRIMARY_CARD_STAGE_ID);
  if (!stage) {
    if (!cardObserverRetry) cardObserverRetry = window.setTimeout(() => { cardObserverRetry = 0; installCardObserver(); }, 50);
    return;
  }
  cardObserver = new MutationObserver(patchPrimaryCard);
  cardObserver.observe(stage, { childList: true, subtree: true });
  patchPrimaryCard();
}

function installLifecycle(){
  if (window.__randomancerEquipmentFamilyLifecycleInstalled) return;
  window.__randomancerEquipmentFamilyLifecycleInstalled = true;
  const priorPrepare = window.RandomancerPrepareBuildRoll;
  window.RandomancerPrepareBuildRoll = (...args) => { priorPrepare?.(...args); projectEquipmentFamilies(); };
  const priorAfter = window.RandomancerAfterBuildRoll;
  window.RandomancerAfterBuildRoll = (...args) => {
    let error = null;
    try { priorAfter?.(...args); } catch (err) { error = err; }
    try { canonicalizeCurrentEquipment(); patchPrimaryCard(); }
    finally { restoreLegacyEquipment(); }
    if (error) throw error;
  };
  window.addEventListener('error', restoreLegacyEquipment);
  window.addEventListener('unhandledrejection', restoreLegacyEquipment);
}

function installPresentation(){
  document.addEventListener('randomancer:mode-change', () => setTimeout(() => {
    if (getMode() !== 'standard') restoreLegacyEquipment();
    renderEquipmentBindFates(); patchPrimaryCard();
  }, 0));
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('.bind-fates-toggle')) setTimeout(renderEquipmentBindFates, 0);
  });
  document.addEventListener('randomancer:build-snapshot-change', patchPrimaryCard);
}

document.addEventListener('DOMContentLoaded', async () => {
  installLifecycle(); installPresentation(); installCardObserver();
  previousPoeNinjaBuilder = window.RandomancerBuildPoeNinjaUrl || null;
  window.RandomancerBuildPoeNinjaUrl = buildFamilyPoeNinjaUrl;
  try {
    const data = await ensureDataPreload();
    coreRef = data?.core || null;
    rememberLegacyState();
    window.RandomancerEquipmentFamilies = families;
    window.RandomancerResolveEquipmentFamily = resolveEquipmentFamily;
    if (window.DATA && typeof window.DATA === 'object') {
      window.DATA.WeaponFamilies = families;
      window.DATA.WeaponContractVersion = EQUIPMENT_FAMILY_CONTRACT;
    }
    canonicalizeEquipmentFates(); renderEquipmentBindFates();
  } catch (error) { console.error('[Equipment] family runtime failed to initialize', error); }
});

export {
  EQUIPMENT_FAMILY_CONTRACT, UNARMED_POOL_RATE, resolveEquipmentFamily,
  canonicalizeCurrentEquipment, projectEquipmentFamilies, restoreLegacyEquipment,
  renderEquipmentBindFates, buildFamilyPoeNinjaUrl
};
