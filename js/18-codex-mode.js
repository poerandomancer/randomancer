import { ensureDataPreload } from './08-data-load.js';

const state = {
  pillar: 'ascendancy',
  skillKind: 'active',
  gearKind: 'uniques',
  q: '',
  tags: new Set(),
  openGroupsByView: new Map(),
  expandedByAccordion: new Map(),
  pinnedIds: new Set(),
  index: [],
  uniquesItems: [],
  uniquesLoadWarning: ''
};

const els = {};

const esc = (s) => String(s || '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const CODEX_TAG_STOPLIST = new Set([
  'helmet', 'body armour', 'body armor', 'gloves', 'boots', 'belt',
  'ring', 'amulet',
  'wand', 'bow', 'staff', 'mace', 'sword', 'axe', 'dagger', 'spear', 'crossbow', 'quarterstaff',
  'flail', 'focus', 'shield', 'buckler', 'quiver', 'sceptre', 'claw',
  'javelin', 'trap', 'flask'
]);

const CODEX_TAG_VARIANTS = new Map([
  ['minions', 'minion'],
  ['charges', 'charge'],
  ['bleeding', 'bleed'],
  ['bled', 'bleed'],
  ['shocked', 'shock'],
  ['shocking', 'shock'],
  ['ignited', 'ignite'],
  ['igniting', 'ignite'],
  ['poisoned', 'poison'],
  ['poisoning', 'poison'],
  ['recouped', 'recoup'],
  ['recouping', 'recoup']
]);

function normalizeCodexTag(tag) {
  const raw = String(tag || '').toLowerCase().replace(/[\[\]]/g, '').replace(/[_-]+/g, ' ').trim();
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, ' ');

  const isFamilyTag = collapsed.startsWith('family:');
  if (/^grants?:/.test(collapsed) || /^grants?\s/.test(collapsed) || collapsed.includes('grants skill')) return null;

  const canonical = CODEX_TAG_VARIANTS.get(collapsed) || collapsed;
  if (!isFamilyTag && CODEX_TAG_STOPLIST.has(canonical)) return null;

  if (!isFamilyTag) return canonical;
  const suffix = canonical.slice('family:'.length).trim();
  if (!suffix) return null;
  return `family:${suffix}`;
}

function normalizeTags(tags, text) {
  const set = new Set();
  (Array.isArray(tags) ? tags : []).forEach((t) => {
    const normalized = normalizeCodexTag(t);
    if (normalized) set.add(normalized);
  });
  const scan = String(text || '').toLowerCase();
  const derives = ['fire','cold','lightning','chaos','physical','minion','projectile','totem','melee','spell','attack','crit','bleed','poison','stun'];
  derives.forEach((t) => {
    if (!scan.includes(t)) return;
    const normalized = normalizeCodexTag(t);
    if (normalized) set.add(normalized);
  });
  return Array.from(set);
}

function mark(txt) {
  const q = state.q.trim();
  if (!q) return esc(txt);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return esc(txt).replace(re, '<mark class="codex-mark">$1</mark>');
}

function matches(entry) {
  if (state.pillar === 'pinned') {
    if (!state.pinnedIds.has(entry.id)) return false;
  } else if (entry.pillar !== state.pillar) {
    return false;
  }
  if (state.pillar === 'skills' && entry.type === 'skill' && entry.extraFields?.skillKind !== state.skillKind) return false;
  if (state.pillar === 'gear' && entry.type !== state.gearKind) return false;
  const hay = `${entry.name} ${entry.text} ${(entry.tags || []).join(' ')}`.toLowerCase();
  const q = state.q.trim().toLowerCase();
  if (q && !hay.includes(q)) return false;
  if (state.pillar === 'pinned') return true;
  for (const t of state.tags) if (!(entry.tags || []).includes(t)) return false;
  return true;
}

