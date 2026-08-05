import { expandCanonicalTag, toMatchKey } from './tag-normalization.js';

const SLOT_MAP = new Map([
  ['body armour', 'body'],
  ['helmet', 'helmet'],
  ['gloves', 'gloves'],
  ['boots', 'boots'],
  ['ring', 'ring'],
  ['amulet', 'amulet'],
  ['talisman', 'talisman'],
  ['belt', 'belt'],
  ['jewel', 'jewel'],
  ['flask', 'flask'],
  ['charm', 'flask'],
  ['tincture', 'tincture'],
  ['bow', 'bow'],
  ['crossbow', 'crossbow'],
  ['staff', 'staff'],
  ['quarterstaff', 'staff'],
  ['spear', 'spear'],
  ['sword', 'sword'],
  ['mace', 'mace'],
  ['axe', 'axe'],
  ['claw', 'claw'],
  ['wand', 'wand'],
  ['sceptre', 'sceptre'],
  ['shield', 'shield'],
  ['buckler', 'buckler'],
  ['focus', 'focus'],
  ['quiver', 'quiver'],
  ['trap tool', 'traptool'],
  ['traptool', 'traptool'],
  ['soul core', 'soulcore'],
  ['soulcore', 'soulcore']
]);

const FACTION_SLOT_PREFIX_RE = /^(?:ezomyte|kalguuran|vaal)\s+/;


function normalizeUniqueSlot(slotLabel) {
  const key = String(slotLabel || '').trim().toLowerCase();
  const direct = SLOT_MAP.get(key);
  if (direct) return direct;

  const unqualified = key.replace(FACTION_SLOT_PREFIX_RE, '');
  return SLOT_MAP.get(unqualified) || null;
}

function normalizeUniqueTagsForBuild(tags) {
  const source = Array.isArray(tags) ? tags : [];
  const canonical = new Set();

  source.forEach((tag) => {
    expandCanonicalTag(tag).forEach((value) => canonical.add(value));
  });

  const raw = Array.from(canonical);
  return {
    raw,
    normalized: raw.map((t) => toMatchKey(t)).filter(Boolean)
  };
}

function formatGrantedSkillLine(skill) {
  if (!skill) return null;
  if (typeof skill === 'string') return `Grants Skill: ${skill}`;

  const skillName = String(skill.name || skill.raw || '').trim();
  if (!skillName) return null;
  return `Grants Skill: ${skillName}`;
}

function transformPoe2dbUnique(record) {
  const name = String(record?.name || '').trim();
  if (!name) return null;

  const base = String(record?.base || '').trim();
  const slot = normalizeUniqueSlot(record?.slot || base);
  if (!slot) return null;

  const implicitMods = Array.isArray(record?.implicit_mods) ? record.implicit_mods.filter(Boolean) : [];
  const explicitMods = Array.isArray(record?.explicit_mods) ? record.explicit_mods.filter(Boolean) : [];
  const grantedSkills = Array.isArray(record?.granted_skills) ? record.granted_skills.filter(Boolean) : [];
  const flavourText = Array.isArray(record?.flavour_text) ? record.flavour_text.filter(Boolean) : [];

  const lines = [
    name,
    base,
    ...implicitMods,
    ...explicitMods,
    ...grantedSkills.map(formatGrantedSkillLine).filter(Boolean),
    ...flavourText
  ];

  return {
    id: record?.key || `${name}::${base || slot}`,
    name,
    base,
    slot,
    lines,
    tags: {
      ...normalizeUniqueTagsForBuild(record?.tags),
      canonical: []
    },
    requirements: record?.requirements || {},
    granted_skills: grantedSkills,
    source: record?.source || {},
    meta: {
      source_slot: record?.slot || '',
      key: record?.key || '',
      implicit_mods: implicitMods,
      explicit_mods: explicitMods,
      flavour_text: flavourText,
      source_url: record?.source?.url || '',
      source_id: record?.source?.id || ''
    }
  };
}

function adaptPoe2dbUniquesPayload(payload) {
  const rawItems = payload?.items;
  const list = Array.isArray(rawItems)
    ? rawItems
    : (rawItems && typeof rawItems === 'object')
      ? Object.values(rawItems)
      : [];

  return list
    .map((record) => transformPoe2dbUnique(record))
    .filter(Boolean);
}

export {
  adaptPoe2dbUniquesPayload,
  normalizeUniqueSlot,
  normalizeUniqueTagsForBuild,
  transformPoe2dbUnique
};
