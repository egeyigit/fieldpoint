import { createUserRepository } from '../users/repository.js';
import { createSiteRepository } from '../sites/repository.js';
import { createWorkOrderRepository } from '../work-orders/repository.js';
import { createTeamRepository } from '../teams/repository.js';
import { hashPassword } from '../auth/password.js';

// The default team the teams migration folds every workspace into.
const DEFAULT_TEAM_ID = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Due date `days` from today, as YYYY-MM-DD. Negative values are overdue. */
function dueInDays(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Demo credentials. Intentionally public: this is a mock application. */
export const DEMO_USERS = Object.freeze([
  { email: 'admin@fieldpoint.local', name: 'Demo Admin', password: 'admin-demo-pass', role: 'admin' },
  { email: 'ops@fieldpoint.local', name: 'Demo Operator', password: 'ops-demo-pass1', role: 'member' },
  { email: 'qa@fieldpoint.local', name: 'QA Tester', password: 'qa-demo-pass-2026', role: 'admin' },
]);

export const DEMO_SITES = Object.freeze([
  { name: 'Boston HQ', address: '1 Financial Center, Boston, MA', lat: 42.3555, lng: -71.0565, category: 'office', status: 'active', notes: 'Main office, 3rd floor.' },
  { name: 'Newark Distribution Center', address: '600 Doremus Ave, Newark, NJ', lat: 40.7079, lng: -74.1266, category: 'warehouse', status: 'active', notes: 'Dock hours 06:00–22:00.' },
  { name: 'Providence Client — Harbor Corp', address: '100 Westminster St, Providence, RI', lat: 41.8236, lng: -71.4114, category: 'client', status: 'active', notes: 'Contact: J. Rivera.' },
  { name: 'Route 9 Substation Retrofit', address: 'Framingham, MA', lat: 42.2793, lng: -71.4162, category: 'job_site', status: 'planned', notes: 'Permit pending.' },
  { name: 'Van 12', address: '', lat: 41.7658, lng: -72.6734, category: 'vehicle', status: 'active', notes: 'Last check-in Hartford yard.' },
  { name: 'Old Portland Depot', address: '30 Danforth St, Portland, ME', lat: 43.6532, lng: -70.2589, category: 'warehouse', status: 'inactive', notes: 'Lease ended 2025.' },
]);

/**
 * Idempotently creates the demo users and sample sites. Safe to run on every
 * boot: existing emails and site names are skipped. Returns what was created.
 */
export const DEMO_WORK_ORDERS = Object.freeze([
  { site: 'Newark Distribution Center', title: 'Replace dock door 4 motor', priority: 'urgent', status: 'in_progress', dueInDays: -1, description: 'Door will not close; blocking evening loading.' },
  { site: 'Route 9 Substation Retrofit', title: 'Confirm permit approval', priority: 'high', status: 'blocked', dueInDays: 3, description: 'Waiting on the town inspector.' },
  { site: 'Boston HQ', title: 'Quarterly fire extinguisher check', priority: 'normal', status: 'open', dueInDays: 14, description: '' },
  { site: 'Van 12', title: 'Oil change and tyre rotation', priority: 'low', status: 'open', dueInDays: 21, description: '' },
  { site: 'Providence Client — Harbor Corp', title: 'Install replacement badge reader', priority: 'normal', status: 'done', dueInDays: -7, description: 'Signed off by J. Rivera.' },
]);

export async function seedDemo(db, { log = () => {} } = {}) {
  const users = createUserRepository(db);
  const sites = createSiteRepository(db);
  const workOrders = createWorkOrderRepository(db);
  const teams = createTeamRepository(db);
  const created = { users: [], sites: [], workOrders: [] };
  let adminId = null;

  for (const user of DEMO_USERS) {
    const existing = users.findByEmail(user.email);
    if (existing) {
      if (user.role === 'admin' && adminId === null) adminId = existing.id;
      continue;
    }
    const row = users.create({ ...user, passwordHash: await hashPassword(user.password) });
    teams.addMember(DEFAULT_TEAM_ID, row.id);
    if (user.role === 'admin' && adminId === null) adminId = row.id;
    created.users.push(user.email);
    log(`created user: ${user.email} (${user.role})`);
  }

  const existingNames = new Set(sites.listAll({}, DEFAULT_TEAM_ID).map((site) => site.name));
  for (const site of DEMO_SITES) {
    if (existingNames.has(site.name)) continue;
    sites.create(site, adminId, DEFAULT_TEAM_ID);
    created.sites.push(site.name);
    log(`created site: ${site.name}`);
  }

  const siteIdByName = new Map(sites.listAll({}, DEFAULT_TEAM_ID).map((site) => [site.name, site.id]));
  const operator = users.findByEmail('ops@fieldpoint.local');
  const existingTitles = new Set(
    workOrders.list({ limit: 500, offset: 0, sort: 'due' }, DEFAULT_TEAM_ID).rows.map((order) => order.title),
  );
  for (const order of DEMO_WORK_ORDERS) {
    const siteId = siteIdByName.get(order.site);
    if (!siteId || existingTitles.has(order.title)) continue;
    workOrders.create(
      {
        siteId,
        title: order.title,
        description: order.description,
        status: order.status,
        priority: order.priority,
        assignedTo: operator?.id ?? null,
        dueDate: dueInDays(order.dueInDays),
      },
      adminId,
      DEFAULT_TEAM_ID,
    );
    created.workOrders.push(order.title);
    log(`created work order: ${order.title}`);
  }
  return created;
}

/**
 * Creates (or resets the password of) one administrator. Used by the Factory
 * qa_seed hook, which supplies its own QA credentials via environment variables.
 */
export async function upsertAdmin(db, { email, name, password }) {
  const users = createUserRepository(db);
  const passwordHash = await hashPassword(password);
  const teams = createTeamRepository(db);
  const existing = users.findByEmail(email);
  if (existing) {
    users.updatePassword(existing.id, passwordHash);
    users.update(existing.id, { role: 'admin', isActive: true });
    teams.addMember(DEFAULT_TEAM_ID, existing.id);
    return { id: existing.id, created: false };
  }
  const row = users.create({ email, name, passwordHash, role: 'admin' });
  teams.addMember(DEFAULT_TEAM_ID, row.id);
  return { id: row.id, created: true };
}
