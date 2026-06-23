/**
 * pgdb.js — PostgreSQL connection pool for cybertowers_access database.
 *
 * Mirrors the pattern of db.js (SQL Server pool) so the rest of the backend
 * stays consistent. Import { pgQuery, pgPool } wherever you need PG access.
 *
 * Pool config is driven entirely by environment variables (see .env.example).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'cybertowers_access',
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  // Pool sizing — keep modest; Bridge + web app are low-concurrency
  max:                parseInt(process.env.PG_POOL_MAX  || '20'),
  min:                parseInt(process.env.PG_POOL_MIN  || '2'),
  idleTimeoutMillis:  parseInt(process.env.PG_IDLE_MS   || '30000'),
  connectionTimeoutMillis: 5000,
  // Always interpret timestamps as UTC
  options: '-c timezone=UTC',
});

pool.on('connect', () => {
  // Set search_path on every new connection so queries can omit the schema prefix
  // (matches the schema name used in the SQL schema script)
});

pool.on('error', (err) => {
  console.error('[pgdb] Unexpected pool error:', err.message);
});

/**
 * Execute a parameterised query.
 *
 * @param {string} text   SQL string with $1, $2 … placeholders
 * @param {any[]}  params Parameter values array
 * @returns {Promise<import('pg').QueryResult>}
 */
async function pgQuery(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const ms = Date.now() - start;
    if (ms > 2000) {
      console.warn(`[pgdb] Slow query (${ms}ms): ${text.substring(0, 120)}`);
    }
    return result;
  } catch (err) {
    console.error(`[pgdb] Query error: ${err.message}\nSQL: ${text.substring(0, 120)}`);
    throw err;
  }
}

/**
 * Check that the pool can reach the database.
 * Called at server startup — non-fatal if PG creds are not set yet.
 */
async function testPgConnection() {
  if (!process.env.PG_USER || !process.env.PG_PASSWORD) {
    console.warn('[pgdb] PG_USER / PG_PASSWORD not set — skipping PostgreSQL connection test');
    return false;
  }
  try {
    const { rows } = await pgQuery('SELECT current_database() AS db, NOW() AS ts');
    console.log(`✅ Connected to PostgreSQL: ${rows[0].db} at ${rows[0].ts}`);
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    return false;
  }
}

const pgPool = pool;
module.exports = { pgPool, pgQuery, testPgConnection };
