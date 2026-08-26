function getCoreBuildOffenseInventory(data) {
  return {
    ailments: Array.isArray(data?.Ailments) ? data.Ailments : [],
    tactics: Array.isArray(data?.Tactics) ? data.Tactics : []
  };
}

function getCoreBuildOffenseOptions(data) {
  const { ailments, tactics } = getCoreBuildOffenseInventory(data);
  return [
    ...ailments.map((item) => ({ name: item?.name, kind: 'ailment' })),
    ...tactics.map((item) => ({ name: item?.name, kind: 'tactic' }))
  ].filter((item) => item.name);
}

function getBindFatesOffenseOptions(data) {
  return getCoreBuildOffenseOptions(data);
}

export {
  getCoreBuildOffenseInventory,
  getCoreBuildOffenseOptions,
  getBindFatesOffenseOptions
};
