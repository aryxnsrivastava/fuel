// Database layer. On Vercel: Neon Postgres (free tier) via DATABASE_URL.
// Locally without DATABASE_URL: embedded Postgres (PGlite) stored in ./.localdb
let client = null;
let ready = null;
let clientP = null;

// memoised: parallel first queries must share one client (two PGlite instances on one folder break)
const getClient = () => (clientP ||= makeClient().catch((e) => { clientP = null; throw e; }));
async function makeClient() {
  if (client) return client;
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    client = { query: async (text, params = []) => sql.query(text, params) };
  } else {
    if (process.env.VERCEL) { const e = new Error('DATABASE_URL missing'); e.status = 500; e.publicMessage = 'No database connected (DATABASE_URL).'; throw e; }
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite('./.localdb');
    client = { query: async (text, params = []) => (await db.query(text, params)).rows };
  }
  return client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profile (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS entries (id SERIAL PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS entries_day_idx ON entries(day)`,
  `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, meta JSONB, created_at TIMESTAMPTZ DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS recipes (id SERIAL PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`,
  // nutrition found by approved web lookups, reused for 6 months instead of searching again
  `CREATE TABLE IF NOT EXISTS nutrition_lookups (id SERIAL PRIMARY KEY, name TEXT NOT NULL, brand TEXT, data JSONB NOT NULL, source TEXT, created_at TIMESTAMPTZ DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS meal_plans (day TEXT PRIMARY KEY, signature TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`,
];

export async function db() {
  const c = await getClient();
  if (!ready) {
    ready = (async () => { for (const s of SCHEMA) await c.query(s); })();
  }
  await ready;
  return c;
}

export async function q(text, params) {
  const c = await db();
  return c.query(text, params);
}
