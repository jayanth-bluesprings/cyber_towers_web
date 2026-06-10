// ═══════════════════════════════════════════════════════════════
//  TYPESCRIPT BASICS — READ THIS FIRST IF YOU ARE NEW
// ═══════════════════════════════════════════════════════════════
//
//  TypeScript = JavaScript + TYPE LABELS
//  The labels are invisible when the code runs — they only help
//  YOU while writing code to catch mistakes early.
//
//  TYPE LABELS:
//    const name: string  = "Pavan"   → name must hold TEXT
//    const age:  number  = 32        → age must hold a NUMBER
//    const ok:   boolean = true      → ok must be true or false
//    const data: string | null       → data is text OR null
//
//  INTERFACE — a template that says "any object with THIS label
//  must have THESE exact fields".
//
//  Example:
//    interface Car {
//      plate:  string;   ← must have a plate (text)
//      seats:  number;   ← must have seats (number)
//    }
//    const myCar: Car = { plate: "TS09", seats: 4 }; ✅ correct
//    const myCar: Car = { plate: "TS09" };            ❌ missing seats
//
//  export = "make this available for other files to import"
//  import = "bring something in FROM another file"
//
// ═══════════════════════════════════════════════════════════════

// ─── ENTRY EVENT ─────────────────────────────────────────────
// This is the data that arrives when a vehicle scans at the gate.
// WF1 receives this as its input.
export interface EntryEvent {
  cardId:        string;   // the RFID card number — e.g. "5248003"
  vehicleNumber: string;   // number plate   — e.g. "TS 09 AB 1234"
  gate:          string;   // which gate      — "GATE_1" or "GATE_2"
  timestamp:     string;   // when it happened — ISO string "2026-06-09T10:30:00"
  portNum:       number;   // 1 = Entry, 2 = Exit
}

// ─── PERSONNEL RECORD ─────────────────────────────────────────
// The data we get back from the Personnel/CardRecord table
// when we look up who owns this card.
export interface PersonnelRecord {
  personnelId: string;   // unique ID in TimeWatch
  cardData:    string;   // same as cardId — the RFID card string
  pCode:       string;   // company code — EMPTY or '-' means UNAUTHORIZED
  pName:       string;   // person's full name
  company:     string;   // company name — e.g. "Microsoft India"
}

// ─── COMPANY QUOTA ────────────────────────────────────────────
// How many parking slots a company has, and how many are used NOW.
// Example: Microsoft India has 22 total, 5 currently inside → 5/22
export interface CompanyQuota {
  companyCode:   string;   // PCode value — e.g. "MSFT"
  companyName:   string;   // human-readable name
  totalSlots:    number;   // e.g. 22  — set in Config page
  occupiedSlots: number;   // e.g. 5   — how many are currently inside
}

// ─── SECURITY DECISION (used in WF3) ─────────────────────────
// When the security officer approves or denies an unauthorized vehicle.
export interface SecurityDecision {
  action:         'approve' | 'deny'; // 'approve' = allow entry, 'deny' = stay denied
  officerId:      string;             // who made the decision
  vehicleNumber?: string;             // vehicle number filled in by security officer
  companyName?:   string;             // company/visiting name (informational only)
  reason?:        string;             // reason for the decision
}

// ─── ADMIN DECISION (used in WF9) ─────────────────────────────
// When the Company Admin approves or denies a quota-override request.
export interface AdminDecision {
  action:    'approve' | 'deny';   // 'approve' = open gate above quota
  adminId:   string;               // who approved/denied
  reason?:   string;               // optional reason
}

