import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

describe('work order checklist', () => {
  let ctx;
  let orderId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    const siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    orderId = (await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Service the pump' })).body.workOrder.id;
  });
  afterEach(() => ctx.close());

  it('adds items in order and reports progress', async () => {
    for (const text of ['Isolate', 'Drain', 'Refill']) {
      const response = await ctx.agent.post(`/api/work-orders/${orderId}/checklist`).send({ text });
      assert.equal(response.status, 201);
    }
    const listed = await ctx.agent.get(`/api/work-orders/${orderId}/checklist`);
    assert.deepEqual(listed.body.checklist.map((item) => item.text), ['Isolate', 'Drain', 'Refill']);
    assert.deepEqual(listed.body.progress, { total: 3, done: 0 });
  });

  it('records who ticked an item and when, and clears it on untick', async () => {
    const { body } = await ctx.agent.post(`/api/work-orders/${orderId}/checklist`).send({ text: 'Isolate' });
    const done = await ctx.agent.patch(`/api/work-orders/${orderId}/checklist/${body.item.id}`).send({ isDone: true });
    assert.equal(done.body.item.isDone, true);
    assert.equal(done.body.item.doneByName, 'Ada Admin');
    assert.ok(done.body.item.doneAt);
    assert.deepEqual(done.body.progress, { total: 1, done: 1 });

    const undone = await ctx.agent.patch(`/api/work-orders/${orderId}/checklist/${body.item.id}`).send({ isDone: false });
    assert.equal(undone.body.item.isDone, false);
    assert.equal(undone.body.item.doneAt, null);
    assert.equal(undone.body.item.doneBy, null);
  });

  it('refuses an item that belongs to another work order', async () => {
    const siteId = (await ctx.agent.get('/api/sites')).body.sites[0].id;
    const other = (await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Other' })).body.workOrder.id;
    const { body } = await ctx.agent.post(`/api/work-orders/${other}/checklist`).send({ text: 'Theirs' });
    const response = await ctx.agent.patch(`/api/work-orders/${orderId}/checklist/${body.item.id}`).send({ isDone: true });
    assert.equal(response.status, 404);
  });

  it('validates the item text', async () => {
    assert.equal((await ctx.agent.post(`/api/work-orders/${orderId}/checklist`).send({ text: '' })).status, 400);
    assert.equal((await ctx.agent.post(`/api/work-orders/${orderId}/checklist`).send({})).status, 400);
  });

  it('members can tick items', async () => {
    const { body } = await ctx.agent.post(`/api/work-orders/${orderId}/checklist`).send({ text: 'Isolate' });
    const member = await createMember(ctx.agent, ctx.server);
    const response = await member.patch(`/api/work-orders/${orderId}/checklist/${body.item.id}`).send({ isDone: true });
    assert.equal(response.status, 200);
    assert.equal(response.body.item.doneByName, 'Max Member');
  });

  it('deleting the work order takes its checklist with it', async () => {
    await ctx.agent.post(`/api/work-orders/${orderId}/checklist`).send({ text: 'Isolate' });
    await ctx.agent.delete(`/api/work-orders/${orderId}`);
    const remaining = ctx.db.prepare('SELECT COUNT(*) AS count FROM work_order_checklist_items').get();
    assert.equal(remaining.count, 0);
  });
});
