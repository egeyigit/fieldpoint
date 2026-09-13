import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

const TEMPLATE = {
  name: 'Quarterly fire check',
  title: 'Quarterly fire extinguisher check',
  description: 'Every unit on the floor plan.',
  priority: 'high',
  estimatedMinutes: 45,
  items: ['Check gauge pressure', 'Check tamper seal', 'Sign the tag'],
};

describe('work order templates', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('creates with an ordered checklist', async () => {
    const response = await ctx.agent.post('/api/templates').send(TEMPLATE);
    assert.equal(response.status, 201);
    const template = response.body.template;
    assert.equal(template.priority, 'high');
    assert.equal(template.estimatedMinutes, 45);
    assert.deepEqual(template.items.map((item) => item.text), TEMPLATE.items);
    assert.deepEqual(template.items.map((item) => item.position), [0, 1, 2]);
  });

  it('refuses a duplicate name regardless of capitalisation', async () => {
    await ctx.agent.post('/api/templates').send(TEMPLATE);
    const duplicate = await ctx.agent.post('/api/templates').send({ ...TEMPLATE, name: 'QUARTERLY FIRE CHECK' });
    assert.equal(duplicate.status, 409);
  });

  it('lets a template keep its own name on update', async () => {
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    const response = await ctx.agent.patch(`/api/templates/${body.template.id}`).send({ name: TEMPLATE.name, title: 'Renamed' });
    assert.equal(response.status, 200);
    assert.equal(response.body.template.title, 'Renamed');
  });

  it('replaces the checklist wholesale when items are sent', async () => {
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    const updated = await ctx.agent.patch(`/api/templates/${body.template.id}`).send({ items: ['Only this'] });
    assert.deepEqual(updated.body.template.items.map((item) => item.text), ['Only this']);
  });

  it('leaves the checklist alone when items are absent', async () => {
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    const updated = await ctx.agent.patch(`/api/templates/${body.template.id}`).send({ priority: 'low' });
    assert.equal(updated.body.template.items.length, 3);
  });

  it('hides archived templates unless asked', async () => {
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    await ctx.agent.patch(`/api/templates/${body.template.id}`).send({ isArchived: true });
    assert.equal((await ctx.agent.get('/api/templates')).body.templates.length, 0);
    assert.equal((await ctx.agent.get('/api/templates?includeArchived=true')).body.templates.length, 1);
  });

  it('members may read but not write', async () => {
    await ctx.agent.post('/api/templates').send(TEMPLATE);
    const member = await createMember(ctx.agent, ctx.app);
    assert.equal((await member.get('/api/templates')).status, 200);
    assert.equal((await member.post('/api/templates').send({ ...TEMPLATE, name: 'Other' })).status, 403);
    assert.equal((await member.delete('/api/templates/1')).status, 403);
  });

  it('validates items and minutes', async () => {
    assert.equal((await ctx.agent.post('/api/templates').send({ ...TEMPLATE, estimatedMinutes: 0 })).status, 400);
    assert.equal((await ctx.agent.post('/api/templates').send({ ...TEMPLATE, items: [''] })).status, 400);
    assert.equal((await ctx.agent.post('/api/templates').send({ ...TEMPLATE, priority: 'panic' })).status, 400);
  });

  it('creating a work order from a template copies the checklist', async () => {
    const siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    const order = await ctx.agent.post('/api/work-orders').send({
      siteId, title: 'Q3 check', templateId: body.template.id,
    });
    assert.equal(order.status, 201);
    const detail = await ctx.agent.get(`/api/work-orders/${order.body.workOrder.id}`);
    assert.deepEqual(detail.body.checklist.map((item) => item.text), TEMPLATE.items);
  });

  it('editing the template afterwards does not rewrite the order checklist', async () => {
    const siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    const order = await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Q3', templateId: body.template.id });
    await ctx.agent.patch(`/api/templates/${body.template.id}`).send({ items: ['Completely different'] });
    const detail = await ctx.agent.get(`/api/work-orders/${order.body.workOrder.id}`);
    assert.deepEqual(detail.body.checklist.map((item) => item.text), TEMPLATE.items);
  });

  it('rejects an unknown template on a work order', async () => {
    const siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    const response = await ctx.agent.post('/api/work-orders').send({ siteId, title: 'x', templateId: 9999 });
    assert.equal(response.status, 400);
  });

  it('deleting a template leaves its work orders intact', async () => {
    const siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    const { body } = await ctx.agent.post('/api/templates').send(TEMPLATE);
    const order = await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Q3', templateId: body.template.id });
    await ctx.agent.delete(`/api/templates/${body.template.id}`);
    const detail = await ctx.agent.get(`/api/work-orders/${order.body.workOrder.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.workOrder.templateId, null);
    assert.equal(detail.body.checklist.length, 3);
  });
});
