# Skill Families (Challenge Mode)

Files:
- `skill_families.json` — library of family definitions + family-local alias overlay rules
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
- Normalization boundary:
  - Shared/global helpers/rules (`data/tag_normalization_rules.json` + `js/tag-normalization.js`) own canonicalization and baseline match semantics.
  - Family-local aliases in `skill_families.json` are a small post-pass overlay for family-specific grouping/search convenience only.
- Keep family-local overlays minimal: if an alias is global/project-wide, it belongs in shared rules instead.
- `python data/helperScripts/validate_tag_normalization.py` now emits lightweight overlap warnings when a family-local alias appears already covered by shared/global normalization rules.
- Codex derived-tag vocabulary remains a Codex-local heuristic policy (in `js/18-codex-mode.js`), not part of shared normalization rules.
- The validator includes tiny boundary regression checks for Codex URL tag hydration and family-query alias resolution behavior.
