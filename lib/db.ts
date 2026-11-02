// PostgreSQL access for the whole app. Only server code imports this file,
// so the browser never sees the connection string.
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// pg returns NUMERIC and BIGINT (e.g. COUNT(*)) as strings to avoid losing
// precision. Our values are small, so read them as JS numbers.
types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10));

// One connection pool per server process. In development Next.js reloads
// modules on every change, so the pool is kept on globalThis to avoid
// opening a new pool each time.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL, // from .env.local, never hard-coded
    options: "-c timezone=UTC", // the roster is in UTC, so date casts are too
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

// Run one parameterised query and return its rows.
// Values are passed separately as $1, $2 ... so user input can never be
// executed as SQL (this is what prevents SQL injection).
export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

// Run several statements as ONE transaction on a single connection:
// either all of them are committed, or (if any throws) all are rolled back.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release(); // give the connection back to the pool
  }
}
