import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { generateLoad } from '../scripts/generate-load.js';
import { createSiteRepository } from '../src/sites/repository.js';
import { createWorkOrderRepository } from '../src/work-orders/repository.js';

describe('load generator', () => {
  it('generates the requested volume of sites and work orders', async () => {
    const ctx = bootApp();
    try {
      const result = await generateLoad(ctx.db, { sites: 120, workOrders: 300, batch: 50, seed: 7 });
      assert.equal(result.sites.count, 120);
      assert.equal(result.workOrders.count, 300);
      assert.ok(result.sites.rate >= 0);

      const sites = createSiteRepository(ctx.db).listAll({});
      assert.equal(sites.length, 120);
      for (const site of sites) {
        assert.ok(site.lat >= -90 && site.lat <= 90, 'lat in range');
        assert.ok(site.lng >= -180 && site.lng <= 180, 'lng in range');
      }

      const orders = createWorkOrderRepository(ctx.db).list({ limit: 1000, offset: 0, sort: 'due' });
      assert.equal(orders.total, 300);
    } finally {
      ctx.close();
    }
  });

  it('is deterministic for a fixed seed', async () => {
    const first = bootApp();
    const second = bootApp();
    try {
      await generateLoad(first.db, { sites: 40, workOrders: 0, batch: 20, seed: 42 });
      await generateLoad(second.db, { sites: 40, workOrders: 0, batch: 20, seed: 42 });
      const a = createSiteRepository(first.db).listAll({}).map((s) => `${s.lat},${s.lng}`);
      const b = createSiteRepository(second.db).listAll({}).map((s) => `${s.lat},${s.lng}`);
      assert.deepEqual(a, b);
    } finally {
      first.close();
      second.close();
    }
  });
});
