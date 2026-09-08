import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MEMBER, bootApp, createMember, registerAdmin } from './helpers.js';

describe('user administration', () => {
  let ctx;
  let admin;
  beforeEach(async () => {
    ctx = bootApp();
    admin = await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('lists users for admins only', async () => {
    const member = await createMember(ctx.agent, ctx.app);
    assert.equal((await member.get('/api/users')).status, 403);
    const response = await ctx.agent.get('/api/users');
    assert.equal(response.status, 200);
    assert.equal(response.body.users.length, 2);
    assert.ok(!('passwordHash' in response.body.users[0]));
  });

  it('promotes a member and refuses to demote the last admin', async () => {
    await createMember(ctx.agent, ctx.app);
    const users = (await ctx.agent.get('/api/users')).body.users;
    const member = users.find((user) => user.email === MEMBER.email);
    const denied = await ctx.agent.patch(`/api/users/${admin.id}`).send({ role: 'member' });
    assert.equal(denied.status, 409);
    const promoted = await ctx.agent.patch(`/api/users/${member.id}`).send({ role: 'admin' });
    assert.equal(promoted.body.user.role, 'admin');
    const nowAllowed = await ctx.agent.patch(`/api/users/${admin.id}`).send({ role: 'member' });
    assert.equal(nowAllowed.status, 200);
  });

  it('deactivating a user kills their sessions and blocks login', async () => {
    const memberAgent = await createMember(ctx.agent, ctx.app);
    const memberId = (await ctx.agent.get('/api/users')).body.users.find((user) => user.email === MEMBER.email).id;
    await ctx.agent.patch(`/api/users/${memberId}`).send({ isActive: false });
    assert.equal((await memberAgent.get('/api/sites')).status, 401);
    const login = await request(ctx.app).post('/api/auth/login').send({ email: MEMBER.email, password: MEMBER.password });
    assert.equal(login.status, 401);
  });

  it('directory is readable by members, exposes only id/name/role, and lists only active users', async () => {
    const member = await createMember(ctx.agent, ctx.app);
    const response = await member.get('/api/users/directory');
    assert.equal(response.status, 200);
    assert.equal(response.body.users.length, 2);
    assert.deepEqual(Object.keys(response.body.users[0]).sort(), ['id', 'name', 'role']);
    assert.ok(response.body.users.every((user) => !('email' in user)));

    const memberId = (await ctx.agent.get('/api/users')).body.users.find((user) => user.email === MEMBER.email).id;
    await ctx.agent.patch(`/api/users/${memberId}`).send({ isActive: false });
    const afterDeactivation = await ctx.agent.get('/api/users/directory');
    assert.equal(afterDeactivation.body.users.length, 1);
  });

  it('directory requires authentication', async () => {
    assert.equal((await request(ctx.app).get('/api/users/directory')).status, 401);
  });

  it('rejects unknown users and empty patches', async () => {
    assert.equal((await ctx.agent.patch('/api/users/999').send({ role: 'admin' })).status, 404);
    assert.equal((await ctx.agent.patch(`/api/users/${admin.id}`).send({})).status, 400);
    assert.equal((await ctx.agent.patch('/api/users/abc').send({ role: 'admin' })).status, 400);
  });
});
