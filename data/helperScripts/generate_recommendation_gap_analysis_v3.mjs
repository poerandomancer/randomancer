import fs from 'node:fs';
import {
  analyzeSupportFirstGapCellV3,
  mergeRecommendationGrantedSkillAccessV3,
  mergeRecommendationSkillCraftingV3
} from '../../js/30-recommendation-v3-selector.js';
import {
  MARTIAL, actualWeaponAllows, craftingPreference, currentCraftingAllows,
  optimizerRole, physicalInheritance, supportAvailability, supportDerivedClosure,
  targetMatches, weaponRequirementProfile
} from './lib/recommendation_gap_followup_v3.mjs';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const native = read('data/enriched/recommendation_native_coverage_v3.json');
const offenseInventory = read('data/offense-inventory.json');
const enrichedSkills = read('data/enriched/skills_enriched.json');
let catalog = read('data/enriched/recommendation_catalog_v3.json');
catalog = mergeRecommendationGrantedSkillAccessV3(catalog,
  read('data/enriched/recommendation_granted_skill_access_v3.json'));
catalog = mergeRecommendationSkillCraftingV3(catalog,
  read('data/enriched/recommendation_skill_crafting_v3.json'));
const enrichedById = new Map(enrichedSkills.map((skill) => [`skill:${skill.id}`, skill]));
catalog = { ...catalog, entities: catalog.entities.map((entity) => {
  const enriched = enrichedById.get(entity.id);
  return enriched ? { ...entity, structured_weapon_requirements: enriched.weapon_requirements,
    enriched_taxonomy: enriched.taxonomy, enriched_tags: enriched.tags } : entity;
}) };

const gaps = native.cells.filter((cell) => cell.classification === 'GAP');
const cells = gaps.map((cell) => {
  const result = analyzeSupportFirstGapCellV3(catalog,
    { weapon: cell.weapon, offenseSet: [cell.offenseId] }, { offenseInventory });
  const routes = result.routes.slice(0, 5).map((route) => ({
    type: route.supports.length === 1 ? 'ONE_ACTIVE_ONE_SUPPORT' : 'ONE_ACTIVE_TWO_SUPPORTS',
    active: route.active,
    supports: route.supports,
    twoSupportChain: route.supports.length === 2 ? {
      intermediateMechanics: route.proof.prerequisiteMechanics,
      requirementsProven: route.proof.allRequirementsMet
    } : null,
    semanticProof: route.proof,
    confidence: 'STRONG'
  }));
  const best = routes[0] || null;
  return {
    weapon: cell.weapon,
    offenseId: cell.offenseId,
    offense: cell.offense,
    nativeClassification: 'GAP',
    candidateSupportRoutes: routes,
    multiSkillChains: [],
    accessDependency: null,
    rejectedHighRelevanceRoutes: result.rejected,
    conflictsAndPrevention: best?.semanticProof.preventedMechanics || [],
    unresolvedMechanics: best ? [] : [cell.offenseId],
    bestProposedRoute: best || { type: 'UNRESOLVED', reason: 'No complete typed support-first or explicit provider/consumer chain.' },
    primaryClassification: best ? 'SUPPORT_FIRST_SIMPLE' : 'NO_CREDIBLE_SOLUTION',
    confidence: best ? 'STRONG' : 'WEAK',
    rationale: best
      ? `${best.type} completes the Offense through runtime-legal delivery and fully proven typed support prerequisites.`
      : 'No runtime-legal support-first construction completes the Offense; the catalog contains no explicit two-active chain that improves this result.'
  };
});

const activeTypes = (entity) => (entity.source_evidence?.active_skill_types || []).map((type) =>
  String(type).toLowerCase());
const hasSemanticType = (entity, type) => activeTypes(entity).includes(type)
  || (entity.enriched_taxonomy?.gem_tags || []).includes(type)
  || (entity.enriched_taxonomy?.skill_types || []).includes(type);
