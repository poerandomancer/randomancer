// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: data/tag_normalization_rules.json
// Regenerate with: python data/helperScripts/generate_tag_rules_js.py

const RULES = {
  "aliases_to_canonical": {
    "aggravated": "aggravate",
    "aggravates_all_ignites": "ignite",
    "aggravating_any_bleeding": "bleed",
    "allies": "ally",
    "armorbreak": "armour_break",
    "armourbreak": "armour_break",
    "attacks": "attack",
    "attributes": "attribute",
    "bled": "bleed",
    "bleeding": "bleed",
    "bleeds": "bleed",
    "blinded": "blind",
    "block recovery": "block_recovery",
    "block_chance": "chance_to_block",
    "blockchance": "chance_to_block",
    "blocked": "block",
    "blocking": "block",
    "breaks_armour": "armour_break",
    "charges": "charge",
    "charms": "charm",
    "chilled": "chill",
    "companions": "companion",
    "corpses": "corpse",
    "critical": "crit",
    "critical_hits": "critical_hit",
    "critical_strike": "critical_hit",
    "criticalhit": "critical_hit",
    "critically_hit": "critical_hit",
    "crushes": "crush",
    "culling strike": "culling_strike",
    "cullingstrike": "culling_strike",
    "curses": "curse",
    "damage over time": "dot",
    "damageovertime": "dot",
    "dazes": "daze",
    "debuffs": "debuff",
    "empowers": "empower",
    "flasks": "flask",
    "freezes": "freeze",
    "frenzy_charges": "frenzy_charge",
    "frozen": "freeze",
    "fully_armour_broken": "armour_break",
    "heavy stun": "heavy_stun",
    "heavy_stunned": "heavy_stun",
    "heavy_stuns": "heavy_stun",
    "heavystun": "heavy_stun",
    "hindered": "hinder",
    "hits": "hit",
    "hitting": "hit",
    "ignited": "ignite",
    "ignites": "ignite",
    "igniting": "ignite",
    "irradiated": "irradiate",
    "leeched": "leech",
    "leeched_as_life": "life_leech",
    "leeches": "leech",
    "leeching_life": "life_leech",
    "life regeneration": "life_regeneration",
    "liferegeneration": "life_regeneration",
    "light_stunned": "light_stun",
    "marks": "mark",
    "mines": "mine",
    "minions": "minion",
    "parried": "parry",
    "parrying": "parry",
    "penetrates": "penetrate",
    "pierced": "pierce",
    "pinning": "pin",
    "poisoned": "poison",
    "poisoning": "poison",
    "poisons": "poison",
    "power_charges": "power_charge",
    "projectiles": "projectile",
    "recharges": "recharge",
    "recouped": "recoup",
    "recouping": "recoup",
    "reserved": "reserve",
    "shattered": "shatter",
    "shocked": "shock",
    "shocking": "shock",
    "shocks": "shock",
    "slowing": "slow",
    "slows": "slow",
    "spells": "spell",
    "stunned": "stun",
    "totems": "totem",
    "traps": "trap",
    "triggered": "trigger",
    "warcries": "warcry"
  },
  "expansions": {
    "allresistance": [
      "all_elemental_resistance"
    ],
    "chance_to_block": [
      "block"
    ],
    "critical_damage_bonus": [
      "critical",
      "critical_hit"
    ],
    "critical_weakness": [
      "critical",
      "critical_hit"
    ],
    "culled": [
      "cull",
      "culling_strike"
    ],
    "decimating_strike": [
      "cull",
      "culling_strike"
    ],
    "electrocution": [
      "shock"
    ],
    "elemental_ailment": [
      "ignite",
      "chill",
      "shock"
    ],
    "elementalresistance": [
      "all_elemental_resistance"
    ],
    "exposure": [
      "ignite",
      "chill",
      "shock"
    ],
    "movespeed": [
      "movement_speed"
    ],
    "shocked_ground": [
      "shock"
    ],
    "thorns_damage": [
      "thorns"
    ]
  },
  "reject_contains": [
    "grants skill"
  ],
  "reject_prefixes": [
    "grants ",
    "grants:",
    "grants_"
  ],
  "schema_version": "phase1",
  "stop_tags": [
    "helmet",
    "body_armour",
    "body_armor",
    "gloves",
    "boots",
    "belt",
    "ring",
    "amulet",
    "wand",
    "bow",
    "staff",
    "mace",
    "sword",
    "axe",
    "dagger",
    "spear",
    "crossbow",
    "quarterstaff",
    "flail",
    "focus",
    "shield",
    "buckler",
    "quiver",
    "sceptre",
    "claw",
    "javelin",
    "trap",
    "flask"
  ]
};

export { RULES };
