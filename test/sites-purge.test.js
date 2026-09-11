import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';
import { createSiteRepository } from '../src/sites/repository.js';
import { purgeCutoff, sweepDeletedSites } from '../src/sites/sweeper.js';

describe('site purge', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  it('refuses to purge a site that is still live with 409', async () => {
    const response = await ctx.agent.delete(`/api/sites/${siteId}?purge=true`);
    assert.equal(response.status, 409);
    assert.ok(ctx.db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId));
  });

  it('hard-deletes a soft-deleted site and cascades work orders and comments', async () => {
    const wo = await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Fix door' });
    const workOrderId = wo.body.workOrder.id;
    await ctx.agent.post(`/api/work-orders/${workOrderId}/comments`).send({ body: 'On it' });

    await ctx.agent.delete(`/api/sites/${siteId}`);
    const purge = await ctx.agent.delete(`/api/sites/${siteId}?purge=true`);
    assert.equal(purge.status, 204);

    assert.equal(ctx.db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId), undefined);
    assert.equal(ctx.db.prepare('SELECT id FROM work_orders WHERE id = ?').get(workOrderId), undefined);
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) AS c FROM work_order_comments WHERE work_order_id = ?').get(workOrderId).c,
      0,
    );
  });

  it('records a site.purge audit entry', async () => {
    await ctx.agent.delete(`/api/sites/${siteId}`);
    await ctx.agent.delete(`/api/sites/${siteId}?purge=true`);
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    assert.ok(actions.includes('site.purge'));
  });

  it('only admins may purge', async () => {
    const member = await createMember(ctx.agent, ctx.app);
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await member.delete(`/api/sites/${siteId}?purge=true`)).status, 403);
    assert.ok(ctx.db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId));
  });

  it('404s when purging an unknown site', async () => {
    assert.equal((await ctx.agent.delete('/api/sites/9999?purge=true')).status, 404);
  });
});

describe('deleted-site sweeper', () => {
  it('computes an ISO cutoff the given number of days before now', () => {
    const now = new Date('2026-02-10T00:00:00.000Z');
    assert.equal(purgeCutoff(30, now), '2026-01-11T00:00:00.000Z');
    assert.equal(purgeCutoff(1, now), '2026-02-09T00:00:00.000Z');
  });

  it('does nothing when retention is not a positive number', () => {
    const ctx = bootApp();
    try {
      const sites = createSiteRepository(ctx.db);
      assert.equal(sweepDeletedSites(ctx.db, sites, { retentionDays: null }), 0);
      assert.equal(sweepDeletedSites(ctx.db, sites, { retentionDays: 0 }), 0);
    } finally {
      ctx.close();
    }
  });

  it('purges only sites deleted before the cutoff and leaves live and recent ones', async () => {
    const ctx = bootApp();
    try {
      await registerAdmin(ctx.agent);
      const admin = (await ctx.agent.get('/api/users')).body.users[0].id;
      const sites = createSiteRepository(ctx.db);

      const liveId = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Live' })).body.site.id;
      const recentId = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Recent' })).body.site.id;
      const oldId = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Old' })).body.site.id;

      ctx.db.prepare('UPDATE sites SET deleted_at = ?, deleted_by = ? WHERE id = ?')
        .run('2026-02-09T00:00:00.000Z', admin, recentId);
      ctx.db.prepare('UPDATE sites SET deleted_at = ?, deleted_by = ? WHERE id = ?')
        .run('2026-01-01T00:00:00.000Z', admin, oldId);

      const now = new Date('2026-02-10T00:00:00.000Z');
      const purged = sweepDeletedSites(ctx.db, sites, { retentionDays: 30, now });
      assert.equal(purged, 1);

      assert.ok(ctx.db.prepare('SELECT id FROM sites WHERE id = ?').get(liveId));
      assert.ok(ctx.db.prepare('SELECT id FROM sites WHERE id = ?').get(recentId));
      assert.equal(ctx.db.prepare('SELECT id FROM sites WHERE id = ?').get(oldId), undefined);
    } finally {
      ctx.close();
    }
  });
});
