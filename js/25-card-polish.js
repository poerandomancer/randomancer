import { ensureBuildCardUniqueData } from './23-build-card-foundation.js';

const PRIMARY_STAGE_ID = 'primary-build-card-stage';
const SNAPSHOT_EVENT = 'randomancer:build-snapshot-change';

let uniqueRecordsPromise = null;
let synergyObserver = null;
let synergyFrame = 0;

function currentSnapshot() {
  return window.App?.state?.currentDraw || null;
}

function safeBtoa(value) {
  try { return btoa(unescape(encodeURIComponent(value))); } catch { return ''; }
}

function compactNamedEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { name: entry };
  const name = String(entry.name || '').trim();
  return name ? { name } : null;
}

function compactSkillEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { name: entry };
  const name = String(entry.name || '').trim();
  const id = String(entry.id || '').trim();
  if (!name && !id) return null;
  const compact = name ? { name } : { id };
  const recommendation = entry.recommendationPackage;
  if (recommendation && typeof recommendation === 'object') {
    const supports = (recommendation.supports || []).slice(0, 2).map((support) => {
      if (!support) return null;
      if (typeof support === 'string') return { name: support };
      const supportName = String(support.name || '').trim();
      const sourceId = String(support.sourceId || support.id || '').trim();
      return supportName ? { name: supportName } : (sourceId ? { sourceId } : null);
    }).filter(Boolean);
    compact.recommendationPackage = {
      ...(recommendation.assignedRole ? { assignedRole: recommendation.assignedRole } : {}),
      ...(supports.length ? { supports } : {})
    };
  }
  return compact;
}

function buildCompactSnapshotPayload(snapshot) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
  if (!snap) return null;

  const out = {};
  const put = (key, value) => {
    if (value == null || value === '') return;
    if (Array.isArray(value) && !value.length) return;
    out[key] = value;
  };

  put('c', snap.className || '');
  put('a', snap.ascendancy || '');
  if (snap.ascendancyId != null) put('ai', snap.ascendancyId);
  put('w', snap.weapon || '');
  put('o', snap.offhand || '');
  put('w2', snap.weapon2 || '');
  put('o2', snap.offhand2 || '');
  put('al', Array.isArray(snap.ailmentList) ? snap.ailmentList.filter(Boolean) : []);
  put('tl', Array.isArray(snap.tacticList) ? snap.tacticList.filter(Boolean) : []);
  put('d', typeof snap.defense === 'string' ? snap.defense : (snap.defense?.name || ''));
  put('ds', typeof snap.defStrat === 'string' ? snap.defStrat : (snap.defStrat?.name || ''));
  put('b', snap.buildName || '');
  put('f', snap.flavor || '');

  const attr = snap.attributes || snap.rollAttr;
  if (attr && typeof attr === 'object') {
    put('attr', {
      strength: Number(attr.strength) || 0,
      dexterity: Number(attr.dexterity) || 0,
      intelligence: Number(attr.intelligence) || 0
    });
  }

  const skills1 = (snap.recommendedSkills || []).map(compactSkillEntry).filter(Boolean).slice(0, 2);
  const skills2 = (snap.recommendedSkills2 || []).map(compactSkillEntry).filter(Boolean).slice(0, 2);
  put('rs', skills1);
  put('rs2', skills2);

  const uniques = (snap.recommendedUniques || [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.name)
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  put('u', uniques);

  const passives = snap.passives && typeof snap.passives === 'object' ? snap.passives : null;
  if (passives) {
    const asc = (passives.ascendancyNodes || []).map(compactNamedEntry).filter(Boolean).slice(0, 2);
    const notables = (passives.notables || []).map(compactNamedEntry).filter(Boolean).slice(0, 3);
    const packed = {};
    if (asc.length) packed.a = asc;
    if (notables.length) packed.n = notables;
    if (Object.keys(packed).length) out.p = packed;
  }

  return out;
}

function encodeCompactBuildSnapshot(snapshot) {
  const payload = buildCompactSnapshotPayload(snapshot);
  if (!payload) return '';
  return safeBtoa(JSON.stringify(payload));
}

