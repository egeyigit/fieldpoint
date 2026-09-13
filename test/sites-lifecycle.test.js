import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER, SITE, bootApp, createMember, registerAdmin } from './helpers.js';

describe('site soft delete and restore', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  it('keeps the row but hides it from every read path', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await ctx.agent.get(`/api/sites/${siteId}`)).status, 404);
    assert.equal((await ctx.agent.get('/api/sites')).body.total, 0);
    assert.equal((await ctx.agent.get('/api/sites/stats')).body.stats.length, 0);
    const csv = await ctx.agent.get('/api/sites/export.csv');
    assert.equal(csv.text.trim().split('\r\n').length, 1, 'CSV should contain only the header');
    const row = ctx.db.prepare('SELECT deleted_at, deleted_by FROM sites WHERE id = ?').get(siteId);
    assert.ok(row.deleted_at, 'row should still exist with deleted_at set');
    assert.ok(row.deleted_by);
  });

  it('restores with the original data intact', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    const restored = await ctx.agent.post(`/api/sites/${siteId}/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.site.deletedAt, null);
    assert.equal(restored.body.site.notes, SITE.notes);
    assert.equal((await ctx.agent.get('/api/sites')).body.total, 1);
  });

  it('refuses to restore a site that is not deleted, or one that does not exist', async () => {
    assert.equal((await ctx.agent.post(`/api/sites/${siteId}/restore`)).status, 409);
    assert.equal((await ctx.agent.post('/api/sites/9999/restore')).status, 404);
  });

  it('only admins may delete, restore or list the recycle bin', async () => {
    const member = await createMember(ctx.agent, ctx.server);
    assert.equal((await member.delete(`/api/sites/${siteId}`)).status, 403);
    assert.equal((await member.get('/api/sites?includeDeleted=true')).status, 403);
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await member.post(`/api/sites/${siteId}/restore`)).status, 403);
    assert.equal((await member.get(`/api/sites/${siteId}?includeDeleted=true`)).status, 403);
    const bin = await ctx.agent.get('/api/sites?includeDeleted=true');
    assert.equal(bin.body.total, 1);
  });

  it('a deleted site cannot be updated', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await ctx.agent.patch(`/api/sites/${siteId}`).send({ name: 'Zombie' })).status, 404);
  });

  it('audits delete and restore', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    await ctx.agent.post(`/api/sites/${siteId}/restore`);
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    assert.ok(actions.includes('site.delete') && actions.includes('site.restore'));
  });
});

describe('site assignment', () => {
  let ctx;
  let memberId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    await createMember(ctx.agent, ctx.server);
    memberId = (await ctx.agent.get('/api/users')).body.users.find((user) => user.email === MEMBER.email).id;
  });
  afterEach(() => ctx.close());

  it('assigns, filters and reports the assignee name', async () => {
    const created = await ctx.agent.post('/api/sites').send({ ...SITE, assignedTo: memberId });
    assert.equal(created.body.site.assignedTo, memberId);
    assert.equal(created.body.site.assignedToName, 'Max Member');
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Unassigned' });
    const mine = await ctx.agent.get(`/api/sites?assignedTo=${memberId}`);
    assert.equal(mine.body.total, 1);
    assert.equal(mine.body.sites[0].name, 'HQ');
  });

  it('rejects an unknown or deactivated assignee', async () => {
    assert.equal((await ctx.agent.post('/api/sites').send({ ...SITE, assignedTo: 9999 })).status, 400);
    await ctx.agent.patch(`/api/users/${memberId}`).send({ isActive: false });
    const response = await ctx.agent.post('/api/sites').send({ ...SITE, assignedTo: memberId });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /deactivated/);
  });

  it('clears the assignment when the assignee is deleted from the database', async () => {
    const { body } = await ctx.agent.post('/api/sites').send({ ...SITE, assignedTo: memberId });
    ctx.db.prepare('DELETE FROM users WHERE id = ?').run(memberId);
    const site = await ctx.agent.get(`/api/sites/${body.site.id}`);
    assert.equal(site.status, 200);
    assert.equal(site.body.site.assignedTo, null);
  });

  it('can unassign by sending null', async () => {
    const { body } = await ctx.agent.post('/api/sites').send({ ...SITE, assignedTo: memberId });
    const updated = await ctx.agent.patch(`/api/sites/${body.site.id}`).send({ assignedTo: null });
    assert.equal(updated.body.site.assignedTo, null);
  });
});

describe('site proximity and sorting', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    // Boston, then ~306 km away in New York, then Los Angeles.
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Boston', lat: 42.3601, lng: -71.0589 });
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'New York', lat: 40.7128, lng: -74.006 });
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Los Angeles', lat: 34.0522, lng: -118.2437 });
  });
  afterEach(() => ctx.close());

  it('filters by radius and reports the distance', async () => {
    const near = await ctx.agent.get('/api/sites?nearLat=42.3601&nearLng=-71.0589&radiusKm=400&sort=distance');
    assert.deepEqual(near.body.sites.map((site) => site.name), ['Boston', 'New York']);
    assert.ok(near.body.sites[0].distanceKm < 0.001);
    assert.ok(Math.abs(near.body.sites[1].distanceKm - 306) < 5);
    assert.equal(near.body.total, 2);
  });

  it('excludes sites just outside the radius', async () => {
    const tight = await ctx.agent.get('/api/sites?nearLat=42.3601&nearLng=-71.0589&radiusKm=100');
    assert.deepEqual(tight.body.sites.map((site) => site.name), ['Boston']);
  });

  it('requires the proximity parameters together', async () => {
    assert.equal((await ctx.agent.get('/api/sites?radiusKm=100')).status, 400);
    assert.equal((await ctx.agent.get('/api/sites?nearLat=42&nearLng=-71')).status, 400);
    assert.equal((await ctx.agent.get('/api/sites?sort=distance')).status, 400);
  });

  it('filters by map viewport', async () => {
    const box = await ctx.agent.get('/api/sites?south=40&north=43&west=-75&east=-70');
    assert.deepEqual(box.body.sites.map((site) => site.name).sort(), ['Boston', 'New York']);
    assert.equal((await ctx.agent.get('/api/sites?south=40&north=43')).status, 400);
  });

  it('sorts by created and updated', async () => {
    const created = await ctx.agent.get('/api/sites?sort=created');
    assert.equal(created.body.sites[0].name, 'Los Angeles');
    const id = created.body.sites.at(-1).id;
    await ctx.agent.patch(`/api/sites/${id}`).send({ notes: 'touched' });
    const updated = await ctx.agent.get('/api/sites?sort=updated');
    assert.equal(updated.body.sites[0].id, id);
  });

  it('rejects an unknown sort key instead of passing it to SQL', async () => {
    const response = await ctx.agent.get('/api/sites?sort=name%3B%20DROP%20TABLE%20sites');
    assert.equal(response.status, 400);
    assert.equal((await ctx.agent.get('/api/sites')).body.total, 3);
  });

  it('paginates radius results', async () => {
    const page = await ctx.agent.get('/api/sites?nearLat=42.3601&nearLng=-71.0589&radiusKm=5000&sort=distance&limit=2&offset=1');
    assert.equal(page.body.total, 3);
    assert.deepEqual(page.body.sites.map((site) => site.name), ['New York', 'Los Angeles']);
  });
});
