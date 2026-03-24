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

function getAscendancyArtPath(ascendancy) {
  if (!ascendancy) return '';
  return `/images/ascendancies/${String(ascendancy).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.webp`;
}

function normalizeBuildSnapshotForShare(snapshot) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const normalized = {
    snapshotVersion: Number(snap.snapshotVersion) || 1,
    className: snap.className || '',
    ascendancy: snap.ascendancy || '',
    ascendancyId: snap.ascendancyId ?? null,
    defense: snap.defense || '',
    defStrat: snap.defStrat || '',
    weapon: snap.weapon || '',
    offhand: snap.offhand || '',
    weapon2: snap.weapon2 || '',
    offhand2: snap.offhand2 || '',
    ailmentList: compactArray(snap.ailmentList),
    tacticList: compactArray(snap.tacticList),
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
  };
  return normalized;
}

function buildFrontFaceGroups(snapshot, weaponLabel) {
  const snap = snapshot || {};
  const groups = [
    { label: 'Ascendancy', values: compactArray([snap.ascendancy || snap.className]).slice(0, 1) },
    { label: 'Weapons', values: compactArray([weaponLabel]).slice(0, 2) },
    { label: 'Combat', values: compactArray([...(snap.ailmentList || []), ...(snap.tacticList || [])]).slice(0, 3) },
    { label: 'Defense', values: compactArray([snap.defStrat || snap.defense]).slice(0, 2) },
    { label: 'Skills', values: compactArray(snap.recommendedSkills, (entry) => entry?.name || entry?.id || entry).slice(0, 2) },
  ];
  return groups.filter((group) => group.values.length);
}

function buildPublicBuildCardRequest(snapshot) {
  const snap = normalizeBuildSnapshotForShare(snapshot);
  const weaponLabel = formatWeaponLine(snap.weapon, snap.offhand);
  const title = snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' ') || 'Randomancer Build Card';
  const combat = [...compactArray(snap.ailmentList), ...compactArray(snap.tacticList)].slice(0, 3);
  const frontFaceGroups = buildFrontFaceGroups(snap, weaponLabel);
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
        ailments: snap.ailmentList,
        tactics: snap.tacticList,
        buildName: snap.buildName || '',
        flavor: snap.flavor || '',
        attributes: snap.attributes || { strength: 0, dexterity: 0, intelligence: 0 },
        recommendedSkills: snap.recommendedSkills,
        recommendedSkills2: snap.recommendedSkills2,
        synergySupports: snap.synergySupports,
        synergySupports2: snap.synergySupports2,
        recommendedPersistentBuff: snap.recommendedPersistentBuff,
        recommendedUniques: snap.recommendedUniques,
        passives: snap.passives,
      }
    },
    card_data: {
      cardTypeLabel: 'Randomancer Build Card',
      title,
      subtitle: snap.flavor || '',
      ascendancy: snap.ascendancy || '',
      ascendancyArtPath: getAscendancyArtPath(snap.ascendancy),
      className: snap.className || '',
      weaponLabel,
      frontFaceGroups
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
  const anchor = tasks.find((task) => task.role === 'anchor') || tasks[0] || null;
  const twist = tasks.find((task) => task.role === 'twist') || tasks[1] || null;
  const anchorShortLabel = anchor?.shortLabel || anchor?.label || anchor?.shortName || anchor?.name || 'Anchor';
  const twistShortLabel = twist?.shortLabel || twist?.label || twist?.shortName || twist?.name || 'Twist';
  const anchorTask = anchor?.line || '';
  const twistTask = twist?.line || '';
  const tagChips = compactArray([safe.severity, anchor?.shortLabel, twist?.shortLabel]).slice(0, 3);
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
      category: twist?.shortLabel || anchor?.shortLabel || '',
      anchorShortLabel,
      twistShortLabel,
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
