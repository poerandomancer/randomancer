/* === Feedback modal controller (v0.8.2a) === */
(function(){
  // Verified Google Forms integration contract. Keep these opaque field IDs and
  // exact option values together; the poll intentionally submits nothing else.
  const FORM_ACTION = 'https://docs.google.com/forms/u/0/d/e/1FAIpQLScmlkvdZzaSooFc8f9D38v_RKLOx5OUAmSweqI7lDuqxx0oNQ/formResponse';
  const RATING_FIELD = 'entry.1168955398';
  const FEATURE_FIELD = 'entry.2076910548';
  const TEXT_FIELD = 'entry.1192568472';
  const FEATURE_OPTIONS = [
    'Defensive Build Recommendations',
    'Passive Tree Visualization',
    'A Randomancer Discord Community',
    'Better Build Sharing'
  ];

  let feedbackReturnFocus = null;
  let submissionPending = false;
  let submissionComplete = false;

  function showFeedbackForm(){
    document.getElementById('feedback-form-view').hidden = false;
    document.getElementById('feedback-success').hidden = true;
    submissionComplete = false;
  }

  function openFeedback(returnFocus){
    const overlay = document.getElementById('feedback-overlay');
    if (!overlay) return;

    feedbackReturnFocus = returnFocus || document.activeElement;
    if (submissionComplete) showFeedbackForm();
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

    const feedbackForm = document.getElementById('feedback-form');
    const feedbackSubmit = document.getElementById('feedback-submit');
    const feedbackTarget = document.getElementById('feedback-submit-target');
    const ratingInputs = Array.from(document.querySelectorAll('.feedback-stars input'));
    const featureInputs = Array.from(document.querySelectorAll('.feedback-features input'));
    const feedbackText = document.getElementById('feedback-text');

    if (feedbackForm) {
      feedbackForm.action = FORM_ACTION;
      ratingInputs.forEach((input, index) => {
        input.name = RATING_FIELD;
        input.value = String(index + 1);
      });
      featureInputs.forEach((input, index) => {
        input.name = FEATURE_FIELD;
        input.value = FEATURE_OPTIONS[index];
      });
      if (feedbackText) feedbackText.name = TEXT_FIELD;

      const updateStars = (rating) => {
        document.querySelectorAll('.feedback-stars label').forEach((star, index) => {
          star.textContent = index < rating ? '★' : '☆';
          star.classList.toggle('is-selected', index < rating);
        });
      };
      ratingInputs.forEach((input) => input.addEventListener('change', () => updateStars(Number(input.value))));
      document.querySelectorAll('.feedback-stars label').forEach((star, index) => {
        star.addEventListener('pointerenter', () => updateStars(index + 1));
      });
      document.querySelector('.feedback-stars')?.addEventListener('pointerleave', () => {
        updateStars(Number(ratingInputs.find((input) => input.checked)?.value || 0));
      });

      feedbackForm.addEventListener('submit', (event) => {
        if (submissionPending) {
          event.preventDefault();
          return;
        }
        submissionPending = true;
        feedbackSubmit.disabled = true;
        feedbackSubmit.textContent = 'Submitting…';
        feedbackSubmit.setAttribute('aria-busy', 'true');
      });

      feedbackTarget?.addEventListener('load', () => {
        // The response is cross-origin, so load confirms completion of the
        // navigation only; the returned Google page cannot be inspected.
        if (!submissionPending) return;
        submissionPending = false;
        submissionComplete = true;
        feedbackSubmit.disabled = false;
        feedbackSubmit.textContent = 'Submit Feedback';
        feedbackSubmit.removeAttribute('aria-busy');
        feedbackForm.reset();
        updateStars(0);
        document.getElementById('feedback-form-view').hidden = true;
        const success = document.getElementById('feedback-success');
        success.hidden = false;
        success.focus?.();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && feedbackOverlay && !feedbackOverlay.hidden) closeFeedback();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
