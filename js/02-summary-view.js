import { formatWeaponLine } from './01-meta-and-domready.js';
import { buildGemDictionary, lookupGem } from './05-tags-and-scorer.js';

// ===== Summary View (presentation toggle) =====
const VIEW_STORAGE_KEY = 'rm_view_mode';

function getViewMode(){
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return (v === 'summary' || v === 'detailed') ? v : 'detailed';
  } catch {
    return 'detailed';
  }
}

function setViewMode(mode){
  const m = (mode === 'summary') ? 'summary' : 'detailed';
  const appEl = document.getElementById('app');
  if (appEl) appEl.dataset.view = m;

  try { localStorage.setItem(VIEW_STORAGE_KEY, m); } catch {}

  // Ensure summary text is up-to-date when switching views
  const snap = (window.App && window.App.state && window.App.state.currentRoll)
    ? window.App.state.currentRoll
    : (window.CURRENT_ROLL || null);
  if (snap) renderSummaryFromSnapshot(snap);
}

function toggleViewMode(){
  const next = (getViewMode() === 'summary') ? 'detailed' : 'summary';
  setViewMode(next);
}

// Summary auto-refresh helpers: keep summary text synced even when roll flows differ
function isSummaryModeActive(){
  const appEl = document.getElementById('app');
  const ds = appEl && appEl.dataset ? appEl.dataset.view : '';
  if (ds) return ds === 'summary';
  return getViewMode() === 'summary';
}

function refreshSummaryFromLatest(){
  if (!isSummaryModeActive()) return;

  let snap = null;
  try { snap = (typeof currentSnap === 'function') ? currentSnap() : null; } catch {}
  if (!snap) {
    try { snap = (window.App && window.App.state && window.App.state.currentRoll) ? window.App.state.currentRoll : null; } catch {}
  }
  if (!snap) {
    try { snap = window.CURRENT_ROLL || null; } catch {}
  }

  // As a last resort, capture from DOM (useful when some roll flows update DOM first)
  if (!snap && window.App && typeof window.App.captureCurrentRollFromDOM === 'function') {
    try {
      window.App.captureCurrentRollFromDOM();
      snap = (window.App.state && window.App.state.currentRoll) ? window.App.state.currentRoll : null;
    } catch {}
  }

  if (snap) {
    try { renderSummaryFromSnapshot(snap); } catch {}
  }
}

function scheduleSummaryRefresh(){
  refreshSummaryFromLatest();
  try { requestAnimationFrame(() => refreshSummaryFromLatest()); } catch {}
  try { setTimeout(() => refreshSummaryFromLatest(), 0); } catch {}
}

// Expose refresh hook globally so all roll entrypoints can trigger it safely
try { window.scheduleSummaryRefresh = scheduleSummaryRefresh; } catch {}

function installSummaryAutoRefresh(){
  const nameEl = document.getElementById('build-name');
  if (!nameEl || nameEl.__summaryAutoRefresh) return;
  nameEl.__summaryAutoRefresh = true;

  const obs = new MutationObserver(() => {
    if (!isSummaryModeActive()) return;
    if (window.scheduleSummaryRefresh) window.scheduleSummaryRefresh();
  });
  obs.observe(nameEl, { childList: true, characterData: true, subtree: true });
}

