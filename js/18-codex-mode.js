import { ensureDataPreload } from './08-data-load.js';

const state = {
  pillar: 'ascendancy',
  passiveKind: 'keystone',
  skillKind: 'active',
  gearKind: 'uniques',
  q: '',
  tags: new Set(),
  openGroupsByView: new Map(),
  pinnedIds: new Set(),
  selectedId: null,
  index: [],
  uniquesItems: []
};

const els = {};

const esc = (s) => String(s || '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function normalizeTags(tags, text) {
  const set = new Set((Array.isArray(tags) ? tags : []).map(t => String(t || '').trim().toLowerCase()).filter(Boolean));
  const scan = String(text || '').toLowerCase();
  const derives = ['fire','cold','lightning','chaos','physical','minion','projectile','totem','melee','spell','attack','crit','bleed','poison','stun'];
  derives.forEach(t => { if (scan.includes(t)) set.add(t); });
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
  } else if (entry.pillar !== state.pillar) return false;
  if (state.pillar === 'passives' && entry.type !== state.passiveKind) return false;
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
  if (state.pillar === 'passives') p.set('passive', state.passiveKind); else p.delete('passive');
  if (state.pillar === 'skills') p.set('skill', state.skillKind); else p.delete('skill');
  if (state.pillar === 'gear') p.set('gear', state.gearKind); else p.delete('gear');
  if (state.q) p.set('q', state.q); else p.delete('q');
  if (state.tags.size) p.set('tags', Array.from(state.tags).join(',')); else p.delete('tags');
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

function selectEntry(id) {
  state.selectedId = id;
  const entry = state.index.find(e => e.id === id);
  if (!entry || !els.inspector) return;
  const uniqueLines = Array.isArray(entry.extraFields?.lines) ? entry.extraFields.lines : [];
  const isPinned = state.pinnedIds.has(entry.id);
  const ascendancyMeta = entry.type === 'ascendancy_node'
    ? `${esc(entry.group || 'Ascendancy')}${entry.extraFields?.officialDescription ? ` | ${esc(entry.extraFields.officialDescription)}` : ''}`
    : null;
  els.inspector.innerHTML = `
    <div class="codex-inspector-head">
      <h3>${esc(entry.name)}</h3>
      <button type="button" class="codex-pin-toggle ${isPinned ? 'is-pinned' : ''}" data-pin-id="${esc(entry.id)}" aria-pressed="${isPinned ? 'true' : 'false'}">📌 ${isPinned ? 'Pinned' : 'Pin'}</button>
    </div>
    <p><strong>${ascendancyMeta || esc(entry.group || 'Library')}</strong></p>
    ${entry.image ? `<img src="${esc(entry.image)}" alt="${esc(entry.group)}" style="max-width:100%;border-radius:8px;margin-bottom:.5rem;">` : ''}
    ${entry.extraFields?.className && entry.type !== 'ascendancy_node' ? `<p><strong>Class:</strong> ${esc(entry.extraFields.className)}</p>` : ''}
    ${entry.type === 'skill' ? `<p><strong>Crafting Type:</strong> ${esc(entry.extraFields?.craftingType || 'Implicit')}</p>` : ''}
    ${entry.type === 'uniques' ? `<p><strong>Slot:</strong> ${esc(entry.extraFields?.slot || 'Unknown')}</p>` : ''}
    ${entry.type === 'uniques' ? `<p><strong>Description:</strong> ${mark(entry.extraFields?.description || 'Description unavailable in current dataset.')}</p>` : ''}
    <p>${mark(entry.text || 'Description unavailable in current dataset.')}</p>
    ${entry.type === 'uniques' && uniqueLines.length ? `<div><strong>Lines:</strong><ul>${uniqueLines.map((ln) => `<li>${mark(ln)}</li>`).join('')}</ul></div>` : ''}
    <div class="skill-tags">${(entry.tags || []).slice(0, 24).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>
  `;
}

function renderTags(entries) {
  if (!els.tags) return;
  const freq = new Map();
  entries.forEach(e => (e.tags || []).forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  const top = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 40);
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
  if (!els.list) return;
  const pins = Array.from(state.pinnedIds)
    .map((id) => state.index.find((entry) => entry.id === id))
    .filter(Boolean);
  const filterUrl = buildPoeNinjaUrl();
  const hasParams = filterUrl.includes('?');

  els.list.innerHTML = `
    <div class="codex-pins-head">
      <span class="codex-pins-title">Pinned Items (${pins.length})</span>
      <div class="codex-pin-actions">
        <button type="button" data-pin-action="copy" ${hasParams ? '' : 'disabled'}>Copy</button>
        <button type="button" data-pin-action="clear" ${pins.length ? '' : 'disabled'}>Clear</button>
      </div>
    </div>
    <div class="codex-pin-list">
      ${pins.map((entry) => `<span class="codex-pin-chip" role="button" tabindex="0" data-select-id="${esc(entry.id)}" aria-label="Inspect pinned ${esc(entry.name)}">${esc(entry.name)}<button type="button" class="codex-pin-remove" data-unpin-id="${esc(entry.id)}" aria-label="Unpin ${esc(entry.name)}">×</button></span>`).join('') || '<span class="codex-empty">No pinned entries yet.</span>'}
    </div>
    <div class="codex-pin-query">Pin entries to build a poe.ninja filter url.</div>
    <div class="codex-pin-query">${hasParams ? esc(filterUrl) : ''}</div>
  `;
}

