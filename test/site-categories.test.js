import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

describe('site categories', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('requires authentication to list', async () => {
    const response = await request(ctx.app).get('/api/site-categories');
    assert.equal(response.status, 401);
  });

  it('seeds the six built-in categories', async () => {
    const { body } = await ctx.agent.get('/api/site-categories');
    const slugs = body.categories.map((category) => category.slug).sort();
    assert.deepEqual(slugs, ['client', 'job_site', 'office', 'other', 'vehicle', 'warehouse']);
  });

  it('lets an admin add a category that new sites can immediately use', async () => {
    const created = await ctx.agent
      .post('/api/site-categories')
      .send({ slug: 'substation', label: 'Substation', color: '#0ea5e9' });
    assert.equal(created.status, 201);

    const site = await ctx.agent.post('/api/sites').send({ ...SITE, category: 'substation' });
    assert.equal(site.status, 201);
    assert.equal(site.body.site.category, 'substation');
  });

  it('rejects an unknown category slug on a site with 400', async () => {
    const response = await ctx.agent.post('/api/sites').send({ ...SITE, category: 'spaceship' });
    assert.equal(response.status, 400);
    assert.ok(response.body.details.some((issue) => issue.path === 'category'));
  });

  it('rejects a duplicate slug with 409', async () => {
    const response = await ctx.agent
      .post('/api/site-categories')
      .send({ slug: 'office', label: 'Office 2', color: '#123456' });
    assert.equal(response.status, 409);
  });

  it('only admins can create categories', async () => {
    const member = await createMember(ctx.agent, ctx.app);
    const response = await member
      .post('/api/site-categories')
      .send({ slug: 'depot', label: 'Depot', color: '#abcdef' });
    assert.equal(response.status, 403);
  });

  it('archives a category: hidden from the active picker but valid on existing sites', async () => {
    const created = await ctx.agent
      .post('/api/site-categories')
      .send({ slug: 'property', label: 'Property', color: '#0ea5e9' });
    const id = created.body.category.id;

    const site = await ctx.agent.post('/api/sites').send({ ...SITE, category: 'property' });
    assert.equal(site.status, 201);

    assert.equal((await ctx.agent.delete(`/api/site-categories/${id}`)).status, 204);

    // Admin still sees it (to manage), members no longer get it in the picker.
    const member = await createMember(ctx.agent, ctx.app);
    const memberList = await member.get('/api/site-categories');
    assert.ok(!memberList.body.categories.some((category) => category.slug === 'property'));

    // The existing site keeps its category and can still be updated on other fields.
    const updated = await ctx.agent.put(`/api/sites/${site.body.site.id}`).send({ notes: 'still here' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.site.category, 'property');

    // But a brand-new site can no longer be filed under the archived slug.
    const blocked = await ctx.agent.post('/api/sites').send({ ...SITE, category: 'property' });
    assert.equal(blocked.status, 400);

    // Restoring makes it assignable again.
    assert.equal((await ctx.agent.post(`/api/site-categories/${id}/restore`)).status, 200);
    const reused = await ctx.agent.post('/api/sites').send({ ...SITE, category: 'property' });
    assert.equal(reused.status, 201);
  });
});
