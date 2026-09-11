import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, bootApp, registerAdmin } from './helpers.js';

describe('cursor pagination — sites', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('traverses all rows without duplicates or gaps (name sort)', async () => {
    for (let i = 0; i < 7; i++) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `Site ${String(i).padStart(2, '0')}` });
    }
    const seen = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const url = cursor
        ? `/api/sites?limit=3&cursor=${encodeURIComponent(cursor)}`
        : '/api/sites?limit=3';
      const res = await ctx.agent.get(url);
      assert.equal(res.status, 200);
      seen.push(...res.body.sites.map((s) => s.name));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, 7);
    assert.deepEqual(seen, [...new Set(seen)], 'no duplicates');
  });

  it('returns stable results when a row is inserted mid-traversal', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `A${i}` });
    }
    // Fetch first page
    const page1 = await ctx.agent.get('/api/sites?limit=2&sort=name');
    assert.equal(page1.body.sites.length, 2);
    const cursor = page1.body.nextCursor;
    assert.ok(cursor);

    // Insert a row that would sort into the first page
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'A0-inserted' });

    // Fetch second page with cursor — should not repeat first-page rows
    const page2 = await ctx.agent.get(`/api/sites?limit=2&sort=name&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(page2.status, 200);
    const page1Names = page1.body.sites.map((s) => s.name);
    const page2Names = page2.body.sites.map((s) => s.name);
    for (const name of page2Names) {
      assert.ok(!page1Names.includes(name), `"${name}" appeared on both pages`);
    }
  });

  it('returns 400 for a malformed cursor', async () => {
    const res = await ctx.agent.get('/api/sites?cursor=not-valid-base64!!!');
    assert.equal(res.status, 400);
  });

  it('returns 400 for a structurally wrong cursor (wrong length)', async () => {
    const bad = Buffer.from(JSON.stringify([1])).toString('base64url');
    // name sort expects [name, id] — length 2, not 1
    const res = await ctx.agent.get(`/api/sites?sort=name&cursor=${bad}`);
    assert.equal(res.status, 400);
  });

  it('works with sort=created', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `C${i}` });
    }
    const page1 = await ctx.agent.get('/api/sites?limit=2&sort=created');
    assert.ok(page1.body.nextCursor);
    const page2 = await ctx.agent.get(`/api/sites?limit=2&sort=created&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    assert.equal(page2.status, 200);
    const allNames = [...page1.body.sites, ...page2.body.sites].map((s) => s.name);
    assert.equal(allNames.length, 4);
    assert.deepEqual(allNames, [...new Set(allNames)]);
  });

  it('works with sort=updated', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `U${i}` });
    }
    const page1 = await ctx.agent.get('/api/sites?limit=2&sort=updated');
    assert.ok(page1.body.nextCursor);
    const page2 = await ctx.agent.get(`/api/sites?limit=2&sort=updated&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    assert.equal(page2.status, 200);
    assert.equal(page2.body.sites.length, 2);
  });

  it('cursor pagination with distance sort', async () => {
    // Create sites at varying distances from origin (0,0)
    const coords = [
      { lat: 0.01, lng: 0.01 },
      { lat: 0.02, lng: 0.02 },
      { lat: 0.03, lng: 0.03 },
      { lat: 0.04, lng: 0.04 },
      { lat: 0.05, lng: 0.05 },
    ];
    for (let i = 0; i < coords.length; i++) {
      await ctx.agent.post('/api/sites').send({
        ...SITE, name: `D${i}`, lat: coords[i].lat, lng: coords[i].lng,
      });
    }
    const page1 = await ctx.agent.get('/api/sites?limit=2&sort=distance&nearLat=0&nearLng=0&radiusKm=100');
    assert.equal(page1.status, 200);
    assert.equal(page1.body.sites.length, 2);
    assert.ok(page1.body.nextCursor);

    const page2 = await ctx.agent.get(
      `/api/sites?limit=2&sort=distance&nearLat=0&nearLng=0&radiusKm=100&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    assert.equal(page2.status, 200);
    assert.equal(page2.body.sites.length, 2);

    const allNames = [...page1.body.sites, ...page2.body.sites].map((s) => s.name);
    assert.deepEqual(allNames, [...new Set(allNames)], 'no duplicates across distance pages');
  });

  it('legacy offset still works', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.agent.post('/api/sites').send({ ...SITE, name: `Site ${i}` });
    }
    const page = await ctx.agent.get('/api/sites?limit=2&offset=2');
    assert.equal(page.body.sites.length, 2);
    assert.equal(page.body.total, 5);
  });
});

