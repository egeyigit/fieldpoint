import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

describe('collections', () => {
  let ctx;
  let siteId;

  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  it('requires authentication', async () => {
    assert.equal((await request(ctx.server).get('/api/collections')).status, 401);
    assert.equal((await request(ctx.server).post('/api/collections').send({ name: 'Private' })).status, 401);
  });

  it('creates, lists, reads and updates a collection', async () => {
    const created = await ctx.agent.post('/api/collections').send({ name: 'Route A', description: 'Morning calls' });
    assert.equal(created.status, 201);
    const id = created.body.collection.id;
    const list = await ctx.agent.get('/api/collections');
    assert.deepEqual(
      { name: list.body.collections[0].name, siteCount: list.body.collections[0].siteCount, isShared: list.body.collections[0].isShared },
      { name: 'Route A', siteCount: 0, isShared: false },
    );
    const updated = await ctx.agent.patch(`/api/collections/${id}`).send({ name: 'Route B' });
    assert.equal(updated.body.collection.name, 'Route B');
    assert.equal((await ctx.agent.get(`/api/collections/${id}`)).body.collection.description, 'Morning calls');
  });

  it('validates names, descriptions and empty patches', async () => {
    assert.equal((await ctx.agent.post('/api/collections').send({ name: '' })).status, 400);
    const collection = (await ctx.agent.post('/api/collections').send({ name: 'Valid' })).body.collection;
    assert.equal((await ctx.agent.patch(`/api/collections/${collection.id}`).send({})).status, 400);
    assert.equal((await ctx.agent.patch(`/api/collections/${collection.id}`).send({ description: 'x'.repeat(501) })).status, 400);
  });

  it('keeps private collections owner-only while allowing an admin override', async () => {
    const adminCollection = (await ctx.agent.post('/api/collections').send({ name: 'Admin private' })).body.collection;
    const memberAgent = await createMember(ctx.agent, ctx.server);
    assert.equal((await memberAgent.get(`/api/collections/${adminCollection.id}`)).status, 403);
    assert.equal((await memberAgent.patch(`/api/collections/${adminCollection.id}`).send({ name: 'No' })).status, 403);
    assert.equal((await memberAgent.delete(`/api/collections/${adminCollection.id}`)).status, 403);

    const memberCollection = (await memberAgent.post('/api/collections').send({ name: 'Member private' })).body.collection;
    assert.equal((await ctx.agent.get(`/api/collections/${memberCollection.id}`)).status, 200);
    assert.equal((await ctx.agent.patch(`/api/collections/${memberCollection.id}`).send({ name: 'Admin edit' })).status, 200);
  });

  it('pins idempotently, unpins idempotently and rejects deleted sites', async () => {
    const collection = (await ctx.agent.post('/api/collections').send({ name: 'Pinned' })).body.collection;
    assert.equal((await ctx.agent.post(`/api/collections/${collection.id}/sites/${siteId}`)).status, 201);
    assert.equal((await ctx.agent.post(`/api/collections/${collection.id}/sites/${siteId}`)).status, 200);
    const detail = await ctx.agent.get(`/api/collections/${collection.id}`);
    assert.equal(detail.body.collection.sites.length, 1);
    assert.ok(detail.body.collection.sites[0].pinnedAt);
    assert.equal((await ctx.agent.delete(`/api/collections/${collection.id}/sites/${siteId}`)).status, 204);
    assert.equal((await ctx.agent.delete(`/api/collections/${collection.id}/sites/${siteId}`)).status, 204);
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await ctx.agent.post(`/api/collections/${collection.id}/sites/${siteId}`)).status, 404);
    assert.equal((await ctx.agent.post(`/api/collections/${collection.id}/sites/99999`)).status, 404);
  });

  it('shares idempotently and clears the token', async () => {
    const collection = (await ctx.agent.post('/api/collections').send({ name: 'Shared' })).body.collection;
    const first = await ctx.agent.post(`/api/collections/${collection.id}/share`);
    const second = await ctx.agent.post(`/api/collections/${collection.id}/share`);
    assert.equal(first.status, 200);
    assert.equal(first.body.shareToken, second.body.shareToken);
    assert.match(first.body.shareToken, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(first.body.shareUrl.endsWith(`/shared/${first.body.shareToken}`));
    assert.equal((await ctx.agent.delete(`/api/collections/${collection.id}/share`)).status, 204);
    assert.equal((await ctx.agent.get(`/api/collections/${collection.id}`)).body.collection.shareToken, null);
  });

  it('deletes a collection and audits every mutation type', async () => {
    const collection = (await ctx.agent.post('/api/collections').send({ name: 'Audit me' })).body.collection;
    await ctx.agent.patch(`/api/collections/${collection.id}`).send({ description: 'changed' });
    await ctx.agent.post(`/api/collections/${collection.id}/sites/${siteId}`);
    await ctx.agent.delete(`/api/collections/${collection.id}/sites/${siteId}`);
    await ctx.agent.post(`/api/collections/${collection.id}/share`);
    await ctx.agent.delete(`/api/collections/${collection.id}/share`);
    await ctx.agent.delete(`/api/collections/${collection.id}`);
    assert.equal((await ctx.agent.get(`/api/collections/${collection.id}`)).status, 404);
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    for (const action of [
      'collection.create', 'collection.update', 'collection.pin', 'collection.unpin',
      'collection.share', 'collection.unshare', 'collection.delete',
    ]) assert.ok(actions.includes(action), `expected ${action}`);
  });
});