// ─── AUDIT LOG ENTRY ──────────────────────────────────────────
// Every important event gets written to the audit log.
export type AuditEventType =
  | 'ENTRY_AUTHORIZED'
  | 'ENTRY_DENIED_QUOTA_FULL'
  | 'ENTRY_DENIED_UNAUTHORIZED'
  | 'UNAUTHORIZED_APPROVED_BY_SECURITY'
  | 'UNAUTHORIZED_DENIED_BY_SECURITY'
  | 'UNAUTHORIZED_TIMEOUT'
  | 'OVERRIDE_REQUESTED'
  | 'OVERRIDE_APPROVED'
  | 'OVERRIDE_DENIED'
  | 'OVERRIDE_TIMEOUT'
  | 'VEHICLE_EXIT'
  | 'UNAUTHORIZED_ENTRY_STARTED'  // unauthorized vehicle approved — tracking started
  | 'OVERRIDE_ENTRY_STARTED'      // override approved — tracking started
  // ── WF2 overstay event types ───────────────────────────
  | 'OVERSTAY_24H_ALERT'      // first alert — vehicle inside 24+ hours
  | 'OVERSTAY_ESCALATION'     // follow-up alerts at 32h, 40h
  // ── WF4 daily report event types ────────────────────────
  | 'DAILY_REPORT_SENT'       // daily summary email was sent successfully
  // ── WF5 weekly report event types ───────────────────────
  | 'WEEKLY_REPORT_SENT';     // weekly analytics email was sent successfully

// ─── DAILY REPORT TYPES (used by WF4) ────────────────────────

// Per-company breakdown in the daily report
// e.g. Microsoft India had 8 entries, 6 exits, 2 still inside
export interface CompanyDailyStat {
  companyCode: string;   // PCode  — e.g. "MSFT"
  entryCount:  number;   // how many entries from this company today
  exitCount:   number;   // how many exits from this company today
}

// The full daily statistics object passed between activity and email
export interface DailyReportStats {
  reportDate:        string;   // "2026-06-09"
  totalEntries:      number;   // total entry scans today
  totalExits:        number;   // total exit scans today
  currentlyInside:   number;   // open sessions (no exit yet)
  companyBreakdown:  CompanyDailyStat[];  // per-company numbers
  peakHour:          number | null;       // 0-23 — hour with most entries
  peakHourCount:     number;              // how many entries in peak hour
  reportGeneratedAt: string;   // ISO timestamp when this report was generated
}

// One "currently inside" vehicle row — used in the report email table
export interface InsideVehicle {
  cardId:      string;
  pName:       string;    // person name
  pCode:       string;    // company code
  entryTime:   string;    // when they entered (formatted string)
  hoursInside: number;    // how long they have been inside
}

export interface AuditLogEntry {
  eventType:     AuditEventType;
  cardId:        string;
  vehicleNumber: string;
  gate:          string;
  timestamp:     string;
  companyCode?:  string;   // optional — not available for unauthorized vehicles
  pName?:        string;   // person name if known
  notes?:        string;   // any extra info
}

// ─── WEEKLY REPORT TYPES (used by WF5) ───────────────────────

// One row in the day-by-day breakdown table.
// e.g. Monday had 52 entries, 48 exits
export interface DailyBreakdown {
  date:    string;   // "2026-06-02"
  dayName: string;   // "Monday"
  entries: number;
  exits:   number;
}

// Per-company stats for the full week
export interface CompanyWeeklyStat {
  companyCode: string;
  entryCount:  number;
  exitCount:   number;
}

// One row in the "top 5 most active people" table
export interface TopCard {
  cardId: string;   // RFID card number
  pName:  string;   // person's name
  pCode:  string;   // company code
  visits: number;   // number of entry scans this week
}

// The complete weekly analytics object — passed from getWeeklyStats
// activity to sendWeeklyReportEmail activity.
export interface WeeklyReportStats {
  weekStart:         string;               // "2026-06-02" (first day of the week)
  weekEnd:           string;               // "2026-06-08" (last day of the week)
  totalEntries:      number;               // total entry scans for the week
  totalExits:        number;               // total exit scans for the week
  currentlyInside:   number;               // vehicles still inside RIGHT NOW
  dailyBreakdown:    DailyBreakdown[];     // 7 rows, one per day
  companyBreakdown:  CompanyWeeklyStat[];  // per-company totals, sorted by entries desc
  busiestDay:        string | null;        // e.g. "Wednesday" (day with most entries)
  busiestDayCount:   number;               // entry count on that busiest day
  peakHour:          number | null;        // 0-23 — hour with most entries across the week
  peakHourCount:     number;               // how many entries in that peak hour
  unauthorizedCount: number;               // entry scans with no valid PCode this week
  topCards:          TopCard[];            // top 5 most frequently entering people
  overnightCount:    number;               // distinct vehicles that stayed > 12 hours
  insideVehicles:    InsideVehicle[];      // full list of vehicles currently inside
  reportGeneratedAt: string;              // ISO timestamp of when the report was built
}
