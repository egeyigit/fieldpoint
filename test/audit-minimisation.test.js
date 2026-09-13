import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, registerAdmin } from './helpers.js';

/** Pulls the raw stored details JSON for the most recent row of an action. */
function latestDetails(db, action) {
  const row = db
    .prepare('SELECT details FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1')
    .get(action);
  return { raw: row.details, parsed: JSON.parse(row.details) };
}

describe('audit log minimisation', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send({ ...SITE, notes: '' })).body.site.id;
  });
  afterEach(() => ctx.close());

  it('never stores site notes text, only a hash and length', async () => {
    const secret = 'Gate code 4821, ask for Dana 555-0134';
    await ctx.agent.patch(`/api/sites/${siteId}`).send({ notes: secret });
    const { raw, parsed } = latestDetails(ctx.db, 'site.update');
    assert.ok(!raw.includes('4821'), 'raw audit details must not contain the notes text');
    assert.equal(parsed.changes.notes.to.length, secret.length);
    assert.match(parsed.changes.notes.to.sha256, /^[0-9a-f]{64}$/);
    assert.equal(parsed.changes.notes.changed, true);
    assert.equal(parsed.changes.notes.to.text, undefined);
  });

  it('keeps before/after for a site status change', async () => {
    await ctx.agent.patch(`/api/sites/${siteId}`).send({ status: 'inactive' });
    const { parsed } = latestDetails(ctx.db, 'site.update');
    assert.deepEqual(parsed.changes.status, { from: 'active', to: 'inactive' });
  });

  it('never stores work order description text, but keeps assignee before/after', async () => {
    const admin = (await ctx.agent.get('/api/auth/me')).body.user;
    const created = await ctx.agent
      .post('/api/work-orders')
      .send({ siteId, title: 'Inspect', description: '' });
    const orderId = created.body.workOrder.id;
    const secret = 'Customer Jane Roe, phone 555-9900, entry via rear';
    await ctx.agent
      .patch(`/api/work-orders/${orderId}`)
      .send({ description: secret, assignedTo: admin.id, status: 'in_progress' });
    const { raw, parsed } = latestDetails(ctx.db, 'work_order.update');
    assert.ok(!raw.includes('Jane Roe'), 'raw audit details must not contain description text');
    assert.equal(parsed.changes.description.to.length, secret.length);
    assert.match(parsed.changes.description.to.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(parsed.changes.assignedTo, { from: null, to: admin.id });
    assert.deepEqual(parsed.changes.status, { from: 'open', to: 'in_progress' });
  });
});