const normalActives = catalog.entities.filter((entity) => entity.content_type === 'active_skill'
  && (entity.crafting?.types_raw || []).length
  && !/^(?:\[?dnt|playtest|prototype)/i.test(entity.name || '')
  && !(entity.provenance?.source_tags || []).includes('kalguuran'));
const weaponSkillAudit = normalActives.map((entity) => {
  const requirement = weaponRequirementProfile(entity);
  const byWeapon = MARTIAL.map((weapon) => {
    const current = currentCraftingAllows(entity, weapon);
    const actual = actualWeaponAllows(requirement, weapon);
    return { weapon, current, actual,
      comparison: actual === null ? 'UNCLEAR' : current === actual ? 'ALIGNED'
        : actual ? 'CURRENTLY_TOO_STRICT' : 'CURRENTLY_TOO_PERMISSIVE',
      preference: actual ? craftingPreference(entity, weapon) : null };
  });
  const types = activeTypes(entity);
  return {
    entityId: entity.id, name: entity.name,
    craftingTypes: entity.crafting.types_raw || [],
    craftingWeaponAffinities: entity.crafting.weapon_affinities || [],
    weaponRequirement: requirement,
    activeSkillTypes: entity.source_evidence?.active_skill_types || [],
    identity: {
      attack: types.includes('attack'), spell: types.includes('spell') || types.includes('areaspell'),
      minion: types.includes('minion') || types.includes('createsminion'),
      companion: types.includes('companion') || types.includes('createscompanion'),
      totem: types.includes('summonstotem') || types.includes('summonsattacktotem')
    },
    byWeapon,
    differingWeapons: byWeapon.filter((entry) => !['ALIGNED', 'UNCLEAR'].includes(entry.comparison))
      .map(({ weapon, comparison, preference }) => ({ weapon, comparison, preference }))
  };
}).sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));

const supports = catalog.entities.filter((entity) => entity.content_type === 'support_gem');
const supportById = new Map(supports.map((support) => [support.id, support]));
const supportFamilies = new Set();
const supportTools = [];
const constructionMechanics = new Set(['physical', 'fire', 'cold', 'lightning', 'chaos',
  'ignite', 'chill', 'freeze', 'shock', 'electrocute', 'bleed', 'poison']);
for (const support of [...supports].sort((a, b) => a.name.localeCompare(b.name))) {
  const family = support.support_family?.id || support.name;
  if (supportFamilies.has(family)) continue;
  const typed = (support.facts || []).filter((fact) => fact.subject === 'supported_skill'
    && ['converts', 'replaces', 'provides'].includes(fact.relation)
    && [fact.from, fact.to, fact.mechanic].some((mechanic) => constructionMechanics.has(mechanic)));
  if (!typed.length) continue;
  supportFamilies.add(family);
  for (const fact of typed) supportTools.push({
    support: support.name, family: support.support_family?.name || support.name,
    relation: fact.relation === 'provides' ? 'ADD_OR_GAIN' : fact.relation === 'converts' ? 'CONVERT' : 'AILMENT_OR_MECHANIC_REPLACEMENT',
    from: fact.from || null, to: fact.to || fact.mechanic || null,
    requirements: (support.facts || []).filter((entry) => ['requires', 'consumes'].includes(entry.relation))
      .map((entry) => `${entry.relation}:${entry.mechanic}`).sort(),
    availability: supportAvailability(support),
    eligibleForTier3: supportAvailability(support) === 'STANDARD_SUPPORT',
    notes: fact.condition || null
  });
}

const ontologyRules = catalog.fate_vocabulary?.global_offense_rules || [];
const offenseById = new Map((offenseInventory.elements || []).map((offense) => [offense.id, offense]));
const derivedRoutes = [];
for (const gap of cells.filter((cell) => cell.primaryClassification === 'NO_CREDIBLE_SOLUTION')) {
  const rule = ontologyRules.find((entry) => entry.source === gap.offenseId && entry.fulfills_source_from_target);
  if (!rule) continue;
  const damageCell = cells.find((cell) => cell.weapon === gap.weapon && cell.offenseId === rule.target
    && cell.bestProposedRoute?.active);
  if (!damageCell) continue;
  const active = catalog.entities.find((entity) => entity.id === damageCell.bestProposedRoute.active.id);
  const enable = supportById.get(damageCell.bestProposedRoute.supports?.[0]?.id);
  const proof = supportDerivedClosure(active, enable, gap.offenseId, ontologyRules);
  if (proof) derivedRoutes.push({ weapon: gap.weapon, offenseId: gap.offenseId,
    active: { id: active.id, name: active.name }, enableSupport: { id: enable.id, name: enable.name }, proof });
}

