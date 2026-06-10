// ═══════════════════════════════════════════════════════════════
//  WF3 — UNAUTHORIZED VEHICLE APPROVAL WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  TRIGGERED BY: WF1 when a vehicle scans but PCode is empty/'-'
//
//  WHAT IT DOES:
//    1. Show LED: "UNAUTHORIZED — Security Notified"
//    2. Broadcast scan to dashboard
//    3. Send alert email to security desk
//    4. Write audit log (ENTRY_DENIED_UNAUTHORIZED)
//    5. WAIT up to 10 minutes for security officer to decide
//    6. If APPROVED → LED "✓ ALLOWED", return { approved: true }
//    7. If DENIED or timeout → LED "✗ DENIED", broadcast DENIED, return { approved: false }
//
//  NOTE: There is NO physical gate. The LED display is the only output.
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

import type * as dbAct    from '../activities/db.activities';
import type * as gateAct  from '../activities/gate.activities';
import type * as emailAct from '../activities/email.activities';
import type * as wsAct    from '../activities/websocket.activities';

import { securityDecisionSignal } from '../shared/signals';
import type { EntryEvent, SecurityDecision } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

const led = wf.proxyActivities<typeof gateAct>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 5 },
});

const email = wf.proxyActivities<typeof emailAct>({
  startToCloseTimeout: '60 seconds',
  retry: { maximumAttempts: 3 },
});

const ws = wf.proxyActivities<typeof wsAct>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 2 },
});

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
export async function wf3UnauthorizedApproval(
  input: EntryEvent
): Promise<{ approved: boolean }> {

  // ── STEP 1: LED + broadcast to dashboard ─────────────────
  await Promise.all([
    led.displayOnLED(input.gate, 'UNAUTHORIZED — Contacting security. Please wait.'),
    ws.broadcastDeniedScan(input, '', ''),
  ]);

  // ── STEP 2: Alert security / admin ───────────────────────
  await Promise.all([
    email.sendUnauthorizedAlert(input),
    db.writeAuditLog({
      eventType:     'ENTRY_DENIED_UNAUTHORIZED',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      notes:         'Awaiting security decision',
    }),
  ]);

  // ── STEP 3: Wait for security officer's decision ──────────
  let decision: SecurityDecision | null = null;

  wf.setHandler(securityDecisionSignal, (incoming: SecurityDecision) => {
    decision = incoming;
  });

  const decided = await wf.condition(
    () => decision !== null,
    '10 minutes'
  );

  // Cast required: TypeScript can't narrow closure-mutated let variables
  const finalDecision = decision as SecurityDecision | null;

  // ── STEP 4a: TIMEOUT ──────────────────────────────────────
  if (!decided || finalDecision === null) {
    await Promise.all([
      led.displayOnLED(input.gate, '✗ DENIED — No security response. Access not granted.'),
      ws.broadcastDeniedResult(input, 'Timeout — no security response in 10 minutes'),
      db.writeAuditLog({
        eventType:     'UNAUTHORIZED_TIMEOUT',
        cardId:        input.cardId,
        vehicleNumber: input.vehicleNumber,
        gate:          input.gate,
        timestamp:     input.timestamp,
        notes:         'No security response within 10 minutes — entry denied',
      }),
    ]);
    return { approved: false };
  }

  // ── STEP 4b: DENIED by security ──────────────────────────
  if (finalDecision.action === 'deny') {
    await Promise.all([
      led.displayOnLED(input.gate, '✗ DENIED — Access refused by security.'),
      ws.broadcastDeniedResult(input, `Denied by officer ${finalDecision.officerId}`),
      db.writeAuditLog({
        eventType:     'UNAUTHORIZED_DENIED_BY_SECURITY',
        cardId:        input.cardId,
        vehicleNumber: input.vehicleNumber,
        gate:          input.gate,
        timestamp:     input.timestamp,
        notes:         `Denied by officer ${finalDecision.officerId}. Reason: ${finalDecision.reason ?? 'none'}`,
      }),
    ]);
    return { approved: false };
  }

  // ── STEP 4c: APPROVED by security ────────────────────────
  const vehicleNumber = finalDecision.vehicleNumber || input.vehicleNumber;
  const companyName   = finalDecision.companyName   || '';
  const reason        = finalDecision.reason        || 'Approved by security';

  await Promise.all([
    led.displayOnLED(input.gate, `✓ ALLOWED — Welcome. Approved by security.`),
    email.sendSecurityApprovalConfirm(input, finalDecision),
    db.writeAuditLog({
      eventType:     'UNAUTHORIZED_APPROVED_BY_SECURITY',
      cardId:        input.cardId,
      vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      notes:         `Approved by ${finalDecision.officerId}. Vehicle: ${vehicleNumber}. Company: ${companyName}. Reason: ${reason}`,
    }),
  ]);

  return { approved: true };
}
