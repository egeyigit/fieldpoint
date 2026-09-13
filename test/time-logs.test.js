import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';
import { minutesBetween, secondsBetween } from '../src/work-orders/time-logs.js';

describe('secondsBetween', () => {
  it('measures whole seconds and never goes negative', () => {
    assert.equal(secondsBetween('2026-01-01T10:00:00Z', '2026-01-01T10:00:20Z'), 20);
    assert.equal(secondsBetween('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z'), 1800);
    assert.equal(secondsBetween('2026-01-01T10:30:00Z', '2026-01-01T10:00:00Z'), 0);
    assert.equal(secondsBetween('nonsense', '2026-01-01T10:00:00Z'), 0);
  });
});

describe('minutesBetween', () => {
  it('floors to whole minutes and never goes negative', () => {
    assert.equal(minutesBetween('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z'), 30);
    assert.equal(minutesBetween('2026-01-01T10:00:00Z', '2026-01-01T10:00:20Z'), 0);
    assert.equal(minutesBetween('2026-01-01T10:30:00Z', '2026-01-01T10:00:00Z'), 0);
    assert.equal(minutesBetween('nonsense', '2026-01-01T10:00:00Z'), 0);
  });
});

describe('work order time logs', () => {
  let ctx;
  let orderId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    const siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
    orderId = (await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Service the pump' })).body.workOrder.id;
  });
  afterEach(() => ctx.close());

  it('clocks in and out, totalling the minutes', async () => {
    const started = await ctx.agent.post(`/api/work-orders/${orderId}/time/start`);
    assert.equal(started.status, 201);
    assert.equal(started.body.timeLog.endedAt, null);
    assert.equal(started.body.timeLog.minutes, null);

    const stopped = await ctx.agent.post(`/api/work-orders/${orderId}/time/stop`).send({ note: 'done' });
    assert.equal(stopped.status, 200);
    assert.ok(stopped.body.timeLog.endedAt);
    assert.equal(stopped.body.timeLog.note, 'done');
    assert.equal(typeof stopped.body.totalMinutes, 'number');
  });

  it('refuses a second timer while one is running, on any order', async () => {
    await ctx.agent.post(`/api/work-orders/${orderId}/time/start`);
    const again = await ctx.agent.post(`/api/work-orders/${orderId}/time/start`);
    assert.equal(again.status, 409);

    const siteId = (await ctx.agent.get('/api/sites')).body.sites[0].id;
    const other = (await ctx.agent.post('/api/work-orders').send({ siteId, title: 'Other' })).body.workOrder.id;
    const elsewhere = await ctx.agent.post(`/api/work-orders/${other}/time/start`);
    assert.equal(elsewhere.status, 409);
    assert.match(elsewhere.body.error, /already clocked in/);
  });

  it('two people can run their own timers at once', async () => {
    const member = await createMember(ctx.agent, ctx.server);
    assert.equal((await ctx.agent.post(`/api/work-orders/${orderId}/time/start`)).status, 201);
    assert.equal((await member.post(`/api/work-orders/${orderId}/time/start`)).status, 201);
    const listed = await ctx.agent.get(`/api/work-orders/${orderId}/time`);
    assert.equal(listed.body.timeLogs.length, 2);
  });

  it('refuses to stop a timer that is not running here', async () => {
    const response = await ctx.agent.post(`/api/work-orders/${orderId}/time/stop`).send({});
    assert.equal(response.status, 409);
  });

  it('keeps a sub-minute session as seconds rather than losing it', async () => {
    const logged = await ctx.agent.post(`/api/work-orders/${orderId}/time`).send({
      startedAt: '2026-01-01T08:00:00Z',
      endedAt: '2026-01-01T08:00:20Z',
    });
    assert.equal(logged.status, 201);
    assert.equal(logged.body.timeLog.seconds, 20);
    assert.equal(logged.body.timeLog.minutes, 0);
    assert.equal(logged.body.totalSeconds, 20);
    assert.equal(logged.body.totalMinutes, 0);
  });

  it('accumulates three short sessions across the minute boundary', async () => {
    for (const start of ['08:00:00', '09:00:00', '10:00:00']) {
      await ctx.agent.post(`/api/work-orders/${orderId}/time`).send({
        startedAt: `2026-01-01T${start}Z`,
        endedAt: `2026-01-01T${start.slice(0, 6)}40Z`,
      });
    }
    const listed = await ctx.agent.get(`/api/work-orders/${orderId}/time`);
    assert.equal(listed.body.totalSeconds, 120);
    assert.equal(listed.body.totalMinutes, 2);
  });

  it('accepts a manual entry and rejects a backwards one', async () => {
    const good = await ctx.agent.post(`/api/work-orders/${orderId}/time`).send({
      startedAt: '2026-01-01T08:00:00Z',
      endedAt: '2026-01-01T09:30:00Z',
      note: 'on site',
    });
    assert.equal(good.status, 201);
    assert.equal(good.body.timeLog.minutes, 90);
    assert.equal(good.body.totalMinutes, 90);

    const backwards = await ctx.agent.post(`/api/work-orders/${orderId}/time`).send({
      startedAt: '2026-01-01T09:30:00Z',
      endedAt: '2026-01-01T08:00:00Z',
    });
    assert.equal(backwards.status, 400);
  });

  it('a member may delete their own entry but not someone else s', async () => {
    const member = await createMember(ctx.agent, ctx.server);
    const mine = await ctx.agent.post(`/api/work-orders/${orderId}/time`).send({
      startedAt: '2026-01-01T08:00:00Z', endedAt: '2026-01-01T09:00:00Z',
    });
    const theirs = await member.post(`/api/work-orders/${orderId}/time`).send({
      startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T11:00:00Z',
    });
    assert.equal((await member.delete(`/api/work-orders/${orderId}/time/${mine.body.timeLog.id}`)).status, 403);
    assert.equal((await member.delete(`/api/work-orders/${orderId}/time/${theirs.body.timeLog.id}`)).status, 204);
    // An admin may remove anyone's.
    assert.equal((await ctx.agent.delete(`/api/work-orders/${orderId}/time/${mine.body.timeLog.id}`)).status, 204);
  });

  it('a running entry contributes nothing to the total', async () => {
    await ctx.agent.post(`/api/work-orders/${orderId}/time`).send({
      startedAt: '2026-01-01T08:00:00Z', endedAt: '2026-01-01T09:00:00Z',
    });
    await ctx.agent.post(`/api/work-orders/${orderId}/time/start`);
    const listed = await ctx.agent.get(`/api/work-orders/${orderId}/time`);
    assert.equal(listed.body.totalMinutes, 60);
  });
});
