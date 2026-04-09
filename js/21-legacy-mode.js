import { ensureDataPreload } from './08-data-load.js';

const LEGACY_BASIS_KEY = 'randomancer_legacy_basis';
const LEGACY_FORMAT_KEY = 'randomancer_legacy_format';
const LEGACY_DAMAGE_KEY = 'randomancer_legacy_damage';

const FORMAT_STATES = ['Weapons', 'Skills'];
const DAMAGE_TYPES = ['Physical', 'Fire', 'Cold', 'Lightning', 'Chaos'];

const state = {
  basis: 'class',
  formatIndex: 0,
  damageOn: false,
  lastResult: null
};

function loadSettings() {
  try {
    const basis = localStorage.getItem(LEGACY_BASIS_KEY);
    const formatRaw = Number.parseInt(localStorage.getItem(LEGACY_FORMAT_KEY) || '', 10);
    const damage = localStorage.getItem(LEGACY_DAMAGE_KEY);

    if (basis === 'class' || basis === 'ascendancy') state.basis = basis;
    if (Number.isInteger(formatRaw) && formatRaw >= 0 && formatRaw < FORMAT_STATES.length) state.formatIndex = formatRaw;
    state.damageOn = damage === 'on';
  } catch {}
}

function persistSettings() {
  try {
    localStorage.setItem(LEGACY_BASIS_KEY, state.basis);
    localStorage.setItem(LEGACY_FORMAT_KEY, String(state.formatIndex));
    localStorage.setItem(LEGACY_DAMAGE_KEY, state.damageOn ? 'on' : 'off');
  } catch {}
}

function normalizeWeaponDisplay(raw) {
  const name = String(raw || '').trim();
  if (!name) return null;
  if (name === 'Two-handed Mace' || name === 'One-handed Mace') return 'Mace';
  if (name === 'Bow') return 'Bow & Quiver';
  return name;
}

function buildLegacyPools(data) {
  const classesByName = data?.Classes || {};
  const classNames = Object.keys(classesByName);

  const ascendancies = classNames
    .flatMap((className) => Array.isArray(classesByName[className]?.ascendancies) ? classesByName[className].ascendancies : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);

  const skills = Array.from(new Set(
    (data?.challengePools?.craftingTypes || [])
      .map((row) => String(row?.label || '').trim())
      .filter(Boolean)
  ));

  const twoHanded = data?.Weapons?.['Two-Handed'] || [];
  const oneHanded = data?.Weapons?.['One-Handed'] || [];
  const offHands = data?.Weapons?.['Off-Hand'] || [];

  const weaponSet = new Set();

  twoHanded.forEach((item) => {
    const display = normalizeWeaponDisplay(item?.name);
    if (display) weaponSet.add(display);
  });

  oneHanded.forEach((main) => {
    const mainName = String(main?.name || '').trim();
    if (!mainName) return;

    offHands.forEach((off) => {
      const offName = String(off?.name || '').trim();
      if (!offName) return;
      const compat = Array.isArray(off?.['one-handed']) ? off['one-handed'] : [];
      if (!compat.includes(mainName)) return;

      if (mainName === 'One-handed Mace' && offName === 'One-handed Mace') {
        weaponSet.add('Dual Maces');
        return;
      }

      const mainDisplay = normalizeWeaponDisplay(mainName);
      const offDisplay = normalizeWeaponDisplay(offName);
      if (!mainDisplay || !offDisplay) return;

      if (mainDisplay === offDisplay) {
        weaponSet.add(mainDisplay === 'Mace' ? 'Dual Maces' : `${mainDisplay} & ${offDisplay}`);
        return;
      }

      weaponSet.add(`${mainDisplay} & ${offDisplay}`);
    });
  });

  return {
    classes: classNames,
    ascendancies: Array.from(new Set(ascendancies)),
    skills,
    weapons: Array.from(weaponSet)
  };
}

