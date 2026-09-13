import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

export const ADMIN = { email: 'admin@example.com', name: 'Ada Admin', password: 'correct-horse-battery' };
export const MEMBER = { email: 'member@example.com', name: 'Max Member', password: 'member-password-1' };
export const SITE = { name: 'HQ', address: '1 Main St', lat: 40.7128, lng: -74.006, category: 'office', status: 'active', notes: '' };

/** Fresh in-memory app per test. Returns an agent that keeps cookies. */
export function bootApp() {
  const config = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', SESSION_SECRET: 'x'.repeat(40) });
  const { app, db, deps } = createApp(config);
  return { app, db, deps, agent: request.agent(app), close: () => db.close() };
}

export async function registerAdmin(agent) {
  const response = await agent.post('/api/auth/register').send(ADMIN);
  if (response.status !== 201) throw new Error(`bootstrap failed: ${response.text}`);
  return response.body.user;
}

export async function createMember(adminAgent, app) {
  const created = await adminAgent.post('/api/auth/register').send(MEMBER);
  if (created.status !== 201) throw new Error(`member create failed: ${created.text}`);
  const memberAgent = request.agent(app);
  await memberAgent.post('/api/auth/login').send({ email: MEMBER.email, password: MEMBER.password });
  return memberAgent;
}