const standardOptimizer = (active, offenseId, excludedFamilies = []) => supports
  .filter((support) => supportAvailability(support) === 'STANDARD_SUPPORT' && targetMatches(support, active))
  .filter((support) => !excludedFamilies.includes(support.support_family?.id))
  .map((support) => ({ support, role: optimizerRole(support, offenseId) }))
  .filter((entry) => entry.role === 'OPTIONAL_OFFENSE_OPTIMIZER')
  .sort((a, b) => (Number(b.support.support_family?.tier) || 0) - (Number(a.support.support_family?.tier) || 0)
    || a.support.name.localeCompare(b.support.name))[0]?.support || null;

const constructedRoutes = [...cells.filter((cell) => cell.primaryClassification === 'SUPPORT_FIRST_SIMPLE').map((cell) => ({
  weapon: cell.weapon, offenseId: cell.offenseId, subtype: 'SUPPORT_FIRST_EXPLICIT',
  active: cell.bestProposedRoute.active,
  requiredSupports: cell.bestProposedRoute.supports.map((support, index, all) => ({ ...support,
    constructionRole: all.length === 2 && index === 1 ? 'REQUIRED_PREREQUISITE_SUPPORT' : 'REQUIRED_ENABLE_SUPPORT' }))
})), ...derivedRoutes.map((route) => ({ weapon: route.weapon, offenseId: route.offenseId,
  subtype: 'SUPPORT_FIRST_DERIVED', active: route.active,
  requiredSupports: [{ ...route.enableSupport, constructionRole: 'REQUIRED_ENABLE_SUPPORT' }],
  derivedProof: route.proof }))].map((route) => {
    const active = catalog.entities.find((entity) => entity.id === route.active.id);
    const optimizer = standardOptimizer(active, route.offenseId,
      route.requiredSupports.map((support) => support.familyId));
    return { ...route, optimizer: optimizer ? { id: optimizer.id, name: optimizer.name,
      family: optimizer.support_family?.name || optimizer.name,
      constructionRole: 'OPTIONAL_OFFENSE_OPTIMIZER' } : null };
  });

const semanticCreators = normalActives.map((entity) => ({ entity,
  mechanics: (entity.facts || []).filter((fact) => ['creates', 'provides'].includes(fact.relation))
    .map((fact) => fact.mechanic) }));
const anyMartialTotemCreators = semanticCreators.filter(({ entity, mechanics }) =>
  mechanics.includes('totem') && weaponRequirementProfile(entity).requirementClass === 'ANY_MARTIAL');
const unrestrictedCompanionCreators = semanticCreators.filter(({ entity, mechanics }) =>
  mechanics.includes('companion') && weaponRequirementProfile(entity).requirementClass === 'UNRESTRICTED'
  && !hasSemanticType(entity, 'hasreservation'));
const talismanPhysical = normalActives.filter((entity) => actualWeaponAllows(weaponRequirementProfile(entity), 'talisman'))
  .map((entity) => ({ entityId: entity.id, name: entity.name, ...physicalInheritance(entity) }))
  .filter((entry) => entry.usesWeaponAttackDamage);
const inheritedPhysicalByWeapon = new Map(MARTIAL.map((weapon) => [weapon, normalActives
  .filter((entity) => actualWeaponAllows(weaponRequirementProfile(entity), weapon))
  .map((entity) => ({ entityId: entity.id, ...physicalInheritance(entity) }))
  .filter((entry) => entry.physicalRemains)]));

const revisedGaps = cells.filter((cell) => cell.primaryClassification === 'NO_CREDIBLE_SOLUTION').map((cell) => {
  let reason = null;
  let evidenceEntityIds = [];
  const derived = derivedRoutes.find((route) => route.weapon === cell.weapon && route.offenseId === cell.offenseId);
  if (derived) { reason = 'SUPPORT_DERIVED_ONTOLOGY'; evidenceEntityIds = [derived.active.id, derived.enableSupport.id]; }
  const archetype = offenseById.get(cell.offenseId)?.category === 'Archetype';
  if (!reason && archetype && cell.offenseId === 'totems') {
    const creators = anyMartialTotemCreators.filter(({ entity }) => actualWeaponAllows(weaponRequirementProfile(entity), cell.weapon));
    if (creators.length) { reason = 'WEAPON_LEGALITY'; evidenceEntityIds = creators.map(({ entity }) => entity.id); }
  }
  if (!reason && archetype && cell.offenseId === 'companions' && MARTIAL.includes(cell.weapon.toLowerCase())) {
    const creators = unrestrictedCompanionCreators.filter(({ entity }) => actualWeaponAllows(weaponRequirementProfile(entity), cell.weapon));
    if (creators.length) { reason = 'WEAPON_LEGALITY'; evidenceEntityIds = creators.map(({ entity }) => entity.id); }
  }
  if (!reason && cell.offenseId === 'physical') {
    const inherited = inheritedPhysicalByWeapon.get(cell.weapon.toLowerCase()) || [];
    if (inherited.length) { reason = 'WEAPON_DAMAGE_INHERITANCE'; evidenceEntityIds = inherited.map((entry) => entry.entityId); }
  }
  return { weapon: cell.weapon, offenseId: cell.offenseId,
    interpretation: reason ? `LIKELY_FALSE_GAP_${reason}` : 'REMAINS_UNRESOLVED',
    modelingReason: reason, evidenceEntityIds };
});

