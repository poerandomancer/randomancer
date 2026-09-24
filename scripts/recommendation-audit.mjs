#!/usr/bin/env node
// Run from the repository root: node scripts/recommendation-audit.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { generateRecommendationAudit } from './recommendation-audit-lib.mjs';

const diversity = process.argv.includes('--diversity');
const repetitions = diversity ? 10 : undefined;
const output = new URL(diversity ? '../tmp/recommendation-diversity-audit.json' : '../tmp/recommendation-audit.json', import.meta.url);
const audit = await generateRecommendationAudit({ repetitions });
await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Wrote ${audit.summary.totalCases} deterministic${diversity ? ' diversity' : ''} cases to ${output.pathname}`);
