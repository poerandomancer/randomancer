#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { generateRecommendationRichnessAudit, renderRecommendationRichnessReport } from './recommendation-richness-audit-lib.mjs';

const output = new URL('../tmp/recommendation-richness-audit.json', import.meta.url);
const audit = await generateRecommendationRichnessAudit();
await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
const report = new URL('../tmp/recommendation-richness-audit.md', import.meta.url);
await writeFile(report, renderRecommendationRichnessReport(audit));
console.log(`Wrote ${audit.summary.totalCases} deterministic richness cases to ${output.pathname} and ${report.pathname}`);
