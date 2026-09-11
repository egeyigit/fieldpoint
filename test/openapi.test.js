import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { openapiDocument, specOperations } from '../src/openapi.js';

/** Walks the app's router tree collecting `METHOD /full/path` for every route. */
function mountedRoutes(app) {
  const routes = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          routes.push(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk(app.router.stack, '');
  return routes;
}

/** Recovers a router's mount path from the layer's regexp (Express 5). */
function mountPath(layer) {
  const known = ['/api/auth', '/api/users', '/api/sites', '/api/work-orders'];
  const source = layer.regexp?.toString() ?? '';
  return known.find((prefix) => source.includes(prefix.replace(/\//g, '\\/'))) ?? '';
}

describe('openapi', () => {
  it('is a valid OpenAPI 3.1 document with the error envelope and cookie auth', () => {
    assert.equal(openapiDocument.openapi, '3.1.0');
    assert.ok(openapiDocument.info?.title);
    assert.ok(openapiDocument.paths && Object.keys(openapiDocument.paths).length > 0);
    assert.deepEqual(
      openapiDocument.components.securitySchemes.sessionCookie,
      { type: 'apiKey', in: 'cookie', name: 'fp_session' },
    );
    const error = openapiDocument.components.schemas.Error;
    assert.deepEqual(error.required, ['ok', 'error']);
    assert.ok('details' in error.properties);
    // Every operation names at least one response.
    for (const item of Object.values(openapiDocument.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (method === 'parameters') continue;
        assert.ok(op.responses && Object.keys(op.responses).length > 0, `${method} needs responses`);
      }
    }
  });

  it('serves the spec at /api/openapi.json without auth', async () => {
    const ctx = bootApp();
    try {
      const response = await ctx.agent.get('/api/openapi.json');
      assert.equal(response.status, 200);
      assert.equal(response.body.openapi, '3.1.0');
      assert.ok(response.body.paths['/sites']);
    } finally {
      ctx.close();
    }
  });

  it('renders /docs under the app CSP (no inline or remote scripts)', async () => {
    const ctx = bootApp();
    try {
      const response = await ctx.agent.get('/docs');
      assert.equal(response.status, 200);
      const csp = response.headers['content-security-policy'];
      assert.ok(csp.includes("script-src 'self'"));
      // The viewer must be an external same-origin module, never inline.
      assert.ok(response.text.includes('src="/docs.js"'));
      assert.ok(!/<script(?![^>]*\ssrc=)/.test(response.text));
    } finally {
      ctx.close();
    }
  });

  it('has a spec entry for every mounted /api route (drift detection)', () => {
    const ctx = bootApp();
    try {
      const declared = new Set(specOperations());
      const undocumented = mountedRoutes(ctx.app)
        .filter((route) => route.startsWith('GET /api') || route.startsWith('POST /api') ||
          route.startsWith('PATCH /api') || route.startsWith('PUT /api') || route.startsWith('DELETE /api'))
        .filter((route) => route !== 'GET /api/openapi.json')
        .filter((route) => !declared.has(route));
      assert.deepEqual(undocumented, [], `routes missing from the OpenAPI spec: ${undocumented.join(', ')}`);
    } finally {
      ctx.close();
    }
  });
});
