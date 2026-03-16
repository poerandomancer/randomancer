// Shared tag normalization helpers.
// TODO(phase2): auto-generate this JS mirror from data/tag_normalization_rules.json.

const RULES = {
  aliases_to_canonical: {
    critical: 'crit',
    'damage over time': 'dot',
    damageovertime: 'dot',
    marks: 'mark',
    armorbreak: 'armour_break',
    'heavy stun': 'heavy_stun',
    heavystun: 'heavy_stun',
    'life regeneration': 'life_regeneration',
    'culling strike': 'culling_strike',
    'block recovery': 'block_recovery',
    bleeding: 'bleed',
    bled: 'bleed',
    shocked: 'shock',
    shocking: 'shock',
    ignited: 'ignite',
    igniting: 'ignite',
    poisoned: 'poison',
    poisoning: 'poison',
    recouped: 'recoup',
    recouping: 'recoup',
    minions: 'minion',
    charges: 'charge',
    corpses: 'corpse',
    attributes: 'attribute',
    flasks: 'flask',
    charms: 'charm',
    armourbreak: 'armour_break',
    heavystun: 'heavy_stun',
    liferegeneration: 'life_regeneration',
    cullingstrike: 'culling_strike',
    criticalhit: 'critical_hit',
    blockchance: 'chance_to_block',
    block_chance: 'chance_to_block',
    critical_strike: 'critical_hit',
    totems: 'totem',
    traps: 'trap',
    mines: 'mine',
    curses: 'curse',
    warcries: 'warcry',
    ignites: 'ignite',
    poisons: 'poison',
    shocks: 'shock',
    freezes: 'freeze',
    frozen: 'freeze',
    chilled: 'chill',
    stunned: 'stun',
    attacks: 'attack',
    spells: 'spell',
    projectiles: 'projectile',
    hits: 'hit',
    leeches: 'leech',
    blocked: 'block',
    blocking: 'block',
    power_charges: 'power_charge',
    frenzy_charges: 'frenzy_charge',
    heavy_stuns: 'heavy_stun',
    heavy_stunned: 'heavy_stun',
    light_stunned: 'light_stun',
    breaks_armour: 'armour_break',
    fully_armour_broken: 'armour_break',
    leeched_as_life: 'life_leech',
    leeching_life: 'life_leech',
    aggravating_any_bleeding: 'bleed',
    aggravates_all_ignites: 'ignite'
  },
  expansions: {
    critical_weakness: ['critical', 'critical_hit'],
    critical_damage_bonus: ['critical', 'critical_hit'],
    electrocution: ['shock'],
    decimating_strike: ['cull', 'culling_strike'],
    culled: ['cull', 'culling_strike'],
    shocked_ground: ['shock'],
    thorns_damage: ['thorns'],
    chance_to_block: ['block'],
    allresistance: ['all_elemental_resistance'],
    elementalresistance: ['all_elemental_resistance'],
    movespeed: ['movement_speed'],
    exposure: ['ignite', 'chill', 'shock'],
    elemental_ailment: ['ignite', 'chill', 'shock']
  },
  stop_tags: [
    'helmet', 'body_armour', 'body_armor', 'gloves', 'boots', 'belt', 'ring', 'amulet',
    'wand', 'bow', 'staff', 'mace', 'sword', 'axe', 'dagger', 'spear', 'crossbow', 'quarterstaff',
    'flail', 'focus', 'shield', 'buckler', 'quiver', 'sceptre', 'claw', 'javelin', 'trap', 'flask'
  ],
  reject_prefixes: ['grants:', 'grants ', 'grants_'],
  reject_contains: ['grants skill']
};

const STOP_TAGS = new Set(RULES.stop_tags.map((v) => canonicalizeTag(v)).filter(Boolean));

function sanitizeRawTag(raw) {
  const s = String(raw ?? '').replace(/[\[\]']/g, '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/[\s_-]+/g, '_').replace(/[^a-z0-9_:]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function canonicalizeTag(raw, opts = {}) {
  const token = sanitizeRawTag(raw);
  if (!token) return null;
  if (shouldRejectTag(token, opts)) return null;
  return RULES.aliases_to_canonical[token] || token;
}

function toMatchKey(rawOrCanonical) {
  const canonical = canonicalizeTag(rawOrCanonical) ?? sanitizeRawTag(rawOrCanonical);
  return String(canonical || '').replace(/[^a-z0-9]+/g, '');
}

function expandCanonicalTag(rawOrCanonical, opts = {}) {
  const canonical = canonicalizeTag(rawOrCanonical, opts);
  if (!canonical) return [];
  const expanded = RULES.expansions[canonical] || [];
  return [canonical, ...expanded.map((v) => canonicalizeTag(v, opts)).filter(Boolean)];
}

function expandMatchKeys(rawOrCanonical, opts = {}) {
  return Array.from(new Set(expandCanonicalTag(rawOrCanonical, opts).map(toMatchKey).filter(Boolean)));
}

function normalizeTagList(tags, opts = {}) {
  const out = new Set();
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const items = opts.expand ? expandCanonicalTag(tag, opts) : [canonicalizeTag(tag, opts)];
    items.filter(Boolean).forEach((item) => out.add(opts.matchKey ? toMatchKey(item) : item));
  });
  return Array.from(out);
}

function displayTag(rawOrCanonical) {
  const canonical = canonicalizeTag(rawOrCanonical) ?? sanitizeRawTag(rawOrCanonical);
  if (!canonical) return '';
  return canonical.replace(/_/g, ' ');
}

function isNoiseTag(rawOrCanonical, opts = {}) {
  if (!opts.includeStopTags) {
    const canonical = canonicalizeTag(rawOrCanonical);
    if (canonical && STOP_TAGS.has(canonical)) return true;
  }
  return false;
}

function shouldRejectTag(rawOrCanonical, opts = {}) {
  const raw = String(rawOrCanonical ?? '').trim().toLowerCase();
  if (!raw) return true;
  if (opts.rejectGrants !== false) {
    if (RULES.reject_prefixes.some((p) => raw.startsWith(p))) return true;
    if (RULES.reject_contains.some((part) => raw.includes(part))) return true;
  }
  return false;
}

export {
  RULES,
  sanitizeRawTag,
  canonicalizeTag,
  toMatchKey,
  expandCanonicalTag,
  expandMatchKeys,
  normalizeTagList,
  displayTag,
  isNoiseTag,
  shouldRejectTag
};
