import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm } from '../src/sites/repository.js';
import { SITE, bootApp, registerAdmin } from './helpers.js';

describe('haversineKm', () => {
  it('returns 0 for the same point', () => {
    assert.equal(haversineKm(40.7128, -74.006, 40.7128, -74.006), 0);
  });

  it('measures a known distance to within 1%', () => {
    // New York City to Los Angeles is roughly 3936 km.
    const km = haversineKm(40.7128, -74.006, 34.0522, -118.2437);
    assert.ok(Math.abs(km - 3936) < 40, `expected ~3936 km, got ${km}`);
  });
});

describe('sites radius filter', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('returns only sites inside the radius, nearest first', async () => {
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Near', lat: 40.71, lng: -74.0 });
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Mid', lat: 40.8, lng: -74.0 });
    await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Far', lat: 34.0522, lng: -118.2437 });

    const response = await ctx.agent.get('/api/sites?lat=40.7128&lng=-74.006&radiusKm=20');
    assert.equal(response.status, 200);
    const names = response.body.sites.map((site) => site.name);
    assert.deepEqual(names, ['Near', 'Mid']);
    assert.equal(response.body.total, 2);
    assert.ok(response.body.sites[0].distanceKm <= response.body.sites[1].distanceKm);
  });

  it('rejects radiusKm without coordinates', async () => {
    const response = await ctx.agent.get('/api/sites?radiusKm=20');
    assert.equal(response.status, 400);
    assert.ok(response.body.details.some((issue) => issue.path === 'radiusKm'));
  });
});
