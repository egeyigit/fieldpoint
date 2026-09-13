import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { bootApp } from './helpers.js';
import { DEMO_SITES, DEMO_USERS, DEMO_WORK_ORDERS, seedDemo, upsertAdmin } from '../src/db/seed.js';
import { createUserRepository } from '../src/users/repository.js';

describe('demo seed', () => {
  it('creates demo users and sites once, then is a no-op', async () => {
    const ctx = bootApp();
    try {
      const first = await seedDemo(ctx.db);
      assert.equal(first.users.length, DEMO_USERS.length);
      assert.equal(first.sites.length, DEMO_SITES.length);
      assert.equal(first.workOrders.length, DEMO_WORK_ORDERS.length);
      const second = await seedDemo(ctx.db);
      assert.deepEqual(second, { users: [], sites: [], workOrders: [], templates: [], schedules: [] });
      assert.equal(createUserRepository(ctx.db).count(), DEMO_USERS.length);
    } finally {
      ctx.close();
    }
  });

  it('every demo account can sign in with its documented password', async () => {
    const ctx = bootApp();
    try {
      await seedDemo(ctx.db);
      for (const user of DEMO_USERS) {
        const response = await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: user.password });
        assert.equal(response.status, 200, `${user.email} should log in`);
        assert.equal(response.body.user.role, user.role);
      }
    } finally {
      ctx.close();
    }
  });

  it('seeded work orders attach to real sites and include an overdue one', async () => {
    const ctx = bootApp();
    try {
      await seedDemo(ctx.db);
      await request(ctx.app).post('/api/auth/login').send({ email: DEMO_USERS[0].email, password: DEMO_USERS[0].password });
      const agent = request.agent(ctx.app);
      await agent.post('/api/auth/login').send({ email: DEMO_USERS[0].email, password: DEMO_USERS[0].password });
      const all = await agent.get('/api/work-orders');
      assert.equal(all.body.total, DEMO_WORK_ORDERS.length);
      assert.ok(all.body.workOrders.every((order) => order.siteName));
      const overdue = await agent.get('/api/work-orders?overdue=true');
      assert.ok(overdue.body.total >= 1, 'demo data should include an overdue order');
    } finally {
      ctx.close();
    }
  });

  it('upsertAdmin creates then resets an administrator', async () => {
    const ctx = bootApp();
    try {
      const created = await upsertAdmin(ctx.db, { email: 'qa@example.com', name: 'QA', password: 'first-password-1' });
      assert.equal(created.created, true);
      const updated = await upsertAdmin(ctx.db, { email: 'qa@example.com', name: 'QA', password: 'second-password-2' });
      assert.equal(updated.created, false);
      assert.equal(updated.id, created.id);
      const login = await request(ctx.app).post('/api/auth/login').send({ email: 'qa@example.com', password: 'second-password-2' });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.role, 'admin');
    } finally {
      ctx.close();
    }
  });
});
