function getPendingSnapshotReadiness(pendingRoll, latestIdentity, now, sameIdentityFallbackMs) {
  if (!pendingRoll) return { ready: false, retryAfter: null };

  // replaceCurrentDraw is the canonical signal that generation (or restore)
  // completed. A repeated build identity is still a newly generated draw.
  if (pendingRoll.latestSource === 'replace') return { ready: true, retryAfter: null };
  if (latestIdentity && latestIdentity !== pendingRoll.startIdentity) {
    return { ready: true, retryAfter: null };
  }

  const elapsed = now - pendingRoll.startedAt;
  const retryAfter = Math.max(0, sameIdentityFallbackMs - elapsed);
  return retryAfter === 0
    ? { ready: true, retryAfter: null }
    : { ready: false, retryAfter };
}

export { getPendingSnapshotReadiness };
