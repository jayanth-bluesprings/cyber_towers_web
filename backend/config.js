/**
 * config.js — centralised environment configuration + validation (Phase 12).
 *
 * Loads .env, normalises values, and validates that production deployments have
 * the security-critical variables set. In production a missing/weak secret is a
 * hard failure (process exits); in development it only warns so local dev stays
 * frictionless.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const NODE_ENV   = (process.env.NODE_ENV || 'development').toLowerCase();
const IS_PROD    = NODE_ENV === 'production';

function num(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function csv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  env: NODE_ENV,
  isProd: IS_PROD,

  port: num(process.env.PORT, 5000),

  apiKey: String(process.env.API_KEY || '').trim(),
  allowedOrigins: process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '*',

  bridgeEncryptionKey: String(process.env.BRIDGE_ENCRYPTION_KEY || '').trim(),

  // Trust the first proxy hop (nginx/IIS) so rate-limit + req.ip work behind it.
  trustProxy: process.env.TRUST_PROXY === 'true',

  db: {
    host:     process.env.PG_HOST     || 'localhost',
    port:     num(process.env.PG_PORT, 5432),
    database: process.env.PG_DATABASE || 'cybertowers_access',
    user:     process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  },

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max:      num(process.env.RATE_LIMIT_MAX, 300),
  },

  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
};

/**
 * Validate configuration. Returns an array of problem strings.
 * Throws in production when any problem is found; warns otherwise.
 */
function validate() {
  const problems = [];

  if (!config.apiKey) {
    problems.push('API_KEY is not set — all /api routes would be unauthenticated.');
  } else if (config.apiKey.length < 16) {
    problems.push('API_KEY is shorter than 16 characters — use a long random secret.');
  } else if (/replace|secret|changeme|example/i.test(config.apiKey)) {
    problems.push('API_KEY still looks like a placeholder value.');
  }

  if (!config.db.user || !config.db.password) {
    problems.push('PG_USER / PG_PASSWORD are not set — database access will fail.');
  }

  if (IS_PROD) {
    if (config.allowedOrigins === '*') {
      problems.push('ALLOWED_ORIGINS is "*" in production — set explicit origins.');
    }
    if (!config.bridgeEncryptionKey) {
      problems.push('BRIDGE_ENCRYPTION_KEY is not set — controller passwords stored in plaintext.');
    } else if (config.bridgeEncryptionKey.length < 32) {
      problems.push('BRIDGE_ENCRYPTION_KEY should be at least 32 characters.');
    }
  }

  if (problems.length) {
    const header = IS_PROD
      ? '❌ Configuration errors (production) — refusing to start:'
      : '⚠️  Configuration warnings (development):';
    console.error(`\n${header}`);
    problems.forEach((p) => console.error(`   • ${p}`));
    console.error('');

    if (IS_PROD) {
      throw new Error('Invalid production configuration. Fix the variables above and restart.');
    }
  } else {
    console.log(`✅ Configuration validated (env=${NODE_ENV}).`);
  }

  return problems;
}

module.exports = { config, validate };
