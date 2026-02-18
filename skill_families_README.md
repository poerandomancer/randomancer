# Skill Families (Challenge Mode)

Files:
- `skill_families.json` — library of family definitions + tag normalization rules
- `skill_family_utils.js` — helper utilities to resolve families and format tooltips

## Basic usage (vanilla)

```js
import familyLib from './data/skill_families.json';
import skills from './data/skills_enriched.json';
import {
  buildSkillFamilyIndex,
  resolveSkillFamily,
  formatFamilyTooltip
} from './js/17-skill-family-utils.js';

const index = buildSkillFamilyIndex(skills, familyLib);

// Example: resolve "Fire Spells"
const fireSpellsDef = familyLib.families.find(f => f.id === 'fire_spells');
const fireSpellIds = resolveSkillFamily(fireSpellsDef, index, familyLib);

// Tooltip text
const tip = formatFamilyTooltip(fireSpellsDef, index, fireSpellIds, { max: 25 });
console.log(tip);
```

## Notes
- Resolution pool includes **all active skills** (buff/persistent/spirit allowed), but excludes:
  - Support gems (`type !== "active"`)
  - DNT/Unused (id/name includes `DNT` or `UNUSED`)
- Matching uses the **union** of `taxonomy.gem_tags`, `taxonomy.skill_types`, and `effect_tags`
- Tags are normalized (lowercase, strip punctuation), then run through alias mapping in `skill_families.json`
