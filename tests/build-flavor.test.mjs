import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GENERIC_BUILD_FLAVOR, selectBuildFlavor } from '../js/build-flavor.js';

const manifest = JSON.parse(await readFile(new URL('../randomancer_flavor_manifest.json', import.meta.url)));
const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');
const stateSource = await readFile(new URL('../js/04-app-state.js', import.meta.url), 'utf8');
const hydrationSource = await readFile(new URL('../js/00-locks-and-snapshots.js', import.meta.url), 'utf8');
const selectorSource = await readFile(new URL('../js/build-flavor.js', import.meta.url), 'utf8');

test('ascendancy flavor takes priority without mixing lower-priority pools', () => {
  const flavor = selectBuildFlavor(manifest, {
    className: 'Warrior', ascendancy: 'Titan', random: () => 0
  });

  assert.equal(flavor, manifest.build_flavor.ascendancies.Titan[0]);
  assert.ok(!manifest.build_flavor.classes.Warrior.includes(flavor));
  assert.ok(!manifest.build_flavor.fallback.includes(flavor));
});

test('class flavor is used when the ascendancy pool is missing or empty', () => {
  const fixture = {
    build_flavor: {
      ascendancies: { Missing: [] },
      classes: { Warrior: ['Class fallback.'] },
      fallback: ['Global fallback.']
    }
  };

  assert.equal(selectBuildFlavor(fixture, { className: 'Warrior', ascendancy: 'Missing', random: () => 0 }), 'Class fallback.');
});

test('global flavor is used when ascendancy and class pools are unavailable', () => {
  assert.equal(
    selectBuildFlavor({ build_flavor: { fallback: ['Global fallback.'] } }, { className: 'Unknown', ascendancy: 'Missing', random: () => 0 }),
    'Global fallback.'
  );
});

test('invalid manifests retain a safe atmospheric fallback', () => {
  assert.equal(selectBuildFlavor(null), GENERIC_BUILD_FLAVOR);
  assert.equal(selectBuildFlavor({ build_flavor: { fallback: 'invalid' } }), GENERIC_BUILD_FLAVOR);
});

test('manifest covers every live class and each supplied live ascendancy pool', () => {
  for (const className of Object.keys(core.Classes)) {
    assert.ok(manifest.build_flavor.classes[className]?.length, `missing class flavor: ${className}`);
  }

  const flavorAscendancies = Object.keys(manifest.build_flavor.ascendancies);
  const liveAscendancies = new Set(Object.values(core.Classes).flatMap(({ ascendancies }) => ascendancies));
  for (const ascendancy of flavorAscendancies) {
    assert.ok(liveAscendancies.has(ascendancy), `non-live ascendancy flavor: ${ascendancy}`);
    assert.ok(manifest.build_flavor.ascendancies[ascendancy]?.length, `empty ascendancy flavor: ${ascendancy}`);
  }
});

test('obsolete build-flavor keys and selector concepts are removed', () => {
  for (const key of ['fallback_flavor', 'class_flavor', 'ascendancy_flavor']) assert.ok(!(key in manifest));
  for (const obsolete of ['named_lore', 'lore_mode', 'fallback_flavor', 'class_flavor', 'ascendancy_flavor']) {
    assert.doesNotMatch(selectorSource, new RegExp(obsolete));
  }
});

test('selected flavor remains a stored snapshot outcome through render and hydration', () => {
  assert.match(engineSource, /flavor:\s*selectBuildFlavor\(/);
  assert.match(stateSource, /flavor:\s*src\.flavor\s*\|\|\s*['"]['"]/);
  assert.match(hydrationSource, /flavor:\s*draw\.f\s*\|\|\s*['"]['"]/);
  assert.match(hydrationSource, /#build-subtext[^\n]+snap\.flavor/);
});
