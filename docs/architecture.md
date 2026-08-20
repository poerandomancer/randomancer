# Runtime architecture

Standard Build mode has one native pipeline: `drawBuild` selects an ascendancy, a canonical weapon family, and one or two canonical Offense concepts, then calls the package selector and installs one `currentDraw`. Completion is announced once with `randomancer:draw-complete`.

Challenge, Codex, and Legacy are independent supported modes. Legacy mode is intentionally an old-school product experience; it is not a compatibility reader for retired Build schemas.

Saved builds, build codes, and public Build Cards accept only `randomancer-draw-v1`. No migration adapters or old standard generator fallback are loaded.
