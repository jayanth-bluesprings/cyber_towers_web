// ═══════════════════════════════════════════════════════════════
//  WF3 — UNAUTHORIZED VEHICLE APPROVAL WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  TRIGGERED BY: WF1 when a vehicle scans but PCode is empty/'-'
//
//  WHAT IT DOES:
//    1. Block the gate (deny signal)
//    2. Show LED message: "UNAUTHORIZED — Security Notified"
//    3. Send alert email to system admin / security desk
//    4. Write audit log (ENTRY_DENIED_UNAUTHORIZED)
//    5. WAIT up to 10 minutes for the security officer to decide
//    6. If APPROVED → open gate + audit log
//    7. If DENIED or no response in 10 min → stay closed + audit log
//
//  NEW TYPESCRIPT CONCEPT — const vs let:
//    const = the variable CANNOT be reassigned (it's fixed)
//            e.g. const name = "Pavan"  ← can't do name = "Someone" later
//    let   = the variable CAN be reassigned
//            e.g. let count = 0;  then later  count = 1;  ← ok
//
//  NEW TYPESCRIPT CONCEPT — null vs undefined:
//    null      = "intentionally empty" — you set it to null on purpose
//    undefined = "never assigned" — variable was declared but never given a value
//    In our code we use null to mean "no decision yet"
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

const gate = wf.proxyActivities<typeof gateAct>({
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
  input: EntryEvent    // the same EntryEvent passed from WF1
): Promise<void> {

  // ── STEP 1: Block gate + broadcast to dashboard ──────────
  // Run gate deny AND dashboard broadcast in parallel.
  // broadcastDeniedScan sends the scan to the Live Entry/Exit page
  // so it appears even when testing with the simulator (which doesn't
  // write to CardRecord — the normal DB poll wouldn't pick it up).
  await Promise.all([
    gate.denyGate(input.gate, 'UNAUTHORIZED VEHICLE — SECURITY NOTIFIED'),
    ws.broadcastDeniedScan(input, '', ''),   // no name/company for unknown card
  ]);
  await gate.displayOnLED(
    input.gate,
    'UNAUTHORIZED — Contacting security. Please wait.'
  );

  // ── STEP 2: Alert security / admin ───────────────────────
  // Run email + audit log at the SAME TIME (in parallel)
  // Promise.all([a, b]) = "start both, wait for BOTH to finish"
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
  //
  //  'let' because this variable WILL change when the signal arrives
  //  SecurityDecision | null = either a decision object OR null
  //  We start with null (no decision yet)
  //
  let decision: SecurityDecision | null = null;

  // When the securityDecisionSignal arrives, store the decision
  wf.setHandler(securityDecisionSignal, (incoming: SecurityDecision) => {
    decision = incoming;
  });

  //  wf.condition(conditionFn, timeout)
  //    conditionFn = a function that returns true when we should stop waiting
  //    timeout     = '10 minutes' — if condition isn't met in 10 min, return false
  //
  //  decided = true  → security responded in time
  //  decided = false → 10 minutes passed with no response (timeout)
  //
  const decided = await wf.condition(
    () => decision !== null,
    '10 minutes'
  );

  // ── STEP 4a: TIMEOUT — no decision in 10 minutes ─────────
  if (!decided || decision === null) {
    await db.writeAuditLog({
      eventType:     'UNAUTHORIZED_TIMEOUT',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      notes:         'No security response within 10 minutes — entry denied',
    });
    // WF3 ends here, gate stays closed
    return;
  }

  // ── STEP 4b: DENIED by security ──────────────────────────
  if (decision.action === 'deny') {
    await db.writeAuditLog({
      eventType:     'UNAUTHORIZED_DENIED_BY_SECURITY',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      notes:         `Denied by officer ${decision.officerId}. Reason: ${decision.reason ?? 'none'}`,
    });
    // WF3 ends here, gate stays closed
    return;
  }

  // ── STEP 4c: APPROVED by security ────────────────────────
  // Security officer approved this vehicle — open the gate
  await Promise.all([
    gate.openGate(input.gate, input.vehicleNumber),
    email.sendSecurityApprovalConfirm(input, decision),
    db.writeAuditLog({
      eventType:     'UNAUTHORIZED_APPROVED_BY_SECURITY',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      notes:         `Approved by officer ${decision.officerId}. Reason: ${decision.reason ?? 'none'}`,
    }),
  ]);

  // WF3 ends here — vehicle was allowed in via security approval
}
