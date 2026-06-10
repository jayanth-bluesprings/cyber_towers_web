// ═══════════════════════════════════════════════════════════════
//  WF9 — PARKING QUOTA FULL: DENIAL & OVERRIDE REQUEST WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  TRIGGERED BY: WF1 when vehicle IS authorized BUT company quota is FULL
//
//  WHAT IT DOES:
//    1. Block gate + LED: "Company Parking Full XX/XX"
//    2. Email Company Admin (informational — "your vehicle was denied")
//    3. Write audit log (ENTRY_DENIED_QUOTA_FULL)
//    4. WAIT up to 5 minutes for an override request signal
//       (security officer clicks "Request Override" on behalf of employee)
//
//    If NO override requested:
//      → End quietly (vehicle parks outside)
//
//    If override IS requested:
//      5. Email Company Admin with Approve/Deny buttons
//      6. WAIT up to 5 minutes for admin's decision
//
//      If APPROVED:
//        → Open gate, log as OVERRIDE_APPROVED, send confirmation emails
//
//      If DENIED or timeout:
//        → Gate stays closed, send denial notification, log OVERRIDE_DENIED
//
//  NEW TYPESCRIPT CONCEPT — wf.sleep():
//    wf.sleep('5 minutes') = pause the workflow for 5 minutes.
//    DURABLE — if the server crashes during this sleep, Temporal
//    restarts and continues the sleep from where it was.
//    This is what FIXES the cronJobs.js bug (server crash = missed job).
//
//  NEW TYPESCRIPT CONCEPT — ?? (nullish coalescing):
//    value ?? 'default'
//    = "use value IF it's not null/undefined, otherwise use 'default'"
//    Example: personnel.company ?? 'Unknown Company'
//             → if company is null, use 'Unknown Company'
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

import type * as dbAct    from '../activities/db.activities';
import type * as gateAct  from '../activities/gate.activities';
import type * as emailAct from '../activities/email.activities';
import type * as wsAct    from '../activities/websocket.activities';

import { overrideRequestSignal, adminDecisionSignal } from '../shared/signals';
import type { EntryEvent, PersonnelRecord, CompanyQuota, AdminDecision } from '../shared/types';

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
//
//  Three parameters: the entry event, the personnel record, and the quota.
//  All three are passed from WF1 when it starts this workflow.
//
export async function wf9QuotaOverride(
  input:     EntryEvent,
  personnel: PersonnelRecord,
  quota:     CompanyQuota
): Promise<void> {

  // Build a readable quota string like "10/10" for messages
  const quotaStr = `${quota.occupiedSlots}/${quota.totalSlots}`;

  // ── STEP 1: Block gate + LED + broadcast to dashboard ────
  // broadcastDeniedScan sends the scan event to Live Entry/Exit so
  // the security guard sees it immediately even in simulator mode.
  // personName + companyCode are included so it shows as "Authorized"
  // (the person IS valid — just their company quota is full).
  await Promise.all([
    gate.denyGate(input.gate, `QUOTA FULL ${quotaStr}`),
    gate.displayOnLED(
      input.gate,
      `Company Parking FULL ${quotaStr} — Please park outside`
    ),
    ws.broadcastDeniedScan(input, personnel.pName, personnel.pCode),
  ]);

  // ── STEP 2: Email Company Admin (informational) ───────────
  // This runs ALONGSIDE the audit log write — both in parallel
  await Promise.all([
    email.sendQuotaFullEmail(input, personnel, quota),
    db.writeAuditLog({
      eventType:     'ENTRY_DENIED_QUOTA_FULL',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      companyCode:   personnel.pCode,
      pName:         personnel.pName,
      notes:         `Quota: ${quotaStr}`,
    }),
  ]);

  // ── STEP 3: Wait up to 5 minutes for override request ────
  //
  //  The security desk has 5 minutes to click "Request Override"
  //  on behalf of the employee standing at the gate.
  //
  //  overrideRequested starts as false.
  //  When the overrideRequestSignal arrives, it becomes true.
  //
  let overrideRequested = false;
  wf.setHandler(overrideRequestSignal, () => {
    overrideRequested = true;
  });

  // Wait until overrideRequested is true, OR 5 minutes pass
  const requestedInTime = await wf.condition(
    () => overrideRequested,
    '5 minutes'
  );

  // ── NO OVERRIDE REQUESTED ─────────────────────────────────
  if (!requestedInTime) {
    await db.writeAuditLog({
      eventType:     'OVERRIDE_TIMEOUT',    // reusing closest type
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      companyCode:   personnel.pCode,
      pName:         personnel.pName,
      notes:         'No override requested within 5 minutes — vehicle parks outside',
    });
    return; // WF9 ends quietly — vehicle parks outside
  }

  // ── STEP 4: Override was requested — email Company Admin ──
  // Now ask the Company Admin to formally approve or deny
  await email.sendOverrideRequestEmail(input, personnel, quota);

  await db.writeAuditLog({
    eventType:     'OVERRIDE_REQUESTED',
    cardId:        input.cardId,
    vehicleNumber: input.vehicleNumber,
    gate:          input.gate,
    timestamp:     input.timestamp,
    companyCode:   personnel.pCode,
    pName:         personnel.pName,
    notes:         'Override requested by security desk — awaiting admin decision',
  });

  // ── STEP 5: Wait up to 5 minutes for admin's decision ────
  let adminDecision: AdminDecision | null = null;

  wf.setHandler(adminDecisionSignal, (incoming: AdminDecision) => {
    adminDecision = incoming;
  });

  const decidedInTime = await wf.condition(
    () => adminDecision !== null,
    '5 minutes'
  );

  // ── ADMIN DENIED or TIMED OUT ─────────────────────────────
  if (!decidedInTime || adminDecision === null || adminDecision.action === 'deny') {
    const notes = !decidedInTime
      ? 'Admin did not respond within 5 minutes — auto-denied'
      : `Denied by admin ${adminDecision?.adminId ?? 'unknown'}`;

    await Promise.all([
      email.sendOverrideResult(input, personnel, adminDecision ?? { action: 'deny', adminId: 'SYSTEM' }),
      db.writeAuditLog({
        eventType:     'OVERRIDE_DENIED',
        cardId:        input.cardId,
        vehicleNumber: input.vehicleNumber,
        gate:          input.gate,
        timestamp:     input.timestamp,
        companyCode:   personnel.pCode,
        pName:         personnel.pName,
        notes,
      }),
    ]);
    return; // WF9 ends — gate stays closed
  }

  // ── ADMIN APPROVED ────────────────────────────────────────
  // Open the gate — this is an over-quota entry.
  // The count goes above total (e.g. 10/10 → 11/10).
  await Promise.all([
    gate.openGate(input.gate, input.vehicleNumber),
    email.sendOverrideResult(input, personnel, adminDecision),
    db.writeAuditLog({
      eventType:     'OVERRIDE_APPROVED',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      companyCode:   personnel.pCode,
      pName:         personnel.pName,
      notes:         `Approved by admin ${adminDecision.adminId} — over quota entry. Quota was ${quotaStr}`,
    }),
  ]);

  // WF9 ends — override approved, vehicle entered above quota
}
