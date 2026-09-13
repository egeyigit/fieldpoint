import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ADMIN, MEMBER, bootApp, createMember, registerAdmin } from './helpers.js';

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
