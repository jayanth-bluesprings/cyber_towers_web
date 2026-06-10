// ─── WEBSOCKET BROADCAST ACTIVITIES ──────────────────────────
//
//  PURPOSE OF THIS FILE:
//
//  When a vehicle enters or exits, the security dashboard (React frontend)
//  should update in real-time — without the guard needing to refresh.
//
//  HOW IT WORKS:
//
//    Temporal Worker (this activity)
//         │
//         │  HTTP POST to Express backend
//         ▼
//    Express /internal/parking-update route
//         │
//         │  io.emit('parkingUpdate', data)   ← WebSocket broadcast
//         ▼
//    All connected Dashboard browsers
//         │
//         │  socket.on('parkingUpdate', data => update UI)
//         ▼
//    Real-time slot count change on screen
//
//  IMPORTANT — Backend route needed:
//    You must add this route to backend/routes/internalRoutes.js (or similar):
//
//      router.post('/internal/parking-update', (req, res) => {
//        io.emit('parkingUpdate', req.body);   // broadcast to all browsers
//        res.json({ ok: true });
//      });
//
//    'io' is the Socket.io instance from your websocket.js file.
//
// ─────────────────────────────────────────────────────────────

import * as http from 'http';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { EntryEvent, PersonnelRecord, CompanyQuota } from '../shared/types';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

// ─── TYPESCRIPT CONCEPT: Union Type ──────────────────────────
//
//  'ENTRY' | 'EXIT'  is a UNION TYPE.
//  It means: this value can ONLY be the text "ENTRY" or "EXIT".
//  TypeScript will give an error if you try to pass anything else.
//
//  Compare to:
//    type: string   ← allows "ENTRY", "EXIT", "HELLO", "xyz123" — too loose
//    type: 'ENTRY' | 'EXIT'  ← only these two exact values — safe
//
type ParkingEventType = 'ENTRY' | 'EXIT';

// ─── HELPER: POST to Express backend ─────────────────────────
//
//  This is the same pattern as callGateAPI in gate.activities.ts.
//  We use Node.js built-in http module to POST JSON to the backend.
//
//  bodyObj: object  ← 'object' means any JavaScript object
//    We pass bodyObj (not a string) and JSON.stringify it here.
//
async function postToBackend(path_: string, bodyObj: object): Promise<void> {
  return new Promise((resolve) => {

    // JSON.stringify converts a JavaScript object to a JSON text string.
    // e.g. { type: "ENTRY", gate: "GATE_1" } → '{"type":"ENTRY","gate":"GATE_1"}'
    const body = JSON.stringify(bodyObj);

    // http.RequestOptions = configuration object for the HTTP request
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port:     parseInt(process.env.BACKEND_PORT || '5000'),
      path:     path_,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),

        // Security header — the Express backend should verify this key
        // before processing internal requests.
        // Both sides read from the same .env file.
        'X-Internal-Key': process.env.INTERNAL_API_KEY || 'temporal-internal',
      },
    };

    const req = http.request(options, (res) => {
      console.log(`[WS-Broadcast] POST ${path_} → HTTP ${res.statusCode}`);
      resolve();
    });

    // If the backend is down, log the error but DON'T throw.
    // WebSocket broadcast failure is non-critical — the gate already opened/closed.
    // The audit log and DB are the source of truth, not the dashboard broadcast.
    req.on('error', (err) => {
      console.warn(`[WS-Broadcast] Backend unreachable: ${err.message}`);
      resolve(); // resolve (not reject) — this is intentional
    });

    req.write(body);
    req.end();
  });
}

// ─── ACTIVITY: broadcastParkingUpdate ────────────────────────
//
//  Sends a real-time parking slot update to all dashboard browsers.
//
//  Parameters:
//    type       = 'ENTRY' or 'EXIT' — did a slot get used or freed?
//    event      = the entry/exit scan data (vehicle, gate, timestamp)
//    personnel  = who owns the card (name, company)
//    quota      = CURRENT slot count AFTER increment/decrement
//                 (WF1 already updated DB before starting/signalling WF7)
//
//  The dashboard will receive this and can:
//    - Update the "X/Y slots used" counter for this company
//    - Add/remove a row in the "currently inside" live table
//    - Flash a notification in the UI
//
export async function broadcastParkingUpdate(
  type:      ParkingEventType,
  event:     EntryEvent,
  personnel: PersonnelRecord,
  quota:     CompanyQuota
): Promise<void> {

  // Build the payload we'll send via WebSocket to the browser.
  // This is a plain JavaScript object — JSON.stringify will convert it.
  const payload = {
    type,                                           // 'ENTRY' or 'EXIT'
    vehicleNumber: event.vehicleNumber,             // "TS 09 AB 1234"
    cardId:        event.cardId,                    // "5248003"
    gate:          event.gate,                      // "GATE_1"
    timestamp:     event.timestamp,                 // "2026-06-09T10:30:00"
    personName:    personnel.pName,                 // "Pavan Kumar"
    companyCode:   personnel.pCode,                 // "MSFT"
    companyName:   personnel.company,               // "Microsoft India"
    occupiedSlots: quota.occupiedSlots,             // 8
    totalSlots:    quota.totalSlots,                // 10
    occupancyPercent: Math.round(                   // 80
      (quota.occupiedSlots / quota.totalSlots) * 100
    ),
  };

  console.log(
    `[WS-Broadcast] ${type} — ${personnel.pName} (${personnel.pCode}) ` +
    `${quota.occupiedSlots}/${quota.totalSlots} slots`
  );

  // POST to the Express backend which will call io.emit('parkingUpdate', payload)
  await postToBackend('/internal/parking-update', payload);
}

// ─── ACTIVITY: broadcastDeniedScan ───────────────────────────
//
//  Broadcasts a scan-attempt that was DENIED to the Live Entry/Exit
//  dashboard. Called by WF3 (unauthorized) and WF9 (quota full).
//
//  Without this, denied scans would be invisible on the dashboard
//  when testing with the simulator (which doesn't write to CardRecord).
//
//  personName  = '' for unauthorized (card not in DB)
//  companyCode = '' for unauthorized, or the PCode for quota-full
//
export async function broadcastDeniedScan(
  event:       EntryEvent,
  personName:  string,
  companyCode: string
): Promise<void> {
  const payload = {
    type:             'ENTRY',   // PortNum=1 → entry arrow on dashboard
    vehicleNumber:    event.vehicleNumber,
    cardId:           event.cardId,
    gate:             event.gate,
    timestamp:        event.timestamp,
    personName,
    companyCode,
    companyName:      companyCode,
    occupiedSlots:    0,
    totalSlots:       0,
    occupancyPercent: 0,
  };

  const label = companyCode ? `QUOTA_DENIED — ${personName} (${companyCode})` : `UNAUTHORIZED — ${event.cardId}`;
  console.log(`[WS-Broadcast] ${label} | ${event.vehicleNumber} | ${event.gate}`);

  await postToBackend('/internal/parking-update', payload);
}
