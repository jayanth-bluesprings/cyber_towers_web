const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE || process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 300000
  },
  pool: {
    max: 50,
    min: 0,
    idleTimeoutMillis: 30000
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    try {
      pool = await sql.connect(config);
      console.log('✅ Connected to SQL Server successfully');
    } catch (err) {
      console.error('❌ SQL Connection Error:', err.message);
      pool = null;
      throw err;
    }
  }
  return pool;
}

async function query(queryString, params = {}) {
  const p = await getPool();
  const request = p.request();
  
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }

  const start = Date.now();
  try {
    // Prepend semicolon to ensure WITH clauses don't fail
    const result = await request.query(`;${queryString}`);
    const duration = Date.now() - start;
    if (duration > 2000) {
      console.log(`⚠️ Slow query (${duration}ms): ${queryString.substring(0, 100)}...`);
    }
    return result;
  } catch (err) {
    console.error(`❌ Query Error: ${err.message}\nQuery Summary: ${queryString.substring(0, 100)}`);
    throw err;
  }
}

module.exports = { getPool, query, sql };
