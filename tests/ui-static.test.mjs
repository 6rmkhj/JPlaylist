import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, app, css] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('app.js', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8'),
]);

test('search input has a real accessible label and clear button is outside the label', () => {
  assert.match(html, /<label class="visually-hidden" for="searchInput">곡명 또는 아티스트 검색<\/label>/);
  assert.doesNotMatch(html, /<label[^>]*class="search-box"/);
});

test('genre filters expose a named accessibility group', () => {
  assert.match(html, /id="genreFilters" role="group" aria-labelledby="genreFilterLabel"/);
  assert.match(app, /aria-label="\$\{escapeHtml\(`\$\{genre\}, \$\{count\}곡`\)\}"/);
});

test('platform selection uses radio semantics and selected state rendering', () => {
  assert.match(html, /id="platformOptions" role="radiogroup"/);
  assert.match(html, /role="radio" aria-checked="false" data-platform="spotify"/);
  assert.match(app, /button\.setAttribute\('aria-checked', String\(selected\)\)/);
});

test('preview player and per-song preview flow exist', () => {
  assert.match(html, /id="previewPlayer"/);
  assert.match(app, /async function togglePreview/);
  assert.match(app, /song\.previewUrl/);
});

test('image fallbacks and responsive artwork are implemented', () => {
  assert.match(app, /artworkSrcSet/);
  assert.match(app, /function artworkFailed/);
  assert.match(css, /\.artwork-fallback/);
});

test('mobile layout keeps 360px dense while using compact horizontal cards only below 340px', () => {
  assert.doesNotMatch(css, /@media \(max-width: 360px\)[\s\S]*?\.song-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(css, /grid-template-columns: 96px minmax\(0, 1fr\)/);
});

test('programmatic scrolling respects reduced motion', () => {
  assert.match(app, /behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth'/);
});

test('navigation state is serialized to the URL and restored on popstate', () => {
  assert.match(app, /serializeViewParams\(currentView\(\)\)/);
  assert.match(app, /addEventListener\('popstate'/);
});

test('backup file picker is triggered by a visible button', () => {
  assert.match(html, /id="importBackupButton" type="button">백업 파일 가져오기<\/button>/);
  assert.match(app, /importBackupButton\.addEventListener\('click'/);
});
