import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

describe('sites', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('requires authentication', async () => {
    const response = await request(ctx.server).get('/api/sites');
    assert.equal(response.status, 401);
  });

  it('creates, reads, updates and deletes a site', async () => {
    const created = await ctx.agent.post('/api/sites').send(SITE);
    assert.equal(created.status, 201);
    assert.equal(created.body.site.createdByName, 'Ada Admin');
    const id = created.body.site.id;

    const fetched = await ctx.agent.get(`/api/sites/${id}`);
    assert.equal(fetched.body.site.name, 'HQ');

    const updated = await ctx.agent.put(`/api/sites/${id}`).send({ status: 'inactive', notes: 'closed' });
    assert.equal(updated.body.site.status, 'inactive');
    assert.equal(updated.body.site.notes, 'closed');
    assert.equal(updated.body.site.name, 'HQ');

    const deleted = await ctx.agent.delete(`/api/sites/${id}`);
    assert.equal(deleted.status, 204);
    assert.equal((await ctx.agent.get(`/api/sites/${id}`)).status, 404);
  });

  it('validates coordinates and enums', async () => {
    const response = await ctx.agent.post('/api/sites').send({ ...SITE, lat: 95, category: 'spaceship' });
    assert.equal(response.status, 400);
    const paths = response.body.details.map((issue) => issue.path);
    assert.ok(paths.includes('lat') && paths.includes('category'));
  });

  it('rejects empty updates', async () => {
    const { body } = await ctx.agent.post('/api/sites').send(SITE);
    const response = await ctx.agent.put(`/api/sites/${body.site.id}`).send({});
    assert.equal(response.status, 400);
  });

  it('filters by text, category and status with LIKE escaping', async () => {
    await ctx.agent.post('/api/sites').send(SITE);
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Depot 100%', category: 'warehouse', status: 'planned' });
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Client A', category: 'client' });

    assert.equal((await ctx.agent.get('/api/sites?category=warehouse')).body.total, 1);
    assert.equal((await ctx.agent.get('/api/sites?status=active')).body.total, 2);
    assert.equal((await ctx.agent.get('/api/sites?q=100%25')).body.total, 1);
    assert.equal((await ctx.agent.get('/api/sites?q=%25')).body.total, 1);
    assert.equal((await ctx.agent.get('/api/sites?q=_')).body.total, 0);
    assert.equal((await ctx.agent.get('/api/sites?category=nope')).status, 400);
  });

  it('filters by visit activity and minimum rating', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const unvisited = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Never' })).body.site.id;
    const recent = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Recent' })).body.site.id;
    const stale = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Stale' })).body.site.id;
    await ctx.agent.post(`/api/sites/${recent}/visits`).send({ visitedAt: today, rating: 5 });
    await ctx.agent.post(`/api/sites/${stale}/visits`).send({ visitedAt: old, rating: 2 });

    const never = await ctx.agent.get('/api/sites?visited=never');
    assert.equal(never.body.total, 1);
    assert.equal(never.body.sites[0].id, unvisited);

    const last30 = await ctx.agent.get('/api/sites?visited=30d');
    assert.equal(last30.body.total, 1);
    assert.equal(last30.body.sites[0].id, recent);

    assert.equal((await ctx.agent.get('/api/sites?visited=90d')).body.total, 2);

    const rated = await ctx.agent.get('/api/sites?minRating=3');
    assert.equal(rated.body.total, 1);
    assert.equal(rated.body.sites[0].id, recent);

    assert.equal((await ctx.agent.get('/api/sites?visited=forever')).status, 400);
    assert.equal((await ctx.agent.get('/api/sites?minRating=6')).status, 400);
  });

  it('paginates', async () => {
    for (let index = 0; index < 5; index += 1) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `Site ${index}` });
    }
    const page = await ctx.agent.get('/api/sites?limit=2&offset=2');
    assert.equal(page.body.sites.length, 2);
    assert.equal(page.body.total, 5);
    assert.equal(page.body.sites[0].name, 'Site 2');
  });

  it('members can create/update but only admins can delete', async () => {
    const member = await createMember(ctx.agent, ctx.server);
    const created = await member.post('/api/sites').send(SITE);
    assert.equal(created.status, 201);
    const id = created.body.site.id;
    assert.equal((await member.put(`/api/sites/${id}`).send({ name: 'Renamed' })).status, 200);
    assert.equal((await member.delete(`/api/sites/${id}`)).status, 403);
    assert.equal((await ctx.agent.delete(`/api/sites/${id}`)).status, 204);
  });

  it('exports CSV with formula-injection protection', async () => {
    await ctx.agent.post('/api/sites').send({ ...SITE, name: '=HYPERLINK("x")', notes: 'a "quoted" note' });
    const response = await ctx.agent.get('/api/sites/export.csv');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.ok(response.text.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(response.text.includes(`"a ""quoted"" note"`));
  });

  it('exports every matching row regardless of page size', async () => {
    for (let index = 0; index < 12; index += 1) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `Bulk ${String(index).padStart(2, '0')}` });
    }
    const response = await ctx.agent.get('/api/sites/export.csv?limit=1&q=Bulk');
    const dataLines = response.text.trim().split('\r\n').slice(1);
    assert.equal(dataLines.length, 12);
  });

  it('returns stats grouped by category and status', async () => {
    await ctx.agent.post('/api/sites').send(SITE);
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'B' });
    const response = await ctx.agent.get('/api/sites/stats');
    assert.deepEqual(response.body.stats, [{ category: 'office', status: 'active', count: 2 }]);
  });

  it('writes audit entries for site mutations', async () => {
    const { body } = await ctx.agent.post('/api/sites').send(SITE);
    await ctx.agent.delete(`/api/sites/${body.site.id}`);
    const audit = await ctx.agent.get('/api/users/audit');
    const actions = audit.body.entries.map((entry) => entry.action);
    assert.ok(actions.includes('site.create') && actions.includes('site.delete'));
  });
});
