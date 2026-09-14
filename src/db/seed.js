import { createUserRepository } from '../users/repository.js';
import { createSiteRepository } from '../sites/repository.js';
import { createWorkOrderRepository } from '../work-orders/repository.js';
import { createChecklistRepository } from '../work-orders/checklist.js';
import { createTemplateRepository } from '../templates/repository.js';
import { createScheduleRepository, addDays, todayIso } from '../maintenance/repository.js';
import { createVisitRepository } from '../visits/repository.js';
import { createCollectionRepository } from '../collections/repository.js';
import { hashPassword } from '../auth/password.js';

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

export const DEMO_TEMPLATES = Object.freeze([
  {
    name: 'Fire extinguisher check',
    title: 'Quarterly fire extinguisher check',
    description: 'Every unit on the floor plan.',
    priority: 'normal',
    estimatedMinutes: 45,
    items: ['Check gauge pressure', 'Check tamper seal', 'Check the access path is clear', 'Sign the tag'],
  },
  {
    name: 'Generator service',
    title: 'Monthly generator service',
    description: '',
    priority: 'high',
    estimatedMinutes: 90,
    items: ['Check oil level', 'Check coolant', 'Run under load for 10 minutes', 'Log the hour meter'],
  },
]);

export const DEMO_SCHEDULES = Object.freeze([
  { site: 'Boston HQ', template: 'Fire extinguisher check', title: 'Quarterly fire extinguisher check', intervalDays: 90, dueInDays: 7, priority: 'normal' },
  { site: 'Newark Distribution Center', template: 'Generator service', title: 'Monthly generator service', intervalDays: 30, dueInDays: -2, priority: 'high' },
]);

export const DEMO_VISITS = Object.freeze([
  { site: 'Boston HQ', user: 'admin@fieldpoint.local', daysAgo: 2, rating: 5, note: 'Quarterly walkthrough completed.' },
  { site: 'Newark Distribution Center', user: 'ops@fieldpoint.local', daysAgo: 5, rating: 4, note: 'Checked loading dock access.' },
  { site: 'Providence Client — Harbor Corp', user: 'admin@fieldpoint.local', daysAgo: 9, rating: null, note: 'Met the client facilities lead.' },
]);

export const DEMO_COLLECTION = Object.freeze({
  name: 'Northeast operations',
  description: 'Key sites for the Northeast field team.',
  shareToken: 'ZmllbGRwb2ludC1kZW1vLXNoYXJl',
  sites: ['Boston HQ', 'Newark Distribution Center', 'Providence Client — Harbor Corp'],
});

export async function seedDemo(db, { log = () => {} } = {}) {
  const users = createUserRepository(db);
  const sites = createSiteRepository(db);
  const workOrders = createWorkOrderRepository(db);
  const templates = createTemplateRepository(db);
  const schedules = createScheduleRepository(db);
  const checklist = createChecklistRepository(db);
  const visits = createVisitRepository(db);
  const collections = createCollectionRepository(db);
  const created = { users: [], sites: [], workOrders: [], templates: [], schedules: [], visits: [], collections: [] };
  let adminId = null;

  for (const user of DEMO_USERS) {
    const existing = users.findByEmail(user.email);
    if (existing) {
      if (user.role === 'admin' && adminId === null) adminId = existing.id;
      continue;
    }
    const row = users.create({ ...user, passwordHash: await hashPassword(user.password) });
    if (user.role === 'admin' && adminId === null) adminId = row.id;
    created.users.push(user.email);
    log(`created user: ${user.email} (${user.role})`);
  }

  const existingNames = new Set(sites.listAll({}).map((site) => site.name));
  for (const site of DEMO_SITES) {
    if (existingNames.has(site.name)) continue;
    sites.create(site, adminId);
    created.sites.push(site.name);
    log(`created site: ${site.name}`);
  }

  const siteIdByName = new Map(sites.listAll({}).map((site) => [site.name, site.id]));
  const operator = users.findByEmail('ops@fieldpoint.local');
  const existingTitles = new Set(
    workOrders.list({ limit: 500, offset: 0, sort: 'due' }).rows.map((order) => order.title),
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
    );
    created.workOrders.push(order.title);
    log(`created work order: ${order.title}`);
  }

  const templateIdByName = new Map(templates.list({ includeArchived: true }).map((row) => [row.name, row.id]));
  for (const template of DEMO_TEMPLATES) {
    if (templateIdByName.has(template.name)) continue;
    const row = templates.create(template, adminId);
    templateIdByName.set(row.name, row.id);
    created.templates.push(row.name);
    log(`created template: ${row.name}`);
  }

  const existingSchedules = new Set(schedules.list({ includeInactive: true }).map((row) => row.title));
  for (const schedule of DEMO_SCHEDULES) {
    const siteId = siteIdByName.get(schedule.site);
    if (!siteId || existingSchedules.has(schedule.title)) continue;
    schedules.create(
      {
        siteId,
        templateId: templateIdByName.get(schedule.template) ?? null,
        title: schedule.title,
        description: '',
        priority: schedule.priority,
        assignedTo: operator?.id ?? null,
        intervalDays: schedule.intervalDays,
        nextDueDate: addDays(todayIso(), schedule.dueInDays),
      },
      adminId,
    );
    created.schedules.push(schedule.title);
    log(`created schedule: ${schedule.title}`);
  }

  // Give the first demo work order a checklist so the dialog has something in it.
  const firstOrder = workOrders.list({ limit: 1, offset: 0, sort: 'due' }).rows[0];
  if (firstOrder && checklist.progressFor(firstOrder.id).total === 0) {
    checklist.addMany(firstOrder.id, ['Isolate the door', 'Replace the motor', 'Test the safety edge']);
  }

  const existingVisitNotes = new Set(
    db.prepare('SELECT note FROM site_visits WHERE note != ?').all('').map((row) => row.note),
  );
  for (const visit of DEMO_VISITS) {
    const siteId = siteIdByName.get(visit.site);
    const user = users.findByEmail(visit.user);
    if (!siteId || !user || existingVisitNotes.has(visit.note)) continue;
    visits.create(siteId, user.id, {
      visitedAt: dueInDays(-visit.daysAgo), rating: visit.rating, note: visit.note,
    });
    created.visits.push(visit.note);
    log(`created visit: ${visit.site}`);
  }

  let demoCollection = collections.listForOwner(adminId).find((row) => row.name === DEMO_COLLECTION.name);
  if (!demoCollection) {
    demoCollection = collections.create(adminId, DEMO_COLLECTION);
    demoCollection = collections.setShareToken(demoCollection.id, DEMO_COLLECTION.shareToken);
    created.collections.push(demoCollection.name);
    log(`created collection: ${demoCollection.name}`);
  }
  for (const siteName of DEMO_COLLECTION.sites) {
    const siteId = siteIdByName.get(siteName);
    if (siteId) collections.pin(demoCollection.id, siteId, adminId);
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
  const existing = users.findByEmail(email);
  if (existing) {
    users.updatePassword(existing.id, passwordHash);
    users.update(existing.id, { role: 'admin', isActive: true });
    return { id: existing.id, created: false };
  }
  const row = users.create({ email, name, passwordHash, role: 'admin' });
  return { id: row.id, created: true };
}