const requirementClasses = ['EXACT_WEAPON', 'MULTI_WEAPON', 'ANY_MARTIAL', 'UNRESTRICTED', 'CASTER_NON_WEAPON', 'SPECIAL_UNCLEAR'];
const compactWeaponSkills = weaponSkillAudit.map(({ byWeapon, ...skill }) => ({
  ...skill,
  currentAcceptedMartialFamilies: byWeapon.filter((entry) => entry.current).map((entry) => entry.weapon),
  actualAcceptedMartialFamilies: byWeapon.filter((entry) => entry.actual).map((entry) => entry.weapon),
  comparisonCounts: Object.fromEntries(['ALIGNED', 'CURRENTLY_TOO_STRICT', 'CURRENTLY_TOO_PERMISSIVE', 'UNCLEAR']
    .map((key) => [key, byWeapon.filter((entry) => entry.comparison === key).length]))
}));
const followup = {
  schemaVersion: 'recommendation-gap-followup-v3.0.0',
  weaponAudit: {
    activeSkillCount: weaponSkillAudit.length,
    countsByRequirementClass: Object.fromEntries(requirementClasses.map((key) =>
      [key, weaponSkillAudit.filter((skill) => skill.weaponRequirement.requirementClass === key).length])),
    skillsCurrentlyTooStrict: weaponSkillAudit.filter((skill) => skill.byWeapon.some((entry) => entry.comparison === 'CURRENTLY_TOO_STRICT')).length,
    skillsCurrentlyTooPermissive: weaponSkillAudit.filter((skill) => skill.byWeapon.some((entry) => entry.comparison === 'CURRENTLY_TOO_PERMISSIVE')).length,
    admittedSkillWeaponPairsByPreference: Object.fromEntries(
      ['EXACT_NATIVE', 'EXPLICIT_BROAD_LEGALITY', 'UNRESTRICTED_CROSS_AFFINITY'].map((preference) => [preference,
        weaponSkillAudit.reduce((sum, skill) => sum + skill.byWeapon.filter((entry) => entry.actual && entry.preference === preference).length, 0)])),
    admittedDistinctSkillsByPreference: Object.fromEntries(
      ['EXACT_NATIVE', 'EXPLICIT_BROAD_LEGALITY', 'UNRESTRICTED_CROSS_AFFINITY'].map((preference) => [preference,
        weaponSkillAudit.filter((skill) => skill.byWeapon.some((entry) => entry.actual && entry.preference === preference)).length])),
    additionalCandidatesByWeapon: Object.fromEntries(MARTIAL.map((weapon) => [weapon,
      ['EXACT_NATIVE', 'EXPLICIT_BROAD_LEGALITY', 'UNRESTRICTED_CROSS_AFFINITY'].map((preference) => ({ preference,
        count: weaponSkillAudit.filter((skill) => skill.byWeapon.some((entry) => entry.weapon === weapon
          && entry.comparison === 'CURRENTLY_TOO_STRICT' && entry.preference === preference)).length }))])),
    skills: compactWeaponSkills
  },
  anyMartialSkills: weaponSkillAudit.filter((skill) => skill.weaponRequirement.requirementClass === 'ANY_MARTIAL')
    .map((skill) => ({ entityId: skill.entityId, name: skill.name })),
  regressionFindings: {
    anyMartialTotemCreators: anyMartialTotemCreators.map(({ entity }) => ({ entityId: entity.id, name: entity.name })),
    unrestrictedCompanionCreators: unrestrictedCompanionCreators.map(({ entity }) => ({ entityId: entity.id, name: entity.name,
      craftingTypes: entity.crafting.types_raw, activeSkillTypes: entity.source_evidence.active_skill_types,
      reservesSpirit: hasSemanticType(entity, 'hasreservation'), persistent: hasSemanticType(entity, 'persistent') })),
    reservationCompanionCreators: semanticCreators.filter(({ entity, mechanics }) => mechanics.includes('companion')
      && hasSemanticType(entity, 'hasreservation')).map(({ entity }) => ({ entityId: entity.id, name: entity.name,
        requirement: weaponRequirementProfile(entity), activeSkillTypes: entity.source_evidence.active_skill_types })),
    talismanPhysical
  },
  derivedRoutes, constructedRoutes, supportTools,
  optimizerSupportsByOffense: Object.fromEntries(['ignite', 'chill', 'freeze', 'shock', 'electrocute', 'bleed', 'poison']
    .map((offense) => [offense, supports.filter((support) => supportAvailability(support) === 'STANDARD_SUPPORT'
      && optimizerRole(support, offense) === 'OPTIONAL_OFFENSE_OPTIMIZER')
      .map((support) => support.name).sort()])),
  revisedGaps
};
fs.writeFileSync('data/enriched/recommendation_gap_followup_v3.json', `${JSON.stringify(followup, null, 2)}\n`);