function getViewKey() {
  if (state.pillar === 'passives') return `passives:${state.passiveKind}`;
  if (state.pillar === 'gear') return `gear:${state.gearKind}`;
  return state.pillar;
}

function getOpenGroupsSet() {
  const key = getViewKey();
  if (!state.openGroupsByView.has(key)) state.openGroupsByView.set(key, new Set());
  return state.openGroupsByView.get(key);
}

function renderList() {
  if (!els.list) return;
  const entries = state.index.filter(matches);
  if (els.count) els.count.textContent = `${entries.length} result${entries.length === 1 ? '' : 's'}`;
  renderTags(entries);
  if (!entries.length) {
    const controlsHtml = `
      <div class="codex-list-actions" aria-label="Navigation group controls">
        <button type="button" class="codex-nav-btn" data-codex-list-action="expand">Expand All</button>
        <button type="button" class="codex-nav-btn" data-codex-list-action="collapse">Collapse All</button>
      </div>
    `;
    els.list.innerHTML = `${controlsHtml}<div class="codex-list-scroll"><div class="codex-empty">No results found. Try a different search or clear tags.</div></div>`;
    if (els.inspector) els.inspector.innerHTML = '<h3>Inspector</h3><p>No entry selected.</p>';
    return;
  }

  const groups = new Map();
  entries.forEach(e => {
    const key = e.group || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  const openGroups = getOpenGroupsSet();
  const controlsHtml = `
    <div class="codex-list-actions" aria-label="Navigation group controls">
      <button type="button" class="codex-nav-btn" data-codex-list-action="expand">Expand All</button>
      <button type="button" class="codex-nav-btn" data-codex-list-action="collapse">Collapse All</button>
    </div>
  `;

  const html = Array.from(groups.entries()).map(([group, items]) => `
    <details class="codex-group" data-group="${esc(group)}" ${openGroups.has(group) ? 'open' : ''}>
      <summary>${esc(group)} (${items.length})</summary>
      ${items.slice(0, 250).map(i => `<button class="codex-item ${state.selectedId===i.id?'is-active':''}" data-entry-id="${esc(i.id)}"><strong>${mark(i.name)}</strong><small>${i.type==='skill' ? `crafting: ${esc(i.extraFields?.craftingType || 'Implicit')} · ` : ''}${mark((i.text || '').slice(0, 130))}</small></button>`).join('')}
    </details>
  `).join('');
  els.list.innerHTML = `${controlsHtml}<div class="codex-list-scroll">${html}</div>`;
}

function render() {
  document.querySelectorAll('[data-codex-pillar]').forEach(btn => {
    const on = btn.dataset.codexPillar === state.pillar;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const passiveToggle = document.getElementById('codex-passive-toggle');
  const skillsToggle = document.getElementById('codex-skills-toggle');
  const gearToggle = document.getElementById('codex-gear-toggle');
  passiveToggle?.classList.toggle('is-hidden', state.pillar !== 'passives');
  skillsToggle?.classList.toggle('is-hidden', state.pillar !== 'skills');
  gearToggle?.classList.toggle('is-hidden', state.pillar !== 'gear');
  passiveToggle?.querySelectorAll('[data-passive-kind]').forEach(btn => {
    const on = btn.dataset.passiveKind === state.passiveKind;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
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
  if (state.pillar === 'pinned') renderPinsTray();
  else renderList();
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
    for (const key of order) {
      if (weights[key] > weights[best]) best = key;
    }
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
      out.push({ id: n.id, type: n.type, pillar: 'passives', group: n.type === 'keystone' ? 'Keystones' : 'Notables', name: n.name, text: passiveText, tags: normalizeTags(n.tags, passiveText), extraFields: {}, sourceRef: 'passivesEnriched' });
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
  uniques.forEach((u, idx) => {
    const name = u?.name || `Unique ${idx + 1}`;
    const slot = u?.slot || 'Unknown';
    const lines = Array.isArray(u?.lines) ? u.lines.filter(Boolean) : [];
    const tags = normalizeTags(u?.tags, `${name} ${slot} ${lines.join(' ')}`);
    out.push({
      id: `unique:${slot}:${name}:${idx}`,
      type: 'uniques',
      pillar: 'gear',
      group: slot,
      name,
      text: lines.join(' • ') || 'No details available in current dataset.',
      tags,
      extraFields: {
        slot,
        description: u?.base ? `Base: ${u.base}` : 'Description unavailable in current dataset.',
        lines
      },
      sourceRef: 'uniques_enriched'
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
  els.inspector = document.getElementById('codex-inspector');
  els.count = document.getElementById('codex-results-count');

  els.search?.addEventListener('input', (e) => { state.q = e.target.value || ''; render(); });
  document.getElementById('codex-clear-tags')?.addEventListener('click', () => { state.tags.clear(); render(); });
  document.querySelectorAll('[data-codex-pillar]').forEach(btn => btn.addEventListener('click', () => { state.pillar = btn.dataset.codexPillar; state.selectedId = null; render(); }));
  document.querySelectorAll('[data-passive-kind]').forEach(btn => btn.addEventListener('click', () => { state.passiveKind = btn.dataset.passiveKind; state.selectedId = null; render(); }));
  document.querySelectorAll('[data-skill-kind]').forEach(btn => btn.addEventListener('click', () => { state.skillKind = btn.dataset.skillKind; state.selectedId = null; render(); }));
  document.querySelectorAll('[data-gear-kind]').forEach(btn => btn.addEventListener('click', () => { state.gearKind = btn.dataset.gearKind; state.selectedId = null; render(); }));

  els.tags?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const t = chip.dataset.tag;
    if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
    render();
  });

  els.list?.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-codex-list-action]');
    if (actionBtn) {
      const mode = actionBtn.dataset.codexListAction;
      const openGroups = getOpenGroupsSet();
      if (mode === 'expand') {
        const groups = new Set(state.index.filter(matches).map(en => en.group || 'Other'));
        state.openGroupsByView.set(getViewKey(), groups);
      } else if (mode === 'collapse') {
        openGroups.clear();
      }
      renderList();
      return;
    }

    const row = e.target.closest('[data-entry-id]');
    if (!row) return;
    selectEntry(row.dataset.entryId);
    renderList();
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

  els.inspector?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pin-id]');
    if (!btn) return;
    const id = btn.dataset.pinId;
    if (!id) return;
    if (state.pinnedIds.has(id)) state.pinnedIds.delete(id);
    else state.pinnedIds.add(id);
    selectEntry(id);
    render();
  });

  els.list?.addEventListener('click', async (e) => {
    const unpin = e.target.closest('[data-unpin-id]');
    if (unpin) {
      const id = unpin.dataset.unpinId;
      if (id) state.pinnedIds.delete(id);
      if (state.selectedId === id) selectEntry(id);
      render();
      return;
    }
    const pick = e.target.closest('[data-select-id]');
    if (pick) {
      const id = pick.dataset.selectId;
      if (id) {
        state.selectedId = id;
        selectEntry(id);
      }
      return;
    }
    const action = e.target.closest('[data-pin-action]')?.dataset.pinAction;
    if (!action) return;
    if (action === 'clear') {
      state.pinnedIds.clear();
      if (state.selectedId) selectEntry(state.selectedId);
      render();
      return;
    }
    if (action === 'copy') {
      const filterUrl = buildPoeNinjaUrl();
      if (!filterUrl.includes('?')) return;
      try { await navigator.clipboard.writeText(filterUrl); } catch {}
    }
  });

  els.list?.addEventListener('keydown', (e) => {
    const pick = e.target.closest('[data-select-id]');
    if (!pick) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const id = pick.dataset.selectId;
    if (!id) return;
    state.selectedId = id;
    selectEntry(id);
  });

  document.addEventListener('randomancer:mode-change', (evt) => {
    const mode = evt.detail?.mode;
    els.panel?.classList.toggle('is-hidden', mode !== 'codex');
  });
}

function hydrateFromUrl() {
  const p = new URLSearchParams(location.search);
  const pillar = p.get('pillar');
  if (pillar && ['ascendancy','skills','passives','gear','pinned'].includes(pillar)) state.pillar = pillar;
  const passiveKind = p.get('passive');
  if (passiveKind && ['keystone','notable'].includes(passiveKind)) state.passiveKind = passiveKind;
  const skillKind = p.get('skill');
  if (skillKind && ['active','support'].includes(skillKind)) state.skillKind = skillKind;
  const gearKind = p.get('gear');
  if (gearKind && ['uniques','implicits','mods'].includes(gearKind)) state.gearKind = gearKind;
  state.q = p.get('q') || '';
  state.tags = new Set((p.get('tags') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

document.addEventListener('DOMContentLoaded', async () => {
  bind();
  hydrateFromUrl();
  await ensureDataPreload();
  try {
    const res = await fetch('data/enriched/uniques_enriched.json');
    const json = await res.json();
    state.uniquesItems = Array.isArray(json?.items) ? json.items : [];
  } catch {
    state.uniquesItems = [];
  }
  buildIndex();
  render();
});

window.RandomancerCodex = {
  setState(next = {}) {
    if (next.pillar) state.pillar = next.pillar;
    if (next.q != null) state.q = String(next.q);
    if (Array.isArray(next.tags)) state.tags = new Set(next.tags);
    render();
  },
  refresh() { buildIndex(); render(); }
};
