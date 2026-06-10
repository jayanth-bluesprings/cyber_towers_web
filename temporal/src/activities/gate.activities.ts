// ─── LED DISPLAY ACTIVITIES ───────────────────────────────────
//
//  Cyber Towers has NO physical gate barrier — only an LED display
//  panel at each gate. This file controls that display.
//
//  When a vehicle scans, the LED shows the access decision:
//    ✓ ALLOWED — Welcome, [Name] (green)
//    ✗ DENIED  — [reason]        (red)
//
// ─────────────────────────────────────────────────────────────

import * as http from 'http';

// ─── HELPER: POST to Express backend's internal LED route ─────
async function callLEDApi(gate: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ gate, message });

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
      console.log(`[LED] ${gate} → HTTP ${res.statusCode}`);
      resolve();
    });

    req.on('error', (err) => {
      console.error(`[LED] Failed to reach backend: ${err.message}`);
      resolve(); // best-effort — audit log is the source of truth
    });

    req.write(body);
    req.end();
  });
}

// ─── ACTIVITY: displayOnLED ───────────────────────────────────
// Shows a message on the LED display panel at the gate.
// This is the ONLY output device — there is no physical gate barrier.
export async function displayOnLED(gate: string, message: string): Promise<void> {
  console.log(`[LED] ${gate} → "${message}"`);
  await callLEDApi(gate, message);
}
