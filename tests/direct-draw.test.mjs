import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const offense = await import('../js/26-offense-roll.js');
const equipment = await import('../js/06-equipment.js');
const inventory = JSON.parse(await readFile(new URL('../data/offense-inventory.json', import.meta.url)));
const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const entry = await readFile(new URL('../core-script.js', import.meta.url), 'utf8');
const modeSource = await readFile(new URL('../js/16-challenge-mode.js', import.meta.url), 'utf8');
const primaryStageSource = await readFile(new URL('../js/24-primary-card-stage.js', import.meta.url), 'utf8');
const controlsCss = await readFile(new URL('../css/20-controls.css', import.meta.url), 'utf8');
const summaryCss = await readFile(new URL('../css/80-summary.css', import.meta.url), 'utf8');

test('canonical Offense draw always contains exactly one concept', () => {
  for (let index = 0; index < 100; index += 1) {
    const result = offense.selectOffense({ data: { OffenseInventory: inventory }, random: () => index / 100 });
    assert.equal(result.error, null);
    assert.equal(result.picks.length, 1);
    const snapshot = offense.buildOffenseSnapshotFields(result.picks);
    assert.equal(snapshot.offenseList.length, 1);
    assert.equal(snapshot.offenseSet.length, 1);
  }
});

test('Critical Hits is excluded from standard draws', () => {
  assert.equal(offense.isRollableOffense({ id: 'critical_hits', name: 'Critical Hits' }), false);
});

