import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

describe('visits', () => {
  let ctx;
  let admin;
  let siteId;

  beforeEach(async () => {
    ctx = bootApp();
    admin = await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  it('requires authentication on both visit route shapes', async () => {
    const anonymous = request(ctx.server);
    assert.equal((await anonymous.get('/api/visits')).status, 401);
    assert.equal((await anonymous.get(`/api/sites/${siteId}/visits`)).status, 401);
    assert.equal((await anonymous.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY })).status, 401);
  });

  it('creates and lists newest visits with joined names and site aggregates', async () => {
    const first = await ctx.agent.post(`/api/sites/${siteId}/visits`).send({
      visitedAt: '2026-01-01', rating: 3, note: 'First',
    });
    const second = await ctx.agent.post(`/api/sites/${siteId}/visits`).send({
      visitedAt: YESTERDAY, rating: 5, note: 'Latest',
    });
    assert.equal(first.status, 201);
    assert.equal(second.body.visit.userName, 'Ada Admin');
    assert.equal(second.body.visit.siteName, 'HQ');

    const listed = await ctx.agent.get(`/api/sites/${siteId}/visits?limit=1&offset=0`);
    assert.equal(listed.body.total, 2);
    assert.equal(listed.body.visits[0].note, 'Latest');
    const site = (await ctx.agent.get(`/api/sites/${siteId}`)).body.site;
    assert.equal(site.visitCount, 2);
    assert.equal(site.lastVisitedAt, YESTERDAY);
    assert.equal(site.averageRating, 4);
  });

  it('rejects future dates, invalid ratings and empty patches', async () => {
    assert.equal((await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: TOMORROW })).status, 400);
    assert.equal((await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY, rating: 6 })).status, 400);
    assert.equal((await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: '2026-02-30' })).status, 400);
    const visit = (await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY })).body.visit;
    assert.equal((await ctx.agent.patch(`/api/visits/${visit.id}`).send({})).status, 400);
  });

  it('defaults the general list to the caller and restricts another user filter', async () => {
    const memberAgent = await createMember(ctx.agent, ctx.server);
    const member = (await memberAgent.get('/api/auth/me')).body.user;
    await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: '2026-01-01' });
    await memberAgent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY });
    assert.equal((await memberAgent.get('/api/visits')).body.total, 1);
    assert.equal((await memberAgent.get(`/api/visits?userId=${admin.id}`)).status, 403);
    assert.equal((await ctx.agent.get(`/api/visits?userId=${member.id}`)).body.total, 1);
  });

  it('lists all visits newest-first for admins with paging and forbids members', async () => {
    const memberAgent = await createMember(ctx.agent, ctx.server);
    const otherSite = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Depot' })).body.site.id;
    await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: '2026-01-01', note: 'Oldest' });
    await memberAgent.post(`/api/sites/${otherSite}/visits`).send({ visitedAt: YESTERDAY, note: 'Newest' });

    assert.equal((await memberAgent.get('/api/visits?scope=all')).status, 403);

    const all = await ctx.agent.get('/api/visits?scope=all');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);
    assert.equal(all.body.visits[0].note, 'Newest');
    assert.equal(all.body.visits[0].siteName, 'Depot');
    assert.equal(all.body.visits[0].userName, 'Max Member');

    const firstPage = await ctx.agent.get('/api/visits?scope=all&limit=1&offset=0');
    assert.equal(firstPage.body.total, 2);
    assert.equal(firstPage.body.visits.length, 1);
    assert.equal(firstPage.body.visits[0].note, 'Newest');
    const secondPage = await ctx.agent.get('/api/visits?scope=all&limit=1&offset=1');
    assert.equal(secondPage.body.visits.length, 1);
    assert.equal(secondPage.body.visits[0].note, 'Oldest');
  });

  it('allows only the author or an administrator to update and delete', async () => {
    const memberAgent = await createMember(ctx.agent, ctx.server);
    const adminVisit = (await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY })).body.visit;
    assert.equal((await memberAgent.patch(`/api/visits/${adminVisit.id}`).send({ note: 'no' })).status, 403);
    assert.equal((await memberAgent.delete(`/api/visits/${adminVisit.id}`)).status, 403);

    const memberVisit = (await memberAgent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY })).body.visit;
    const updated = await ctx.agent.patch(`/api/visits/${memberVisit.id}`).send({ rating: 4 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.visit.rating, 4);
    assert.equal((await ctx.agent.delete(`/api/visits/${memberVisit.id}`)).status, 204);
  });

  it('returns 404 for site-scoped access to a soft-deleted site', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await ctx.agent.get(`/api/sites/${siteId}/visits`)).status, 404);
    assert.equal((await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY })).status, 404);
  });

  it('audits visit create, update and delete', async () => {
    const visit = (await ctx.agent.post(`/api/sites/${siteId}/visits`).send({ visitedAt: YESTERDAY })).body.visit;
    await ctx.agent.patch(`/api/visits/${visit.id}`).send({ note: 'checked' });
    await ctx.agent.delete(`/api/visits/${visit.id}`);
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    for (const action of ['visit.create', 'visit.update', 'visit.delete']) assert.ok(actions.includes(action));
  });
});
