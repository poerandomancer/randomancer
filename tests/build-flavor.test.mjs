import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GENERIC_BUILD_FLAVOR, selectBuildFlavor } from '../js/build-flavor.js';

const manifest = JSON.parse(await readFile(new URL('../randomancer_flavor_manifest.json', import.meta.url)));
const engineSource = await readFile(new URL('../js/10-roll-engine.js', import.meta.url), 'utf8');

test('new build flavor prefers the selected ascendancy pool', () => {
  const flavor = selectBuildFlavor(manifest, {
    className: 'Warrior', ascendancy: 'Titan', weapon: 'Mace', offense: 'Fire', random: () => 0
  });

  assert.equal(flavor, manifest.ascendancy_flavor.Warrior.Titan[0].replace(/^Titan:\s*/, ''));
  assert.doesNotMatch(flavor, /^(?:Titan|Warrior)\s*:/);
  assert.notEqual(flavor, 'A fate drawn from one weapon family and the Offense it must carry.');
});

test('ascendancy names embedded in a tagline are excluded from card flavor', () => {
  const flavor = selectBuildFlavor(manifest, {
    className: 'Monk', ascendancy: 'Acolyte of Chayula', random: () => 0
  });

  assert.equal(flavor, 'Reality frays at the edges; you pull on the loose threads.');
  assert.doesNotMatch(flavor, /Chayula|Acolyte|Monk/i);
});

test('ascendancy taglines remove identity labels before reaching the card', () => {
  const taggedManifest = {
    ascendancy_flavor: { Witch: { Lich: ['Lich: The dead keep excellent counsel.'] } },
    class_flavor: { Witch: { base: ['Witch: A forbidden fallback.'] } },
    fallback_flavor: ['A final fallback.']
  };

  assert.equal(
    selectBuildFlavor(taggedManifest, { className: 'Witch', ascendancy: 'Lich', random: () => 0 }),
    'The dead keep excellent counsel.'
  );
  assert.equal(
    selectBuildFlavor(taggedManifest, { className: 'Witch', ascendancy: 'Unknown', random: () => 0 }),
    GENERIC_BUILD_FLAVOR
  );
});

test('build flavor never uses class, lore, fallback, intro, or subtitle pools', () => {
  const restrictedManifest = {
    intro: { lore: ['Forbidden intro lore.'], meta: ['Forbidden intro meta.'] },
    subtitles: ['Forbidden subtitle.'],
    class_flavor: {
      Warrior: {
        base: ['Allowed base line.'],
        named_lore: ['Forbidden named lore.'],
        lore_mode: ['Forbidden lore mode.']
      }
    },
    fallback_flavor: ['Forbidden manifest fallback.']
  };

  assert.equal(selectBuildFlavor(restrictedManifest, { className: 'Warrior', ascendancy: 'Unknown', random: () => 0.99 }), GENERIC_BUILD_FLAVOR);
});

test('build flavor uses the safe generic when no ascendancy tagline exists', () => {
  assert.equal(selectBuildFlavor(manifest, { className: 'Unknown', random: () => 0 }), GENERIC_BUILD_FLAVOR);
});

test('missing or malformed flavor manifests use a safe poetic fallback', () => {
  assert.equal(selectBuildFlavor(null, { className: 'Warrior', random: () => 0 }), GENERIC_BUILD_FLAVOR);
  assert.equal(selectBuildFlavor({ class_flavor: [], fallback_flavor: 'invalid' }, {}), GENERIC_BUILD_FLAVOR);
});

test('draw construction stores its selected flavor in the snapshot', () => {
  assert.match(engineSource, /flavor:\s*selectBuildFlavor\(/);
  assert.doesNotMatch(engineSource, /flavor:\s*['"]A fate drawn from one weapon family/);
});
