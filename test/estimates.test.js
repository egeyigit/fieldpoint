import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, registerAdmin } from './helpers.js';
import { median } from '../src/reports/repository.js';

describe('median', () => {
  it('takes the middle value for an odd count', () => {
    assert.equal(median([30, 10, 20]), 20);
  });
  it('averages the two middle values for an even count', () => {
    assert.equal(median([10, 20, 30, 40]), 25);
  });
  it('is null for an empty sample', () => {
    assert.equal(median([]), null);
  });
});

describe('estimate reporting', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  async function completedOrderFromTemplate(templateId, minutes) {
    const order = (
      await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Job', templateId })
    ).body.workOrder.id;
    await ctx.agent.post(`/api/work-orders/${order}/time`).send({
      startedAt: '2026-01-01T08:00:00Z',
      endedAt: new Date(Date.parse('2026-01-01T08:00:00Z') + minutes * 60000).toISOString(),
    });
    await ctx.agent.patch(`/api/work-orders/${order}`).send({ status: 'done' });
    return order;
  }

  it('exposes a per-order over/under delta, blank when no estimate is set', async () => {
    const noEstimate = (
      await ctx.agent.post('/api/work-orders').send({ siteId, title: 'No estimate' })
    ).body.workOrder.id;
    let detail = await ctx.agent.get(`/api/work-orders/${noEstimate}`);
    assert.equal(detail.body.estimateDeltaMinutes, null);

    const withEstimate = (
      await ctx.agent.post('/api/work-orders').send({ siteId, title: 'With estimate', estimatedMinutes: 60 })
    ).body.workOrder.id;
    await ctx.agent.post(`/api/work-orders/${withEstimate}/time`).send({
      startedAt: '2026-01-01T08:00:00Z', endedAt: '2026-01-01T09:30:00Z',
    });
    detail = await ctx.agent.get(`/api/work-orders/${withEstimate}`);
    assert.equal(detail.body.estimateDeltaMinutes, 30);
  });

  it('groups completed orders by template with count and median actual (odd count)', async () => {
    const templateId = (
      await ctx.agent.post('/api/templates').send({
        name: 'Pump service', title: 'Service pump', estimatedMinutes: 60, items: [],
      })
    ).body.template.id;
    await completedOrderFromTemplate(templateId, 30);
    await completedOrderFromTemplate(templateId, 90);
    await completedOrderFromTemplate(templateId, 60);

    const report = await ctx.agent.get('/api/reports/estimates');
    assert.equal(report.status, 200);
    const row = report.body.estimates.find((entry) => entry.templateId === templateId);
    assert.equal(row.count, 3);
    assert.equal(row.medianMinutes, 60);
    assert.equal(row.estimatedMinutes, 60);
  });

  it('averages the two middle values for an even count', async () => {
    const templateId = (
      await ctx.agent.post('/api/templates').send({
        name: 'Filter swap', title: 'Swap filter', estimatedMinutes: 45, items: [],
      })
    ).body.template.id;
    await completedOrderFromTemplate(templateId, 20);
    await completedOrderFromTemplate(templateId, 40);
    await completedOrderFromTemplate(templateId, 60);
    await completedOrderFromTemplate(templateId, 80);

    const report = await ctx.agent.get('/api/reports/estimates');
    const row = report.body.estimates.find((entry) => entry.templateId === templateId);
    assert.equal(row.count, 4);
    assert.equal(row.medianMinutes, 50);
  });

  it('excludes cancelled orders and orders with no logged time', async () => {
    const templateId = (
      await ctx.agent.post('/api/templates').send({
        name: 'Inspection', title: 'Inspect', estimatedMinutes: 30, items: [],
      })
    ).body.template.id;
    await completedOrderFromTemplate(templateId, 25);

    // Cancelled: never happened.
    const cancelled = (
      await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Cancelled', templateId })
    ).body.workOrder.id;
    await ctx.agent.post(`/api/work-orders/${cancelled}/time`).send({
      startedAt: '2026-01-01T08:00:00Z', endedAt: '2026-01-01T10:00:00Z',
    });
    await ctx.agent.patch(`/api/work-orders/${cancelled}`).send({ status: 'cancelled' });

    // Done but no logged time: no measured actual to contribute.
    const noTime = (
      await ctx.agent.post('/api/work-orders').send({ siteId, title: 'No time', templateId })
    ).body.workOrder.id;
    await ctx.agent.patch(`/api/work-orders/${noTime}`).send({ status: 'done' });

    const report = await ctx.agent.get('/api/reports/estimates');
    const row = report.body.estimates.find((entry) => entry.templateId === templateId);
    assert.equal(row.count, 1);
    assert.equal(row.medianMinutes, 25);
  });

  it('lets an admin write the median back to the template', async () => {
    const templateId = (
      await ctx.agent.post('/api/templates').send({
        name: 'Belt change', title: 'Change belt', estimatedMinutes: 30, items: [],
      })
    ).body.template.id;
    await completedOrderFromTemplate(templateId, 50);
    await completedOrderFromTemplate(templateId, 70);
    await completedOrderFromTemplate(templateId, 90);

    const adopt = await ctx.agent.post(`/api/reports/estimates/${templateId}/adopt`);
    assert.equal(adopt.status, 200);
    assert.equal(adopt.body.template.estimatedMinutes, 70);

    const template = await ctx.agent.get(`/api/templates/${templateId}`);
    assert.equal(template.body.template.estimatedMinutes, 70);
  });
});
