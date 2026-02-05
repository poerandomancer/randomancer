import { renderOathAwareText } from './01-meta-and-domready.js';
import { getBindFatesFromApp } from './04-app-state.js';
import { sliderValueToThreshold, thresholdToSliderValue } from './06-cohesion.js';
import { ensureDataPreload } from './08-data-load.js';

function countBindFatesSelections(bind){
  const counts = { oaths: 0, abominations: 0 };
  Object.values(bind || {}).forEach((cfg) => {
    counts.oaths += Array.isArray(cfg?.oaths) ? cfg.oaths.length : 0;
    counts.abominations += Array.isArray(cfg?.abominations) ? cfg.abominations.length : 0;
  });
  return counts;
}

function updateBindFatesSummary(){
  const bf = window.App?.getBindFates ? window.App.getBindFates() : getBindFatesFromApp();
  const summaryEl = document.getElementById('bind-fates-summary');
  const counts = countBindFatesSelections(bf);
  if (summaryEl) {
    summaryEl.textContent = (counts.oaths + counts.abominations) > 0
      ? `${counts.oaths} Oath${counts.oaths === 1 ? '' : 's'} | ${counts.abominations} Abomination${counts.abominations === 1 ? '' : 's'}`
      : 'No Fates Bound';
  }
}

function showBindFatesError(msg){
  const el = document.getElementById('bind-fates-error');
  if (!el) return;
  el.textContent = msg || '';
}

if (typeof window !== 'undefined') {
  window.showBindFatesError = showBindFatesError;
}

