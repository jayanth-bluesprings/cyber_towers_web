// ─── GATE CONTROL ACTIVITIES ─────────────────────────────────
//
//  These activities control the physical gate at Cyber Towers.
//  Right now they LOG the command and broadcast via the backend's
//  internal API. When real gate hardware is integrated, you replace
//  the body of each function — the workflows DO NOT need to change.
//
//  That's the power of Temporal: the workflow logic stays the same,
//  you only swap the activity implementation.
//
// ─────────────────────────────────────────────────────────────

import * as http from 'http';

// ─── HELPER: call the Express backend's internal gate API ─────
// The Express backend (port 5000) has a /internal/gate route that
// broadcasts gate commands via WebSocket to all dashboard clients.
//
// We POST a JSON body: { command: 'OPEN'|'DENY', gate: 'GATE_1' }
async function callGateAPI(command: 'OPEN' | 'DENY', gate: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ command, gate, message });

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port:     parseInt(process.env.BACKEND_PORT || '5000'),
      path:     '/internal/gate-command',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Internal-Key': process.env.INTERNAL_API_KEY || 'temporal-internal',
      },
    };

    const req = http.request(options, (res) => {
      console.log(`[Gate] ${command} ${gate} → HTTP ${res.statusCode}`);
      resolve();
    });

    req.on('error', (err) => {
      // Log but do NOT throw — gate command is best-effort
      // The audit log still records the intent
      console.error(`[Gate] Failed to reach backend: ${err.message}`);
      resolve();
    });

    req.write(body);
    req.end();
  });
}

// ─── ACTIVITY: openGate ───────────────────────────────────────
// Sends an OPEN command to the gate controller.
// Called when: authorized vehicle enters (WF1), override approved (WF9)
export async function openGate(gate: string, vehicleNumber: string): Promise<void> {
  console.log(`[Gate] OPEN → ${gate} for vehicle ${vehicleNumber}`);
  await callGateAPI('OPEN', gate, `Authorized: ${vehicleNumber}`);
}

// ─── ACTIVITY: denyGate ───────────────────────────────────────
// Sends a DENY command — gate stays closed.
// Called when: unauthorized vehicle (WF3), quota full (WF9)
export async function denyGate(gate: string, reason: string): Promise<void> {
  console.log(`[Gate] DENY → ${gate} | Reason: ${reason}`);
  await callGateAPI('DENY', gate, reason);
}

// ─── ACTIVITY: displayOnLED ───────────────────────────────────
// Shows a message on the LED display panel at the gate.
// Dashboard also reflects this via WebSocket broadcast.
export async function displayOnLED(gate: string, message: string): Promise<void> {
  console.log(`[LED] ${gate} → "${message}"`);
  await callGateAPI('DENY', gate, message); // DENY doubles as the LED message carrier
}
