import { APP_VERSION, formatWeaponLine } from './01-meta-and-domready.js';

const PUBLIC_CARD_SCHEMA_VERSION = 'public-card.v1';

function compactArray(list, mapFn) {
  const values = Array.isArray(list) ? list.map(mapFn || ((item) => item)).filter((item) => item != null && item !== '') : [];
  return values.length ? values : [];
}

function pickGemRef(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { name: entry };
  const out = {};
  if (entry.id) out.id = entry.id;
  if (entry.name) out.name = entry.name;
  if (Array.isArray(entry.recommended_supports) && entry.recommended_supports.length) {
    out.recommended_supports = compactArray(entry.recommended_supports, (support) => {
      if (!support) return null;
      if (typeof support === 'string') return support;
      return support.id || support.name || null;
    });
  }
  return Object.keys(out).length ? out : null;
}

function pickPassiveNode(node) {
  if (!node || typeof node !== 'object') return null;
  return {
    name: node.name || '',
    lines: compactArray(node.lines),
    tags: compactArray(node.tags),
    icon: node.icon || ''
  };
}

function pickPassives(passives) {
  if (!passives || typeof passives !== 'object') return null;
  return {
    ascendancyNodes: compactArray(passives.ascendancyNodes, pickPassiveNode),
    keystones: compactArray(passives.keystones, pickPassiveNode),
    notables: compactArray(passives.notables, pickPassiveNode),
  };
}

function buildPublicBuildCardRequest(snapshot) {
  const snap = snapshot || {};
  const payload = {
    snapshot: {
      snapshotVersion: snap.snapshotVersion || 1,
      className: snap.className || '',
      ascendancy: snap.ascendancy || '',
      ascendancyId: snap.ascendancyId ?? null,
      defense: snap.defense || '',
      defStrat: snap.defStrat || '',
      weapon: snap.weapon || '',
      offhand: snap.offhand || '',
      weapon2: snap.weapon2 || '',
      offhand2: snap.offhand2 || '',
      ailments: compactArray(snap.ailmentList),
      tactics: compactArray(snap.tacticList),
      buildName: snap.buildName || '',
      flavor: snap.flavor || '',
      attributes: snap.attributes || { strength: 0, dexterity: 0, intelligence: 0 },
      recommendedSkills: compactArray(snap.recommendedSkills, pickGemRef),
      recommendedSkills2: compactArray(snap.recommendedSkills2, pickGemRef),
      synergySupports: compactArray(snap.synergySupports, (entry) => typeof entry === 'string' ? entry : (entry?.id || entry?.name || null)),
      synergySupports2: compactArray(snap.synergySupports2, (entry) => typeof entry === 'string' ? entry : (entry?.id || entry?.name || null)),
      recommendedPersistentBuff: pickGemRef(snap.recommendedPersistentBuff),
      recommendedUniques: compactArray(snap.recommendedUniques, (entry) => typeof entry === 'string' ? entry : (entry?.name || null)),
      passives: pickPassives(snap.passives),
    }
  };

  const title = snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' ') || 'Randomancer Build Card';
  const combat = [...compactArray(snap.ailmentList), ...compactArray(snap.tacticList)].slice(0, 3).join(' · ');
  const descriptionBits = [
    snap.ascendancy || snap.className || '',
    formatWeaponLine(snap.weapon, snap.offhand),
    combat,
  ].filter(Boolean);

  return {
    schema_version: PUBLIC_CARD_SCHEMA_VERSION,
    card_kind: 'build',
    app_version: APP_VERSION,
    payload,
    preview: {
      title,
      subtitle: snap.flavor || undefined,
      description: descriptionBits.join(' • ') || title,
      image_kind: 'build'
    }
  };
}

function buildPublicChallengeCardRequest(contract) {
  const safe = contract || {};
  const payload = {
    contract: {
      mode: 'challenge',
      title: safe.title || '',
      subtitle: safe.subtitle || '',
      severity: safe.severity || 'cruel',
      taskCount: Number(safe.taskCount) || 2,
      tasks: compactArray(safe.tasks, (task) => {
        if (!task || typeof task !== 'object') return null;
        return {
          id: task.id || '',
          role: task.role || '',
          shortLabel: task.shortLabel || '',
          line: task.line || '',
          slots: task.slots && typeof task.slots === 'object' ? task.slots : {}
        };
      }),
      challengeFates: safe.challengeFates && typeof safe.challengeFates === 'object'
        ? safe.challengeFates
        : { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } }
    }
  };
  const description = compactArray(safe.tasks, (task) => task?.line).slice(0, 2).join(' • ') || (safe.subtitle || 'Randomancer challenge contract');
  return {
    schema_version: PUBLIC_CARD_SCHEMA_VERSION,
    card_kind: 'challenge',
    app_version: APP_VERSION,
    payload,
    preview: {
      title: safe.title || 'Challenge Contract',
      subtitle: safe.subtitle || undefined,
      description,
      image_kind: 'challenge'
    }
  };
}

export {
  PUBLIC_CARD_SCHEMA_VERSION,
  buildPublicBuildCardRequest,
  buildPublicChallengeCardRequest,
};
