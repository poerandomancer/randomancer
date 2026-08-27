// Recommendation context derived exclusively from the canonical draw.
function buildBuildContext(draw = window.App?.state?.currentDraw || {}) {
  const offense = draw.offenseSet || [];
  return {
    className: draw.className || '', ascendancy: draw.ascendancy || '', passiveTreeStart: draw.passiveTreeStart || '',
    weapon: draw.weaponFamily || draw.weapon || '', offhand: '', defense: '', defensiveStrategy: '',
    attributes: draw.attributes || {}, offense,
    tags: new Set([...(draw.offenseTags || []), ...offense.flatMap((entry) => entry.tags || [])])
  };
}
export { buildBuildContext };
