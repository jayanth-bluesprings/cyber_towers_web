// ═══════════════════════════════════════════════════════════════
//  WHAT ARE TEMPORAL ACTIVITIES?
// ═══════════════════════════════════════════════════════════════
//
//  Activities = the functions that do REAL WORK (DB queries, emails,
//  HTTP calls, file writes, etc.)
//
//  Workflows CANNOT do any of this directly — they only CALL activities.
//  Activities run in a normal Node.js environment and CAN do anything.
//
//  If an activity FAILS (network error, DB timeout, etc.), Temporal
//  automatically RETRIES it. The workflow just waits and does not crash.
//
//  async function = a function that does something that takes time
//  await          = "pause here and wait for this to finish"
//  Promise<T>     = "this function will eventually return a value of type T"
//
//  Examples:
//    async function getName(): Promise<string>  → returns text eventually
//    async function saveRow(): Promise<void>    → returns nothing eventually
//    async function getAge():  Promise<number>  → returns a number eventually
//
// ═══════════════════════════════════════════════════════════════

import * as sql from 'mssql';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { PersonnelRecord, CompanyQuota, AuditLogEntry } from '../shared/types';

// Load .env from the backend folder (same .env the Express server uses)
dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

// ─── DB CONNECTION ────────────────────────────────────────────
// Same config as backend/db.js — reads from the same .env file
const dbConfig: sql.config = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server:   process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || process.env.DB_NAME || 'TimeWatch',
  port:     parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    requestTimeout:         30000,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// Singleton pool — created once, reused for all queries
let _pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!_pool) {
    _pool = await new sql.ConnectionPool(dbConfig).connect();
  }
  return _pool;
}

// ─── ACTIVITY 1: lookupPersonnel ─────────────────────────────
// Called by WF1 right after a card scan.
// Queries the CardRecord table to find who this card belongs to,
// and whether they are authorized (PCode present) or not.
//
// Returns null if the card is completely unknown.
export async function lookupPersonnel(
  cardId: string                // the RFID card number from the gate scan
): Promise<PersonnelRecord | null> {

  const pool    = await getPool();
  const request = pool.request();

  // @cardId = the SQL parameter — prevents SQL injection
  request.input('cardId', sql.NVarChar, cardId);

  // Get the most recent scan record for this card to find out who it belongs to
  const result = await request.query(`;
    SELECT TOP 1
      PersonnelID,
      CardData,
      ISNULL(PCode, '')  AS PCode,
      ISNULL(PName, '')  AS PName,
      ISNULL(PCode, '')  AS Company
    FROM CardRecord WITH (NOLOCK)
    WHERE CardData = @cardId
    ORDER BY DataTime DESC
  `);

  if (result.recordset.length === 0) return null;

  const row = result.recordset[0];

  // Return a PersonnelRecord shaped object
  return {
    personnelId: String(row.PersonnelID ?? ''),
    cardData:    String(row.CardData    ?? ''),
    pCode:       String(row.PCode       ?? '').trim(),
    pName:       String(row.PName       ?? '').trim(),
    company:     String(row.PCode       ?? '').trim(), // PCode IS the company code
  };
}