function encodeBuildQueryValue(code) {
  // Standard Base64 stays compatible with the existing atob decoder. '+' is
  // the only character that must be escaped for query-string parsing; '/' and
  // trailing '=' padding can remain literal inside the value.
  return String(code || '').replace(/\+/g, '%2B');
}

function buildCompactBuildLink(snapshot) {
  const code = encodeCompactBuildSnapshot(snapshot);
  if (!code) return '';

  try {
    const url = new URL(window.location.href);
    const base = `${url.origin}${url.pathname}`;
    return `${base}?build=${encodeBuildQueryValue(code)}`;
  } catch {
    const base = `${window.location.origin || ''}${window.location.pathname || '/'}`;
    return `${base}?build=${encodeBuildQueryValue(code)}`;
  }
}

async function copyCompactBuildLink() {
  const link = buildCompactBuildLink(currentSnapshot());
  if (!link) {
    window.RandomancerShowToast?.('Build link could not be created.');
    return false;
  }

  const copied = await window.RandomancerCopyTextToClipboard?.(link);
  window.RandomancerShowToast?.(copied ? 'Build link copied.' : 'Could not copy build link.');
  return !!copied;
}

function normalizeTag(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function splitCompound(value) {
  return String(value || '')
    .split(/\s*(?:\/|&|\band\b|\+)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tagsForNamedData(collection, name) {
  if (!name || !Array.isArray(collection)) return [];
  const wanted = String(name).trim().toLowerCase();
  const row = collection.find((entry) => String(entry?.name || '').trim().toLowerCase() === wanted);
  return Array.isArray(row?.tags) ? row.tags : [];
}

function buildRollFocuses(snapshot) {
  const snap = snapshot || {};
  const focuses = [];

  const add = (name, tags = []) => {
    const label = String(name || '').trim();
    if (!label) return;
    const normalized = new Set();
    [label, ...splitCompound(label), ...(tags || [])].forEach((tag) => {
      const key = normalizeTag(tag);
      if (key && key !== 'physical') normalized.add(key);
    });
    if (!normalized.size) return;
    focuses.push({ label, tags: normalized });
  };

  (snap.ailmentList || []).forEach((name) => add(name, tagsForNamedData(window.DATA?.Ailments, name)));
  (snap.tacticList || []).forEach((name) => add(name, tagsForNamedData(window.DATA?.Tactics, name)));

  const defStrat = typeof snap.defStrat === 'string' ? snap.defStrat : snap.defStrat?.name;
  add(defStrat, tagsForNamedData(window.DATA?.DefensiveStrategies, defStrat));

  const defense = typeof snap.defense === 'string' ? snap.defense : snap.defense?.name;
  add(defense, splitCompound(defense));

  return focuses;
}

function uniqueRecordTags(record) {
  const tags = new Set();
  const add = (value) => {
    splitCompound(value).forEach((part) => {
      const key = normalizeTag(part);
      if (key && key !== 'physical') tags.add(key);
    });
  };

  const source = record?.tags;
  if (Array.isArray(source)) source.forEach(add);
  if (Array.isArray(source?.raw)) source.raw.forEach(add);
  if (Array.isArray(source?.canonical)) source.canonical.forEach(add);
  if (Array.isArray(record?.meta?.tags)) record.meta.tags.forEach(add);

  const lines = [
    ...(Array.isArray(record?.explicit_mods) ? record.explicit_mods : []),
    ...(Array.isArray(record?.lines) ? record.lines : [])
  ];
  const text = lines.join(' ').toLowerCase();

  if (/\bpoison/.test(text)) tags.add('poison');
  if (/\bbleed/.test(text)) tags.add('bleed');
  if (/\bignite/.test(text)) tags.add('ignite');
  if (/\bfreeze|\bchill/.test(text)) { tags.add('freeze'); tags.add('chill'); }
  if (/\bshock/.test(text)) tags.add('shock');
  if (/\bleech/.test(text)) tags.add('leech');
  if (/armou?r/.test(text)) tags.add('armour');
  if (/evasion/.test(text)) tags.add('evasion');
  if (/energy shield/.test(text)) tags.add('energyshield');
  if (/block/.test(text)) tags.add('block');

  return tags;
}

function buildUniqueSynergyLine(record, snapshot) {
  if (!record) return '';
  const itemTags = uniqueRecordTags(record);
  if (!itemTags.size) return '';

  const matches = [];
  for (const focus of buildRollFocuses(snapshot)) {
    if (Array.from(focus.tags).some((tag) => itemTags.has(tag))) matches.push(focus.label);
  }

  const uniqueMatches = Array.from(new Set(matches)).slice(0, 3);
  return uniqueMatches.length ? `Synergies: ${uniqueMatches.join(' · ')}` : '';
}

function uniqueRecordName(record) {
  return String(record?.name || record?.base_item?.display_name || record?.source?.label || '').trim();
}

function getUniqueRecords() {
  if (!uniqueRecordsPromise) {
    uniqueRecordsPromise = ensureBuildCardUniqueData()
      .then((items) => Array.isArray(items) ? items : [])
      .catch(() => []);
  }
  return uniqueRecordsPromise;
}

async function hydrateUniqueSynergyTooltips(snapshot = currentSnapshot()) {
  const stage = document.getElementById(PRIMARY_STAGE_ID);
  if (!stage || stage.dataset.cardState !== 'result' || !snapshot) return;

  const records = await getUniqueRecords();
  if (!records.length) return;
  const byName = new Map(records.map((record) => [uniqueRecordName(record).toLowerCase(), record]).filter(([name]) => name));

  const blocks = Array.from(stage.querySelectorAll('.rc-print-block'));
  const uniqueBlock = blocks.find((block) => block.querySelector('.rc-print-block__label')?.textContent?.trim() === 'Unique Ideas');
  if (!uniqueBlock) return;

  uniqueBlock.querySelectorAll('.rc-name').forEach((node) => {
    const name = String(node.dataset.tipTitle || node.textContent || '').trim();
    const record = byName.get(name.toLowerCase());
    const synergy = buildUniqueSynergyLine(record, snapshot);
    if (!synergy) return;

    let lines = [];
    try { lines = JSON.parse(node.dataset.tipLines || '[]'); } catch {}
    lines = (Array.isArray(lines) ? lines : []).filter((line) => !String(line).startsWith('Synergies:'));
    lines.unshift(synergy);

    node.dataset.tipTitle = name;
    node.dataset.tipLines = JSON.stringify(lines);
    node.classList.add('has-tip');
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
  });
}

function scheduleSynergyHydration(snapshot) {
  if (synergyFrame) cancelAnimationFrame(synergyFrame);
  synergyFrame = requestAnimationFrame(() => {
    synergyFrame = 0;
    hydrateUniqueSynergyTooltips(snapshot || currentSnapshot());
  });
}

function installSynergyObserver() {
  if (synergyObserver) return;
  const stage = document.getElementById(PRIMARY_STAGE_ID);
  if (!stage) {
    window.setTimeout(installSynergyObserver, 60);
    return;
  }

  synergyObserver = new MutationObserver(() => scheduleSynergyHydration());
  synergyObserver.observe(stage, { childList: true, subtree: true });
  scheduleSynergyHydration();
}

function install() {
  // Capture the primary-card Copy Link action before the card's existing
  // bubbling handler. Saved-build encoding remains unchanged; only copied URLs
  // use this compact, legacy-decoder-compatible payload.
  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-card-action="copy-link"]');
    if (!target || !target.closest(`#${PRIMARY_STAGE_ID}`)) return;
    event.preventDefault();
    event.stopPropagation();
    copyCompactBuildLink();
  }, true);

  document.addEventListener(SNAPSHOT_EVENT, (event) => {
    scheduleSynergyHydration(event.detail?.snapshot || currentSnapshot());
  });
  document.addEventListener('randomancer:mode-change', () => scheduleSynergyHydration());

  installSynergyObserver();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

if (typeof window !== 'undefined') {
  window.RandomancerEncodeCompactBuildSnapshot = encodeCompactBuildSnapshot;
  window.RandomancerBuildCompactBuildLink = buildCompactBuildLink;
}

export {
  buildCompactSnapshotPayload,
  encodeCompactBuildSnapshot,
  buildCompactBuildLink,
  buildUniqueSynergyLine
};