function updateUrl() {
  if (window.RandomancerGetMode?.() !== 'codex') return;
  const p = new URLSearchParams(location.search);
  p.set('mode', 'codex');
  p.set('pillar', state.pillar);
  if (state.pillar === 'skills') p.set('skill', state.skillKind); else p.delete('skill');
  if (state.pillar === 'gear') p.set('gear', state.gearKind); else p.delete('gear');
  if (state.q) p.set('q', state.q); else p.delete('q');
  if (state.tags.size) p.set('tags', Array.from(state.tags).join(',')); else p.delete('tags');
  p.delete('passive');
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

function renderTags(entries) {
  if (!els.tags) return;
  const freq = new Map();
  entries.forEach(e => (e.tags || []).forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  const top = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 50);
  const selectedMissing = Array.from(state.tags).filter((t) => !freq.has(t)).map((t) => [t, 0]);
  const chips = [...top, ...selectedMissing];
  els.tags.innerHTML = chips.map(([t,c]) => `<button class="tag-pill ${state.tags.has(t)?'is-active':''}" data-tag="${esc(t)}">${esc(t)} <small>${c}</small></button>`).join('');
}

function buildPoeNinjaUrl() {
  const league = window.RANDOMANCER?.support?.league?.poeNinjaSlug || 'standard';
  const url = new URL(`https://poe.ninja/poe2/builds/${league}`);

  Array.from(state.pinnedIds)
    .map((id) => state.index.find((entry) => entry.id === id))
    .filter(Boolean)
    .forEach((entry) => {
      const name = entry.name;
      if (!name) return;

      if (entry.type === 'ascendancy_node' || entry.type === 'keystone') {
        url.searchParams.append('keypassives', name);
        return;
      }
      if (entry.type === 'skill') {
        if (entry.extraFields?.skillKind === 'support') url.searchParams.append('allskills', name);
        else url.searchParams.append('skills', name);
        return;
      }
      if (entry.type === 'uniques') {
        url.searchParams.append('items', name);
      }
    });

  return url.toString();
}

function renderPinsTray() {
  if (!els.listMount) return;
  const pins = Array.from(state.pinnedIds)
    .map((id) => state.index.find((entry) => entry.id === id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const filterUrl = buildPoeNinjaUrl();
  const hasParams = filterUrl.includes('?');

  els.listMount.innerHTML = `
    <div class="codex-pins-tray">
      <div class="codex-pins-head">
        <span class="codex-pins-title">Pinned Items (${pins.length})</span>
        <div class="codex-pin-actions">
          ${hasParams ? '<button type="button" data-pin-action="view-ninja" aria-label="View in poe.ninja"><span aria-hidden="true">🥷</span> View in poe.ninja</button>' : ''}
          <button type="button" data-pin-action="clear" ${pins.length ? '' : 'disabled'}>Clear</button>
        </div>
      </div>
      <div class="codex-pin-list">
        ${pins.map((entry) => `<span class="codex-pin-chip" role="button" tabindex="0" data-select-id="${esc(entry.id)}" aria-label="Jump to pinned ${esc(entry.name)}">${esc(entry.name)}<button type="button" class="codex-pin-remove" data-unpin-id="${esc(entry.id)}" aria-label="Unpin ${esc(entry.name)}">×</button></span>`).join('') || '<span class="codex-empty">No pinned entries yet.</span>'}
      </div>
      <div class="codex-pin-query">Pin Ascendancy, Keystone, Skill, and Gear entries to power the <em>View in poe.ninja</em> action.</div>
    </div>
  `;
}

function getViewKey() {
  if (state.pillar === 'gear') return `gear:${state.gearKind}`;
  if (state.pillar === 'skills') return `skills:${state.skillKind}`;
  return state.pillar;
}

function getOpenGroupsSet() {
  const key = getViewKey();
  if (!state.openGroupsByView.has(key)) state.openGroupsByView.set(key, new Set());
  return state.openGroupsByView.get(key);
}

function accordionStateKey(group) {
  return `${getViewKey()}::${group}`;
}

function getExpandedId(group) {
  return state.expandedByAccordion.get(accordionStateKey(group)) || null;
}

function setExpandedId(group, id) {
  const key = accordionStateKey(group);
  if (id) state.expandedByAccordion.set(key, id);
  else state.expandedByAccordion.delete(key);
}

function getEntryMeta(entry) {
  if (entry.type === 'skill') return `Crafting: ${entry.extraFields?.craftingType || 'Implicit'}`;
  if (entry.type === 'uniques') {
    const base = entry.extraFields?.base;
    const slot = entry.extraFields?.slot;
    if (base && slot) return `${base} · ${slot}`;
    return base || slot || 'Unknown item class';
  }
  return '';
}

function formatRequirements(req) {
  if (!req || typeof req !== 'object') return '';
  const parts = [];
  if (Number.isFinite(Number(req.level)) && Number(req.level) > 0) parts.push(`Level ${Number(req.level)}`);
  if (Number.isFinite(Number(req.str)) && Number(req.str) > 0) parts.push(`Str ${Number(req.str)}`);
  if (Number.isFinite(Number(req.dex)) && Number(req.dex) > 0) parts.push(`Dex ${Number(req.dex)}`);
  if (Number.isFinite(Number(req.int)) && Number(req.int) > 0) parts.push(`Int ${Number(req.int)}`);
  return parts.join(' · ');
}

function renderUniqueSection(title, lines) {
  if (!Array.isArray(lines) || !lines.length) return '';
  const body = lines.map((line) => `<li>${mark(line)}</li>`).join('');
  return `<div class="codex-unique-section"><div class="codex-unique-label">${esc(title)}</div><ul>${body}</ul></div>`;
}

function renderGrantedSkills(skills) {
  if (!Array.isArray(skills) || !skills.length) return '';
  const rows = skills.map((skill) => {
    const name = skill?.name || 'Unknown Skill';
    const level = Number.isFinite(Number(skill?.level)) ? ` (Lvl ${Number(skill.level)})` : '';
    return `<li>${mark(`${name}${level}`)}</li>`;
  }).join('');
  return `<div class="codex-unique-section"><div class="codex-unique-label">Granted Skills</div><ul>${rows}</ul></div>`;
}

function renderUniqueBody(entry) {
  const reqLine = formatRequirements(entry.extraFields?.requirements);
  const implicit = renderUniqueSection('Implicit Mods', entry.extraFields?.implicitMods);
  const explicit = renderUniqueSection('Explicit Mods', entry.extraFields?.explicitMods);
  const grantedSkills = renderGrantedSkills(entry.extraFields?.grantedSkills);
  const flavour = Array.isArray(entry.extraFields?.flavourText) ? entry.extraFields.flavourText.filter(Boolean) : [];
  return `
    <div class="codex-row-body" id="codex-body-${esc(entry.id)}">
      ${reqLine ? `<p><strong>Requirements:</strong> ${mark(reqLine)}</p>` : ''}
      ${implicit}
      ${explicit}
      ${grantedSkills}
      ${flavour.length ? `<div class="codex-unique-flavour">${flavour.map((line) => `<p>${mark(line)}</p>`).join('')}</div>` : ''}
      ${(entry.tags || []).length ? `<div class="codex-row-tags">${entry.tags.slice(0, 24).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
  `;
}

function pinIconSvg() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10.7 2.2 13.8 5.3l-1.3 1.3-1.1-.3-2.6 2.6 2.3 2.3-.9.9-2.3-2.3-3.4 3.4-.7-.7 3.4-3.4L4.9 7.1l.9-.9 2.3 2.3 2.6-2.6-.3-1.1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
}

function renderCodexRow(entry, group) {
  const expanded = getExpandedId(group) === entry.id;
  const isPinned = state.pinnedIds.has(entry.id);
  const meta = getEntryMeta(entry);
  const rowBody = expanded ? (entry.type === 'uniques' ? renderUniqueBody(entry) : `
    <div class="codex-row-body" id="codex-body-${esc(entry.id)}">
      <p>${mark(entry.text || 'Description unavailable in current dataset.')}</p>
      ${(entry.tags || []).length ? `<div class="codex-row-tags">${entry.tags.slice(0, 24).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
  `) : '';
  const rawText = entry.text || '';
  const isTruncated = rawText.length > 130;
  const previewText = rawText.slice(0, 130);
  const previewDisplay = isTruncated ? `${previewText}…` : previewText;
  const subline = !expanded
    ? `${meta ? `${esc(meta)}${previewDisplay ? ' · ' : ''}` : ''}${previewDisplay ? mark(previewDisplay) : ''}`
    : (meta ? esc(meta) : '');

  return `
    <article class="codex-row ${expanded ? 'is-expanded' : ''}" data-entry-id="${esc(entry.id)}" data-group="${esc(group)}" role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="codex-body-${esc(entry.id)}">
      <div class="codex-row-head">
        <span class="codex-row-chevron" aria-hidden="true">▸</span>
        <div class="codex-row-copy">
          <strong>${mark(entry.name)}</strong>
          ${subline ? `<small>${subline}</small>` : ''}
        </div>
        <button type="button" class="codex-pin-icon ${isPinned ? 'is-pinned' : ''}" data-pin-id="${esc(entry.id)}" aria-label="${isPinned ? `Unpin ${esc(entry.name)}` : `Pin ${esc(entry.name)}`}" aria-pressed="${isPinned ? 'true' : 'false'}">${pinIconSvg()}</button>
      </div>
      ${rowBody}
    </article>
  `;
}

function renderList() {
  if (!els.listMount) return;
  const entries = state.index.filter(matches);
  const warningHtml = (state.pillar === 'gear' && state.gearKind === 'uniques' && state.uniquesLoadWarning)
    ? `<div class="codex-empty">${esc(state.uniquesLoadWarning)}</div>`
    : '';
  if (els.count) els.count.textContent = `${entries.length} result${entries.length === 1 ? '' : 's'}`;
  renderTags(entries);

  if (!entries.length) {
    const controlsHtml = `
      <div class="codex-list-actions" aria-label="Navigation group controls">
        <button type="button" class="codex-nav-btn" data-codex-list-action="expand">Expand All</button>
        <button type="button" class="codex-nav-btn" data-codex-list-action="collapse">Collapse All</button>
      </div>
    `;
    els.listMount.innerHTML = `${controlsHtml}<div class="codex-list-scroll">${warningHtml}<div class="codex-empty">No results found. Try a different search or clear tags.</div></div>`;
    return;
  }

  const groups = new Map();
  if (state.pillar === 'passives') {
    groups.set('Keystones', entries.filter((e) => e.type === 'keystone'));
    groups.set('Notables', entries.filter((e) => e.type === 'notable'));
  } else {
    entries.forEach((e) => {
      const key = e.group || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
  }

  const openGroups = getOpenGroupsSet();
  const controlsHtml = `
    <div class="codex-list-actions" aria-label="Navigation group controls">
      <button type="button" class="codex-nav-btn" data-codex-list-action="expand">Expand All</button>
      <button type="button" class="codex-nav-btn" data-codex-list-action="collapse">Collapse All</button>
    </div>
  `;

  const html = Array.from(groups.entries()).map(([group, items]) => {
    const itemsHtml = items.length
      ? items.slice(0, 250).map((item) => renderCodexRow(item, group)).join('')
      : '<div class="codex-empty">No matching entries in this section.</div>';
    return `
      <details class="codex-group" data-group="${esc(group)}" ${openGroups.has(group) ? 'open' : ''}>
        <summary>${esc(group)} (${items.length})</summary>
        <div class="codex-group-rows">${itemsHtml}</div>
      </details>
    `;
  }).join('');

  els.listMount.innerHTML = `${controlsHtml}<div class="codex-list-scroll">${warningHtml}${html}</div>`;
}

function applyPinnedJump(id) {
  const entry = state.index.find((item) => item.id === id);
  if (!entry) return;
  state.pillar = entry.pillar;
  if (entry.type === 'skill') state.skillKind = entry.extraFields?.skillKind || 'active';
  if (entry.pillar === 'gear') state.gearKind = entry.type;
  const group = entry.group || (entry.type === 'keystone' ? 'Keystones' : entry.type === 'notable' ? 'Notables' : 'Other');
  getOpenGroupsSet().add(group);
  setExpandedId(group, id);
}

function render() {
  document.querySelectorAll('[data-codex-pillar]').forEach(btn => {
    const on = btn.dataset.codexPillar === state.pillar;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const skillsToggle = document.getElementById('codex-skills-toggle');
  const gearToggle = document.getElementById('codex-gear-toggle');
  skillsToggle?.classList.toggle('is-hidden', state.pillar !== 'skills');
  gearToggle?.classList.toggle('is-hidden', state.pillar !== 'gear');

  const hasSubtabs = (state.pillar === 'skills' || state.pillar === 'gear');
  els.panel?.classList.toggle('codex--has-subtabs', hasSubtabs);

  skillsToggle?.querySelectorAll('[data-skill-kind]').forEach(btn => {
    const on = btn.dataset.skillKind === state.skillKind;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  gearToggle?.querySelectorAll('[data-gear-kind]').forEach(btn => {
    const on = btn.dataset.gearKind === state.gearKind;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  if (els.search) els.search.value = state.q;
  if (els.tags) els.tags.style.display = state.pillar === 'pinned' ? 'none' : '';
  if (state.pillar === 'pinned') renderPinsTray(); else renderList();

  const pinnedTab = document.getElementById('codex-pinned-tab');
  if (pinnedTab) pinnedTab.textContent = `Pinned (${state.pinnedIds.size})`;
  updateUrl();
}

function buildIndex() {
  const data = window.DATA || {};
  const out = [];
  const passives = data.passivesEnriched?.nodes || [];
  const ascMetaMap = data.ascendancyByName || {};
  const keystoneTooltips = data.keystoneTooltips || {};

  function getKeystoneText(node) {
    const key = node?.name;
    const tip = (key && (keystoneTooltips[key] || keystoneTooltips[key.replace(/[’]/g, "'")])) || null;
    const tipLines = Array.isArray(tip?.lines) ? tip.lines.map(String).filter(Boolean) : [];
    if (tipLines.length) return tipLines.join(' • ');
    return (node.lines || node.rawStats || []).join(' • ') || node.flavour || '';
  }

  function deriveCraftingType(gem) {
    const direct = gem?.crafting_type;
    if (direct) return String(direct);
    const types = Array.isArray(gem?.crafting?.types_raw) ? gem.crafting.types_raw.filter(Boolean) : [];
    if (types.length) return types.join(' / ');
    return 'Implicit';
  }

  function deriveSupportAttributeGroup(gem) {
    const rw = gem?.requirement_weights;
    const weights = {
      strength: Number(rw?.strength || 0),
      dexterity: Number(rw?.dexterity || 0),
      intelligence: Number(rw?.intelligence || 0)
    };
    const order = ['strength', 'dexterity', 'intelligence'];
    let best = 'strength';
    for (const key of order) if (weights[key] > weights[best]) best = key;
    return best;
  }

  function isBrowsableSkill(gem) {
    const hay = `${gem?.name || ''} ${gem?.id || ''} ${gem?.base_item?.display_name || ''} ${gem?.description || ''} ${gem?.support_text || ''}`.toLowerCase();
    if (!hay.trim()) return false;
    if (hay.includes('dnt')) return false;
    if (hay.includes('unused')) return false;
    if (hay.includes('playtest')) return false;
    if (hay.includes('default')) return false;
    if (hay.includes('coming soon')) return false;
    return true;
  }

  function isAtlasNotable(node) {
    if (!node || node.type !== 'notable') return false;
    const id = String(node.id || '');
    if (/^atlas/i.test(id)) return true;
    const hay = `${node.name || ''} ${(node.lines || []).join(' ')} ${(node.tags || []).join(' ')}`.toLowerCase();
    return hay.includes('atlas');
  }

  passives.forEach(n => {
    const text = (n.lines || n.rawStats || []).join(' • ') || n.flavour || '';
    const tags = normalizeTags(n.tags, text);
    if (n.type === 'ascendancy') {
      const ascName = n.ascendancy || 'Unknown Ascendancy';
      const meta = ascMetaMap[ascName] || {};
      out.push({
        id: n.id,
        type: 'ascendancy_node',
        pillar: 'ascendancy',
        group: ascName,
        name: n.name,
        text: text || 'Description unavailable in current dataset.',
        tags,
        image: `images/ascendancies/${slug(ascName)}.webp`,
        extraFields: { className: meta.className || meta.character || 'Unknown class', officialDescription: meta.description || '' },
        sourceRef: 'passivesEnriched'
      });
      return;
    }
    if ((n.type === 'keystone' || n.type === 'notable') && !n.ascendancy) {
      if (isAtlasNotable(n)) return;
      const passiveText = n.type === 'keystone' ? getKeystoneText(n) : text;
      out.push({
        id: n.id,
        type: n.type,
        pillar: 'passives',
        group: n.type === 'keystone' ? 'Keystones' : 'Notables',
        name: n.name,
        text: passiveText,
        tags: normalizeTags(n.tags, passiveText),
        extraFields: {},
        sourceRef: 'passivesEnriched'
      });
    }
  });

  const gems = Array.isArray(data.gems) ? data.gems : [];
  gems.forEach((g) => {
    if (!isBrowsableSkill(g)) return;
    const sid = g.id || g.base_item?.id || g.name;
    const name = g.name || g.base_item?.display_name || sid;
    if (!sid || !name) return;
    const text = g.description || g.support_text || '';
    const craftingType = deriveCraftingType(g);
    const skillKind = g?.type === 'support' ? 'support' : 'active';
    const supportAffinity = skillKind === 'support' ? deriveSupportAttributeGroup(g) : null;
    const skillGroup = skillKind === 'support' ? supportAffinity : craftingType;
    out.push({
      id: `skill:${sid}`,
      type: 'skill',
      pillar: 'skills',
      group: skillGroup,
      name,
      text,
      tags: normalizeTags(g.tags, `${text} ${craftingType} ${supportAffinity || ''}`),
      extraFields: { craftingType, skillKind, supportAffinity },
      sourceRef: 'skills_enriched'
    });
  });

  const uniques = Array.isArray(state.uniquesItems) ? state.uniquesItems : [];
  uniques.forEach((u) => {
    const name = u?.name;
    if (!name) return;
    const slot = u?.slot || 'Unknown';
    const base = u?.base || '';
    const implicitMods = Array.isArray(u?.implicit_mods) ? u.implicit_mods.filter(Boolean) : [];
    const explicitMods = Array.isArray(u?.explicit_mods) ? u.explicit_mods.filter(Boolean) : [];
    const flavourText = Array.isArray(u?.flavour_text) ? u.flavour_text.filter(Boolean) : [];
    const lines = [...implicitMods, ...explicitMods];
    const tags = normalizeTags(u?.tags, `${name} ${base} ${slot} ${lines.join(' ')}`);
    const stableKey = String(u?.key || `${name}||${base || slot}`);
    const sourceId = String(u?.id || u?.source?.id || 'unknown');
    out.push({
      id: `unique:${stableKey}`,
      type: 'uniques',
      pillar: 'gear',
      group: slot,
      name,
      text: `${base ? `${base} • ` : ''}${lines.join(' • ')}` || 'No details available in current dataset.',
      tags,
      extraFields: {
        slot,
        base,
        requirements: u?.requirements || {},
        implicitMods,
        explicitMods,
        grantedSkills: Array.isArray(u?.granted_skills) ? u.granted_skills : [],
        flavourText,
        sourceId
      },
      sourceRef: 'poe2db_uniques_min'
    });
  });

  out.push({
    id: 'gear-placeholder-implicits',
    type: 'implicits',
    pillar: 'gear',
    group: 'Implicits',
    name: 'Implicit Mod Library (Coming Soon)',
    text: 'Implicit item metadata will appear here in a future pass.',
    tags: ['implicit', 'placeholder'],
    extraFields: {},
    sourceRef: 'placeholder'
  });

  out.push({
    id: 'gear-placeholder-mods',
    type: 'mods',
    pillar: 'gear',
    group: 'Gear Mods',
    name: 'Gear Mod Library (Coming Soon)',
    text: 'Global gear modifiers and affix references will appear here in a future pass.',
    tags: ['mods', 'placeholder'],
    extraFields: {},
    sourceRef: 'placeholder'
  });

  state.index = out;
}

function bind() {
  els.panel = document.getElementById('codex-panel');
  els.search = document.getElementById('codex-search');
  els.tags = document.getElementById('codex-tag-chips');
  els.list = document.getElementById('codex-list');
  els.listMount = document.getElementById('codex-list-mount');
  els.count = document.getElementById('codex-results-count');

  els.search?.addEventListener('input', (e) => { state.q = e.target.value || ''; render(); });
  document.getElementById('codex-clear-tags')?.addEventListener('click', () => { state.tags.clear(); state.q = ''; render(); });
  document.querySelectorAll('[data-codex-pillar]').forEach(btn => btn.addEventListener('click', () => { state.pillar = btn.dataset.codexPillar; render(); }));
  document.querySelectorAll('[data-skill-kind]').forEach(btn => btn.addEventListener('click', () => { state.skillKind = btn.dataset.skillKind; render(); }));
  document.querySelectorAll('[data-gear-kind]').forEach(btn => btn.addEventListener('click', () => { state.gearKind = btn.dataset.gearKind; render(); }));

  els.tags?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const t = normalizeCodexTag(chip.dataset.tag);
    if (!t) return;
    if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
    render();
  });

  els.list?.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-codex-list-action]');
    if (actionBtn) {
      const mode = actionBtn.dataset.codexListAction;
      const openGroups = getOpenGroupsSet();
      if (mode === 'expand') {
        const groups = new Set(state.index.filter(matches).map(en => en.group || 'Other'));
        if (state.pillar === 'passives') {
          groups.add('Keystones');
          groups.add('Notables');
        }
        state.openGroupsByView.set(getViewKey(), groups);
      } else if (mode === 'collapse') {
        openGroups.clear();
      }
      renderList();
      return;
    }

    const pinBtn = e.target.closest('[data-pin-id]');
    if (pinBtn) {
      e.stopPropagation();
      const id = pinBtn.dataset.pinId;
      if (!id) return;
      if (state.pinnedIds.has(id)) state.pinnedIds.delete(id);
      else state.pinnedIds.add(id);
      render();
      return;
    }

    const unpin = e.target.closest('[data-unpin-id]');
    if (unpin) {
      const id = unpin.dataset.unpinId;
      if (id) state.pinnedIds.delete(id);
      render();
      return;
    }

    const pick = e.target.closest('[data-select-id]');
    if (pick) {
      const id = pick.dataset.selectId;
      if (id) {
        applyPinnedJump(id);
        render();
      }
      return;
    }

    const row = e.target.closest('[data-entry-id]');
    if (!row) {
      const action = e.target.closest('[data-pin-action]')?.dataset.pinAction;
      if (!action) return;
      if (action === 'clear') {
        state.pinnedIds.clear();
        render();
        return;
      }
      if (action === 'view-ninja') {
        const filterUrl = buildPoeNinjaUrl();
        if (!filterUrl.includes('?')) return;
        window.open(filterUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    const group = row.dataset.group || 'Other';
    const id = row.dataset.entryId;
    const current = getExpandedId(group);
    setExpandedId(group, current === id ? null : id);
    renderList();
  });

  els.list?.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-entry-id]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const group = row.dataset.group || 'Other';
      const id = row.dataset.entryId;
      const current = getExpandedId(group);
      setExpandedId(group, current === id ? null : id);
      renderList();
      return;
    }

    const pick = e.target.closest('[data-select-id]');
    if (!pick || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const id = pick.dataset.selectId;
    if (!id) return;
    applyPinnedJump(id);
    render();
  });

  els.list?.addEventListener('toggle', (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    const group = details.dataset.group;
    if (!group) return;
    const openGroups = getOpenGroupsSet();
    if (details.open) openGroups.add(group);
    else openGroups.delete(group);
  }, true);

  document.addEventListener('randomancer:mode-change', (evt) => {
    const mode = evt.detail?.mode;
    els.panel?.classList.toggle('is-hidden', mode !== 'codex');
  });
}

function hydrateFromUrl() {
  const p = new URLSearchParams(location.search);
  const pillar = p.get('pillar');
  if (pillar && ['ascendancy','skills','passives','gear','pinned'].includes(pillar)) state.pillar = pillar;
  const skillKind = p.get('skill');
  if (skillKind && ['active','support'].includes(skillKind)) state.skillKind = skillKind;
  const gearKind = p.get('gear');
  if (gearKind && ['uniques','implicits','mods'].includes(gearKind)) state.gearKind = gearKind;
  state.q = p.get('q') || '';
  state.tags = new Set(
    (p.get('tags') || '')
      .split(',')
      .map((s) => normalizeCodexTag(s))
      .filter(Boolean)
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  bind();
  hydrateFromUrl();
  await ensureDataPreload();

  async function loadCodexUniques() {
    try {
      const res = await fetch('data/enriched/poe2db_uniques_min.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const mapped = Object.entries(json?.items || {})
        .map(([id, record]) => ({ id, ...(record || {}) }))
        .filter((record) => record && !record.error && record.name)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '') || (a.base || '').localeCompare(b.base || ''));
      state.uniquesLoadWarning = '';
      return mapped;
    } catch {
      try {
        const fallbackRes = await fetch('data/enriched/uniques_enriched.json');
        if (!fallbackRes.ok) throw new Error(`HTTP ${fallbackRes.status}`);
        const fallbackJson = await fallbackRes.json();
        const fallbackItems = Array.isArray(fallbackJson?.items) ? fallbackJson.items : [];
        state.uniquesLoadWarning = 'Using fallback uniques dataset. To refresh Codex uniques, generate and commit data/enriched/poe2db_uniques_min.json.';
        return fallbackItems;
      } catch {
        state.uniquesLoadWarning = 'Uniques dataset unavailable. Generate and commit data/enriched/poe2db_uniques_min.json to enable Codex uniques browsing.';
        return [];
      }
    }
  }

  state.uniquesItems = await loadCodexUniques();
  buildIndex();
  render();
});

window.RandomancerCodex = {
  setState(next = {}) {
    if (next.pillar) state.pillar = next.pillar;
    if (next.q != null) state.q = String(next.q);
    if (Array.isArray(next.tags)) state.tags = new Set(next.tags.map((tag) => normalizeCodexTag(tag)).filter(Boolean));
    render();
  },
  refresh() { buildIndex(); render(); }
};