// ─── HELPER: ensure CompanySlots table exists ─────────────────
// Called before any CompanySlots query. Creates the table + inserts a
// default row for the company if neither exist. This means the workflows
// work on a fresh DB without any manual SQL setup step.
async function ensureCompanySlots(pool: sql.ConnectionPool, companyCode: string): Promise<void> {
  // Create table if it doesn't exist (safe to run repeatedly)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='CompanySlots' AND xtype='U')
    CREATE TABLE CompanySlots (
      CompanyCode   NVARCHAR(50) PRIMARY KEY,
      CompanyName   NVARCHAR(100),
      TotalSlots    INT NOT NULL DEFAULT 10,
      OccupiedSlots INT NOT NULL DEFAULT 0
    )
  `);

  // Insert a default row for this company if no row exists yet
  const req = pool.request();
  req.input('companyCode', sql.NVarChar, companyCode);
  await req.query(`
    IF NOT EXISTS (SELECT 1 FROM CompanySlots WHERE CompanyCode = @companyCode)
    INSERT INTO CompanySlots (CompanyCode, CompanyName, TotalSlots, OccupiedSlots)
    VALUES (@companyCode, @companyCode, 10, 0)
  `);
}

// ─── ACTIVITY 2: getCompanyQuota ──────────────────────────────
// Called by WF1 to check: does this company still have free parking?
// Auto-creates CompanySlots table and default row on first run.
export async function getCompanyQuota(
  companyCode: string   // the PCode value — e.g. "MSFT"
): Promise<CompanyQuota> {

  const pool = await getPool();

  // Auto-create table + default row so this never fails on a fresh DB
  await ensureCompanySlots(pool, companyCode);

  const request = pool.request();
  request.input('companyCode', sql.NVarChar, companyCode);

  const result = await request.query(`
    SELECT CompanyCode, CompanyName, TotalSlots, OccupiedSlots
    FROM CompanySlots WITH (NOLOCK)
    WHERE CompanyCode = @companyCode
  `);

  if (result.recordset.length === 0) {
    // Should not happen after ensureCompanySlots, but safe fallback
    console.warn(`[Temporal] CompanySlots: no row found for ${companyCode}, using default 10`);
    return {
      companyCode,
      companyName:   companyCode,
      totalSlots:    10,
      occupiedSlots: 0,
    };
  }

  const row = result.recordset[0];
  return {
    companyCode:   row.CompanyCode,
    companyName:   row.CompanyName,
    totalSlots:    row.TotalSlots,
    occupiedSlots: row.OccupiedSlots,
  };
}

// ─── ACTIVITY 3: incrementCompanyCount ───────────────────────
// Called by WF1 when an authorized vehicle enters.
// Adds 1 to OccupiedSlots for that company.
export async function incrementCompanyCount(companyCode: string): Promise<number> {
  const pool = await getPool();

  // Ensure table + row exist before updating
  await ensureCompanySlots(pool, companyCode);

  const request = pool.request();
  request.input('companyCode', sql.NVarChar, companyCode);
  await request.query(`
    UPDATE CompanySlots
    SET OccupiedSlots = OccupiedSlots + 1
    WHERE CompanyCode = @companyCode
  `);

  const r2 = pool.request();
  r2.input('companyCode', sql.NVarChar, companyCode);
  const result = await r2.query(`
    SELECT OccupiedSlots, TotalSlots FROM CompanySlots WHERE CompanyCode = @companyCode
  `);
  return result.recordset[0]?.OccupiedSlots ?? 0;
}

// ─── ACTIVITY 4: decrementCompanyCount ───────────────────────
// Called by WF1 when a vehicle exits. Subtracts 1 from OccupiedSlots.
// Never goes below 0.
export async function decrementCompanyCount(companyCode: string): Promise<number> {
  const pool = await getPool();

  // Ensure table + row exist before updating (handles fresh DB or missing row)
  await ensureCompanySlots(pool, companyCode);

  const request = pool.request();
  request.input('companyCode', sql.NVarChar, companyCode);
  await request.query(`
    UPDATE CompanySlots
    SET OccupiedSlots = CASE WHEN OccupiedSlots > 0 THEN OccupiedSlots - 1 ELSE 0 END
    WHERE CompanyCode = @companyCode
  `);

  const r2 = pool.request();
  r2.input('companyCode', sql.NVarChar, companyCode);
  const result = await r2.query(`
    SELECT OccupiedSlots FROM CompanySlots WHERE CompanyCode = @companyCode
  `);
  return result.recordset[0]?.OccupiedSlots ?? 0;
}

// ─── ACTIVITY 5: writeAuditLog ────────────────────────────────
// Every important event (entry, denial, override, exit) is recorded here.
// Creates the TemporalAuditLog table if it doesn't exist (first run).
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  const pool    = await getPool();

  // Create the audit log table if it doesn't exist yet
  await pool.request().query(`;
    IF NOT EXISTS (
      SELECT * FROM sysobjects WHERE name='TemporalAuditLog' AND xtype='U'
    )
    CREATE TABLE TemporalAuditLog (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      EventType     NVARCHAR(60),
      CardId        NVARCHAR(50),
      VehicleNumber NVARCHAR(50),
      Gate          NVARCHAR(20),
      EventTime     NVARCHAR(30),
      CompanyCode   NVARCHAR(50),
      PersonName    NVARCHAR(100),
      Notes         NVARCHAR(500),
      CreatedAt     DATETIME DEFAULT GETDATE()
    )
  `);

  const request = pool.request();
  request.input('eventType',     sql.NVarChar, entry.eventType);
  request.input('cardId',        sql.NVarChar, entry.cardId);
  request.input('vehicleNumber', sql.NVarChar, entry.vehicleNumber);
  request.input('gate',          sql.NVarChar, entry.gate);
  request.input('timestamp',     sql.NVarChar, entry.timestamp);
  request.input('companyCode',   sql.NVarChar, entry.companyCode ?? '');
  request.input('pName',         sql.NVarChar, entry.pName       ?? '');
  request.input('notes',         sql.NVarChar, entry.notes       ?? '');

  await request.query(`;
    INSERT INTO TemporalAuditLog
      (EventType, CardId, VehicleNumber, Gate, EventTime, CompanyCode, PersonName, Notes)
    VALUES
      (@eventType, @cardId, @vehicleNumber, @gate, @timestamp, @companyCode, @pName, @notes)
  `);

  console.log(`[AuditLog] ${entry.eventType} | ${entry.vehicleNumber} | ${entry.gate} | ${entry.timestamp}`);
}
