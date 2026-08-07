/**
 * Vitest setup: point the app's database singleton at an in-memory SQLite
 * and create the schema on it. Runs before each test file; the module cache
 * means all files in a worker share one db, so suites reset tables in
 * beforeEach (see helpers.ts resetDb).
 */
process.env.DATABASE_URL = ':memory:';

const { db } = await import('$lib/server/db');
const schema = await import('$lib/server/db/schema');
const { pushSQLiteSchema } = await import('drizzle-kit/api');
const { sql } = await import('drizzle-orm');

// pushSQLiteSchema's own apply() runs DDL through .all(), which
// better-sqlite3 rejects — execute the generated statements directly.
// (Its types name LibSQL, but it works fine against better-sqlite3.)
const { statementsToExecute } = await pushSQLiteSchema(
	schema,
	db as unknown as Parameters<typeof pushSQLiteSchema>[1]
);
for (const statement of statementsToExecute) {
	db.run(sql.raw(statement));
}

export {};
