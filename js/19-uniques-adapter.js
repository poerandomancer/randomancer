import { TagUtils } from './05-tags-and-scorer.js';

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

const TAG_ALIAS = new Map([
  ['armorbreak', ['armourbreak']],
  ['allresistance', ['all_elemental_resistance']],
  ['elementalresistance', ['all_elemental_resistance']],
  ['movespeed', ['movement_speed']],

  // Requested build-mode normalization aliases
  ['critical_weakness', ['critical_hit', 'critical']],
  ['critical_damage_bonus', ['critical_hit', 'critical']],
  ['electrocution', ['shock']],
  ['decimating_strike', ['culling_strike', 'cull']],
  ['culled', ['cull', 'culling_strike']],
  ['exposure', ['ignite', 'chill', 'shock']],
  ['elemental_ailment', ['ignite', 'chill', 'shock']],
  ['elemental_damage', ['ignite', 'chill', 'shock']],
  ['shocked_ground', ['shock']],
  ['thorns_damage', ['thorns']],
  ['chance_to_block', ['block']]
]);

function normalizeUniqueSlot(slotLabel) {
  const key = String(slotLabel || '').trim().toLowerCase();
  return SLOT_MAP.get(key) || null;
}

function normalizeUniqueTagsForBuild(tags) {
  const src = Array.isArray(tags) ? tags : [];
  const raw = new Set();

  src.forEach((tag) => {
    const cleaned = String(tag || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleaned) return;
    raw.add(cleaned);

    const aliasTo = TAG_ALIAS.get(cleaned) || TAG_ALIAS.get(TagUtils.norm(cleaned));
    if (Array.isArray(aliasTo)) aliasTo.forEach((mapped) => raw.add(mapped));
  });

  return Array.from(raw);
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
      raw: normalizeUniqueTagsForBuild(record?.tags),
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
