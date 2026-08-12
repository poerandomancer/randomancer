/* Final motion cleanup for the primary Build Card stage.
 *
 * Rerolling from Build Ideas should not first flip the outgoing card back to the
 * Build face. Preserve the visible back face while the primary-stage controller
 * samples roll state, then restore the dataset immediately after the click. The
 * existing reroll choreography can therefore move that card aside as-is and
 * still reveal the incoming card on its canonical Build face.
 */

const STAGE_ID = 'primary-build-card-stage';
const MOUNT_ID = 'primary-build-card-mount';

function isBuildMode() {
  const mode = document.body?.dataset?.mode;
  return !mode || mode === 'build';
}

function preserveIdeasFaceOnReroll(event) {
  const roll = event.target?.closest?.('#roll');
  if (!roll || !isBuildMode()) return;

  const stage = document.getElementById(STAGE_ID);
  const mount = document.getElementById(MOUNT_ID);
  if (stage?.dataset?.cardState !== 'result' || mount?.dataset?.cardFace !== 'back') return;

  // The primary-stage roll listener runs later in the same capture path on the
  // Roll button. Let it see a front-state marker so it skips the outgoing
  // normalization flip, while leaving the actual rendered Build Ideas face
  // untouched. Restore the marker after the event completes.
  mount.dataset.cardFace = 'front';
  queueMicrotask(() => {
    if (mount.isConnected && mount.dataset.cardFace === 'front') {
      mount.dataset.cardFace = 'back';
    }
  });
}

document.addEventListener('click', preserveIdeasFaceOnReroll, true);
