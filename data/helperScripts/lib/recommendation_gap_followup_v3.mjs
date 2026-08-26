const MARTIAL = ['sword', 'axe', 'mace', 'quarterstaff', 'claw', 'dagger', 'spear', 'bow', 'flail', 'crossbow', 'talisman'];
const CASTER = ['staff', 'wand', 'sceptre'];
const HARD = new Set(['exact', 'strong']);
const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const list = (value) => Array.isArray(value) ? value : [];
const mechanics = (fact) => fact?.relation === 'converts' || fact?.relation === 'replaces'
  ? [norm(fact.from), norm(fact.to)].filter(Boolean) : [norm(fact?.mechanic)].filter(Boolean);

function weaponRequirementProfile(entity) {
  const equipment = entity?.structured_weapon_requirements || entity?.compatibility?.equipment || {};
  const allowed = [...new Set([...list(equipment.mainhand_tags_any_of),
    ...list(equipment.allowed_weapon_tags_any_of)].map(norm).filter((tag) => MARTIAL.includes(tag)))].sort();
  const types = new Set(list(entity?.source_evidence?.active_skill_types).map(norm));
  const requirement = norm(equipment.requirement_id || equipment.display);
  let requirementClass;
  if (requirement.includes('any_martial_weapon') && allowed.length === MARTIAL.length) requirementClass = 'ANY_MARTIAL';
  else if (allowed.length > 1) requirementClass = 'MULTI_WEAPON';
  else if (allowed.length === 1) requirementClass = 'EXACT_WEAPON';
  else if (equipment.is_unrestricted === true && (types.has('spell') || types.has('areaspell'))) requirementClass = 'CASTER_NON_WEAPON';
  else if (equipment.is_unrestricted === true) requirementClass = 'UNRESTRICTED';
  else requirementClass = 'SPECIAL_UNCLEAR';
  return { requirementClass, requirementId: equipment.requirement_id || null,
    display: equipment.display || null, allowedWeaponTags: allowed,
    mainhandRequirements: list(equipment.mainhand_tags_any_of).map(norm),
    offhandRequirements: list(equipment.offhand_tags_any_of).map(norm),
    isUnrestricted: equipment.is_unrestricted === true };
}

function actualWeaponAllows(profile, weapon) {
  const family = norm(weapon);
  if (profile.requirementClass === 'ANY_MARTIAL') return MARTIAL.includes(family);
  if (['EXACT_WEAPON', 'MULTI_WEAPON'].includes(profile.requirementClass)) return profile.allowedWeaponTags.includes(family);
  if (profile.requirementClass === 'UNRESTRICTED') return [...MARTIAL, ...CASTER].includes(family);
  if (profile.requirementClass === 'CASTER_NON_WEAPON') return CASTER.includes(family);
  return null;
}

function craftingPreference(entity, weapon) {
  const family = norm(weapon);
  const affinities = list(entity?.crafting?.weapon_affinities).map(norm);
  if (affinities.includes(family)) return 'EXACT_NATIVE';
  const profile = weaponRequirementProfile(entity);
  if (profile.requirementClass === 'ANY_MARTIAL' || profile.requirementClass === 'MULTI_WEAPON') return 'EXPLICIT_BROAD_LEGALITY';
  return 'UNRESTRICTED_CROSS_AFFINITY';
}

function currentCraftingAllows(entity, weapon) {
  return list(entity?.crafting?.weapon_affinities).map(norm).includes(norm(weapon));
}

function targetMatches(support, active) {
  const rule = support?.compatibility?.target_skill || {};
  const types = new Set(list(active?.source_evidence?.active_skill_types).map(norm));
  const excluded = list(rule.excluded_skill_types).map(norm);
  if (excluded.some((type) => types.has(type))) return false;
  const allowed = list(rule.allowed_skill_types_any_of).map(norm).filter((type) => !['and', 'or'].includes(type));
  return !allowed.length || allowed.some((type) => types.has(type));
}