describe('cursor pagination — work orders', () => {
  let ctx;
  let siteId;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
    siteId = (await ctx.agent.post('/api/sites').send(SITE)).body.site.id;
  });
  afterEach(() => ctx.close());

  const newOrder = (overrides = {}) => ({ siteId, title: 'Fix pump', ...overrides });

  it('traverses all rows via cursor (default due sort)', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < 5; i++) {
      await ctx.agent.post('/api/work-orders').send(newOrder({ title: `WO${i}`, dueDate: tomorrow }));
    }
    const seen = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const url = cursor
        ? `/api/work-orders?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/api/work-orders?limit=2';
      const res = await ctx.agent.get(url);
      assert.equal(res.status, 200);
      seen.push(...res.body.workOrders.map((w) => w.title));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, 5);
    assert.deepEqual(seen, [...new Set(seen)]);
  });

  it('stable under concurrent insert (priority sort)', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.agent.post('/api/work-orders').send(newOrder({ title: `P${i}`, priority: 'normal' }));
    }
    const page1 = await ctx.agent.get('/api/work-orders?limit=2&sort=priority');
    const cursor = page1.body.nextCursor;
    assert.ok(cursor);

    // Insert a row that would appear early
    await ctx.agent.post('/api/work-orders').send(newOrder({ title: 'P-urgent', priority: 'urgent' }));

    const page2 = await ctx.agent.get(`/api/work-orders?limit=2&sort=priority&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(page2.status, 200);
    const p1Titles = page1.body.workOrders.map((w) => w.title);
    const p2Titles = page2.body.workOrders.map((w) => w.title);
    for (const t of p2Titles) {
      assert.ok(!p1Titles.includes(t), `"${t}" duplicated`);
    }
  });

  it('returns 400 for a malformed cursor', async () => {
    const res = await ctx.agent.get('/api/work-orders?cursor=garbage!');
    assert.equal(res.status, 400);
  });

  it('returns 400 for a structurally wrong cursor', async () => {
    const bad = Buffer.from(JSON.stringify([1])).toString('base64url');
    const res = await ctx.agent.get(`/api/work-orders?sort=created&cursor=${bad}`);
    assert.equal(res.status, 400);
  });

  it('works with sort=created and sort=updated', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.agent.post('/api/work-orders').send(newOrder({ title: `T${i}` }));
    }
    for (const sort of ['created', 'updated']) {
      const p1 = await ctx.agent.get(`/api/work-orders?limit=2&sort=${sort}`);
      assert.ok(p1.body.nextCursor, `nextCursor for ${sort}`);
      const p2 = await ctx.agent.get(`/api/work-orders?limit=2&sort=${sort}&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
      assert.equal(p2.status, 200);
      const all = [...p1.body.workOrders, ...p2.body.workOrders].map((w) => w.id);
      assert.deepEqual(all, [...new Set(all)]);
    }
  });

  it('legacy offset still works', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.agent.post('/api/work-orders').send(newOrder({ title: `L${i}` }));
    }
    const page = await ctx.agent.get('/api/work-orders?limit=2&offset=2');
    assert.equal(page.body.workOrders.length, 2);
    assert.equal(page.body.total, 5);
  });
});
