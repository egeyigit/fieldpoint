import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ADMIN, MEMBER, bootApp, createMember, registerAdmin } from './helpers.js';
import { createSessionStore, sessionCookieName } from '../src/auth/session.js';
import { openDatabase } from '../src/db/connection.js';

describe('auth', () => {
  let ctx;
  beforeEach(() => (ctx = bootApp()));
  afterEach(() => ctx.close());

  it('reports needsBootstrap before any user exists', async () => {
    const response = await ctx.agent.get('/api/auth/me');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, user: null, needsBootstrap: true });
  });

  it('first registration creates an admin and signs them in', async () => {
    const user = await registerAdmin(ctx.agent);
    assert.equal(user.role, 'admin');
    const me = await ctx.agent.get('/api/auth/me');
    assert.equal(me.body.user.email, ADMIN.email);
    assert.equal(me.body.needsBootstrap, false);
  });

  it('concurrent bootstrap registrations yield exactly one admin', async () => {
    const attempts = ['a', 'b', 'c', 'd'].map((suffix) =>
      request(ctx.server).post('/api/auth/register').send({ ...ADMIN, email: `${suffix}@example.com` }),
    );
    const responses = await Promise.all(attempts);
    const created = responses.filter((response) => response.status === 201);
    assert.equal(created.length, 1);
    assert.equal(created[0].body.user.role, 'admin');
    assert.ok(responses.filter((response) => response.status === 403).length === 3);
  });

  it('rejects anonymous registration after bootstrap', async () => {
    await registerAdmin(ctx.agent);
    const response = await request(ctx.server).post('/api/auth/register').send(MEMBER);
    assert.equal(response.status, 403);
  });

  it('member cannot create accounts, admin can', async () => {
    await registerAdmin(ctx.agent);
    const member = await createMember(ctx.agent, ctx.server);
    const denied = await member.post('/api/auth/register').send({ ...MEMBER, email: 'x@example.com' });
    assert.equal(denied.status, 403);
  });

  it('login rejects wrong password and unknown email identically', async () => {
    await registerAdmin(ctx.agent);
    const wrong = await request(ctx.server).post('/api/auth/login').send({ email: ADMIN.email, password: 'nope-nope-nope' });
    const unknown = await request(ctx.server).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
  });

  it('validates registration input', async () => {
    const response = await ctx.agent.post('/api/auth/register').send({ email: 'not-an-email', name: '', password: 'short' });
    assert.equal(response.status, 400);
    const paths = response.body.details.map((issue) => issue.path);
    assert.ok(paths.includes('email') && paths.includes('name') && paths.includes('password'));
  });

  it('logout invalidates the session server-side', async () => {
    await registerAdmin(ctx.agent);
    const cookie = (await ctx.agent.get('/api/auth/me')).request.cookies;
    await ctx.agent.post('/api/auth/logout');
    const replay = await request(ctx.server).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(replay.body.user, null);
  });

  it('rejects tampered session cookies', async () => {
    await registerAdmin(ctx.agent);
    const response = await request(ctx.server).get('/api/auth/me').set('Cookie', 'fp_session=deadbeef.notasignature');
    assert.equal(response.body.user, null);
  });

  it('password change requires current password and rotates the session', async () => {
    await registerAdmin(ctx.agent);
    const bad = await ctx.agent.post('/api/auth/password').send({ currentPassword: 'wrong-wrong-wrong', newPassword: 'new-password-123' });
    assert.equal(bad.status, 401);
    const good = await ctx.agent.post('/api/auth/password').send({ currentPassword: ADMIN.password, newPassword: 'new-password-123' });
    assert.equal(good.status, 200);
    const login = await request(ctx.server).post('/api/auth/login').send({ email: ADMIN.email, password: 'new-password-123' });
    assert.equal(login.status, 200);
  });

  it('blocks cross-origin mutations', async () => {
    await registerAdmin(ctx.agent);
    const response = await ctx.agent.post('/api/auth/logout').set('Origin', 'https://evil.example');
    assert.equal(response.status, 403);
  });

  it('returns 400 on malformed JSON', async () => {
    const response = await ctx.agent.post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    assert.equal(response.status, 400);
  });
});

describe('session cookie hardening', () => {
  it('applies the __Host- prefix only in production', () => {
    assert.equal(sessionCookieName(true), '__Host-fp_session');
    assert.equal(sessionCookieName(false), 'fp_session');
  });

  it('rejects and deletes an idle-expired session', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES ('a@b.c', 'A', 'x', 'admin')`).run();
      const userId = db.prepare(`SELECT id FROM users WHERE email = 'a@b.c'`).get().id;
      const store = createSessionStore(db, { secret: 'x'.repeat(40), ttlMs: 72 * 60 * 60 * 1000, idleMs: 1 });
      const token = store.create(userId);
      // Wait past the 1ms idle window.
      const until = Date.now() + 5;
      while (Date.now() < until) { /* spin */ }
      assert.equal(store.resolve(token), null);
      const id = token.split('.')[0];
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?').get(id).count, 0);
    } finally {
      db.close();
    }
  });

  it('slides an active session forward but never past the absolute cap', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES ('a@b.c', 'A', 'x', 'admin')`).run();
      const userId = db.prepare(`SELECT id FROM users WHERE email = 'a@b.c'`).get().id;
      const ttlMs = 72 * 60 * 60 * 1000;
      const store = createSessionStore(db, { secret: 'x'.repeat(40), ttlMs, idleMs: 8 * 60 * 60 * 1000 });
      const token = store.create(userId);
      const id = token.split('.')[0];
      const absoluteCap = db.prepare('SELECT absolute_expires_at AS c FROM sessions WHERE id = ?').get(id).c;
      // Shrink the working expiry so a slide has room to move it forward, but
      // keep last_seen_at recent so the idle check passes.
      const shrunk = Date.now() + 60 * 1000;
      db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?')
        .run(shrunk, Date.now(), id);
      const user = store.resolve(token);
      assert.equal(user.email, 'a@b.c');
      const after = db.prepare('SELECT expires_at AS e FROM sessions WHERE id = ?').get(id).e;
      assert.ok(after > shrunk, 'expiry should slide forward on activity');
      assert.ok(after <= absoluteCap, 'expiry must never exceed the absolute cap');
    } finally {
      db.close();
    }
  });

  it('cannot be renewed past its absolute lifetime cap', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES ('a@b.c', 'A', 'x', 'admin')`).run();
      const userId = db.prepare(`SELECT id FROM users WHERE email = 'a@b.c'`).get().id;
      const ttlMs = 72 * 60 * 60 * 1000;
      const store = createSessionStore(db, { secret: 'x'.repeat(40), ttlMs, idleMs: 8 * 60 * 60 * 1000 });
      const token = store.create(userId);
      const id = token.split('.')[0];
      const absoluteCap = db.prepare('SELECT absolute_expires_at AS c FROM sessions WHERE id = ?').get(id).c;
      // Simulate a caller that keeps touching the session past its cap: we
      // walk the clock forward by rewriting last_seen_at, then resolve, and
      // the row must be gone once now has crossed absolute_expires_at.
      db.prepare('UPDATE sessions SET last_seen_at = ?, absolute_expires_at = ?, expires_at = ? WHERE id = ?')
        .run(Date.now(), Date.now() - 1, Date.now() - 1, id);
      assert.equal(store.resolve(token), null);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?').get(id).count, 0);
      assert.ok(absoluteCap > Date.now() - ttlMs);
    } finally {
      db.close();
    }
  });
});
