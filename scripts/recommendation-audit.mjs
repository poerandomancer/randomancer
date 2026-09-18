#!/usr/bin/env node
// Run from the repository root: node scripts/recommendation-audit.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { generateRecommendationAudit } from './recommendation-audit-lib.mjs';

const output = new URL('../tmp/recommendation-audit.json', import.meta.url);
const audit = await generateRecommendationAudit();
await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Wrote ${audit.summary.totalCases} deterministic cases to ${output.pathname}`);