function buildSummaryLinesFromSnapshot(snap){

  if (!snap) return ['', '', '', '', ''];

  const dot = ' · ';

  const weaponsTxt = formatWeaponLine(snap.weapon, snap.offhand);

  const ailments = Array.isArray(snap.ailmentList)
    ? snap.ailmentList
    : (snap.ailments ? String(snap.ailments).split(/\s*&\s*/).filter(Boolean) : []);
  const tactics = Array.isArray(snap.tacticList)
    ? snap.tacticList
    : (snap.tactics ? String(snap.tactics).split(/\s*&\s*/).filter(Boolean) : []);

  const ailTxt = ailments.length ? ailments.join(' & ') : '';
  const tacTxt = tactics.length ? tactics.join(' & ') : '';
  const mechanicsTxt = [ailTxt, tacTxt].filter(Boolean).join(' & ');

  const line1 = [snap.ascendancy, weaponsTxt, mechanicsTxt, snap.defStrat].filter(Boolean).join(dot);

  // Resolve gem entries -> display names
  const gems = (window.DATA && window.DATA.gems) || [];
  const gemDict = buildGemDictionary(gems);
  const resolveGemName = (entry) => {
    if (!entry) return '';
    const key = entry.id || entry.name || '';
    if (!key) return '';
    const g = lookupGem(gemDict, key);
    return (g && g.name) ? g.name : (entry.name || key);
  };

  // Secondary weapon set (if rolled/selected)
  const weapons2Txt = formatWeaponLine(snap.weapon2, snap.offhand2);
  const skills2All = (snap.recommendedSkills2 || []).map(resolveGemName).filter(Boolean);
  const skills2 = skills2All.slice(0, 2);
  const lineWS2 = [weapons2Txt, ...skills2].filter(Boolean).join(dot);


  const skills = (snap.recommendedSkills || []).map(resolveGemName).filter(Boolean);
  const buff = snap.recommendedPersistentBuff ? resolveGemName(snap.recommendedPersistentBuff) : '';
  const line2 = [...skills, buff].filter(Boolean).join(dot);

  const uniques = Array.isArray(snap.recommendedUniques) ? snap.recommendedUniques : [];
  const line3 = uniques.filter(Boolean).join(dot);

  const pass = snap.passives || {};
  const passNames = [
    ...(pass.ascendancyNodes || []).map(n => n && n.name).filter(Boolean),
    ...(pass.keystones || []).map(n => n && n.name).filter(Boolean),
    ...(pass.notables || []).map(n => n && n.name).filter(Boolean),
  ];

  // De-dupe while preserving order
  const seen = new Set();
  const uniqPass = passNames.filter(n => (seen.has(n) ? false : (seen.add(n), true)));
  const line4 = uniqPass.join(dot);

  return [line1, lineWS2, line2, line3, line4];
}

function getSummaryTextFromSnapshot(snap){
  const lines = buildSummaryLinesFromSnapshot(snap);
  const out = [];
  if (lines[0]) out.push(`ARCHETYPE: ${lines[0]}`);
  if (lines[1]) out.push(`WEAPON SET II: ${lines[1]}`);
  if (lines[2]) out.push(`CORE SKILLS: ${lines[2]}`);
  if (lines[3]) out.push(`UNIQUES: ${lines[3]}`);
  if (lines[4]) out.push(`PASSIVES: ${lines[4]}`);
  return out.join('\n');
}

const SUMMARY_LABELS = ['ARCHETYPE','WEAPON SET II','CORE SKILLS','UNIQUES','PASSIVES'];

function setSummaryRow(el, label, content, opts){
  if (!el) return;
  // clear
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!content) { el.hidden = true; return; }
  el.hidden = false;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'summary-label';
  labelSpan.textContent = `${label} — `;

  const contentSpan = document.createElement('span');
  contentSpan.className = (opts && opts.highlight) ? 'summary-content oath-hit' : 'summary-content';
  contentSpan.textContent = content;

  el.appendChild(labelSpan);
  el.appendChild(contentSpan);
}

function renderSummaryFromSnapshot(snap){
  const panel = document.getElementById('summary-panel');
  if (!panel) return;

  const lines = buildSummaryLinesFromSnapshot(snap);
  const ids = ['summary-line-1','summary-line-2','summary-line-3','summary-line-4','summary-line-5'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    setSummaryRow(el, SUMMARY_LABELS[i], lines[i] || '', { highlight: i === 0 });
  });

  panel.hidden = !isSummaryModeActive();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view-mode-tabs .skills-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document
        .querySelectorAll('.view-mode-tabs .skills-tab')
        .forEach(t => t.classList.remove('is-active'));

      tab.classList.add('is-active');
      setViewMode(tab.dataset.view);
    });
  });
});


document.addEventListener('DOMContentLoaded', () => {
  const mode = getViewMode();
  document
    .querySelectorAll('.view-mode-tabs .skills-tab')
    .forEach(t => {
      t.classList.toggle('is-active', t.dataset.view === mode);
    });

  setViewMode(mode); // ensures DOM + summary panel are correct
});


export {
  getViewMode,
  setViewMode,
  toggleViewMode,
  isSummaryModeActive,
  scheduleSummaryRefresh,
  installSummaryAutoRefresh,
  buildSummaryLinesFromSnapshot,
  getSummaryTextFromSnapshot,
  renderSummaryFromSnapshot
};
