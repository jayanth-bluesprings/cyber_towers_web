#!/usr/bin/env node
/**
 * run-migrations.js — apply SQL migrations in order, idempotently.
 *
 * Tracks applied files in cybertowers.schema_migrations so each runs exactly once.
 * Migrations live in backend/database/migrations/*.sql and are applied in
 * lexicographic order (001_, 002_, …). Each file runs inside a transaction.
 *
 * Usage:
 *   node database/run-migrations.js          # apply pending migrations
 *   node database/run-migrations.js --status # list applied / pending, apply nothing
 */

const fs   = require('fs');
const path = require('path');
const { pgPool } = require('../pgdb');

const SCHEMA = 'cybertowers';
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureTable() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function getApplied() {
  const { rows } = await pgPool.query(`SELECT filename FROM ${SCHEMA}.schema_migrations`);
  return new Set(rows.map((r) => r.filename));
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  await ensureTable();

  const files   = listMigrationFiles();
  const applied = await getApplied();
  const pending = files.filter((f) => !applied.has(f));

  console.log(`\nMigrations: ${files.length} total · ${applied.size} applied · ${pending.length} pending`);
  files.forEach((f) => console.log(`   ${applied.has(f) ? '✅' : '⬜'} ${f}`));

  if (statusOnly) { await pgPool.end(); return; }
  if (!pending.length) { console.log('\nNothing to apply — database is up to date.\n'); await pgPool.end(); return; }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO ${SCHEMA}.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
        [file]
      );
      await client.query('COMMIT');
      console.log(`   ▶ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`\n❌ Migration failed: ${file}\n   ${err.message}\n`);
      client.release();
      await pgPool.end();
      process.exit(1);
    }
    client.release();
  }

  console.log(`\n✅ Applied ${pending.length} migration(s).\n`);
  await pgPool.end();
}

main().catch((err) => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
