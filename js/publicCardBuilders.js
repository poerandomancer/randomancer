import { APP_VERSION, formatWeaponLine } from './01-meta-and-domready.js';
import { getClassIconPath } from './ascendancy-visuals.js';

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
  const recommendation = entry.recommendationPackage;
  if (recommendation && typeof recommendation === 'object') {
    const supports = compactArray(recommendation.supports, (support) => {
      if (!support) return null;
      if (typeof support === 'string') return { name: support };
      const compact = {};
      if (support.sourceId || support.id) compact.sourceId = support.sourceId || support.id;
      if (support.name) compact.name = support.name;
      if (support.familyId) compact.familyId = support.familyId;
      if (support.tier != null) compact.tier = support.tier;
      return Object.keys(compact).length ? compact : null;
    }).slice(0, 2);
    out.recommendationPackage = {
      ...(recommendation.assignedRole ? { assignedRole: recommendation.assignedRole } : {}),
      ...(supports.length ? { supports } : {})
    };
  }
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
    id: node.id || '',
    name: node.name || '',
    recommendationEvidence: node.recommendationEvidence || undefined,
    lines: compactArray(node.lines),
    tags: compactArray(node.tags),
    icon: node.icon || ''
  };
}

function pickPassives(passives) {
  if (!passives || typeof passives !== 'object') return null;
  return {
    ascendancyNodes: compactArray(passives.ascendancyNodes, pickPassiveNode),
    notables: compactArray(passives.notables, pickPassiveNode),
  };
}

function limit(list, max = 3) {
  return compactArray(list).slice(0, max);
}

function normalizeBuildSnapshotForShare(snapshot) {
  const draw = snapshot && typeof snapshot === 'object' ? snapshot : {};
  if (draw.schema !== 'randomancer-draw-v1') throw new Error('Only current Randomancer draws can be shared.');
  return JSON.parse(JSON.stringify(draw));
}

function buildFrontFaceGroups(snapshot, weaponLabel) {
  const snap = snapshot || {};
  const groups = [
    { label: 'Ascendancy', values: compactArray([snap.ascendancy || snap.className]).slice(0, 1) },
    { label: 'Weapon', values: compactArray([weaponLabel]).slice(0, 1) },
    { label: 'Offense', values: compactArray(snap.offenseList).slice(0, 2) },
    { label: 'Skills', values: compactArray(snap.recommendedSkills, (entry) => entry?.name || entry?.id || entry).slice(0, 2) },
  ];
  return groups.filter((group) => group.values.length);
}

function buildPublicBuildCardRequest(snapshot) {
  const snap = normalizeBuildSnapshotForShare(snapshot);
  const weaponLabel = snap.weaponFamily || snap.weapon || '';
  const title = snap.buildName || [snap.className, snap.ascendancy].filter(Boolean).join(' ') || 'Randomancer Build Card';
  const offense = compactArray(snap.offenseList).slice(0, 2);
  const frontFaceGroups = buildFrontFaceGroups(snap, weaponLabel);
  const descriptionBits = [snap.ascendancy || snap.className || '', weaponLabel, ...offense].filter(Boolean);
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
        weapon: snap.weapon || '',
        offhand: snap.offhand || '',
        weapon2: snap.weapon2 || '',
        offhand2: snap.offhand2 || '',
        ailments: snap.ailmentList,
        tactics: snap.tacticList,
        buildName: snap.buildName || '',
        flavor: snap.flavor || '',
        attributes: snap.attributes,
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
      ascendancyArtPath: getClassIconPath(snap.className, snap.ascendancy),
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


export {
  PUBLIC_CARD_SCHEMA_VERSION,
  buildPublicBuildCardRequest,
};
