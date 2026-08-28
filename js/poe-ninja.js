import { familyName, poeNinjaModesByWeaponFamily } from './06-equipment.js';

function skillName(value) {
  return String(value && typeof value === 'object' ? value.name || '' : value || '').trim();
}

function recommendedSkillNames(snap = {}) {
  const values = [
    ...(Array.isArray(snap.recommendedSkills) ? snap.recommendedSkills : []),
    ...(Array.isArray(snap.recommendedSkills2) ? snap.recommendedSkills2 : []),
    ...(snap.recommendedPersistentBuff == null ? [] : [snap.recommendedPersistentBuff])
  ];
  return [...new Set(values.map(skillName).filter(Boolean))];
}

function buildPoeNinjaUrl(snap, leagueSlug) {
  if (!snap) return '';

  const params = new URLSearchParams();
  const ascendancy = String(snap.ascendancyName || snap.ascendancy || '').trim();
  if (ascendancy) params.set('class', ascendancy);

  const weaponModes = poeNinjaModesByWeaponFamily[familyName(snap.weapon)] || [];
  if (weaponModes.length) params.set('weaponmode', weaponModes.join(','));

  const skills = recommendedSkillNames(snap);
  if (skills.length) params.set('allskills', skills.join(','));

  return `https://poe.ninja/poe2/builds/${leagueSlug}?${params.toString()}`;
}

export { buildPoeNinjaUrl, recommendedSkillNames };
