import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requestLogger } from '../src/middleware/logging.js';
import { errorHandler } from '../src/middleware/errors.js';
import { ADMIN, bootApp, registerAdmin } from './helpers.js';

/** Drives the middleware with the smallest req/res pair it actually touches. */
function runLogger(middleware, { method = 'GET', url = '/api/thing?secret=1', status = 200, user = null } = {}) {
  const listeners = [];
  const req = { method, originalUrl: url, headers: {}, user };
  const res = {
    statusCode: status,
    setHeader() {},
    on(event, handler) {
      if (event === 'finish') listeners.push(handler);
    },
  };
  middleware(req, res, () => {});
  for (const handler of listeners) handler();
  return req;
}

describe('request logging', () => {
  it('emits one JSON line per request with the expected fields', () => {
    const lines = [];
    const middleware = requestLogger({ write: (line) => lines.push(line) });
    runLogger(middleware, { method: 'POST', url: '/api/sites?q=x', status: 201, user: { id: 7 } });
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.method, 'POST');
    assert.equal(entry.path, '/api/sites', 'query string must be stripped');
    assert.equal(entry.status, 201);
    assert.equal(entry.userId, 7);
    assert.equal(entry.level, 'info');
    assert.ok(entry.requestId && entry.time);
    assert.equal(typeof entry.durationMs, 'number');
  });

  it('marks server errors at error level', () => {
    const lines = [];
    runLogger(requestLogger({ write: (line) => lines.push(line) }), { status: 500 });
    assert.equal(JSON.parse(lines[0]).level, 'error');
  });

  it('assigns a request id and reuses an inbound one', () => {
    const middleware = requestLogger({ enabled: false });
    const fresh = runLogger(middleware);
    assert.ok(fresh.requestId);
    const req = { method: 'GET', originalUrl: '/x', headers: { 'x-request-id': 'abc-123' }, user: null };
    middleware(req, { setHeader() {}, on() {} }, () => {});
    assert.equal(req.requestId, 'abc-123');
  });

  it('never writes credentials into a log line', () => {
    const lines = [];
    const middleware = requestLogger({ write: (line) => lines.push(line) });
    const req = {
      method: 'POST',
      originalUrl: '/api/auth/login',
      headers: { cookie: 'fp_session=supersecrettoken' },
      body: { email: ADMIN.email, password: 'correct-horse-battery' },
      user: null,
    };
    const handlers = [];
    middleware(req, { statusCode: 200, setHeader() {}, on: (event, handler) => event === 'finish' && handlers.push(handler) }, () => {});
    handlers.forEach((handler) => handler());
    const line = lines[0];
    assert.ok(!line.includes('correct-horse-battery'), 'password must not be logged');
    assert.ok(!line.includes('supersecrettoken'), 'session cookie must not be logged');
    assert.ok(!line.toLowerCase().includes('cookie'));
  });

  it('is silent when disabled', () => {
    const lines = [];
    runLogger(requestLogger({ enabled: false, write: (line) => lines.push(line) }));
    assert.equal(lines.length, 0);
  });

  it('returns the request id set by the logger in the 500 body', () => {
    const middleware = requestLogger({ enabled: false });
    const headers = {};
    const req = { method: 'GET', originalUrl: '/x', headers: {}, user: null };
    middleware(req, { setHeader(name, value) { headers[name] = value; }, on() {} }, () => {});
    assert.equal(req.requestId, headers['x-request-id']);

    const body = {};
    errorHandler(new Error('boom'), req, {
      status() { return this; },
      json(payload) { Object.assign(body, payload); return this; },
    }, () => {});
    assert.equal(body.requestId, req.requestId, 'the 500 body must carry the request id it was logged under');
  });
});

describe('health', () => {
  let ctx;
  beforeEach(() => (ctx = bootApp()));
  afterEach(() => {
    try {
      ctx.close();
    } catch {
      // already closed by a test
    }
  });

  it('reports the database as reachable', async () => {
    const response = await ctx.agent.get('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(
      { ok: response.body.ok, service: response.body.service, database: response.body.database },
      { ok: true, service: 'fieldpoint', database: 'ok' },
    );
  });

  it('returns 503 when the database is gone', async () => {
    await registerAdmin(ctx.agent);
    ctx.db.close();
    const response = await ctx.agent.get('/api/health');
    assert.equal(response.status, 503);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.database, 'error');
  });

  it('exposes a request id header', async () => {
    const response = await ctx.agent.get('/api/health');
    assert.ok(response.headers['x-request-id']);
  });
});
