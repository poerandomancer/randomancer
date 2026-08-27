import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  analyzeWholeUnique, classifyEmpty, legalForWeapon, qualityBand, rankCandidates
} from '../data/helperScripts/lib/recommendation_unique_analysis_v3.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const artifact = read('data/enriched/recommendation_unique_analysis_v3.json');
const runtimeSemantics = read('data/enriched/recommendation_unique_semantics_v3.json');

test('jewelry diagnostic is offense-level, slot-legal, and capacity-safe', () => {
  assert.equal(artifact.jewelryCells.length, 15);
  assert.equal(artifact.summary.jewelry.eligibleRings, 37);
  assert.equal(artifact.summary.jewelry.eligibleAmulets, 25);
  for (const cell of artifact.jewelryCells) {
    assert.ok(cell.selected.length <= 2);
    assert.ok(cell.selected.filter((entry) => entry.itemType === 'Amulet').length <= 1);
    assert.equal(new Set(cell.selected.map((entry) => entry.id)).size, cell.selected.length);
    assert.ok(cell.selected.every((entry) => ['Ring', 'Amulet'].includes(entry.itemType)));
  }
});
const fact = (relation, mechanic, extra = {}) => ({ relation, mechanic, confidence: 'exact', ...extra });
const unique = (facts = [], extra = {}) => ({ id: 'unique:test', source_id: 'test||Bow', name: 'Test', content_type: 'unique',
  facts, compatibility: { equipment: { slot: 'Bow', base: 'Bow' } }, ...extra });
const sources = (granted = [], raw = { key: 'test||Bow', granted_skills: [{ name: 'Granted' }], implicit_mods: [], explicit_mods: [] }) => ({
  rawByKey: new Map([[raw.key, raw]]), entitiesByName: new Map([['Granted', granted]])
});

test('artifact covers the deterministic 135 Weapon × Offense cells compactly', () => {
  assert.equal(artifact.cells.length, 135);
  assert.equal(new Set(artifact.cells.map((cell) => `${cell.weapon}:${cell.offenseId}`)).size, 135);
  assert.ok(artifact.cells.every((cell) => cell.candidates.length <= 3));
  assert.equal(artifact.summary.runtimeSelectorChanged, true);
  assert.equal(artifact.summary.namedItemOrCellExceptionsIntroduced, false);
});

test('granted skills, effects, and nested components retain parent provenance', () => {
  const granted = { id: 'skill:granted', name: 'Granted', facts: [fact('inflicts', 'ignite')],
    source_evidence: { granted_effects: [{ facts: [fact('provides', 'ignite')] }] },
    components: [{ name: 'Explosion', facts: [fact('modifies', 'ignite')] }] };
  const parent = unique([], { granted_effects: [fact('provides', 'ignite')] });
  const result = analyzeWholeUnique(parent, 'ignite', sources([granted]));
  assert.deepEqual(new Set(result.records.map((entry) => entry.provenance.sourceType)),
    new Set(['granted_skill', 'granted_effect', 'nested_component']));
  assert.ok(result.records.every((entry) => entry.provenance.parentUniqueId === parent.id));
  assert.ok(result.records.some((entry) => entry.provenance.component === 'Explosion'));
});

test('runtime promotion is compact while diagnostics retain richer provenance', () => {
  const fair = runtimeSemantics.byUniqueId["Fairgraves' Curse||Artillery Bow"].ignite;
  assert.ok(fair.facts.some((entry) => entry.k === 'granted_skill' && entry.e?.startsWith('skill:')));
  assert.ok(fair.facts.every((entry) => !Object.hasOwn(entry, 'evidence') && !Object.hasOwn(entry, 'provenance')));
  const diagnostic = artifact.cells.find((cell) => cell.weapon === 'Bow' && cell.offenseId === 'ignite').proposed;
  assert.ok(diagnostic.evidence.some((entry) => entry.provenance.evidenceKind));
});

test('one capability outranks shallow affinity volume and payoff is not capability', () => {
  const capability = { id: 'cap', name: 'Capability', bestTier: 'BUILD_DEFINING_CAPABILITY', proposedScore: 405, contradiction: false };
  const affinity = { id: 'aff', name: 'Affinity', bestTier: 'AFFINITY_AMPLIFICATION', proposedScore: 299, contradiction: false };
  assert.equal(rankCandidates([affinity, capability])[0].id, 'cap');
  const payoff = analyzeWholeUnique(unique([fact('consumes', 'ignite')]), 'ignite', sources([],
    { key: 'test||Bow', granted_skills: [], implicit_mods: [], explicit_mods: [] }));
  assert.equal(payoff.bestTier, 'PAYOFF_CONTEXT');
});