const taxonomy = ['SUPPORT_FIRST_SIMPLE', 'MULTI_SKILL', 'ACCESS_DEPENDENT',
  'CONDITIONAL_WEIRD', 'NO_CREDIBLE_SOLUTION'];
const confidence = ['STRONG', 'PLAUSIBLE', 'WEAK'];
const counts = {
  primaryClassification: Object.fromEntries(taxonomy.map((key) =>
    [key, cells.filter((cell) => cell.primaryClassification === key).length])),
  confidence: Object.fromEntries(confidence.map((key) =>
    [key, cells.filter((cell) => cell.confidence === key).length]))
};
const successfulSupports = {};
for (const cell of cells) for (const support of cell.bestProposedRoute?.supports || []) {
  successfulSupports[support.family] = (successfulSupports[support.family] || 0) + 1;
}
const summary = {
  gapCount: cells.length,
  counts,
  successfulSupportFamilies: Object.entries(successfulSupports)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([family, count]) => ({ family, count })),
  commonPrerequisiteMechanics: [...new Set(cells.flatMap((cell) =>
    cell.candidateSupportRoutes.flatMap((route) => route.semanticProof.prerequisiteMechanics)))].sort(),
  commonFailureReasons: [...new Set(cells.flatMap((cell) =>
    cell.rejectedHighRelevanceRoutes.map((route) => route.reason)))].sort(),
  // These are review leads, not overrides: every unresolved cell whose catalog
  // nevertheless exposed a terminal support is worth checking at extraction.
  suspiciousSemanticDataGaps: cells.filter((cell) =>
    cell.primaryClassification === 'NO_CREDIBLE_SOLUTION'
      && cell.rejectedHighRelevanceRoutes.length > 0)
    .map((cell) => `${cell.weapon}:${cell.offenseId}`),
  runtimeBehaviorChanged: true,
  namedSkillOrCellExceptionsIntroduced: false
};
const payload = { schemaVersion: 'recommendation-gap-analysis-v3.0.0', sourceSchemaVersion: native.schemaVersion, summary, cells };
fs.writeFileSync('data/enriched/recommendation_gap_analysis_v3.json', `${JSON.stringify(payload, null, 2)}\n`);

const section = (classification) => cells.filter((cell) => cell.primaryClassification === classification)
  .map((cell) => `- ${cell.weapon} × ${cell.offense}: ${cell.bestProposedRoute.active?.name || 'unresolved'}${cell.bestProposedRoute.supports ? ` + ${cell.bestProposedRoute.supports.map((support) => support.name).join(' + ')}` : ''} (${cell.confidence})`).join('\n') || '- None';
