import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';
import { addDays, advanceDueDate, todayIso } from '../src/maintenance/repository.js';
import { generateDueWorkOrders } from '../src/maintenance/generator.js';

const TODAY = todayIso();
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);

describe('schedule date arithmetic', () => {
  it('adds days across a month boundary', () => {
    assert.equal(addDays('2026-01-30', 3), '2026-02-02');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('advances past today in whole intervals rather than one step', () => {
    // Missed for a year: one jump forward, not 52 generated orders.
    assert.equal(advanceDueDate('2026-01-01', 7, '2026-01-01'), '2026-01-08');
    assert.equal(advanceDueDate('2026-01-01', 7, '2026-02-01'), '2026-02-05');
    assert.ok(advanceDueDate('2020-01-01', 30, '2026-01-01') > '2026-01-01');
  });
});

describe('maintenance schedules', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  const schedule = (overrides = {}) => ({
    siteId, title: 'Monthly generator test', intervalDays: 30, nextDueDate: TOMORROW, ...overrides,
  });

  it('creates and lists a schedule with its joins', async () => {
    const response = await ctx.agent.post('/api/maintenance').send(schedule());
    assert.equal(response.status, 201);
    assert.equal(response.body.schedule.siteName, 'HQ');
    assert.equal(response.body.schedule.isActive, true);
    const listed = await ctx.agent.get('/api/maintenance');
    assert.equal(listed.body.schedules.length, 1);
  });

  it('validates the interval, the date and the references', async () => {
    assert.equal((await ctx.agent.post('/api/maintenance').send(schedule({ intervalDays: 0 }))).status, 400);
    assert.equal((await ctx.agent.post('/api/maintenance').send(schedule({ nextDueDate: '01/02/2026' }))).status, 400);
    assert.equal((await ctx.agent.post('/api/maintenance').send(schedule({ siteId: 9999 }))).status, 400);
    assert.equal((await ctx.agent.post('/api/maintenance').send(schedule({ assignedTo: 9999 }))).status, 400);
    assert.equal((await ctx.agent.post('/api/maintenance').send(schedule({ templateId: 9999 }))).status, 400);
  });

  it('only admins may write schedules', async () => {
    const member = await createMember(ctx.agent, ctx.server);
    assert.equal((await member.get('/api/maintenance')).status, 200);
    assert.equal((await member.post('/api/maintenance').send(schedule())).status, 403);
    assert.equal((await member.post('/api/maintenance/run')).status, 403);
  });

  it('generates a work order for a due schedule and moves the date on', async () => {
    const { body } = await ctx.agent.post('/api/maintenance').send(schedule({ nextDueDate: TODAY }));
    const run = await ctx.agent.post('/api/maintenance/run');
    assert.equal(run.status, 200);
    assert.equal(run.body.created.length, 1);

    const orders = await ctx.agent.get('/api/work-orders');
    assert.equal(orders.body.total, 1);
    assert.equal(orders.body.workOrders[0].title, 'Monthly generator test');
    assert.equal(orders.body.workOrders[0].dueDate, TODAY);
    assert.equal(orders.body.workOrders[0].scheduleId, body.schedule.id);

    const after = await ctx.agent.get(`/api/maintenance/${body.schedule.id}`);
    assert.equal(after.body.schedule.nextDueDate, addDays(TODAY, 30));
    assert.ok(after.body.schedule.lastGeneratedAt);
  });

  it('is idempotent: a second sweep on the same day generates nothing', async () => {
    await ctx.agent.post('/api/maintenance').send(schedule({ nextDueDate: TODAY }));
    await ctx.agent.post('/api/maintenance/run');
    const second = await ctx.agent.post('/api/maintenance/run');
    assert.deepEqual(second.body.created, []);
    assert.equal((await ctx.agent.get('/api/work-orders')).body.total, 1);
  });

  it('catches up a long-missed schedule with one order, not a backlog', async () => {
    const { body } = await ctx.agent.post('/api/maintenance').send(
      schedule({ nextDueDate: addDays(TODAY, -365), intervalDays: 7 }),
    );
    await ctx.agent.post('/api/maintenance/run');
    assert.equal((await ctx.agent.get('/api/work-orders')).body.total, 1);
    const after = await ctx.agent.get(`/api/maintenance/${body.schedule.id}`);
    assert.ok(after.body.schedule.nextDueDate > TODAY, 'next due date must be in the future');
  });

  it('skips a future schedule, an inactive one, and one on a deleted site', async () => {
    await ctx.agent.post('/api/maintenance').send(schedule({ title: 'Future', nextDueDate: TOMORROW }));
    const paused = await ctx.agent.post('/api/maintenance').send(schedule({ title: 'Paused', nextDueDate: YESTERDAY }));
    await ctx.agent.patch(`/api/maintenance/${paused.body.schedule.id}`).send({ isActive: false });

    const otherSite = (await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Gone' })).body.site.id;
    await ctx.agent.post('/api/maintenance').send(schedule({ siteId: otherSite, title: 'Orphan', nextDueDate: YESTERDAY }));
    await ctx.agent.delete(`/api/sites/${otherSite}`);

    const run = await ctx.agent.post('/api/maintenance/run');
    assert.deepEqual(run.body.created, []);
    assert.equal((await ctx.agent.get('/api/work-orders')).body.total, 0);
  });

  it('copies the template checklist onto the generated order', async () => {
    const template = await ctx.agent.post('/api/templates').send({
      name: 'Generator service', title: 'Service the generator', items: ['Check oil', 'Run for 10 minutes'],
    });
    await ctx.agent.post('/api/maintenance').send(
      schedule({ nextDueDate: TODAY, templateId: template.body.template.id }),
    );
    await ctx.agent.post('/api/maintenance/run');
    const orderId = (await ctx.agent.get('/api/work-orders')).body.workOrders[0].id;
    const detail = await ctx.agent.get(`/api/work-orders/${orderId}`);
    assert.deepEqual(detail.body.checklist.map((item) => item.text), ['Check oil', 'Run for 10 minutes']);
  });

  it('dueOnly lists only what the sweep would pick up', async () => {
    await ctx.agent.post('/api/maintenance').send(schedule({ title: 'Due', nextDueDate: YESTERDAY }));
    await ctx.agent.post('/api/maintenance').send(schedule({ title: 'Later', nextDueDate: TOMORROW }));
    const due = await ctx.agent.get('/api/maintenance?dueOnly=true');
    assert.deepEqual(due.body.schedules.map((row) => row.title), ['Due']);
  });

  it('deleting a schedule leaves the orders it already generated', async () => {
    const { body } = await ctx.agent.post('/api/maintenance').send(schedule({ nextDueDate: TODAY }));
    await ctx.agent.post('/api/maintenance/run');
    await ctx.agent.delete(`/api/maintenance/${body.schedule.id}`);
    const orders = await ctx.agent.get('/api/work-orders');
    assert.equal(orders.body.total, 1);
    assert.equal(orders.body.workOrders[0].scheduleId, null);
  });

  it('the generator called directly reports what it created', async () => {
    await ctx.agent.post('/api/maintenance').send(schedule({ nextDueDate: TODAY }));
    const created = generateDueWorkOrders(ctx.db, { ...ctx.deps, today: TODAY });
    assert.equal(created.length, 1);
    assert.equal(created[0].title, 'Monthly generator test');
  });

  it('audits create, update, delete and a generating sweep', async () => {
    const { body } = await ctx.agent.post('/api/maintenance').send(schedule({ nextDueDate: TODAY }));
    await ctx.agent.patch(`/api/maintenance/${body.schedule.id}`).send({ priority: 'high' });
    await ctx.agent.post('/api/maintenance/run');
    await ctx.agent.delete(`/api/maintenance/${body.schedule.id}`);
    const actions = (await ctx.agent.get('/api/users/audit')).body.entries.map((entry) => entry.action);
    for (const action of ['schedule.create', 'schedule.update', 'schedule.generate', 'schedule.delete']) {
      assert.ok(actions.includes(action), `expected ${action}`);
    }
  });
});
