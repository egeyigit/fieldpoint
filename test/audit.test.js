import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { SITE, registerAdmin } from './helpers.js';

function boot(env = {}) {
  const config = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40), ...env });
  const { app, db } = createApp(config);
  return { app, db, agent: request.agent(app), close: () => db.close() };
}

describe('audit read events', () => {
  it('records nothing on read when AUDIT_READS is off', async () => {
    const ctx = boot();
    try {
      await registerAdmin(ctx.agent);
      const { body } = await ctx.agent.post('/api/sites').send(SITE);
      await ctx.agent.get(`/api/sites/${body.site.id}`);
      const audit = await ctx.agent.get('/api/users/audit');
      const reads = audit.body.entries.filter((entry) => entry.action === 'site.read');
      assert.equal(reads.length, 0);
    } finally {
      ctx.close();
    }
  });

  it('records exactly one site.read per detail request when AUDIT_READS is on', async () => {
    const ctx = boot({ AUDIT_READS: 'true' });
    try {
      await registerAdmin(ctx.agent);
      const { body } = await ctx.agent.post('/api/sites').send(SITE);
      await ctx.agent.get(`/api/sites/${body.site.id}`);
      const audit = await ctx.agent.get('/api/users/audit');
      const reads = audit.body.entries.filter((entry) => entry.action === 'site.read');
      assert.equal(reads.length, 1);
      assert.equal(reads[0].entityId, body.site.id);
    } finally {
      ctx.close();
    }
  });

  it('records a work_order.read only on the detail route', async () => {
    const ctx = boot({ AUDIT_READS: 'true' });
    try {
      await registerAdmin(ctx.agent);
      const site = (await ctx.agent.post('/api/sites').send(SITE)).body.site;
      const order = (await ctx.agent.post('/api/work-orders').send({ title: 'Fix', siteId: site.id })).body.workOrder;
      await ctx.agent.get(`/api/work-orders/${order.id}`);
      const audit = await ctx.agent.get('/api/users/audit');
      const reads = audit.body.entries.filter((entry) => entry.action === 'work_order.read');
      assert.equal(reads.length, 1);
    } finally {
      ctx.close();
    }
  });
});

describe('audit retention and export', () => {
  it('trims only rows older than the window and audits the trim itself', async () => {
    const ctx = boot({ AUDIT_RETENTION_DAYS: '7' });
    try {
      await registerAdmin(ctx.agent);
      await ctx.agent.post('/api/sites').send(SITE);
      // An old entry outside the window, inserted directly.
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      ctx.db
        .prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(null, 'site.create', 'site', 999, '{}', old);

      const trimmed = await ctx.agent.post('/api/users/audit/trim');
      assert.equal(trimmed.status, 200);
      assert.equal(trimmed.body.deleted, 1);

      const audit = await ctx.agent.get('/api/users/audit');
      const actions = audit.body.entries.map((entry) => entry.action);
      assert.ok(actions.includes('audit.trim'));
      assert.ok(actions.includes('site.create'));
      // The in-window site.create must survive; only the old row is gone.
      assert.ok(!audit.body.entries.some((entry) => entry.entityId === 999));
    } finally {
      ctx.close();
    }
  });

  it('rejects trim when retention is not configured', async () => {
    const ctx = boot();
    try {
      await registerAdmin(ctx.agent);
      const response = await ctx.agent.post('/api/users/audit/trim');
      assert.equal(response.status, 409);
    } finally {
      ctx.close();
    }
  });

  it('exports the audit log as CSV', async () => {
    const ctx = boot();
    try {
      await registerAdmin(ctx.agent);
      await ctx.agent.post('/api/sites').send(SITE);
      const response = await ctx.agent.get('/api/users/audit/export.csv');
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /text\/csv/);
      const lines = response.text.trim().split('\r\n');
      assert.equal(lines[0], 'id,userId,userEmail,action,entityType,entityId,details,createdAt');
      assert.ok(lines.some((line) => line.includes('site.create')));
    } finally {
      ctx.close();
    }
  });
});
