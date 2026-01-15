/* === Info Lightbox controller (v0.7.9_beta2m) === */
(function(){
  const $ = (sel)=>document.querySelector(sel);
  const fab = $('#info-fab');
  const overlay = $('#rm-info-overlay');
  const dialog = overlay ? overlay.querySelector('.rm-info-dialog') : null;
  const btnClose = $('#rm-info-close');
  const content = $('#rm-info-content');
  let lastFocus = null;

  function openInfo(){ if(!overlay) return; lastFocus = document.activeElement; overlay.hidden = false; (btnClose||dialog)?.focus?.(); }
  function closeInfo(){ if(!overlay) return; overlay.hidden = true; if(lastFocus && lastFocus.focus) lastFocus.focus(); }

  function onClick(e){ const t=e.target; if(t===btnClose || t?.dataset?.close) closeInfo(); }
  function onKey(e){ if(e.key==='Escape') closeInfo(); }

  fab?.addEventListener('click', openInfo);
  overlay?.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  window.RandomancerInfo = { set(html){ if(content) content.innerHTML = html; }, open: openInfo, close: closeInfo };
})();


/* === Feedback link + Mobile header menu (v0.8.2a) === */
