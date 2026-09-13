import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime, absoluteTime, todayIso } from '../public/js/lib/time.js';
import { escapeHtml } from '../public/js/lib/html.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe('relativeTime', () => {
  it('returns empty string for missing or unparseable input', () => {
    assert.equal(relativeTime(''), '');
    assert.equal(relativeTime(null), '');
    assert.equal(relativeTime(undefined), '');
    assert.equal(relativeTime('not a date'), '');
  });

  it('picks the largest fitting unit at each boundary', () => {
    const now = Date.now();
    const atAgo = (ms) => new Date(now - ms).toISOString();
    // Just below a minute falls through to seconds.
    assert.match(relativeTime(atAgo(MINUTE - SECOND)), /second/);
    // Exactly one unit lands on that unit.
    assert.match(relativeTime(atAgo(MINUTE)), /minute/);
    assert.match(relativeTime(atAgo(HOUR)), /hour/);
    assert.match(relativeTime(atAgo(DAY)), /day/);
    assert.match(relativeTime(atAgo(MONTH)), /month/);
    assert.match(relativeTime(atAgo(YEAR)), /year/);
  });

  it('describes both past and future', () => {
    const now = Date.now();
    assert.match(relativeTime(new Date(now - 3 * DAY).toISOString()), /ago/);
    assert.match(relativeTime(new Date(now + 3 * DAY).toISOString()), /in/);
  });
});

describe('absoluteTime', () => {
  it('returns empty string for missing or unparseable input', () => {
    assert.equal(absoluteTime(''), '');
    assert.equal(absoluteTime(null), '');
    assert.equal(absoluteTime('not a date'), '');
  });

  it('formats a valid timestamp', () => {
    const iso = '2020-01-02T03:04:05.000Z';
    assert.equal(absoluteTime(iso), new Date(Date.parse(iso)).toLocaleString());
  });
});

describe('todayIso', () => {
  it('formats today as zero-padded YYYY-MM-DD', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(todayIso(), expected);
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('escapeHtml', () => {
  it('escapes each dangerous character', () => {
    assert.equal(escapeHtml('<'), '&lt;');
    assert.equal(escapeHtml('>'), '&gt;');
    assert.equal(escapeHtml('&'), '&amp;');
    assert.equal(escapeHtml('"'), '&quot;');
    assert.equal(escapeHtml("'"), '&#39;');
  });

  it('escapes a mixed string', () => {
    assert.equal(
      escapeHtml(`<a href="x" onclick='y'>Tom & Jerry</a>`),
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  it('coerces nullish and non-string input', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
  });
});