test('Bind the Fates combat options use every rollable Offense ID and no others', async () => {
  const uiSource = await readFile(new URL('../js/09-bind-fates-ui.js', import.meta.url), 'utf8');
  assert.match(uiSource, /resolveRollableOffenseElements\(data\)\.map\(\(entry\) => \(\{[\s\S]*?name: entry\.id,[\s\S]*?label: entry\.name,[\s\S]*?kind: 'offense'/);
  assert.doesNotMatch(uiSource, /data\.(?:Ailments|Tactics)/);

  const expectedIds = inventory.elements.filter(offense.isRollableOffense).map((entry) => entry.id);
  const bindFatesIds = offense.resolveRollableOffenseElements({ OffenseInventory: inventory }).map((entry) => entry.id);
  assert.deepEqual(bindFatesIds, expectedIds);
  assert.ok(!bindFatesIds.includes('critical_hits'));
});

test('a requested legacy count cannot produce multiple Offense concepts', () => {
  const result = offense.selectOffense({ data: { Offense: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, count: 2, random: () => 0 });
  assert.deepEqual(result.picks.map((entry) => entry.id), ['a']);
});

test('Bind the Fates favors and bans canonical Offense', () => {
  const data = { Offense: [{ id: 'fire', name: 'Fire' }, { id: 'cold', name: 'Cold' }] };
  const result = offense.selectOffense({ data, count: 1, bindFates: { combat: { oaths: ['cold'], abominations: ['fire'] } }, random: () => 0 });
  assert.equal(result.picks[0].name, 'Cold');
});

test('Bind the Fates Abominations can make a single Offense draw impossible', () => {
  const data = { Offense: [{ id: 'fire', name: 'Fire' }] };
  const result = offense.selectOffense({ data, bindFates: { combat: { abominations: ['fire'] } }, random: () => 0 });
  assert.deepEqual(result.picks, []);
  assert.match(result.error, /No valid Offense concept/);
});

test('obsolete Bind the Fates mechanic IDs are ignored safely', () => {
  const data = { Offense: [{ id: 'fire', name: 'Fire' }, { id: 'cold', name: 'Cold' }] };
  const result = offense.selectOffense({
    data,
    count: 1,
    bindFates: { combat: { oaths: ['thorns'], abominations: ['culling_strike', 'slow_maim_hinder'] } },
    random: () => 0
  });
  assert.equal(result.error, null);
  assert.equal(result.picks[0].id, 'fire');
});

test('weapon-family derivation collapses handed variants', () => {
  const families = equipment.deriveWeaponFamilies(core);
  assert.equal(new Set(families.map((family) => family.name)).size, families.length);
  assert.ok(families.some((family) => family.aliases.length > 1));
});

test('Bind the Fates weapon options exactly match the core Build weapon categories', async () => {
  const uiSource = await readFile(new URL('../js/09-bind-fates-ui.js', import.meta.url), 'utf8');
  const coreWeaponCategories = equipment.deriveWeaponFamilies(core).map((family) => family.name);

  assert.deepEqual(coreWeaponCategories, [
    'Mace', 'Quarterstaff', 'Bow', 'Crossbow', 'Staff', 'Talisman', 'Wand', 'Sceptre', 'Spear'
  ]);
  assert.match(uiSource, /return deriveWeaponFamilies\(data\)\.map\(\(family\) => family\.name\);/);
  assert.doesNotMatch(uiSource, /data\.Weapons\?\.\['(?:Two|One)-Handed'\]/);
});

test('weapon-family Bind the Fates honors legality', () => {
  const families = [{ name: 'Bow' }, { name: 'Wand' }];
  assert.equal(equipment.pickWeaponFamily(families, { oaths: ['Wand'], abominations: ['Bow'] }, () => 0).name, 'Wand');
});

test('standard engine invokes the package selector directly', () => {
  assert.match(engineSource, /selectRecommendationPackageV3\(catalog, draw/);
  assert.match(engineSource, /randomancer:draw-complete/);
});

test('canonical draw has no obsolete standard fields', () => {
  const stateSource = engineSource.slice(engineSource.indexOf("schema: 'randomancer-draw-v1'"), engineSource.indexOf('const catalog'));
  assert.doesNotMatch(stateSource, /weapon2|offhand2|ailmentSet|tacticSet|defStrat|rollAttr/);
});

test('obsolete standard controls and migration runtimes are absent', () => {
  assert.doesNotMatch(html, /weapon-set2-toggle|mechanics-count-btn|id="ailments"|id="tactics"/);
  assert.doesNotMatch(entry, /27-offense-runtime|28-primary-equipment-runtime|29-selection-frequency-runtime|31-recommendation-v3-runtime/);
});

test('standard and Codex entry points remain mounted without Legacy', () => {
  for (const id of ['build-panel', 'codex-panel']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(primaryStageSource, /primary-build-card-stage/);
  assert.doesNotMatch(html, /data-mode-target="legacy"|id="legacy-(?:panel|controls)"/);
  assert.doesNotMatch(entry, /21-legacy-mode/);
  assert.doesNotMatch(modeSource, /MODES\.LEGACY|RandomancerLegacy|legacy-mode/);
  assert.match(modeSource, /new URLSearchParams\(location\.search\)\.get\(['"]mode['"]\)\s*===\s*MODES\.CODEX/);
  assert.match(modeSource, /localStorage\.getItem\(MODE_KEY\)\s*===\s*MODES\.CODEX\s*\?\s*MODES\.CODEX\s*:\s*MODES\.STANDARD/);
  assert.match(modeSource, /catch\s*\{\s*return MODES\.STANDARD;?\s*\}/);
  assert.match(modeSource, /setMode\(getMode\(\)\)/);
  assert.match(controlsCss, /--seg-count:\s*2/);
  assert.match(controlsCss, /grid-template-columns:\s*repeat\(2,/);
  assert.doesNotMatch(controlsCss, /--seg-count:\s*[34]|grid-template-columns:\s*repeat\([34],/);
});

test('the primary Challenge stage binds the shared interactive tooltip handlers', () => {
  assert.match(primaryStageSource, /attachTooltipHandlers\(stage\.querySelector\(`/);
});

test('the Contracts cards reuse delegated Challenge entity tooltips above the card stack', () => {
  assert.match(modeSource, /getElementById\('contracts-overlay'\)/);
  assert.match(modeSource, /closest\?\.\('\.task-val\.has-tip'\)/);
  assert.match(modeSource, /SKILL_FAMILY_2/);
  assert.match(summaryCss, /\.rc-tooltip\{[\s\S]*?z-index:8100/);
  assert.match(summaryCss, /\.contracts-overlay\{[^}]*z-index:8000/);
});