const tooStrictExamples = weaponSkillAudit.filter((skill) => skill.differingWeapons.some((entry) => entry.comparison === 'CURRENTLY_TOO_STRICT')).slice(0, 12);
const gapLabel = (gap) => `${gap.weapon} × ${offenseById.get(gap.offenseId)?.name || gap.offenseId}`;
const report = `# Recommendation GAP analysis v3\n\nGenerated by \`make recommendation-gap-analysis\` from the authoritative native coverage artifact. The GAP artifact remains diagnostic; this report also reflects the implemented foundational runtime model corrections.\n\n- GAP cells: ${cells.length}\n- STRONG: ${counts.confidence.STRONG}; PLAUSIBLE: ${counts.confidence.PLAUSIBLE}; WEAK: ${counts.confidence.WEAK}\n\n| Classification | Count |\n|---|---:|\n${taxonomy.map((key) => `| ${key} | ${counts.primaryClassification[key]} |`).join('\n')}\n\n${taxonomy.map((key) => `## ${key}\n\n${section(key)}`).join('\n\n')}\n\n## Observations\n\n- Successful support families: ${summary.successfulSupportFamilies.map((entry) => `${entry.family} (${entry.count})`).join(', ') || 'none'}.\n- Typed intermediate prerequisites: ${summary.commonPrerequisiteMechanics.join(', ') || 'none'}.\n- No named-skill or Weapon × Offense exception was added; optimizer support selection remains diagnostic-only.\n\n# Follow-up: legality, ontology closure, and optimization\n\n## A. Weapon requirement vs crafting affinity\n\nAudited ${followup.weaponAudit.activeSkillCount} normal active-skill candidates.\n\n| Requirement class | Count |\n|---|---:|\n${requirementClasses.map((key) => `| ${key} | ${followup.weaponAudit.countsByRequirementClass[key]} |`).join('\n')}\n\nActual structured requirements are now the hard martial legality boundary. Crafting affinity remains a separate preference signal: EXACT_NATIVE, EXPLICIT_BROAD_LEGALITY, then UNRESTRICTED_CROSS_AFFINITY. The prior crafting-only gate remains recorded as the historical comparison baseline.\n\n## B. Skills where the historical crafting gate was stricter than actual legality\n\n- Skills with at least one CURRENTLY_TOO_STRICT martial family: ${followup.weaponAudit.skillsCurrentlyTooStrict}.\n- Skills with at least one CURRENTLY_TOO_PERMISSIVE martial family: ${followup.weaponAudit.skillsCurrentlyTooPermissive}.\n\n${tooStrictExamples.map((skill) => `- ${skill.name}: ${skill.differingWeapons.filter((entry) => entry.comparison === 'CURRENTLY_TOO_STRICT').map((entry) => `${entry.weapon} (${entry.preference})`).join(', ')}`).join('\n')}\n\n## C. Any-Martial and multi-weapon skills\n\nAny-Martial skills: ${followup.anyMartialSkills.map((skill) => skill.name).join(', ') || 'none'}. Multi-weapon requirements remain limited to their explicitly listed families; neither category is inferred from Attack tags.\n\n## D. Tame Beast and Companion findings\n\n${followup.regressionFindings.unrestrictedCompanionCreators.map((skill) => `- ${skill.name}: crafting ${skill.craftingTypes.join('/')}; actual requirement UNRESTRICTED; Persistent=${skill.persistent}; HasReservation/Spirit=${skill.reservesSpirit}. Its companion creation is explicit, but the catalog does not encode the created Companion's separate resource cost.`).join('\n') || '- No unrestricted, non-reservation Companion creator found.'}\n\nThe enriched gem taxonomy marks Tame Beast Persistent, but its active-skill types do not include HasReservation; it is therefore distinct from a Spirit-reservation gem under the existing archetype-aware persistent policy. Its Spear crafting type is therefore affinity, while structured equipment legality is unrestricted. It can explain the Mace, Quarterstaff, and Crossbow Companion GAPs under the audited hierarchy.\n\n## E. Shockwave Totem and Totem findings\n\n${followup.regressionFindings.anyMartialTotemCreators.map((skill) => `- ${skill.name}: explicit Totem creation and structured ANY_MARTIAL legality.`).join('\n') || '- No Any-Martial Totem creator found.'}\n\nThis generic evidence explains the Quarterstaff, Bow, Talisman, and Spear Totem GAPs as likely crafting-gate artifacts.\n\n### Rhoa Mount contrast\n\n${followup.regressionFindings.reservationCompanionCreators.map((skill) => `- ${skill.name}: ${skill.requirement.requirementClass} (${skill.requirement.display || 'no display'}); active types include HasReservation and Persistent.`).join('\n') || '- No reservation Companion creator found.'}\n\nRhoa Mount remains categorically separate: structured weapon data says UNRESTRICTED while its description says Bow or Spear, a source inconsistency that should not be silently normalized. More importantly, its HasReservation/Persistent identity does not justify broad Spirit-skill admission. The catalog does not explicitly encode an “Uncut Spirit Gem” source label, so that detail remains unverified here.\n\n## F. Weapon-based Physical inheritance\n\n${followup.regressionFindings.talismanPhysical.map((skill) => `- ${skill.name}: weapon Attack Damage=${skill.usesWeaponAttackDamage}; conversions=${skill.conversions.length ? skill.conversions.map((conversion) => `Physical→${conversion.to} (${conversion.percent ?? 'percentage missing'})`).join(', ') : 'none'}; Physical remains=${skill.physicalRemains}; ${skill.confidence}.`).join('\n')}\n\nTalisman × Physical is a likely damage-inheritance modeling gap because multiple structured Talisman weapon attacks have no conversion or prevention fact. Unknown conversion percentages remain PLAUSIBLE and are not used as proof that Physical remains.\n\n## G. Support-derived elemental ailment closure\n\n${derivedRoutes.map((route) => `- ${route.weapon} × ${offenseById.get(route.offenseId)?.name}: ${route.active.name} + ${route.enableSupport.name} → ${route.proof.damageMechanic} Hit → ${route.offenseId} (STRONG).`).join('\n') || '- None.'}\n\nEach route requires an explicit support-provided damage type, typed Hit delivery, an explicit global ontology rule, target compatibility, and no prevention.\n\n## H. Required support vs optimizer support\n\n| Cell | Subtype | Required support(s) | Optional optimizer |\n|---|---|---|---|\n${constructedRoutes.map((route) => `| ${route.weapon} × ${offenseById.get(route.offenseId)?.name || route.offenseId} | ${route.subtype} | ${route.requiredSupports.map((support) => `${support.name} (${support.constructionRole})`).join('; ')} | ${route.optimizer?.name || 'none'} |`).join('\n')}\n\nOptimizers never establish validity. Supports that consume, prevent, or conditionally pay off against the target are classified as CONSUMER, PREVENTION, or CONDITIONAL and excluded from optimizer slots.\n\n## I. Standard conversion, addition, and contribution tools\n\n| Support | Relation | From | To | Availability | Tier 3 eligible |\n|---|---|---|---|---|---|\n${supportTools.map((tool) => `| ${tool.support} | ${tool.relation} | ${tool.from || '—'} | ${tool.to || '—'} | ${tool.availability} | ${tool.eligibleForTier3 ? 'yes' : 'no'} |`).join('\n')}\n\nADD_OR_GAIN, CONVERT, and AILMENT_OR_MECHANIC_REPLACEMENT remain distinct. Lineage and seasonal supports are reported but are not ordinary Tier 3 candidates.\n\n### Standard Offense optimizer inventory\n\n${Object.entries(followup.optimizerSupportsByOffense).map(([offense, names]) => `- ${offense}: ${names.join(', ') || 'none'}`).join('\n')}\n\n## J. Likely false GAPs / modeling GAPs\n\n| Current GAP | Revised diagnostic interpretation | Evidence class |\n|---|---|---|\n${revisedGaps.map((gap) => `| ${gapLabel(gap)} | ${gap.interpretation} | ${gap.modelingReason || '—'} |`).join('\n')}\n\n- Likely false/modeling GAPs: ${revisedGaps.filter((gap) => gap.modelingReason).length}.\n- Remaining genuinely unresolved: ${revisedGaps.filter((gap) => !gap.modelingReason).map(gapLabel).join(', ') || 'none among the prior 12'}.\n\n## Architecture recommendations\n\n1. Future weapon legality should use structured weapon requirements as the hard boundary, then rank EXACT_NATIVE above EXPLICIT_BROAD_LEGALITY above UNRESTRICTED_CROSS_AFFINITY. This preserves weapon identity without discarding explicitly legal unusual constructions.\n2. Future Tier 3 should first prove the minimal required support chain, then independently fill an optional optimizer slot. Optional modifiers must never bootstrap fulfillment, and prevention/consumption must override name or affinity matches.\n3. DIRECT, CARRIER_BRIDGE, and FALLBACK precedence and support-slot behavior remain unchanged; structured weapon legality, support ontology closure, inherited Physical proof, and reservation enforcement are the only foundational runtime changes. No named-skill or Weapon × Offense exceptions were introduced.\n`;
fs.writeFileSync('docs/recommendation_gap_analysis_v3.md', report);
console.log(JSON.stringify(summary, null, 2));
