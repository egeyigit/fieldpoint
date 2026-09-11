// The single machine-readable contract for the FieldPoint HTTP API.
// Kept hand-authored (rather than generated) so it can be reviewed as prose,
// but the drift test in test/openapi.test.js fails if a mounted /api route is
// missing here, so it cannot silently fall behind the handlers.

const errorEnvelope = {
  type: 'object',
  required: ['ok', 'error'],
  properties: {
    ok: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
    details: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
};

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const okResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean', enum: [true] } },
      },
    },
  },
});

const idPath = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
};

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'FieldPoint API',
    version: '1.0.0',
    description:
      'Site and work-order API for field-operations teams. Every response is ' +
      '`{ ok: boolean, ... }`; errors are `{ ok: false, error, details? }`. ' +
      'Authenticated routes use the `fp_session` cookie set by `POST /api/auth/login`.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'health' },
    { name: 'auth' },
    { name: 'sites' },
    { name: 'work-orders' },
    { name: 'users' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'fp_session' },
    },
    schemas: {
      Error: errorEnvelope,
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Liveness and readiness',
        security: [],
        responses: {
          200: okResponse('Service and database healthy'),
          503: errorResponse('Database unreachable'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Current user and bootstrap state',
        security: [],
        responses: { 200: okResponse('Current user (or null) and needsBootstrap') },
      },
    },
    '/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Create a user (first user becomes admin; afterwards admin only)',
        security: [{ sessionCookie: [] }],
        responses: {
          201: okResponse('User created'),
          403: errorResponse('Only administrators can create accounts'),
          409: errorResponse('Email already registered'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Sign in (sets the fp_session cookie)',
        security: [],
        responses: {
          200: okResponse('Signed in'),
          401: errorResponse('Invalid email or password'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Destroy the current session',
        security: [],
        responses: { 200: okResponse('Signed out') },
      },
    },
    '/auth/password': {
      post: {
        tags: ['auth'],
        summary: 'Change own password (rotates sessions)',
        security: [{ sessionCookie: [] }],
        responses: {
          200: okResponse('Password changed'),
          401: errorResponse('Current password is incorrect'),
        },
      },
    },
    '/sites': {
      get: {
        tags: ['sites'],
        summary: 'List sites',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Matching sites, total and paging') },
      },
      post: {
        tags: ['sites'],
        summary: 'Create a site',
        security: [{ sessionCookie: [] }],
        responses: {
          201: okResponse('Site created'),
          400: errorResponse('Invalid body'),
        },
      },
    },
    '/sites/stats': {
      get: {
        tags: ['sites'],
        summary: 'Counts by category and status',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Site statistics') },
      },
    },
    '/sites/export.csv': {
      get: {
        tags: ['sites'],
        summary: 'Export sites as CSV',
        security: [{ sessionCookie: [] }],
        responses: {
          200: { description: 'CSV attachment', content: { 'text/csv': {} } },
        },
      },
    },
    '/sites/{id}': {
      parameters: [idPath],
      get: {
        tags: ['sites'],
        summary: 'Read a site',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('The site'), 404: errorResponse('Site not found') },
      },
      patch: {
        tags: ['sites'],
        summary: 'Partial update',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Updated site'), 404: errorResponse('Site not found') },
      },
      put: {
        tags: ['sites'],
        summary: 'Partial update (alias of PATCH)',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Updated site'), 404: errorResponse('Site not found') },
      },
      delete: {
        tags: ['sites'],
        summary: 'Soft delete a site',
        security: [{ sessionCookie: [] }],
        responses: { 204: { description: 'Deleted' }, 404: errorResponse('Site not found') },
      },
    },
    '/sites/{id}/restore': {
      parameters: [idPath],
      post: {
        tags: ['sites'],
        summary: 'Restore a soft-deleted site',
        security: [{ sessionCookie: [] }],
        responses: {
          200: okResponse('Restored site'),
          404: errorResponse('Site not found'),
          409: errorResponse('Site is not deleted'),
        },
      },
    },
    '/work-orders': {
      get: {
        tags: ['work-orders'],
        summary: 'List work orders',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Matching work orders, total and paging') },
      },
      post: {
        tags: ['work-orders'],
        summary: 'Create a work order',
        security: [{ sessionCookie: [] }],
        responses: {
          201: okResponse('Work order created'),
          400: errorResponse('Invalid body or unknown site'),
        },
      },
    },
    '/work-orders/summary': {
      get: {
        tags: ['work-orders'],
        summary: 'Counts by status and priority',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Work-order summary') },
      },
    },
    '/work-orders/{id}': {
      parameters: [idPath],
      get: {
        tags: ['work-orders'],
        summary: 'Read a work order with its comments',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('The work order'), 404: errorResponse('Work order not found') },
      },
      patch: {
        tags: ['work-orders'],
        summary: 'Partial update',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Updated work order'), 404: errorResponse('Work order not found') },
      },
      delete: {
        tags: ['work-orders'],
        summary: 'Delete a work order (cascades comments)',
        security: [{ sessionCookie: [] }],
        responses: { 204: { description: 'Deleted' }, 404: errorResponse('Work order not found') },
      },
    },
    '/work-orders/{id}/comments': {
      parameters: [idPath],
      get: {
        tags: ['work-orders'],
        summary: 'List comments',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Comments'), 404: errorResponse('Work order not found') },
      },
      post: {
        tags: ['work-orders'],
        summary: 'Add a comment',
        security: [{ sessionCookie: [] }],
        responses: { 201: okResponse('Comment added'), 404: errorResponse('Work order not found') },
      },
    },
    '/users/directory': {
      get: {
        tags: ['users'],
        summary: 'Active users for assignment',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Directory of active users') },
      },
    },
    '/users': {
      get: {
        tags: ['users'],
        summary: 'List users (admin)',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('All users') },
      },
    },
    '/users/{id}': {
      parameters: [idPath],
      patch: {
        tags: ['users'],
        summary: 'Change role or active state (admin)',
        security: [{ sessionCookie: [] }],
        responses: {
          200: okResponse('Updated user'),
          404: errorResponse('User not found'),
          409: errorResponse('Cannot remove the last active administrator'),
        },
      },
    },
    '/users/audit': {
      get: {
        tags: ['users'],
        summary: 'Recent audit entries (admin)',
        security: [{ sessionCookie: [] }],
        responses: { 200: okResponse('Audit entries') },
      },
    },
  },
};

/**
 * Every operation the spec declares, as `METHOD /api/<path>` with Express-style
 * `:id` params, so the drift test can compare it against the mounted router.
 */
export function specOperations() {
  const ops = [];
  for (const [path, item] of Object.entries(openapiDocument.paths)) {
    const expressPath = '/api' + path.replace(/\{(\w+)\}/g, ':$1');
    for (const method of Object.keys(item)) {
      if (method === 'parameters') continue;
      ops.push(`${method.toUpperCase()} ${expressPath}`);
    }
  }
  return ops;
}
