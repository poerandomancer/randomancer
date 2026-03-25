/* === Feedback link + Mobile header menu (v0.8.2a) === */
(function(){
  function getFeedbackUrl(){
    return (document.getElementById('feedback-fab')?.dataset?.feedbackUrl || '').trim();
  }

  function openFeedback(){
    const url = getFeedbackUrl();
    if (!url || url.includes('REPLACE_ME')) {
      console.warn('[feedback] Please set data-feedback-url on #feedback-fab (index.html).');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function init(){
    const feedbackFab = document.getElementById('feedback-fab');
    feedbackFab?.addEventListener('click', openFeedback);

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

      if (action === 'trending') document.getElementById('trending-fab')?.click();
      else if (action === 'saved') document.getElementById('saved-fab')?.click();
      else if (action === 'info') document.getElementById('info-fab')?.click();
      else if (action === 'feedback') openFeedback();
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
      if (e.key === 'Escape' && isOpen()) {
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
