import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import {
  ASCENDANCY_BACKGROUND_PATHS,
  ASCENDANCY_BASE_CLASSES,
  getAscendancyBackgroundPath,
  getClassIconPath
} from '../js/ascendancy-visuals.js';

test('every current ascendancy has a pre-blurred ambiance asset', async () => {
  assert.equal(Object.keys(ASCENDANCY_BACKGROUND_PATHS).length, 23);
  assert.deepEqual(Object.keys(ASCENDANCY_BACKGROUND_PATHS), Object.keys(ASCENDANCY_BASE_CLASSES));
  await Promise.all(Object.values(ASCENDANCY_BACKGROUND_PATHS).map((path) => access(`.${path}`)));
  assert.equal(getAscendancyBackgroundPath('Smith of Kitava'), '/images/ascendancies/smith-of-kitava-blur.webp');
  assert.equal(getAscendancyBackgroundPath('Unknown Ascendancy'), '');
});

test('class icon lookup uses explicit class metadata and ascendancy fallback', async () => {
  assert.equal(getClassIconPath('Huntress', 'Amazon'), '/images/classes/huntress.webp');
  assert.equal(getClassIconPath('', 'Acolyte of Chayula'), '/images/classes/monk.webp');
  assert.equal(getClassIconPath('', 'Unknown Ascendancy'), '');
  await access(`.${getClassIconPath('Druid', 'Oracle')}`);
});
