import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GENERIC_BUILD_FLAVOR, selectBuildFlavor } from '../js/build-flavor.js';

const manifest = JSON.parse(await readFile(new URL('../randomancer_flavor_manifest.json', import.meta.url)));
const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');

test('new build flavor prefers the selected class poetic pools', () => {
  const flavor = selectBuildFlavor(manifest, {
    className: 'Warrior', ascendancy: 'Titan', weapon: 'Mace', offense: 'Fire', random: () => 0
  });

  assert.equal(flavor, manifest.class_flavor.Warrior.base[0]);
  assert.notEqual(flavor, 'A fate drawn from one weapon family and the Offense it must carry.');
});

test('build flavor uses manifest fallback when its class has no lines', () => {
  assert.equal(
    selectBuildFlavor(manifest, { className: 'Unknown', random: () => 0 }),
    manifest.fallback_flavor[0]
  );
});

test('missing or malformed flavor manifests use a safe poetic fallback', () => {
  assert.equal(selectBuildFlavor(null, { className: 'Warrior', random: () => 0 }), GENERIC_BUILD_FLAVOR);
  assert.equal(selectBuildFlavor({ class_flavor: [], fallback_flavor: 'invalid' }, {}), GENERIC_BUILD_FLAVOR);
});

test('draw construction stores its selected flavor in the snapshot', () => {
  assert.match(engineSource, /flavor:\s*selectBuildFlavor\(/);
  assert.doesNotMatch(engineSource, /flavor:\s*['"]A fate drawn from one weapon family/);
});
