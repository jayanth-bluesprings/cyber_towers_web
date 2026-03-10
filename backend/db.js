const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'TimeWatch',

  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YOUR_SA_PASSWORD',

  options: {
    encrypt: false,
    trustServerCertificate: true
  },

  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;

async function getPool() {
  if (!pool) {
    try {
      pool = await sql.connect(config);
      console.log('✅ Connected to SQL Server successfully');
      pool.on('error', (err) => {
        console.error('SQL Pool error:', err);
        pool = null;
      });
    } catch (err) {
      console.error('❌ Failed to connect to SQL Server:', err.message);
      throw err;
    }
  }
  return pool;
}

async function query(queryString, params = {}) {
  const p = await getPool();
  const request = p.request();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number') {
      request.input(key, sql.Int, value);
    } else {
      request.input(key, sql.NVarChar, value);
    }
  }
  return request.query(queryString);
}

module.exports = { getPool, query, sql };
