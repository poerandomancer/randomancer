import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  actualWeaponAllows, craftingPreference, optimizerRole, physicalInheritance,
  supportDerivedClosure, weaponRequirementProfile
} from '../data/helperScripts/lib/recommendation_gap_followup_v3.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const native = read('data/enriched/recommendation_native_coverage_v3.json');
const analysis = read('data/enriched/recommendation_gap_analysis_v3.json');
const followup = read('data/enriched/recommendation_gap_followup_v3.json');
const key = (cell) => `${cell.weapon}:${cell.offenseId}`;

test('analysis set is exactly authoritative GAP coverage', () => {
  const expected = native.cells.filter((cell) => cell.classification === 'GAP').map(key).sort();
  assert.deepEqual(analysis.cells.map(key).sort(), expected);
  assert.equal(analysis.cells.length, 24);
  assert.ok(analysis.cells.every((cell) => cell.nativeClassification === 'GAP'));
  assert.ok(!analysis.cells.some((cell) => cell.offenseId === 'critical_hits'));
});

test('every cell has the closed classification and confidence taxonomy', () => {
  const classifications = new Set(['SUPPORT_FIRST_SIMPLE', 'MULTI_SKILL', 'ACCESS_DEPENDENT',
    'CONDITIONAL_WEIRD', 'NO_CREDIBLE_SOLUTION']);
  const confidence = new Set(['STRONG', 'PLAUSIBLE', 'WEAK']);
  for (const cell of analysis.cells) {
    assert.ok(classifications.has(cell.primaryClassification));
    assert.ok(confidence.has(cell.confidence));
    assert.ok(cell.bestProposedRoute);
    assert.ok(Array.isArray(cell.multiSkillChains));
    assert.equal(cell.primaryClassification === 'ACCESS_DEPENDENT', Boolean(cell.accessDependency));
  }
});

test('STRONG routes retain complete semantic and runtime legality proof', () => {
  const strong = analysis.cells.filter((cell) => cell.confidence === 'STRONG');
  assert.ok(strong.length);
  for (const cell of strong) for (const route of cell.candidateSupportRoutes) {
    assert.ok(route.supports.length === 1 || route.supports.length === 2);
    assert.equal(route.semanticProof.allRequirementsMet, true);
    assert.equal(route.semanticProof.targetCompatibility, true);
    assert.equal(route.semanticProof.accessLegal, true);
    assert.equal(route.semanticProof.deliveryLegal, true);
    assert.equal(route.semanticProof.conflictsClear, true);
    if (route.supports.length === 2) {
      assert.ok(route.twoSupportChain);
      assert.equal(route.twoSupportChain.requirementsProven, true);
      assert.ok(route.twoSupportChain.intermediateMechanics.length);
    }
  }
});

test('simplicity ordering, prevention, and affinity boundaries remain explicit', () => {
  for (const cell of analysis.cells) {
    const lengths = cell.candidateSupportRoutes.map((route) => route.supports.length);
    assert.deepEqual(lengths, [...lengths].sort());
    assert.ok(cell.candidateSupportRoutes.every((route) =>
      !route.semanticProof.preventedMechanics.includes(route.semanticProof.mechanic)));
  }
  const electrocute = analysis.cells.find((cell) => key(cell) === 'Mace:electrocute');
  assert.equal(electrocute.bestProposedRoute.supports.length, 2);
  assert.ok(electrocute.bestProposedRoute.semanticProof.prerequisiteMechanics.length);
  const chill = analysis.cells.find((cell) => key(cell) === 'Mace:chill');
  assert.equal(chill.primaryClassification, 'NO_CREDIBLE_SOLUTION');
});

test('generation is deterministic and does not mutate runtime selector source', () => {
  const artifact = new URL('data/enriched/recommendation_gap_analysis_v3.json', root);
  const selector = new URL('js/30-recommendation-v3-selector.js', root);
  const followupArtifact = new URL('data/enriched/recommendation_gap_followup_v3.json', root);
  const hash = (url) => crypto.createHash('sha256').update(fs.readFileSync(url)).digest('hex');
  const beforeArtifact = hash(artifact);
  const beforeSelector = hash(selector);
  const beforeFollowup = hash(followupArtifact);
  execFileSync('node', ['data/helperScripts/generate_recommendation_gap_analysis_v3.mjs'], {
    cwd: root, stdio: 'ignore'
  });
  assert.equal(hash(artifact), beforeArtifact);
  assert.equal(hash(selector), beforeSelector);
  assert.equal(hash(followupArtifact), beforeFollowup);
  assert.equal(analysis.summary.runtimeBehaviorChanged, false);
  assert.equal(analysis.summary.namedSkillOrCellExceptionsIntroduced, false);
});

