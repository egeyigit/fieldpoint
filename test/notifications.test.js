import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

describe('notifications', () => {
  let ctx;
  let siteId;
  let admin;
  let member;
  let memberId;
  beforeEach(async () => {
    ctx = bootApp();
    admin = await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    member = await createMember(ctx.agent, ctx.app);
    memberId = (await member.get('/api/auth/me')).body.user.id;
  });
  afterEach(() => ctx.close());

  const newOrder = (overrides = {}) => ({ siteId, title: 'Replace gate motor', ...overrides });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    assert.equal((await request(ctx.app).get('/api/notifications')).status, 401);
  });

  it('creates exactly one notification on assignment and none for the actor', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId }));
    const inbox = (await member.get('/api/notifications')).body;
    assert.equal(inbox.notifications.length, 1);
    assert.equal(inbox.notifications[0].type, 'assignment');
    assert.equal(inbox.unread, 1);
    // The admin who did the assigning gets nothing.
    assert.equal((await ctx.agent.get('/api/notifications')).body.notifications.length, 0);
  });

  it('does not notify when a user assigns an order to themselves', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: admin.id }));
    assert.equal((await ctx.agent.get('/api/notifications')).body.notifications.length, 0);
  });

  it('notifies the assignee (not the author) on a comment', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId }));
    await ctx.agent.post(`/api/work-orders/${body.workOrder.id}/comments`).send({ body: 'Parts ordered' });
    const inbox = (await member.get('/api/notifications')).body;
    assert.deepEqual(inbox.notifications.map((n) => n.type), ['comment', 'assignment']);
  });

  it('lists only your own notifications', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId }));
    assert.equal((await member.get('/api/notifications')).body.notifications.length, 1);
    assert.equal((await ctx.agent.get('/api/notifications')).body.notifications.length, 0);
  });

  it('marks read idempotently, scoped to the owner', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId }));
    const id = (await member.get('/api/notifications')).body.notifications[0].id;
    const first = await member.post(`/api/notifications/${id}/read`);
    assert.equal(first.status, 200);
    assert.equal(first.body.unread, 0);
    // Reading again is a no-op success, not an error.
    const again = await member.post(`/api/notifications/${id}/read`);
    assert.equal(again.status, 200);
    assert.equal(again.body.unread, 0);
    // Another user's id is a 404, not a leak.
    assert.equal((await ctx.agent.post(`/api/notifications/${id}/read`)).status, 404);
  });

  it('runs the overdue sweep idempotently: twice yields one row', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId, dueDate: YESTERDAY }));
    assert.equal(ctx.notifications.sweepOverdue(), 1);
    assert.equal(ctx.notifications.sweepOverdue(), 0);
    const overdue = (await member.get('/api/notifications')).body.notifications.filter((n) => n.type === 'overdue');
    assert.equal(overdue.length, 1);
  });

  it('does not sweep completed or unassigned overdue orders', async () => {
    await ctx.agent.post('/api/work-orders').send(newOrder({ dueDate: YESTERDAY }));
    await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId, status: 'done', dueDate: YESTERDAY }));
    assert.equal(ctx.notifications.sweepOverdue(), 0);
  });

  it('keeps the unread count correct after read and after the source order is deleted', async () => {
    const { body } = await ctx.agent.post('/api/work-orders').send(newOrder({ assignedTo: memberId, dueDate: YESTERDAY }));
    ctx.notifications.sweepOverdue();
    assert.equal((await member.get('/api/notifications')).body.unread, 2);
    const first = (await member.get('/api/notifications')).body.notifications[0].id;
    await member.post(`/api/notifications/${first}/read`);
    assert.equal((await member.get('/api/notifications')).body.unread, 1);
    // Deleting the order leaves the notifications (work_order_id nulled), count intact.
    await ctx.agent.delete(`/api/work-orders/${body.workOrder.id}`);
    const after = (await member.get('/api/notifications')).body;
    assert.equal(after.unread, 1);
    assert.equal(after.notifications.length, 2);
  });
});
