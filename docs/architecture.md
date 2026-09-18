# Runtime architecture

Standard Build mode has one native pipeline: `drawBuild` selects an ascendancy, a canonical weapon family, and one canonical Offense concept, then calls the package selector and installs one `currentDraw`. Completion is announced once with `randomancer:draw-complete`.

Challenge and Codex are the two alternate supported modes. Any unknown, stale URL, or persisted mode value is normalized to standard Build mode.

Saved builds, build codes, and public Build Cards accept only `randomancer-draw-v1`. No migration adapters or old standard generator fallback are loaded.
