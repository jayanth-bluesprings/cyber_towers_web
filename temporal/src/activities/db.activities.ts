// ═══════════════════════════════════════════════════════════════
//  DB ACTIVITIES — PostgreSQL (cybertowers_access)
//
//  All queries now hit PostgreSQL via the 'pg' module, the same
//  database the backend uses. SQL Server (TimeWatch) is NOT used
//  by Temporal — only the backend's bridge routes touch TimeWatch.
//
//  Tables used:
//    cybertowers.cards              — registered RFID cards / personnel
//    cybertowers.company_slots      — per-company parking slot counters
//    cybertowers.temporal_audit_log — durable audit trail of workflow events
//
// ═══════════════════════════════════════════════════════════════

import { Pool } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { PersonnelRecord, CompanyQuota, AuditLogEntry } from '../shared/types';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

// ─── PG POOL ──────────────────────────────────────────────────
// Reads the same env vars as the backend (PG_HOST, PG_PORT, etc.)
const _pool = new Pool({
  host:     process.env.PG_HOST     || '127.0.0.1',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'cybertowers_access',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
  max:      10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ─── ACTIVITY 1: lookupPersonnel ─────────────────────────────
// Queries cybertowers.cards to find who this RFID card belongs to.
// Returns null if the card is not registered.
export async function lookupPersonnel(
  cardId: string
): Promise<PersonnelRecord | null> {
  const res = await _pool.query(
    `SELECT
       id             AS "personnelId",
       card_no        AS "cardData",
       COALESCE(person_code, '') AS "pCode",
       COALESCE(person_name, '') AS "pName",
       COALESCE(department, company_code, '') AS "company"
     FROM cybertowers.cards
     WHERE card_no = $1
       AND (card_status IS NULL OR card_status != 'Deleted')
     LIMIT 1`,
    [String(cardId)]
  );

  if (res.rows.length === 0) return null;

  const row = res.rows[0];
  return {
    personnelId: String(row.personnelId ?? ''),
    cardData:    String(row.cardData    ?? ''),
    pCode:       String(row.pCode       ?? '').trim(),
    pName:       String(row.pName       ?? '').trim(),
    company:     String(row.company     ?? '').trim(),
  };
}

// ─── ENSURE COMPANY SLOT ROW EXISTS ──────────────────────────
// Auto-inserts a default row (10 slots) if none exists yet.
// Safe to call repeatedly — uses INSERT ON CONFLICT DO NOTHING.
async function ensureCompanySlots(companyCode: string): Promise<void> {
  await _pool.query(
    `INSERT INTO cybertowers.company_slots (company_code, company_name, total_slots, occupied_slots)
     VALUES ($1, $1, 10, 0)
     ON CONFLICT (company_code) DO NOTHING`,
    [companyCode]
  );
}

// ─── ACTIVITY 2: getCompanyQuota ──────────────────────────────
export async function getCompanyQuota(
  companyCode: string
): Promise<CompanyQuota> {
  await ensureCompanySlots(companyCode);

  const res = await _pool.query(
    `SELECT company_code, company_name, total_slots, occupied_slots
     FROM cybertowers.company_slots
     WHERE company_code = $1`,
    [companyCode]
  );

  if (res.rows.length === 0) {
    return { companyCode, companyName: companyCode, totalSlots: 10, occupiedSlots: 0 };
  }

  const row = res.rows[0];
  return {
    companyCode:   row.company_code,
    companyName:   row.company_name,
    totalSlots:    row.total_slots,
    occupiedSlots: row.occupied_slots,
  };
}

// ─── ACTIVITY 3: incrementCompanyCount ───────────────────────
export async function incrementCompanyCount(companyCode: string): Promise<number> {
  await ensureCompanySlots(companyCode);

  const res = await _pool.query(
    `UPDATE cybertowers.company_slots
     SET occupied_slots = occupied_slots + 1,
         updated_at     = NOW()
     WHERE company_code = $1
     RETURNING occupied_slots`,
    [companyCode]
  );
  return res.rows[0]?.occupied_slots ?? 0;
}

// ─── ACTIVITY 4: decrementCompanyCount ───────────────────────
export async function decrementCompanyCount(companyCode: string): Promise<number> {
  await ensureCompanySlots(companyCode);

  const res = await _pool.query(
    `UPDATE cybertowers.company_slots
     SET occupied_slots = GREATEST(occupied_slots - 1, 0),
         updated_at     = NOW()
     WHERE company_code = $1
     RETURNING occupied_slots`,
    [companyCode]
  );
  return res.rows[0]?.occupied_slots ?? 0;
}

// ─── ACTIVITY 5: writeAuditLog ────────────────────────────────
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await _pool.query(
    `INSERT INTO cybertowers.temporal_audit_log
       (event_type, card_id, vehicle_number, gate, event_time, company_code, person_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.eventType,
      entry.cardId,
      entry.vehicleNumber,
      entry.gate,
      entry.timestamp,
      entry.companyCode ?? '',
      entry.pName       ?? '',
      entry.notes       ?? '',
    ]
  );

  console.log(`[AuditLog] ${entry.eventType} | ${entry.vehicleNumber} | ${entry.gate} | ${entry.timestamp}`);
}