function supportAvailability(support) {
  const terms = new Set([...list(support?.retrieval_terms), ...list(support?.provenance?.source_tags)].map(norm));
  if (terms.has('lineage')) return 'LINEAGE_SUPPORT';
  if (terms.has('kalguuran')) return 'SEASONAL_EXCLUDED';
  if (/dnt|coming_soon|prototype/.test(norm(support?.name))) return 'OTHER';
  return 'STANDARD_SUPPORT';
}

function supportDerivedClosure(active, support, offenseId, globalRules) {
  const target = norm(offenseId);
  const rule = list(globalRules).find((entry) => norm(entry.source) === target
    && entry.fulfills_source_from_target === true);
  if (!rule) return null;
  const damage = norm(rule.target);
  const types = new Set(list(active?.source_evidence?.active_skill_types).map(norm));
  if (rule.requires_hit && !types.has('attack') && !types.has('hit') && !types.has('damage')) return null;
  const facts = list(support?.facts).filter((fact) => norm(fact.subject) === 'supported_skill' && HARD.has(fact.confidence));
  const provides = facts.some((fact) => ['provides', 'generates', 'converts'].includes(fact.relation)
    && (norm(fact.mechanic) === damage || norm(fact.to) === damage));
  const prevented = facts.some((fact) => fact.relation === 'prevents'
    && [target, damage, 'elemental_damage'].includes(norm(fact.mechanic)));
  if (!provides || prevented || !targetMatches(support, active)) return null;
  return { offense: target, damageMechanic: damage, ontologyRelation: rule.relation,
    requiresHit: Boolean(rule.requires_hit), supportProvidesDamage: true, hitProven: true,
    targetCompatibility: true, preventionClear: true };
}

function optimizerRole(support, offenseId) {
  const target = norm(offenseId);
  const facts = list(support?.facts).filter((fact) => norm(fact.subject) === 'supported_skill' && HARD.has(fact.confidence));
  if (facts.some((fact) => fact.relation === 'prevents' && mechanics(fact).includes(target))) return 'PREVENTION';
  if (facts.some((fact) => fact.relation === 'consumes' && mechanics(fact).includes(target))) return 'CONSUMER';
  if (facts.some((fact) => fact.relation === 'requires' && mechanics(fact).includes(target))) return 'CONDITIONAL';
  if (facts.some((fact) => fact.relation === 'modifies' && mechanics(fact).includes(target)
    && norm(fact.condition))) return 'CONDITIONAL';
  if (facts.some((fact) => fact.relation === 'modifies' && mechanics(fact).includes(target))) return 'OPTIONAL_OFFENSE_OPTIMIZER';
  return null;
}

function physicalInheritance(active) {
  const types = new Set(list(active?.source_evidence?.active_skill_types).map(norm));
  const facts = list(active?.facts).filter((fact) => HARD.has(fact.confidence));
  const usesWeaponAttackDamage = types.has('attack') && (types.has('melee') || types.has('projectile') || types.has('slam'));
  const conversions = facts.filter((fact) => fact.relation === 'converts' && norm(fact.from) === 'physical')
    .map((fact) => ({ to: norm(fact.to), percent: Number(fact.percent ?? fact.value ?? 0) || null }));
  const preventsPhysical = facts.some((fact) => fact.relation === 'prevents' && norm(fact.mechanic) === 'physical');
  const knownPercent = conversions.reduce((sum, conversion) => sum + (conversion.percent || 0), 0);
  const conversionUnknown = conversions.some((conversion) => conversion.percent === null);
  const fullyConverted = preventsPhysical || knownPercent >= 100;
  return { usesWeaponAttackDamage, conversions, fullyConverted,
    conversionUnknown, physicalRemains: usesWeaponAttackDamage && !fullyConverted && !conversionUnknown,
    confidence: usesWeaponAttackDamage && !conversionUnknown ? 'STRONG' : 'PLAUSIBLE' };
}

export { MARTIAL, CASTER, actualWeaponAllows, craftingPreference, currentCraftingAllows,
  optimizerRole, physicalInheritance, supportAvailability, supportDerivedClosure,
  targetMatches, weaponRequirementProfile };
