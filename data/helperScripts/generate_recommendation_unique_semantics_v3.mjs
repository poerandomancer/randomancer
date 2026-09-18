#!/usr/bin/env node
import fs from 'node:fs';
import { compactUniqueSemantics } from './lib/recommendation_unique_semantics_v3.mjs';

const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const catalog = read('data/enriched/recommendation_catalog_v3.json');
const raw = read('data/enriched/poe2db_uniques_min.json');
const inventory = read('data/offense-inventory.json');
const offenses = inventory.elements.filter((offense) => offense.id !== 'critical_hits').slice(0, 15);
const semantics = compactUniqueSemantics(catalog, raw.items, offenses.map((offense) => offense.id));
fs.writeFileSync('data/enriched/recommendation_unique_semantics_v3.json', `${JSON.stringify(semantics)}\n`);
console.log(`Wrote compact semantics for ${Object.keys(semantics.byUniqueId).length} uniques.`);
