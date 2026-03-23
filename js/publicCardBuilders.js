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

function limit(list, max = 3) {
  return compactArray(list).slice(0, max);
}

function buildPublicBuildCardRequest(snapshot) {
  const snap = snapshot || {};
  const weaponLabel = formatWeaponLine(snap.weapon, snap.offhand);
  const title = snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' ') || 'Randomancer Build Card';
  const combat = [...compactArray(snap.ailmentList), ...compactArray(snap.tacticList)].slice(0, 3);
  const primarySkills = compactArray(snap.recommendedSkills, (entry) => entry?.name || entry?.id || entry).slice(0, 3);
  const uniqueHighlights = compactArray(snap.recommendedUniques, (entry) => typeof entry === 'string' ? entry : entry?.name).slice(0, 3);
  const cohesionLabels = compactArray([
    snap.defStrat,
    ...(snap.passives?.keystones || []).map((node) => node?.name).filter(Boolean).slice(0, 2),
  ]).slice(0, 3);
  const descriptionBits = [snap.ascendancy || snap.className || '', weaponLabel, ...combat].filter(Boolean);
  const metaTitle = `Randomancer Build Card — ${title}`;
  const metaDescription = descriptionBits.join(' • ').slice(0, 155) || `A shared Randomancer build featuring ${title}.`;

  return {
    schema_version: PUBLIC_CARD_SCHEMA_VERSION,
    card_kind: 'build',
    app_version: APP_VERSION,
    payload: {
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
    },
    card_data: {
      title,
      subtitle: snap.flavor || '',
      ascendancy: snap.ascendancy || '',
      className: snap.className || '',
      weaponLabel,
      primarySkills,
      mechanicTags: limit(combat, 3),
      uniqueHighlights,
      cohesionLabels,
      footerText: 'Randomancer • Shared build artifact',
    },
    meta: {
      title: metaTitle,
      description: metaDescription,
    },
    preview: {
      title: metaTitle,
      subtitle: snap.flavor || undefined,
      description: metaDescription,
      image_kind: 'build'
    }
  };
}

function buildPublicChallengeCardRequest(contract) {
  const safe = contract || {};
  const tasks = compactArray(safe.tasks, (task) => {
    if (!task || typeof task !== 'object') return null;
    return {
      id: task.id || '',
      role: task.role || '',
      shortLabel: task.shortLabel || '',
      line: task.line || '',
      slots: task.slots && typeof task.slots === 'object' ? task.slots : {}
    };
  });
  const title = safe.title || 'Challenge Contract';
  const anchorTask = tasks[0]?.line || '';
  const twistTask = tasks[1]?.line || '';
  const tagChips = compactArray([safe.severity, tasks[0]?.shortLabel, tasks[1]?.shortLabel]).slice(0, 3);
  const description = [anchorTask, twistTask].filter(Boolean).join(' • ').slice(0, 155) || (safe.subtitle || 'Randomancer challenge contract');
  const metaTitle = `Randomancer Challenge Card — ${title}`;

  return {
    schema_version: PUBLIC_CARD_SCHEMA_VERSION,
    card_kind: 'challenge',
    app_version: APP_VERSION,
    payload: {
      contract: {
        mode: 'challenge',
        title: safe.title || '',
        subtitle: safe.subtitle || '',
        severity: safe.severity || 'cruel',
        taskCount: Number(safe.taskCount) || 2,
        tasks,
        challengeFates: safe.challengeFates && typeof safe.challengeFates === 'object'
          ? safe.challengeFates
          : { anchors: { favor: [], ban: [] }, twistCategories: { favor: [], ban: [] } }
      }
    },
    card_data: {
      title,
      subtitle: safe.subtitle || '',
      severity: safe.severity || 'cruel',
      category: tasks[1]?.shortLabel || tasks[0]?.shortLabel || '',
      anchorTask,
      twistTask,
      tagChips,
      footerText: 'Randomancer • Shared challenge artifact',
    },
    meta: {
      title: metaTitle,
      description,
    },
    preview: {
      title: metaTitle,
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
