import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resetRecentBuildNames, selectBuildName, weaponDisplayName } from '../js/build-name.js';

const manifest = JSON.parse(await readFile(new URL('../randomancer_build_names.json', import.meta.url)));
const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');
const context = { className:'Sorceress', ascendancy:'Chronomancer', weapon:'Bow', offense:'Poison' };

function onlyFamily(family) {
  return { ...manifest, templateWeights: Object.fromEntries(Object.keys(manifest.templates).map(k => [k, k === family ? 1 : 0])), settings:{...manifest.settings,recentHistorySize:0} };
}

test('all four data-defined template families compose valid concise output', () => {
  for (const family of Object.keys(manifest.templates)) {
    resetRecentBuildNames();
    const name = selectBuildName(onlyFamily(family), context, { random:()=>0 });
    assert.match(name, /^The /); assert.doesNotMatch(name, /[{}]|undefined|\s{2,}/);
    assert.ok(name.length <= manifest.settings.maxCharacters);
    assert.ok(name.split(/\s+/).length <= manifest.settings.maxWords);
  }
});

test('three-input and two-input templates use exactly their declared dimensions', () => {
  const fixture={settings:{maxCharacters:80,maxWords:10,recentHistorySize:0},templateWeights:{ascendancy_weapon_offense:1},templates:{ascendancy_weapon_offense:[{pattern:'{ascendancy.adjective} {weapon.bearer} {offense.noun}',weight:1}]},ascendancies:{A:{adjective:['ASC']}},weapons:{W:{bearer:['WEAPON']}},offenseFamilies:{chaos:{noun:['OFFENSE']}}};
  assert.equal(selectBuildName(fixture,{ascendancy:'A',weapon:'W',offense:'Chaos'},{random:()=>0}),'ASC WEAPON OFFENSE');
  fixture.templateWeights={ascendancy_weapon:1}; fixture.templates={ascendancy_weapon:[{pattern:'{ascendancy.adjective} {weapon.bearer}',weight:1}]};
  assert.equal(selectBuildName(fixture,{ascendancy:'A',weapon:'W',offense:'Chaos'},{random:()=>0}),'ASC WEAPON');
});

test('exact offense overrides inherit family vocabulary', () => {
  const fixture={...onlyFamily('ascendancy_offense'),templates:{ascendancy_offense:[{pattern:'The {offense.adjective} {ascendancy.identity}',weight:1}]}};
  resetRecentBuildNames();
  assert.match(selectBuildName(fixture,context,{random:()=>0}),/Venomous/);
  resetRecentBuildNames();
  assert.match(selectBuildName(fixture,context,{random:()=>.999}),/Withering|Void-Touched|Blackened/);
});

test('missing slots make templates ineligible and malformed manifests safely fall back', () => {
  const bad={templateWeights:{x:1},templates:{x:[{pattern:'The {weapon.bearer}',weight:1}]},fallback:{generic:'The Unwritten Fate'}};
  assert.equal(selectBuildName(bad,{}, {random:()=>0}),'The Unwritten Fate');
  assert.equal(selectBuildName(null,{}),'The Unwritten Fate');
});

test('limits and collision keys reject bad candidates without unbounded looping', () => {
  const base={settings:{maxCharacters:12,maxWords:2,maxAttempts:2},templateWeights:{x:1},templates:{x:[{pattern:'The {ascendancy.adjective} {offense.noun}',weight:1}]},ascendancies:{A:{adjective:[{text:'Stormwoven',collisionKeys:['storm']}]}},offenseFamilies:{lightning:{noun:[{text:'Storm',collisionKeys:['storm']}]}}};
  assert.equal(selectBuildName(base,{ascendancy:'A',offense:'Shock'},{random:()=>0}),'The Unwritten Pilgrim');
});

test('recent exact duplicates reroll and retry cap remains finite', () => {
  const fixture={settings:{maxCharacters:40,maxWords:5,maxAttempts:4,recentHistorySize:9},templateWeights:{x:1},templates:{x:[{pattern:'The {ascendancy.adjective} {weapon.bearer}',weight:1}]},ascendancies:{A:{adjective:['First','Second']}},weapons:{Bow:{bearer:['Archer']}}};
  resetRecentBuildNames(); let values=[0,0,0,0,0,0,.9,0]; const random=()=>values.shift()??0;
  assert.equal(selectBuildName(fixture,{ascendancy:'A',weapon:'Bow'},{random}),'The First Archer');
  assert.equal(selectBuildName(fixture,{ascendancy:'A',weapon:'Bow'},{random}),'The Second Archer');
});

test('weapon normalization and live vocabulary coverage are complete', () => {
  assert.equal(weaponDisplayName(' Two-handed Mace '),'Mace');
  for(const {ascendancies} of Object.values(core.Classes)) for(const name of ascendancies) assert.ok(manifest.ascendancies[name]?.adjective?.length && manifest.ascendancies[name]?.identity?.length, name);
  const weapons=new Set(Object.values(core.Weapons).flat().map(x=>x.name).filter(Boolean).map(weaponDisplayName));
  for(const weapon of weapons) assert.ok(manifest.weapons[weapon]?.adjective?.length && manifest.weapons[weapon]?.bearer?.length,weapon);
});

test('draw construction stores the selected asset-generated name',()=>{
  assert.match(engineSource,/buildName:\s*selectBuildName\(buildNameManifest, presentationContext/);
});
