# readme.md

# The Randomancer — Path of Exile 2 Build Randomizer

**The Randomancer** is a fan-made Path of Exile 2 build randomizer.  
It’s a single-page web app that rolls **themed builds** composed of:

- Class & Ascendancy  
- Main-hand & Off-hand weapons  
- Ailments & Tactics  
- Primary defense & defensive strategy  
- Attribute balance (STR/DEX/INT)  
- Two recommended active skills (with supports)  
- A set of suggested unique items

The goal is to encourage **creative, off-meta build ideas** while still giving a sense of internal coherence and synergy.

> This is a non-commercial, fan project and is not affiliated with or endorsed by Grinding Gear Games.

---

## High-Level Features

- **Cohesion Slider**  
  A “Strict → Cohesive → Chaotic → Madness” slider that controls how closely the randomizer adheres to attribute and tag-based synergy.
  
- **Smart Data-Driven Choices**  
  - Weapons, ailments, tactics, defenses, skills, and uniques are selected from structured JSON datasets.
  - Attribute weights and tag arrays are used to prefer more thematically consistent combinations in more “cohesive” modes.

- **Recommended Skills + Supports**  
  - Active skill gems are chosen from `skill_gems.json` using tags like weapon type, damage type, ailment type, etc.
  - Support gems are recommended based on a simple tag/role matching system.

- **Unique Item Suggestions**  
  - Unique items come from `uniques_enriched_*.json`, with canonical and raw tags (e.g., `"Freeze"`, `"Critical Hit"`, `"Leech"`, `"Block"`, `"Minions"`).
  - The randomizer uses these tags to select uniques that fit the rolled build’s intended playstyle.

- **Polished UI/UX**  
  - Dark-fantasy card layout with subtle gold accents.
  - Ascendancy background art layer with fade transitions.
  - Attribute bar with glowing, blended visualization.
  - Intro “Roll Your Fate” overlay with flavor text.

---

## Project Structure

Typical versioned release (example: `v0.8.2_cleanup`):

```text
.
├── index.html
├── styles.css
├── core-script.js
├── core-data.json
├── skill_gems.json
├── skills.json
├── uniques_enriched.json
└── images/
    ├── background.png
    ├── dice.png
    └── ascendancy_*.jpg / .png (per ascendancy art, if present)
HTML

The main entry point, defines:

Intro overlay

Info / “A Note from the Randomancer” dialog

App panels (Archetype, Combat Mechanics, Survivability, Balance, Recommended Skills)

Roll button and cohesion slider

CSS

Visual style, layout, and interactive states:

Header typography

Glow effects and overlays

Skill gem and unique card styling

Attribute bar visual

JavaScript

Single main script file (script_*.js) that:

Loads JSON data

Performs the random roll

Applies cohesion mode logic

Computes tag- and attribute-based synergies

Renders all results to the DOM

Data Files

data_*.json

Core structure for:

Classes → ascendancies + attribute biases

Weapons → two-handed, one-handed, off-hand, compatibility rules

Defense → armour, evasion, energy shield, hybrids

Ailments and Tactics → tags and attribute weights

Used as the backbone for the main build components.

skill_gems.json

Datamined or curated skill gem data:

Active and support gems

Tags (projectile, bow, fire, cold, minion, totem, trap, etc.)

Requirements and descriptions

Helps determine which skills make sense for a rolled weapon + ailment + tactic combo.

skills.json

Supplemental mapping or alternate structured view, depending on version.

Sometimes used as a bridge or compatibility layer with older iterations of the randomizer logic.

uniques_enriched_*.json

Enriched unique items with:

slot (amulet, ring, belt, weapon, etc.)

name, base

tags:

canonical: normalized conceptual tags (e.g., "Freeze", "Life Regeneration", "Critical Hit")

raw: more literal/captured tags derived from the original text

lines: an array of strings representing the in-game-like tooltip, with some {tags:...} markers.

Randomizer uses canonical tags to match uniques to build themes.

How It Works (Simplified Flow)

Data Load

On page load, script_*.js fetches core JSON files (e.g. data_0.8.2_cleanup.json, skill_gems.json, uniques_enriched_0.8.2_cleanup.json).

The code builds internal lookup maps or helpers where needed (e.g., mapping skills by tag, type, or weapon compatibility).

Roll Your Fate
When the user clicks “Roll Your Fate”:

Class & Ascendancy are chosen from data.*.Classes.

A weapon setup is chosen:

One of: two-handed weapon, or one-handed + off-hand.

Off-hand selection respects compatibility rules (one-handed arrays).

Ailments and Tactics are chosen, influenced by:

Attribute alignment,

Tag overlaps with weapons and ascendancy themes,

Cohesion slider mode.

A Defense and Defensive Strategy are chosen based on desired attribute bias and build flavor.

An Attribute Balance vector is computed from all chosen pieces, and rendered as a glowing bar.

Recommended Skills and Supports

From skill_gems.json, the app finds candidate active gems whose tags match:

Weapon type (bow, crossbow, melee, spell, etc.),

Ailments/tactics (ignite, shock, poison, minions, totems, crit, etc.),

Ascendancy or defense themes where possible.

Two active skills are picked, each with a small subset of recommended support gems, based on tag matches (e.g., more ailment damage, projectile synergy, totem/minion scaling).

Unique Item Suggestions

From uniques_enriched_*.json, items are filtered by:

Tag overlap with build mechanics (e.g., "Freeze", "Ignite", "Critical Hit", "Block", "Minions", "Life Regeneration").

Slot diversity (amulet, ring, belt, weapon, etc.).

A handful of uniques are chosen and rendered as cards, displaying:

Name, base, slot

Tooltip lines (from lines[])