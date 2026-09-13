import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { bootApp } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('app plumbing', () => {
  let ctx;
  beforeEach(() => (ctx = bootApp()));
  afterEach(() => ctx.close());

  it('serves health without auth', async () => {
    const response = await ctx.agent.get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.service, 'fieldpoint');
  });

  it('serves the SPA and vendored leaflet', async () => {
    assert.equal((await ctx.agent.get('/')).status, 200);
    assert.equal((await ctx.agent.get('/vendor/leaflet/leaflet.js')).status, 200);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const response = await ctx.agent.get('/api/nope');
    assert.equal(response.status, 404);
    assert.equal(response.body.ok, false);
  });

  it('sets security headers', async () => {
    const response = await ctx.agent.get('/api/health');
    assert.ok(response.headers['content-security-policy']);
    assert.equal(response.headers['x-powered-by'], undefined);
  });
});

describe('config', () => {
  it('falls back to a persisted generated secret in production and warns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldpoint-prod-'));
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      const first = loadConfig({ NODE_ENV: 'production', DB_PATH: join(dir, 'x.db') });
      const second = loadConfig({ NODE_ENV: 'production', DB_PATH: join(dir, 'x.db') });
      assert.equal(first.sessionSecret, second.sessionSecret);
      assert.ok(first.sessionSecret.length >= 32);
      assert.ok(warnings.some((line) => line.includes('SESSION_SECRET is not set')));
    } finally {
      console.warn = originalWarn;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers an explicit SESSION_SECRET over the persisted one', () => {
    const config = loadConfig({ NODE_ENV: 'production', DB_PATH: ':memory:', SESSION_SECRET: 'y'.repeat(40) });
    assert.equal(config.sessionSecret, 'y'.repeat(40));
  });

  it('persists a generated dev secret next to the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldpoint-'));
    const first = loadConfig({ DB_PATH: join(dir, 'x.db') });
    const second = loadConfig({ DB_PATH: join(dir, 'x.db') });
    assert.equal(first.sessionSecret, second.sessionSecret);
    assert.ok(existsSync(join(dir, '.session-secret')));
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults trust proxy to 1 in production and off elsewhere', () => {
    assert.equal(loadConfig({ DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40), NODE_ENV: 'production' }).trustProxy, 1);
    assert.equal(loadConfig({ DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40) }).trustProxy, false);
  });

  it('parses the full trust-proxy vocabulary', () => {
    const base = { DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40) };
    assert.equal(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy, false);
    assert.equal(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy, true);
    assert.equal(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy, 2);
    assert.equal(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).trustProxy, 'loopback');
    assert.deepEqual(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy, ['10.0.0.0/8', '127.0.0.1']);
  });

  it('throws at boot on an invalid trust-proxy value', () => {
    assert.throws(
      () => loadConfig({ DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40), TRUST_PROXY: 'nonsense' }),
      /invalid TRUST_PROXY/,
    );
  });

  it('resolves req.ip to the client behind two proxy hops', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40), TRUST_PROXY: '2' });
    const { app, db } = createApp(config);
    app.get('/__ip', (req, res) => res.json({ ip: req.ip }));
    try {
      const response = await request(app)
        .get('/__ip')
        .set('X-Forwarded-For', '203.0.113.7, 10.0.0.2, 10.0.0.1');
      assert.equal(response.status, 200);
      assert.equal(response.body.ip, '203.0.113.7');
    } finally {
      db.close();
    }
  });

  it('applies defaults and parses overrides', () => {
    const config = loadConfig({ DB_PATH: ':memory:', PORT: '5000', SESSION_TTL_HOURS: '1', ALLOWED_ORIGINS: 'https://a.test, https://b.test' });
    assert.equal(config.port, 5000);
    assert.equal(config.sessionTtlMs, 3_600_000);
    assert.deepEqual(config.allowedOrigins, ['https://a.test', 'https://b.test']);
    assert.equal(config.sessionSecret.length >= 32, true);
  });
});
