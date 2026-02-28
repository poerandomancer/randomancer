import { ensureDataPreload } from './08-data-load.js';

const state = {
  pillar: 'ascendancy',
  passiveKind: 'keystone',
  q: '',
  tags: new Set(),
  openGroups: new Set(),
  selectedId: null,
  index: []
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
  if (entry.pillar !== state.pillar) return false;
  if (state.pillar === 'passives' && entry.type !== state.passiveKind) return false;
  const hay = `${entry.name} ${entry.text} ${(entry.tags || []).join(' ')}`.toLowerCase();
  const q = state.q.trim().toLowerCase();
  if (q && !hay.includes(q)) return false;
  for (const t of state.tags) if (!(entry.tags || []).includes(t)) return false;
  return true;
}

function updateUrl() {
  if (window.RandomancerGetMode?.() !== 'codex') return;
  const p = new URLSearchParams(location.search);
  p.set('mode', 'codex');
  p.set('pillar', state.pillar);
  if (state.pillar === 'passives') p.set('passive', state.passiveKind); else p.delete('passive');
  if (state.q) p.set('q', state.q); else p.delete('q');
  if (state.tags.size) p.set('tags', Array.from(state.tags).join(',')); else p.delete('tags');
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

function selectEntry(id) {
  state.selectedId = id;
  const entry = state.index.find(e => e.id === id);
  if (!entry || !els.inspector) return;
  els.inspector.innerHTML = `
    <h3>${esc(entry.name)}</h3>
    <p><strong>${esc(entry.group || 'Library')}</strong></p>
    ${entry.image ? `<img src="${esc(entry.image)}" alt="${esc(entry.group)}" style="max-width:100%;border-radius:8px;margin-bottom:.5rem;">` : ''}
    ${entry.extraFields?.className ? `<p><strong>Class:</strong> ${esc(entry.extraFields.className)}</p>` : ''}
    ${entry.type === 'skill' ? `<p><strong>Crafting Type:</strong> ${esc(entry.extraFields?.craftingType || 'Implicit')}</p>` : ''}
    ${entry.type === 'ascendancy_node' ? `<p><strong>Official Description:</strong> ${esc(entry.extraFields?.officialDescription || 'Description unavailable in current dataset.')}</p>` : ''}
    <p>${mark(entry.text || 'Description unavailable in current dataset.')}</p>
    <div class="skill-tags">${(entry.tags || []).slice(0, 24).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>
  `;
}

function renderTags(entries) {
  if (!els.tags) return;
  const freq = new Map();
  entries.forEach(e => (e.tags || []).forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  const top = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 40);
  els.tags.innerHTML = top.map(([t,c]) => `<button class="tag-pill ${state.tags.has(t)?'is-active':''}" data-tag="${esc(t)}">${esc(t)} <small>${c}</small></button>`).join('');
}

function renderList() {
  if (!els.list) return;
  const entries = state.index.filter(matches);
  if (els.count) els.count.textContent = `${entries.length} result${entries.length === 1 ? '' : 's'}`;
  renderTags(entries);
  if (!entries.length) {
    els.list.innerHTML = '<div class="codex-empty">No results found. Try a different search or clear tags.</div>';
    if (els.inspector) els.inspector.innerHTML = '<h3>Inspector</h3><p>No entry selected.</p>';
    return;
  }

  const groups = new Map();
  entries.forEach(e => {
    const key = e.group || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  const html = Array.from(groups.entries()).map(([group, items]) => `
    <details class="codex-group" data-group="${esc(group)}" ${state.openGroups.has(group) ? 'open' : ''}>
      <summary>${esc(group)} (${items.length})</summary>
      ${items.slice(0, 250).map(i => `<button class="codex-item ${state.selectedId===i.id?'is-active':''}" data-entry-id="${esc(i.id)}"><strong>${mark(i.name)}</strong><small>${i.type==='skill' ? `crafting: ${esc(i.extraFields?.craftingType || 'Implicit')} · ` : ''}${mark((i.text || '').slice(0, 130))}</small></button>`).join('')}
    </details>
  `).join('');
  els.list.innerHTML = html;
}

function render() {
  document.querySelectorAll('[data-codex-pillar]').forEach(btn => {
    const on = btn.dataset.codexPillar === state.pillar;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const passiveToggle = document.getElementById('codex-passive-toggle');
  passiveToggle?.classList.toggle('is-hidden', state.pillar !== 'passives');
  passiveToggle?.querySelectorAll('[data-passive-kind]').forEach(btn => {
    const on = btn.dataset.passiveKind === state.passiveKind;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (els.search) els.search.value = state.q;
  renderList();
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
    out.push({
      id: `skill:${sid}`,
      type: 'skill',
      pillar: 'skills',
      group: craftingType,
      name,
      text,
      tags: normalizeTags(g.tags, `${text} ${craftingType}`),
      extraFields: { craftingType },
      sourceRef: 'skills_enriched'
    });
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
  document.getElementById('codex-expand-all')?.addEventListener('click', () => {
    const groups = new Set(state.index.filter(matches).map(e => e.group || 'Other'));
    state.openGroups = groups;
    renderList();
  });
  document.getElementById('codex-collapse-all')?.addEventListener('click', () => {
    state.openGroups.clear();
    renderList();
  });
  document.querySelectorAll('[data-codex-pillar]').forEach(btn => btn.addEventListener('click', () => { state.pillar = btn.dataset.codexPillar; state.selectedId = null; state.openGroups.clear(); render(); }));
  document.querySelectorAll('[data-passive-kind]').forEach(btn => btn.addEventListener('click', () => { state.passiveKind = btn.dataset.passiveKind; state.selectedId = null; state.openGroups.clear(); render(); }));

  els.tags?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const t = chip.dataset.tag;
    if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
    render();
  });

  els.list?.addEventListener('click', (e) => {
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
    if (details.open) state.openGroups.add(group);
    else state.openGroups.delete(group);
  }, true);

  document.addEventListener('randomancer:mode-change', (evt) => {
    const mode = evt.detail?.mode;
    els.panel?.classList.toggle('is-hidden', mode !== 'codex');
  });
}

function hydrateFromUrl() {
  const p = new URLSearchParams(location.search);
  const pillar = p.get('pillar');
  if (pillar && ['ascendancy','skills','passives'].includes(pillar)) state.pillar = pillar;
  const passiveKind = p.get('passive');
  if (passiveKind && ['keystone','notable'].includes(passiveKind)) state.passiveKind = passiveKind;
  state.q = p.get('q') || '';
  state.tags = new Set((p.get('tags') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

document.addEventListener('DOMContentLoaded', async () => {
  bind();
  hydrateFromUrl();
  await ensureDataPreload();
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