// ---------- wireup ----------
document.addEventListener('DOMContentLoaded', ()=>{
    const slider = document.getElementById('cohesionRange');
	
	  const applyThreshold = (t) => {
		// sync App.state
		if (window.App && typeof window.App.setCohesion === 'function') {
		  window.App.setCohesion(t);
		}
	  };
	
	  if (slider) {
		let initialThreshold = 3/4;
		try {
		  const st = window.App && window.App.state;
		  if (st && typeof st.cohesionThreshold === 'number') {
			initialThreshold = st.cohesionThreshold;
		  }
		} catch (e) {}

	
		slider.value = String(thresholdToSliderValue(initialThreshold));
		applyThreshold(initialThreshold);
	
                slider.addEventListener('input', (e) => {
                  const t = sliderValueToThreshold(e.target.value);
                  applyThreshold(t);
                });
          }

  const bindBar     = document.getElementById('bind-fates-bar');
  const toggleBtn   = bindBar?.querySelector('.bind-fates-toggle');
  const clearBtn    = document.getElementById('bind-fates-clear');

  const modal         = document.getElementById('bind-fates-modal');
  const modalBackdrop = modal?.querySelector('.bind-fates-backdrop');
  const modalClose    = document.getElementById('bind-fates-close');
  const modalSections = {
    ascendancy: document.getElementById('bind-fates-list-ascendancy'),
    weapon: document.getElementById('bind-fates-list-weapon'),
    combat: document.getElementById('bind-fates-list-combat'),
  };
  let originButton = null;

  const resolveData = async () => {
    const fromState = (window.App && window.App.state && window.App.state.DATA) || window.DATA;
    if (fromState) return fromState;
    try {
      const preload = await ensureDataPreload();
      return preload?.core || preload;
    } catch (e) {
      console.error('[BindFates] Unable to resolve data', e);
      return null;
    }
  };

  const cycleOptionState = (btn) => {
    if (!btn) return;
    if (btn.classList.contains('is-oath')) {
      btn.classList.remove('is-oath');
      btn.classList.add('is-abomination');
    } else if (btn.classList.contains('is-abomination')) {
      btn.classList.remove('is-abomination');
    } else {
      btn.classList.add('is-oath');
    }
  };

  const renderOptions = (options, cfg, listEl) => {
    if (!listEl) return;
    listEl.innerHTML = '';
    options.forEach((opt) => {
      const name = typeof opt === 'string' ? opt : opt?.name;
      if (!name) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bind-option';
      btn.dataset.name = name;
      if (opt?.kind) btn.dataset.kind = opt.kind;
      if (cfg?.oaths?.includes(name)) btn.classList.add('is-oath');
      else if (cfg?.abominations?.includes(name)) btn.classList.add('is-abomination');
      btn.textContent = name;
      btn.addEventListener('click', () => cycleOptionState(btn));
      listEl.appendChild(btn);
    });
  };

  const buildOptions = (category, data) => {
    if (category === 'ascendancy') {
      const ascSet = new Set();
      Object.values(data.Classes || {}).forEach((cls) => {
        (cls?.ascendancies || []).forEach((name) => ascSet.add(name));
      });
      return Array.from(ascSet).sort();
    }
    if (category === 'weapon') {
      const two = Array.isArray(data.Weapons?.['Two-Handed']) ? data.Weapons['Two-Handed'] : [];
      const one = Array.isArray(data.Weapons?.['One-Handed']) ? data.Weapons['One-Handed'] : [];
      return [...two, ...one].map((w) => w.name);
    }
    if (category === 'combat') {
      const ail = (data.Ailments || []).map((a) => ({ name: a.name, kind: 'ailment' }));
      const tac = (data.Tactics || []).map((t) => ({ name: t.name, kind: 'tactic' }));
      return [...ail, ...tac];
    }
    return [];
  };

  const openBindFatesModal = async (originBtn) => {
    const data = await resolveData();
    if (!modal || !data) return;
    originButton = originBtn || null;

    const current = window.App?.getBindFates ? window.App.getBindFates() : getBindFatesFromApp();
    Object.entries(modalSections).forEach(([category, listEl]) => {
      const cfg = current?.[category] || { oaths: [], abominations: [] };
      const options = buildOptions(category, data);
      renderOptions(options, cfg, listEl);
    });

    modal.hidden = false;
    (modal.querySelector('.bind-option') || modalClose || modal)?.focus?.();
  };

  const persistBindFatesSelection = () => {
    Object.entries(modalSections).forEach(([category, listEl]) => {
      if (!listEl) return;
      const oaths = [];
      const abominations = [];
      listEl.querySelectorAll('.bind-option').forEach((opt) => {
        const name = opt?.dataset?.name;
        if (!name) return;
        if (opt.classList.contains('is-oath')) oaths.push(name);
        else if (opt.classList.contains('is-abomination')) abominations.push(name);
      });

      if (window.App?.setBindFatesCategory) {
        window.App.setBindFatesCategory(category, { oaths, abominations });
      } else if (window.App?.state?.bindFates?.[category]) {
        window.App.state.bindFates[category] = { oaths, abominations };
      }
    });
  };

  const clearBindFatesSelections = () => {
    Object.keys(modalSections).forEach((category) => {
      if (window.App?.setBindFatesCategory) {
        window.App.setBindFatesCategory(category, { oaths: [], abominations: [] });
      } else if (window.App?.state?.bindFates?.[category]) {
        window.App.state.bindFates[category] = { oaths: [], abominations: [] };
      }
      const listEl = modalSections[category];
      listEl?.querySelectorAll('.bind-option').forEach((opt) => {
        opt.classList.remove('is-oath', 'is-abomination');
      });
    });
    updateBindFatesSummary();
    showBindFatesError('');
  };

  const closeBindFatesModal = () => {
    if (!modal) return;
    persistBindFatesSelection();
    modal.hidden = true;
    updateBindFatesSummary();
    showBindFatesError('');
    if (originButton?.focus) originButton.focus();
    originButton = null;
  };

  modalClose?.addEventListener('click', closeBindFatesModal);
  modalBackdrop?.addEventListener('click', closeBindFatesModal);
  modal?.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      evt.preventDefault();
      closeBindFatesModal();
    }
  });

  toggleBtn?.addEventListener('click', () => openBindFatesModal(toggleBtn));
  clearBtn?.addEventListener('click', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    clearBindFatesSelections();
  });

  updateBindFatesSummary();

   // Kick off preloading early and hydrate App.state from it
	  if (window.App && typeof window.App.bootstrap === 'function') {
		window.App.bootstrap().catch(err => {
		  console.error("[Randomancer] App bootstrap failed", err);
		});
	  } else {
		// Fallback: just preload data as before
		ensureDataPreload().catch(err => {
		  console.error("[Randomancer] Preload on DOMContentLoaded failed", err);
		});
	  }

});

export { showBindFatesError };

// ---------- data initialization ----------
