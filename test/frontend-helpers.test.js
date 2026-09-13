import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime, absoluteTime, todayIso } from '../public/js/ui.js';
import { escapeHtml } from '../public/js/map.js';

test('relativeTime handles empty and invalid timestamps', () => {
  assert.equal(relativeTime(''), '');
  assert.equal(relativeTime('not-a-date'), '');
});

test('absoluteTime handles empty and invalid timestamps', () => {
  assert.equal(absoluteTime(''), '');
  assert.equal(absoluteTime('not-a-date'), '');
  assert.notEqual(absoluteTime('2024-01-02T03:04:05Z'), '');
});

test('todayIso returns the API date format', () => {
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('escapeHtml encodes markup and quotes', () => {
  assert.equal(escapeHtml(`<tag a="b">& 'x'`), '&lt;tag a=&quot;b&quot;&gt;&amp; &#39;x&#39;');
});
