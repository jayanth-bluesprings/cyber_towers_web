// ═══════════════════════════════════════════════════════════════
//  WF1 — ENTRY / EXIT TRACKING WORKFLOW
// ═══════════════════════════════════════════════════════════════
//
//  NOTE: Cyber Towers has NO physical gate barrier.
//  The LED display is the ONLY output device.
//  All gate.openGate() calls replaced with gate.displayOnLED().
//
//  executeChild vs startChild:
//    executeChild → WF1 pauses and WAITS for child to finish
//    startChild   → WF1 continues immediately; child runs in parallel
//
// ═══════════════════════════════════════════════════════════════

import * as wf from '@temporalio/workflow';

import type * as dbAct   from '../activities/db.activities';
import type * as gateAct from '../activities/gate.activities';
import type * as wsAct   from '../activities/websocket.activities';

import { exitSignal, cancelOverstaySignal, vehicleExitedSignal } from '../shared/signals';
import type { EntryEvent } from '../shared/types';

// ─── PROXY ACTIVITIES ─────────────────────────────────────────
const db = wf.proxyActivities<typeof dbAct>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

const led = wf.proxyActivities<typeof gateAct>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 5 },
});

const ws = wf.proxyActivities<typeof wsAct>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 2 },
});

// ─── THE WORKFLOW FUNCTION ────────────────────────────────────
export async function wf1EntryExit(input: EntryEvent): Promise<void> {

  // ── SIGNAL HANDLERS — must be set BEFORE any awaits ───────
  let exitData: { timestamp: string; gate: string } | undefined;
  wf.setHandler(exitSignal, (data) => { exitData = data; });

  // ── STEP 1: Lookup who owns this card ─────────────────────
  const personnel = await db.lookupPersonnel(input.cardId);

  // ── STEP 2: Is this vehicle authorized? ───────────────────
  const isAuthorized =
    personnel !== null &&
    personnel.pCode.length > 0 &&
    personnel.pCode !== '-';

  if (!isAuthorized) {
    // ── UNAUTHORIZED PATH ──────────────────────────────────
    // WF3 handles the security decision (approve or deny).
    // WF3 now returns { approved: boolean }.
    const wf3Result = await wf.executeChild('wf3UnauthorizedApproval', {
      args:                    [input],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf3-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      workflowExecutionTimeout: '30 minutes',
    }) as { approved: boolean };

    if (!wf3Result.approved) {
      return; // Security denied — no entry tracking needed
    }

    // Security approved the unauthorized vehicle — track entry and exit.
    // No PCode so we skip quota increment/decrement.
    await db.writeAuditLog({
      eventType:     'UNAUTHORIZED_ENTRY_STARTED',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      notes:         'Approved by security — tracking until exit',
    });

    // Start WF2 (overstay monitoring) in parallel
    const wf2Handle = await wf.startChild('wf2OverstayAlert', {
      args:                    [input, { personnelId: '', cardData: input.cardId, pCode: '', pName: input.vehicleNumber, company: '' }],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf2-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      workflowExecutionTimeout: '48 hours',
    });

    // Wait for exit
    await wf.condition(() => exitData != null);

    // Signal WF2 to cancel overstay monitoring
    await wf2Handle.signal(cancelOverstaySignal);

    await db.writeAuditLog({
      eventType:     'VEHICLE_EXIT',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          exitData!.gate,
      timestamp:     exitData!.timestamp,
      notes:         `Unauthorized approved entry. Entry: ${input.timestamp} | Exit: ${exitData!.timestamp}`,
    });

    return;
  }

  // ── STEP 3: Check company parking quota ───────────────────
  const quota = await db.getCompanyQuota(personnel.pCode);
  const isQuotaFull = quota.occupiedSlots >= quota.totalSlots;

  if (isQuotaFull) {
    // ── QUOTA FULL PATH ────────────────────────────────────
    // WF9 handles the override request (admin approve or deny).
    // WF9 now returns { approved: boolean }.
    const wf9Result = await wf.executeChild('wf9QuotaOverride', {
      args:                    [input, personnel, quota],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf9-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      workflowExecutionTimeout: '30 minutes',
    }) as { approved: boolean };

    if (!wf9Result.approved) {
      return; // Override denied — no entry tracking needed
    }

    // Override approved — increment slot count (over-quota entry) and track
    const newCount = await db.incrementCompanyCount(personnel.pCode);
    const updatedQuota = { ...quota, occupiedSlots: newCount };

    await db.writeAuditLog({
      eventType:     'OVERRIDE_ENTRY_STARTED',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          input.gate,
      timestamp:     input.timestamp,
      companyCode:   personnel.pCode,
      pName:         personnel.pName,
      notes:         `Override approved — over-quota entry. Quota: ${newCount}/${quota.totalSlots}`,
    });

    const wf2Handle = await wf.startChild('wf2OverstayAlert', {
      args:                    [input, personnel],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf2-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      workflowExecutionTimeout: '48 hours',
    });

    const wf7Handle = await wf.startChild('wf7ParkingSlotTracker', {
      args:                    [input, personnel, updatedQuota],
      taskQueue:               'cyber-towers-task-queue',
      workflowId:              `wf7-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
      parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      workflowExecutionTimeout: '72 hours',
    });

    await wf.condition(() => exitData != null);

    await db.decrementCompanyCount(personnel.pCode);
    await wf7Handle.signal(vehicleExitedSignal, exitData!);
    await wf2Handle.signal(cancelOverstaySignal);

    await db.writeAuditLog({
      eventType:     'VEHICLE_EXIT',
      cardId:        input.cardId,
      vehicleNumber: input.vehicleNumber,
      gate:          exitData!.gate,
      timestamp:     exitData!.timestamp,
      companyCode:   personnel.pCode,
      pName:         personnel.pName,
      notes:         `Override entry. Entry: ${input.timestamp} | Exit: ${exitData!.timestamp}`,
    });

    return;
  }

  // ── STEP 4: ALLOW ENTRY — show LED ────────────────────────
  // Authorized vehicle with free parking slots.
  const slotStr = `${quota.occupiedSlots + 1}/${quota.totalSlots}`;
  await led.displayOnLED(
    input.gate,
    `✓ ALLOWED — Welcome, ${personnel.pName}. Slot ${slotStr}`
  );
  await db.incrementCompanyCount(personnel.pCode);
  await db.writeAuditLog({
    eventType:     'ENTRY_AUTHORIZED',
    cardId:        input.cardId,
    vehicleNumber: input.vehicleNumber,
    gate:          input.gate,
    timestamp:     input.timestamp,
    companyCode:   personnel.pCode,
    pName:         personnel.pName,
  });

  // ── STEP 5: START WF2 — overstay monitoring ───────────────
  const wf2Handle = await wf.startChild('wf2OverstayAlert', {
    args: [input, personnel],
    taskQueue:               'cyber-towers-task-queue',
    workflowId:              `wf2-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
    parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    workflowExecutionTimeout: '48 hours',
  });

  // ── STEP 5b: START WF7 — real-time slot tracker ────────────
  const wf7Handle = await wf.startChild('wf7ParkingSlotTracker', {
    args: [input, personnel, quota],
    taskQueue:               'cyber-towers-task-queue',
    workflowId:              `wf7-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`,
    parentClosePolicy:       wf.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
    workflowExecutionTimeout: '72 hours',
  });

  // ── STEP 6: Wait for exit ─────────────────────────────────
  await wf.condition(() => exitData != null);

  // ── STEP 7: Decrement BEFORE signalling WF7 ──────────────
  await db.decrementCompanyCount(personnel.pCode);

  // ── STEP 8: Signal WF7 — exit broadcast ──────────────────
  await wf7Handle.signal(vehicleExitedSignal, exitData!);

  // ── STEP 9: Signal WF2 — cancel overstay ─────────────────
  await wf2Handle.signal(cancelOverstaySignal);

  // ── STEP 10: Write final audit log ───────────────────────
  await db.writeAuditLog({
    eventType:     'VEHICLE_EXIT',
    cardId:        input.cardId,
    vehicleNumber: input.vehicleNumber,
    gate:          exitData!.gate,
    timestamp:     exitData!.timestamp,
    companyCode:   personnel.pCode,
    pName:         personnel.pName,
    notes:         `Entry: ${input.timestamp} | Exit: ${exitData!.timestamp}`,
  });
}
