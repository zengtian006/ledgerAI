import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';

// DATE -> 'YYYY-MM-DD' string (avoids timezone shifts); NUMERIC -> number
pg.types.setTypeParser(1082, (v) => v);
// TIMESTAMP (no tz) columns are written in UTC; return them as ISO strings with a Z suffix
pg.types.setTypeParser(1114, (v) => (v === null ? null : new Date(`${v.replace(' ', 'T')}Z`).toISOString()));
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
