import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, css, design, icons, typography] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8'),
  readFile(new URL('ui-design.js', root), 'utf8'),
  readFile(new URL('icons.css', root), 'utf8'),
  readFile(new URL('typography.css', root), 'utf8'),
]);

test('hero typography protects Korean words and uses a bounded desktop scale', () => {
  assert.match(css, /\.hero h1 \{[\s\S]*?font-size: clamp\(50px, 5\.4vw, 74px\)/);
  assert.match(css, /\.hero h1 \{[\s\S]*?word-break: keep-all/);
});

test('featured artwork keeps a square visual frame instead of a tall crop', () => {
  assert.match(css, /\.featured-artwork-wrap \{[\s\S]*?aspect-ratio: 1/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.featured-artwork-wrap \{[\s\S]*?aspect-ratio: 1/);
});

test('discovery source diagnostics are progressively disclosed', () => {
  assert.match(html, /<details class="source-details">/);
  assert.match(html, /<summary>데이터 기준<\/summary>/);
});

test('platform settings live in header rather than duplicating the featured CTA', () => {
  assert.match(html, /<nav class="header-actions"[\s\S]*?id="platformSettings"/);
  assert.doesNotMatch(html, /platform-hint-row[\s\S]{0,240}id="platformSettings"/);
});

test('cards reserve their lower region for metadata and actions', () => {
  assert.match(css, /\.song-info \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column/);
  assert.match(css, /\.song-meta \{[\s\S]*?margin-top: auto/);
  assert.match(css, /\.card-actions \{[\s\S]*?display: grid/);
});

test('design uses explicit semantic color, spacing and radius tokens', () => {
  for (const token of ['--selected:', '--favorite:', '--focus:', '--s4:', '--r-control:', '--r-card:']) {
    assert.ok(css.includes(token), `missing ${token}`);
  }
});

test('unicode-heavy visual states are normalized into a single SVG-mask icon family', () => {
  assert.match(html, /href="\.\/icons\.css"/);
  assert.match(html, /src="\.\/ui-design\.js"/);
  assert.match(design, /function decorateBadge/);
  assert.match(design, /decorateFavoritesNav/);
  assert.match(design, /replace\(\/\\s\*↗\/g, ''\)/);
  assert.match(icons, /--icon-heart:/);
  assert.match(icons, /--icon-headphones:/);
  assert.match(icons, /mask-image:/);
});

test('functional microcopy uses a readable body-small scale', () => {
  assert.match(html, /href="\.\/typography\.css"/);
  assert.match(typography, /\.featured-reason,[\s\S]*?font-size: 13px/);
  assert.match(typography, /@media \(max-width: 720px\)[\s\S]*?\.featured-reason[\s\S]*?font-size: 13px/);
});

test('preview player reserves bottom layout space', () => {
  assert.match(css, /body:has\(\.preview-player:not\(\.hidden\)\) main \{ padding-bottom:/);
});

test('small screens retain the JPlaylist wordmark', () => {
  assert.match(css, /@media \(max-width: 340px\)[\s\S]*?\.brand-wordmark \{ display: inline; \}/);
  assert.doesNotMatch(css, /@media \(max-width: 340px\)[\s\S]*?\.brand-wordmark \{ display: none/);
});

test('glass blur is not required for component hierarchy', () => {
  assert.doesNotMatch(css, /backdrop-filter:/);
  assert.doesNotMatch(css, /filter:\s*blur\(/);
});