test('structured requirements are independent of crafting affinity', () => {
  const entity = (equipment, affinities = ['mace'], types = ['Attack']) => ({
    compatibility: { equipment }, crafting: { weapon_affinities: affinities },
    source_evidence: { active_skill_types: types }
  });
  const exact = entity({ display: 'Requires Bow', mainhand_tags_any_of: ['bow'] });
  assert.equal(weaponRequirementProfile(exact).requirementClass, 'EXACT_WEAPON');
  assert.equal(actualWeaponAllows(weaponRequirementProfile(exact), 'bow'), true);
  assert.equal(actualWeaponAllows(weaponRequirementProfile(exact), 'spear'), false);
  assert.equal(craftingPreference(exact, 'bow'), 'UNRESTRICTED_CROSS_AFFINITY');

  const multi = entity({ display: 'Requires Bow or Spear', mainhand_tags_any_of: ['bow', 'spear'] });
  assert.equal(weaponRequirementProfile(multi).requirementClass, 'MULTI_WEAPON');
  assert.equal(actualWeaponAllows(weaponRequirementProfile(multi), 'bow'), true);
  assert.equal(actualWeaponAllows(weaponRequirementProfile(multi), 'spear'), true);
  assert.equal(actualWeaponAllows(weaponRequirementProfile(multi), 'mace'), false);

  const broad = entity({ requirement_id: 'Any Martial Weapon', mainhand_tags_any_of:
    ['sword', 'axe', 'mace', 'quarterstaff', 'claw', 'dagger', 'spear', 'bow', 'flail', 'crossbow', 'talisman'] });
  assert.equal(weaponRequirementProfile(broad).requirementClass, 'ANY_MARTIAL');
  assert.equal(actualWeaponAllows(weaponRequirementProfile(broad), 'quarterstaff'), true);
  assert.equal(actualWeaponAllows(weaponRequirementProfile(broad), 'wand'), false);

  const unrestricted = entity({ is_unrestricted: true }, ['spear'], ['Companion']);
  assert.equal(weaponRequirementProfile(unrestricted).requirementClass, 'UNRESTRICTED');
  assert.equal(actualWeaponAllows(weaponRequirementProfile(unrestricted), 'mace'), true);
  assert.equal(craftingPreference(unrestricted, 'spear'), 'EXACT_NATIVE');
});

test('archetype regression findings derive from generic structured facts', () => {
  assert.ok(followup.regressionFindings.anyMartialTotemCreators.length);
  for (const creator of followup.regressionFindings.anyMartialTotemCreators) {
    const audited = followup.weaponAudit.skills.find((skill) => skill.entityId === creator.entityId);
    assert.equal(audited.weaponRequirement.requirementClass, 'ANY_MARTIAL');
    assert.equal(audited.identity.totem, true);
  }
  assert.ok(followup.regressionFindings.unrestrictedCompanionCreators.length);
  for (const creator of followup.regressionFindings.unrestrictedCompanionCreators) {
    const audited = followup.weaponAudit.skills.find((skill) => skill.entityId === creator.entityId);
    assert.equal(audited.weaponRequirement.requirementClass, 'UNRESTRICTED');
    assert.equal(audited.identity.companion, true);
    assert.equal(creator.reservesSpirit, false);
  }
  assert.ok(followup.regressionFindings.reservationCompanionCreators.some((creator) =>
    creator.activeSkillTypes.includes('HasReservation') && creator.activeSkillTypes.includes('Persistent')));
});

test('support closure requires typed damage, Hit delivery, ontology, and no prevention', () => {
  const active = { source_evidence: { active_skill_types: ['Attack'] } };
  const rules = [{ source: 'freeze', target: 'cold', relation: 'native_affinity',
    fulfills_source_from_target: true, requires_hit: true }];
  const support = { compatibility: { target_skill: {} }, facts: [{ subject: 'supported_skill',
    relation: 'provides', mechanic: 'cold', confidence: 'exact' }] };
  assert.ok(supportDerivedClosure(active, support, 'freeze', rules));
  const prevented = { ...support, facts: [...support.facts, { subject: 'supported_skill',
    relation: 'prevents', mechanic: 'freeze', confidence: 'exact' }] };
  assert.equal(supportDerivedClosure(active, prevented, 'freeze', rules), null);
  assert.equal(supportDerivedClosure({ source_evidence: { active_skill_types: ['Buff'] } }, support, 'freeze', rules), null);
});

test('optimizer roles cannot establish validity and reject consumption or prevention', () => {
  const gem = (relation, condition = null) => ({ facts: [{ subject: 'supported_skill', relation,
    mechanic: 'freeze', confidence: 'exact', condition }] });
  assert.equal(optimizerRole(gem('modifies'), 'freeze'), 'OPTIONAL_OFFENSE_OPTIMIZER');
  assert.equal(optimizerRole(gem('provides'), 'freeze'), null);
  assert.equal(optimizerRole(gem('consumes'), 'freeze'), 'CONSUMER');
  assert.equal(optimizerRole(gem('prevents'), 'freeze'), 'PREVENTION');
  assert.equal(optimizerRole(gem('modifies', 'frozen_enemy'), 'freeze'), 'CONDITIONAL');
});

test('Physical inheritance respects complete and unknown conversion', () => {
  const active = (facts) => ({ source_evidence: { active_skill_types: ['Attack', 'Melee'] }, facts });
  assert.equal(physicalInheritance(active([])).physicalRemains, true);
  assert.equal(physicalInheritance(active([{ relation: 'converts', from: 'physical', to: 'fire',
    percent: 100, confidence: 'exact' }])).physicalRemains, false);
  const unknown = physicalInheritance(active([{ relation: 'converts', from: 'physical', to: 'cold', confidence: 'exact' }]));
  assert.equal(unknown.physicalRemains, false);
  assert.equal(unknown.conversionUnknown, true);
});
