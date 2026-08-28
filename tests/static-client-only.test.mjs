import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const textFiles = [];
for (const directory of ['js', 'css']) {
  const walk = (path) => readdirSync(path).forEach((name) => {
    const child = join(path, name);
    if (statSync(child).isDirectory()) walk(child);
    else if (/\.(?:js|css)$/.test(name)) textFiles.push(child);
  });
  walk(new URL(`../${directory}`, import.meta.url).pathname);
}
const runtimeSource = textFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

test('runtime source has no Randomancer backend endpoints or retired feature modules', () => {
  assert.doesNotMatch(runtimeSource, /(?:api|cards)\.therandomancer\.com/i);
  assert.doesNotMatch(runtimeSource, /publicCard|market-price|pricecheck|sharedCard/i);
});

test('unique renderers retain poe.ninja actions without market controls', () => {
  const uniques = readFileSync(new URL('../js/12-uniques-engine.js', import.meta.url), 'utf8');
  const codex = readFileSync(new URL('../js/18-codex-mode.js', import.meta.url), 'utf8');
  assert.doesNotMatch(`${uniques}\n${codex}`, /MarketBadge|market-badge/);
  assert.match(codex, /buildPoeNinjaUrl/);
  assert.match(codex, /data-pin-action="view-ninja"/);
});

test('challenge rendering targets cards rather than cadence selector tabs', () => {
  const challenges = readFileSync(new URL('../js/16-challenge-mode.js', import.meta.url), 'utf8');
  assert.match(challenges, /renderContractCard\(overlay\.querySelector\(`\.contracts-card\[data-cadence=/);
  assert.match(challenges, /overlay\.querySelector\(`\.contracts-card\[data-cadence=.*\.contracts-card__renewal/);
  assert.doesNotMatch(challenges, /renderContractCard\(overlay\.querySelector\(`\[data-cadence=/);
});