function pickOne(pool) {
  if (!Array.isArray(pool) || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function pickDistinct(pool, count) {
  const arr = Array.isArray(pool) ? [...pool] : [];
  if (!arr.length) return [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

function renderResult(result) {
  const out = document.getElementById('legacy-output');
  if (!out) return;

  if (!result) {
    out.innerHTML = '<div class="legacy-line"><span class="legacy-k">Status:</span> <span class="legacy-v legacy-v--muted">Awaiting legacy roll.</span></div>';
    return;
  }

  const lines = [];
  lines.push(`<div class="legacy-line"><span class="legacy-k">${result.identityLabel}:</span> <span class="legacy-v">${result.identityValue}</span></div>`);
  lines.push(`<div class="legacy-line"><span class="legacy-k">${result.formatLabel}:</span> <span class="legacy-v">${result.formatValues.join(', ')}</span></div>`);
  if (result.damageType) {
    lines.push(`<div class="legacy-line"><span class="legacy-k">Damage Type:</span> <span class="legacy-v">${result.damageType}</span></div>`);
  }
  lines.push(`<div class="legacy-contract">${result.contractLine}</div>`);
  out.innerHTML = lines.join('');
}

function updateControls() {
  const basisBtn = document.getElementById('legacy-basis-btn');
  const formatBtn = document.getElementById('legacy-format-btn');
  const formatLabel = document.getElementById('legacy-format-label');
  const damageToggle = document.getElementById('legacy-damage-toggle');
  const damageText = document.getElementById('legacy-damage-text');

  if (basisBtn) {
    basisBtn.dataset.basis = state.basis;
    basisBtn.setAttribute('aria-label', `Legacy basis: ${state.basis === 'ascendancy' ? 'Ascendancy' : 'Class'}`);
    basisBtn.querySelectorAll('[data-choice]').forEach((el) => {
      const on = el.dataset.choice === state.basis;
      el.classList.toggle('is-on', on);
    });
  }

  if (formatBtn) {
    formatBtn.dataset.formatIndex = String(state.formatIndex);
    formatBtn.setAttribute('aria-label', FORMAT_STATES[state.formatIndex]);
    formatBtn.querySelectorAll('.rm-dotstep__dot').forEach((dot) => {
      const dotIndex = Number(dot.dataset.dot || 0) - 1;
      dot.classList.toggle('is-on', dotIndex <= state.formatIndex);
    });
  }

  if (formatLabel) formatLabel.textContent = FORMAT_STATES[state.formatIndex];
  if (damageToggle) damageToggle.checked = state.damageOn;
  if (damageText) damageText.textContent = state.damageOn ? 'On' : 'Off';
}

function bindControls() {
  const basisBtn = document.getElementById('legacy-basis-btn');
  const formatBtn = document.getElementById('legacy-format-btn');
  const damageToggle = document.getElementById('legacy-damage-toggle');

  basisBtn?.addEventListener('click', () => {
    state.basis = state.basis === 'class' ? 'ascendancy' : 'class';
    persistSettings();
    updateControls();
  });

  formatBtn?.addEventListener('click', () => {
    state.formatIndex = (state.formatIndex + 1) % FORMAT_STATES.length;
    persistSettings();
    updateControls();
  });

  damageToggle?.addEventListener('change', () => {
    state.damageOn = !!damageToggle.checked;
    persistSettings();
    updateControls();
  });

  updateControls();
}

async function handleLegacyRoll({ statusEl } = {}) {
  await ensureDataPreload();
  const data = window.DATA || {};
  const pools = buildLegacyPools(data);

  const identityLabel = state.basis === 'ascendancy' ? 'Ascendancy' : 'Class';
  const identityPool = state.basis === 'ascendancy' ? pools.ascendancies : pools.classes;
  const identityValue = pickOne(identityPool) || 'Unknown';

  const format = FORMAT_STATES[state.formatIndex];
  const wantsWeapons = format === 'Weapons';
  const quantity = wantsWeapons ? 1 : 2;
  const formatLabel = wantsWeapons ? 'Weapons' : 'Skills';
  const formatPool = wantsWeapons ? pools.weapons : pools.skills;
  const formatValues = pickDistinct(formatPool, quantity);
  const damageType = state.damageOn ? pickOne(DAMAGE_TYPES) : null;

  let contractLine = '';
  if (wantsWeapons) {
    const weapon = formatValues[0] || 'Unknown Weapon';
    contractLine = damageType
      ? `Your ${identityValue} must equip only ${weapon} and rely on ${damageType} damage.`
      : `Your ${identityValue} must equip only ${weapon}.`;
  } else {
    const [theme1 = 'Unknown', theme2 = 'Unknown'] = formatValues;
    contractLine = damageType
      ? `Your ${identityValue} must include both ${theme1} and ${theme2} skills, and rely on ${damageType} damage.`
      : `Your ${identityValue} must include both ${theme1} and ${theme2} skills.`;
  }

  const result = {
    identityLabel,
    identityValue,
    formatLabel,
    formatValues,
    damageType,
    contractLine
  };

  state.lastResult = result;
  renderResult(result);

  if (statusEl) statusEl.textContent = '';
  try { document.dispatchEvent(new CustomEvent('randomancer:legacy-roll')); } catch {}
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindControls();
  renderResult(state.lastResult);
});

window.RandomancerHandleLegacyRollOverride = async ({ statusEl } = {}) => {
  try {
    if (statusEl) statusEl.textContent = 'Rolling legacy seed…';
    await handleLegacyRoll({ statusEl });
    return true;
  } catch (err) {
    console.error('[Randomancer][Legacy] roll failed', err);
    if (statusEl) statusEl.textContent = 'Legacy generation failed. Try again.';
    return true;
  }
};

window.RandomancerLegacyHasRoll = () => !!state.lastResult;
window.RandomancerLegacyRenderLast = () => renderResult(state.lastResult);
window.RandomancerLegacyClearRender = () => renderResult(null);
