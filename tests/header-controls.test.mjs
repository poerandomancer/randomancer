import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const modalCss = readFileSync(new URL('../css/70-modals.css', import.meta.url), 'utf8');
const challengeCss = readFileSync(new URL('../css/80-summary.css', import.meta.url), 'utf8');
const feedbackController = readFileSync(new URL('../js/14-feedback-menu.js', import.meta.url), 'utf8');
const modeController = readFileSync(new URL('../js/16-challenge-mode.js', import.meta.url), 'utf8');

test('header exposes the five controls directly in the required order', () => {
  const controls = html.match(/<div class="header-actions"[\s\S]*?<\/div>/)?.[0] || '';
  const ids = [...controls.matchAll(/<button id="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(ids, [
    'contracts-button',
    'mode-header-action',
    'saved-fab',
    'feedback-fab',
    'info-fab'
  ]);
  for (const label of ['Challenge', 'The Archive', 'Saved Builds', 'Feedback', 'About']) {
    assert.match(controls, new RegExp(`aria-label="${label}"`));
  }
});

test('obsolete hamburger markup, behavior, and styles are removed', () => {
  for (const source of [html, modalCss, feedbackController]) {
    assert.doesNotMatch(source, /header-menu|header-menu-fab/);
  }
});

test('shared medallion styling remains visible and compact on narrow screens', () => {
  assert.match(modalCss, /\.header-actions \.rm-info-fab\s*\{/);
  assert.match(modalCss, /@media \(max-width:600px\)[\s\S]*?width:28px;[\s\S]*?height:28px;/);
  assert.match(challengeCss, /\.header-actions \.contracts-button\{[^}]*border-color:rgba\(176,61,69/);
});

test('archive action retains its state-dependent destination label', () => {
  assert.match(modeController, /codex \? 'Return to Build' : 'The Archive'/);
});
