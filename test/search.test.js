import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, registerAdmin } from './helpers.js';

describe('global search', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Fix HQ door' });
  });
  afterEach(() => ctx.close());

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    assert.equal((await request(ctx.app).get('/api/search?q=HQ')).status, 401);
  });

  it('returns both site and work-order hits in labelled groups', async () => {
    const response = await ctx.agent.get('/api/search?q=HQ');
    assert.equal(response.status, 200);
    assert.equal(response.body.sites.length, 1);
    assert.equal(response.body.sites[0].name, 'HQ');
    assert.equal(response.body.workOrders.length, 1);
    assert.equal(response.body.workOrders[0].title, 'Fix HQ door');
  });

  it('matches work orders by title even when the site name does not match', async () => {
    const response = await ctx.agent.get('/api/search?q=door');
    assert.equal(response.body.sites.length, 0);
    assert.equal(response.body.workOrders.length, 1);
    assert.equal(response.body.workOrders[0].title, 'Fix HQ door');
  });

  it('excludes soft-deleted sites and their work orders', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    const response = await ctx.agent.get('/api/search?q=HQ');
    assert.equal(response.body.sites.length, 0);
    assert.equal(response.body.workOrders.length, 0);
  });

  it('ranks an exact site-name match ahead of a substring match', async () => {
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'HQ Annex' });
    const response = await ctx.agent.get('/api/search?q=HQ');
    assert.deepEqual(
      response.body.sites.map((site) => site.name),
      ['HQ', 'HQ Annex'],
    );
  });

  it('rejects an empty query with 400', async () => {
    assert.equal((await ctx.agent.get('/api/search?q=')).status, 400);
    assert.equal((await ctx.agent.get('/api/search')).status, 400);
  });

  it('rejects a query longer than 100 characters with 400', async () => {
    assert.equal((await ctx.agent.get(`/api/search?q=${'a'.repeat(101)}`)).status, 400);
  });
});
