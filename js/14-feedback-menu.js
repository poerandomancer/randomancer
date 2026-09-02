/* === Feedback link + Mobile header menu (v0.8.2a) === */
(function(){
  function getFeedbackEmbedUrl(){
    return (document.getElementById('feedback-fab')?.dataset?.feedbackEmbedUrl || '').trim();
  }

  let feedbackReturnFocus = null;

  function openFeedback(returnFocus){
    const overlay = document.getElementById('feedback-overlay');
    const frame = document.getElementById('feedback-frame');
    if (!overlay || !frame) return;

    const url = getFeedbackEmbedUrl();
    if (!url || url.includes('REPLACE_ME')) {
      console.warn('[feedback] Please set data-feedback-embed-url on #feedback-fab (index.html).');
      return;
    }

    feedbackReturnFocus = returnFocus || document.activeElement;
    if (!frame.getAttribute('src')) frame.setAttribute('src', url);
    overlay.hidden = false;
    document.getElementById('feedback-close')?.focus?.();
  }

  function closeFeedback(){
    const overlay = document.getElementById('feedback-overlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    feedbackReturnFocus?.focus?.();
    feedbackReturnFocus = null;
  }

  function init(){
    const feedbackFab = document.getElementById('feedback-fab');
    feedbackFab?.addEventListener('click', () => openFeedback(feedbackFab));

    const feedbackOverlay = document.getElementById('feedback-overlay');
    const feedbackClose = document.getElementById('feedback-close');
    feedbackOverlay?.addEventListener('click', (e) => {
      if (e.target === feedbackClose || e.target?.dataset?.close) closeFeedback();
    });

    const menuFab = document.getElementById('header-menu-fab');
    const menu = document.getElementById('header-menu');
    if (!menuFab || !menu) return;

    const isOpen = () => !menu.hidden;

    function openMenu(){
      menu.hidden = false;
      menuFab.setAttribute('aria-expanded', 'true');
      const first = menu.querySelector('.header-menu-item');
      first?.focus?.();
    }

    function closeMenu(){
      menu.hidden = true;
      menuFab.setAttribute('aria-expanded', 'false');
    }

    function toggleMenu(){
      if (isOpen()) closeMenu();
      else openMenu();
    }

    menuFab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener('click', (e) => {
      const item = e.target?.closest?.('.header-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      closeMenu();

      if (action === 'saved') document.getElementById('saved-fab')?.click();
      else if (action === 'info') document.getElementById('info-fab')?.click();
      else if (action === 'feedback') openFeedback(menuFab);
    });

    // Close when clicking anywhere outside the menu / button
    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      const t = e.target;
      if (t === menuFab || menu.contains(t)) return;
      closeMenu();
    });

    // ESC closes the menu
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (feedbackOverlay && !feedbackOverlay.hidden) {
        closeFeedback();
      } else if (isOpen()) {
        closeMenu();
        menuFab.focus?.();
      }
    });

    // If the viewport changes while open, just close it
    window.addEventListener('resize', () => {
      if (isOpen()) closeMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
