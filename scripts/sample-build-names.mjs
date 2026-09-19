#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resetRecentBuildNames, selectBuildName, weaponDisplayName } from '../js/build-name.js';

const names = JSON.parse(await readFile(new URL('../randomancer_build_names.json', import.meta.url)));
const core = JSON.parse(await readFile(new URL('../data/core-data.json', import.meta.url)));
const ascendancies = Object.values(core.Classes).flatMap(({ ascendancies: values }) => values);
const weapons = [...new Set(Object.values(core.Weapons).flat().map((entry) => entry?.name).filter(Boolean).map(weaponDisplayName))];
const offenses = [...Object.keys(names.offenseFamilies), ...Object.keys(names.offenseOverrides)];
const requested = Number.parseInt(process.argv[2], 10);
const count = Number.isFinite(requested) && requested > 0 ? requested : Math.max(weapons.length, offenses.length) * 3;
let state = 0x9e3779b9;
const random = () => ((state = Math.imul(state ^ (state >>> 16), 0x21f0aaad)) >>> 0) / 4294967296;

resetRecentBuildNames();
for (let index = 0; index < count; index += 1) {
  const context = {
    ascendancy: ascendancies[index % ascendancies.length],
    weapon: weapons[index % weapons.length],
    offense: offenses[index % offenses.length]
  };
  const name = selectBuildName(names, context, { random });
  process.stdout.write(`${context.ascendancy} | ${context.weapon} | ${context.offense} => ${name}\n`);
}
