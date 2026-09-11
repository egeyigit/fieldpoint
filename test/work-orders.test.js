import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

describe('work orders', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  const newOrder = (overrides = {}) => ({ siteId, title: 'Replace gate motor', ...overrides });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    assert.equal((await request(ctx.app).get('/api/work-orders')).status, 401);
  });

  it('creates with defaults and joins the site', async () => {
    const response = await ctx.agent.post('/api/work-orders').send(newOrder());
    assert.equal(response.status, 201);
    const order = response.body.workOrder;
    assert.equal(order.status, 'open');
    assert.equal(order.priority, 'normal');
    assert.equal(order.assignedTo, null);
    assert.equal(order.dueDate, null);
    assert.equal(order.completedAt, null);
    assert.equal(order.siteName, 'HQ');
    assert.equal(order.createdByName, 'Ada Admin');
  });

  it('rejects an unknown site, unknown assignee and bad due date', async () => {
    const badSite = await ctx.agent.post('/api/work-orders').send(newOrder({ siteId: 9999 }));
    assert.equal(badSite.status, 400);
    const badUser = await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: 9999 }));
    assert.equal(badUser.status, 400);
    const badDate = await ctx.agent.post('/api/work-orders').send(newOrder({ dueDate: '12/01/2026' }));
    assert.equal(badDate.status, 400);
    const impossibleDate = await ctx.agent.post('/api/work-orders').send(newOrder({ dueDate: '2026-13-45' }));
    assert.equal(impossibleDate.status, 400);
  });

  it('rejects an unknown status or priority', async () => {
    assert.equal((await ctx.agent.post('/api/work-orders').send(newOrder({ status: 'pending' }))).status, 400);
    assert.equal((await ctx.agent.post('/api/work-orders').send(newOrder({ priority: 'critical' }))).status, 400);
  });

  it('sets completedAt when the status becomes terminal and clears it on reopen', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder());
    const done = await ctx.agent.patch(`/api/work-orders/${body.workOrder.id}`).send({ status: 'done' });
    assert.ok(done.body.workOrder.completedAt, 'completedAt should be set');
    const reopened = await ctx.agent.patch(`/api/work-orders/${body.workOrder.id}`).send({ status: 'open' });
    assert.equal(reopened.body.workOrder.completedAt, null);
  });

  it('ignores a client-supplied completedAt', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder({ completedAt: '1999-01-01T00:00:00Z' }));
    assert.equal(body.workOrder.completedAt, null);
  });

  it('filters by status, priority, assignee, openOnly and overdue', async () => {
    const me = (await ctx.agent.get('/api/auth/me')).body.user;
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'A', priority: 'urgent', dueDate: YESTERDAY }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'B', status: 'done', dueDate: YESTERDAY }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'C', assignedTo: me.id, dueDate: TOMORROW }));

    assert.equal((await ctx.agent.get('/api/work-orders?status=done')).body.total, 1);
    assert.equal((await ctx.agent.get('/api/work-orders?priority=urgent')).body.total, 1);
    assert.equal((await ctx.agent.get(`/api/work-orders?assignedTo=${me.id}`)).body.total, 1);
    assert.equal((await ctx.agent.get('/api/work-orders?openOnly=true')).body.total, 2);
    // Overdue excludes the completed one even though its due date has passed.
    assert.equal((await ctx.agent.get('/api/work-orders?overdue=true')).body.total, 1);
  });

  it('sorts by due date with undated orders last, then by priority', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'No date' }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'Later', dueDate: TOMORROW }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'Sooner', dueDate: YESTERDAY }));
    const titles = (await ctx.agent.get('/api/work-orders?sort=due')).body.workOrders.map((order) => order.title);
    assert.deepEqual(titles, ['Sooner', 'Later', 'No date']);

    const byPriority = await ctx.agent.get('/api/work-orders?sort=priority');
    assert.equal(byPriority.status, 200);
  });

  it('ranks urgent before low when sorting by priority', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'Low', priority: 'low' }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'Urgent', priority: 'urgent' }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'High', priority: 'high' }));
    const titles = (await ctx.agent.get('/api/work-orders?sort=priority')).body.workOrders.map((order) => order.title);
    assert.deepEqual(titles, ['Urgent', 'High', 'Low']);
  });

  it('hides orders whose site has been soft-deleted', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder());
    assert.equal((await ctx.agent.get('/api/work-orders')).body.total, 1);
    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal((await ctx.agent.get('/api/work-orders')).body.total, 0);
    await ctx.agent.post(`/api/sites/${siteId}/restore`);
    assert.equal((await ctx.agent.get('/api/work-orders')).body.total, 1);
  });

  it('supports comments in order', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder());
    const id = body.workOrder.id;
    await ctx.agent.post(`/api/work-orders/${id}/comments`).send({ body: 'Parts ordered' });
    await ctx.agent.post(`/api/work-orders/${id}/comments`).send({ body: 'Crew scheduled' });
    const detail = await ctx.agent.get(`/api/work-orders/${id}`);
    assert.deepEqual(detail.body.comments.map((comment) => comment.body), ['Parts ordered', 'Crew scheduled']);
    assert.equal(detail.body.comments[0].authorName, 'Ada Admin');
    assert.equal((await ctx.agent.post(`/api/work-orders/${id}/comments`).send({ body: '' })).status, 400);
  });

  it('only admins can delete an order', async () => {
    const member = await createMember(ctx.agent, ctx.app);
    const { body } = await member.post('/api/work-orders').send(newOrder());
    assert.equal((await member.delete(`/api/work-orders/${body.workOrder.id}`)).status, 403);
    assert.equal((await ctx.agent.delete(`/api/work-orders/${body.workOrder.id}`)).status, 204);
    assert.equal((await ctx.agent.get(`/api/work-orders/${body.workOrder.id}`)).status, 404);
  });

  it('cascades deletion of comments when the order goes', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder());
    await ctx.agent.post(`/api/work-orders/${body.workOrder.id}/comments`).send({ body: 'note' });
    await ctx.agent.delete(`/api/work-orders/${body.workOrder.id}`);
    const remaining = ctx.db.prepare('SELECT COUNT(*) AS count FROM work_order_comments').get();
    assert.equal(remaining.count, 0);
  });

  it('summarises by status and priority', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder());
    await ctx.agent.post('/api/work-orders').send(newOrder({ status: 'done' }));
    const response = await ctx.agent.get('/api/work-orders/summary');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.reduce((sum, row) => sum + row.count, 0), 2);
  });

  const TRANSITION_CASES = [
    { from: 'open', to: 'in_progress', allowed: true },
    { from: 'open', to: 'done', allowed: true },
    { from: 'in_progress', to: 'blocked', allowed: true },
    { from: 'blocked', to: 'done', allowed: true },
    { from: 'done', to: 'open', allowed: true },
    { from: 'cancelled', to: 'in_progress', allowed: true },
    { from: 'cancelled', to: 'in_progress', allowed: true, label: 'reopen cancelled' },
    { from: 'done', to: 'blocked', allowed: false },
    { from: 'cancelled', to: 'done', allowed: false },
    { from: 'done', to: 'cancelled', allowed: false },
  ];

  for (const { from, to, allowed, label } of TRANSITION_CASES) {
    it(`${allowed ? 'allows' : 'rejects'} ${label ?? `${from} \u2192 ${to}`}`, async () => {
      const { body } = await ctx.agent.post('/api/work-orders').send(newOrder());
      const id = body.workOrder.id;
      if (from !== 'open') {
        await ctx.agent.patch(`/api/work-orders/${id}`).send({ status: from });
      }
      const response = await ctx.agent.patch(`/api/work-orders/${id}`).send({ status: to });
      if (allowed) {
        assert.equal(response.status, 200);
        assert.equal(response.body.workOrder.status, to);
      } else {
        assert.equal(response.status, 409);
        assert.deepEqual(response.body.details, [{ path: 'status', from, to }]);
        // A rejected transition changes nothing.
        const current = await ctx.agent.get(`/api/work-orders/${id}`);
        assert.equal(current.body.workOrder.status, from);
      }
    });
  }

  it('audits reopening a terminal order as work_order.reopen', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder());
    const id = body.workOrder.id;
    await ctx.agent.patch(`/api/work-orders/${id}`).send({ status: 'done' });
    await ctx.agent.patch(`/api/work-orders/${id}`).send({ status: 'in_progress' });
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    assert.ok(actions.includes('work_order.reopen'), 'expected work_order.reopen');
  });

  it('audits create, update, delete and comment', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder());
    await ctx.agent.patch(`/api/work-orders/${body.workOrder.id}`).send({ status: 'in_progress' });
    await ctx.agent.post(`/api/work-orders/${body.workOrder.id}/comments`).send({ body: 'on site' });
    await ctx.agent.delete(`/api/work-orders/${body.workOrder.id}`);
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    for (const action of ['work_order.create', 'work_order.update', 'work_order.comment', 'work_order.delete']) {
      assert.ok(actions.includes(action), `expected ${action}`);
    }
  });
});
