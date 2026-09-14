import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { SITE, bootApp, registerAdmin } from './helpers.js';

describe('public collection sharing', () => {
  let ctx;
  let siteId;
  let collectionId;

  beforeEach(async () => {
    ctx = bootApp();
    const admin = await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send({ ...SITE, notes: 'private site note', assignedTo: admin.id })).body.site.id;
    collectionId = (await ctx.agent.post('/api/collections').send({
      name: 'Public route', description: 'Sites customers may see',
    })).body.collection.id;
    await ctx.agent.post(`/api/collections/${collectionId}/sites/${siteId}`);
  });
  afterEach(() => ctx.close());

  it('serves the share page without authentication', async () => {
    const response = await request(ctx.server).get('/shared/not-a-real-token');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.text, /Shared collection/);
  });

  it('returns the safe public projection for a valid token', async () => {
    const shared = await ctx.agent.post(`/api/collections/${collectionId}/share`);
    const response = await request(ctx.server).get(`/api/shared/${shared.body.shareToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.collection.name, 'Public route');
    assert.equal(response.body.collection.ownerName, 'Ada Admin');
    assert.equal(response.body.collection.sites[0].name, 'HQ');
    const payload = JSON.stringify(response.body);
    for (const forbidden of ['notes', 'assignedTo', 'ownerId', 'userId', 'pinnedBy', 'createdBy', 'updatedBy']) {
      assert.ok(!payload.includes(`"${forbidden}"`), `public payload exposed ${forbidden}`);
    }
  });

  it('returns 404 for unknown and cleared tokens', async () => {
    assert.equal((await request(ctx.server).get('/api/shared/abcdefghijklmnopqrstuvwxyz123456')).status, 404);
    const shared = await ctx.agent.post(`/api/collections/${collectionId}/share`);
    await ctx.agent.delete(`/api/collections/${collectionId}/share`);
    assert.equal((await request(ctx.server).get(`/api/shared/${shared.body.shareToken}`)).status, 404);
  });

  it('omits soft-deleted sites from the public collection', async () => {
    const shared = await ctx.agent.post(`/api/collections/${collectionId}/share`);
    await ctx.agent.delete(`/api/sites/${siteId}`);
    const response = await request(ctx.server).get(`/api/shared/${shared.body.shareToken}`);
    assert.deepEqual(response.body.collection.sites, []);
  });
});
