/**
 * Creates or resets an administrator from environment variables. Handy for CI,
 * and the hook the Atlantic Software Factory runs inside every preview:
 *   FIELDPOINT_USER_EMAIL=qa@example.com FIELDPOINT_USER_PASSWORD=... node scripts/create-user.js
 *
 * The Factory does not read factory.deploy.yml; it discovers the repository's
 * `factory:qa:seed` package script and runs it in the built image with
 * FACTORY_QA_EMAIL / FACTORY_QA_PASSWORD set, so those names are accepted as
 * fallbacks for the same pair.
 */
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { upsertAdmin } from '../src/db/seed.js';
import { emailSchema, passwordSchema } from '../src/auth/schema.js';

const MAX_NAME = 80;

export function readInput(env) {
  const email = emailSchema.safeParse(env.FIELDPOINT_USER_EMAIL ?? env.FACTORY_QA_EMAIL ?? '');
  const password = passwordSchema.safeParse(env.FIELDPOINT_USER_PASSWORD ?? env.FACTORY_QA_PASSWORD ?? '');
  if (!email.success) throw new Error('FIELDPOINT_USER_EMAIL (or FACTORY_QA_EMAIL) missing or invalid');
  if (!password.success) {
    throw new Error('FIELDPOINT_USER_PASSWORD (or FACTORY_QA_PASSWORD) missing or shorter than 10 characters');
  }
  const name = (env.FIELDPOINT_USER_NAME ?? 'Factory QA').slice(0, MAX_NAME);
  return { email: email.data, password: password.data, name };
}

async function main() {
  const input = readInput(process.env);
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  try {
    const result = await upsertAdmin(db, input);
    console.log(`${result.created ? 'created' : 'updated'} admin ${input.email} (id ${result.id})`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('[create-user] failed:', error.message);
  process.exit(1);
});