test('contradiction overrides positives and conversion remains directional', () => {
  const blocked = analyzeWholeUnique(unique([fact('inflicts', 'ignite'), fact('prevents', 'ignite')]), 'ignite', sources([]));
  assert.equal(blocked.contradiction, true);
  assert.deepEqual(rankCandidates([{ id: 'blocked', name: 'Blocked', ...blocked }]), []);
  const toward = analyzeWholeUnique(unique([{ relation: 'converts', from: 'physical', to: 'fire' }]), 'fire', sources([]));
  const away = analyzeWholeUnique(unique([{ relation: 'converts', from: 'fire', to: 'cold' }]), 'fire', sources([]));
  assert.equal(toward.bestTier, 'BUILD_DEFINING_CAPABILITY');
  assert.equal(away.bestTier, 'CONTRADICTION_PREVENTION');
});

test('Bow and Quiver legality carries no slot priority', () => {
  const bow = unique();
  const quiver = { ...unique(), id: 'unique:quiver', compatibility: { equipment: { slot: 'Quiver', base: 'Quiver' } } };
  assert.equal(legalForWeapon(bow, 'Bow'), true);
  assert.equal(legalForWeapon(quiver, 'Bow'), true);
  const ranked = rankCandidates([
    { id: 'quiver', name: 'Quiver', bestTier: 'AFFINITY_AMPLIFICATION', proposedScore: 299, contradiction: false },
    { id: 'bow', name: 'Bow', bestTier: 'BUILD_DEFINING_CAPABILITY', proposedScore: 405, contradiction: false }
  ]);
  assert.equal(ranked[0].id, 'bow');
});

test('empty classification and quality bands are deterministic and conservative', () => {
  assert.equal(classifyEmpty([], 4), 'GENUINELY_NO_RELEVANT_UNIQUE');
  const candidates = [
    { id: 'a', name: 'A', bestTier: 'BUILD_DEFINING_CAPABILITY', proposedScore: 410, contradiction: false },
    { id: 'b', name: 'B', bestTier: 'BUILD_DEFINING_CAPABILITY', proposedScore: 403, contradiction: false },
    { id: 'c', name: 'C', bestTier: 'STRONG_SPECIALIZATION', proposedScore: 399, contradiction: false }
  ];
  const first = qualityBand(rankCandidates(candidates)); const second = qualityBand(rankCandidates(candidates));
  assert.deepEqual(first.map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(second, first);
});

test("Fairgraves and Blackgleam are generic regression evidence, not exceptions", () => {
  const ignite = artifact.cells.find((cell) => cell.weapon === 'Bow' && cell.offenseId === 'ignite');
  const fire = artifact.cells.find((cell) => cell.weapon === 'Bow' && cell.offenseId === 'fire');
  assert.equal(ignite.previous.name, 'Blackgleam');
  assert.equal(ignite.current.name, "Fairgraves' Curse");
  assert.equal(ignite.proposed.name, "Fairgraves' Curse");
  assert.equal(fire.previous, null);
  assert.equal(fire.current.name, "Fairgraves' Curse");
  assert.equal(fire.proposed.name, "Fairgraves' Curse");
  assert.ok(ignite.proposed.evidence.some((entry) => entry.provenance.sourceName === 'Phantasmal Arrow'));
});

test('generation is deterministic and does not mutate runtime selector bytes', () => {
  const json = new URL('data/enriched/recommendation_unique_analysis_v3.json', root);
  const markdown = new URL('docs/recommendation_unique_analysis_v3.md', root);
  const runtime = new URL('js/31-non-skill-recommendation-selector.js', root);
  const semantics = new URL('data/enriched/recommendation_unique_semantics_v3.json', root);
  const hash = (url) => crypto.createHash('sha256').update(fs.readFileSync(url)).digest('hex');
  const before = [hash(json), hash(markdown), hash(runtime), hash(semantics)];
  execFileSync('node', ['data/helperScripts/generate_recommendation_unique_analysis_v3.mjs'], { cwd: root, stdio: 'ignore' });
  assert.deepEqual([hash(json), hash(markdown), hash(runtime), hash(semantics)], before);
});
