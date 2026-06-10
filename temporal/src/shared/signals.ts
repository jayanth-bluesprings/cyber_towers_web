// ═══════════════════════════════════════════════════════════════
//  WHAT ARE TEMPORAL SIGNALS?
// ═══════════════════════════════════════════════════════════════
//
//  A Signal = a message you send INTO a running workflow from outside.
//  Think of it like pressing a button that wakes up a workflow.
//
//  REAL EXAMPLE:
//    WF1 is SLEEPING, waiting for a vehicle to exit.
//    When the vehicle exits, the backend sends the "exitSignal"
//    into WF1. WF1 wakes up and handles the exit.
//
//  defineSignal<[PayloadType]>('signalName')
//    PayloadType = the shape of data you can send WITH the signal
//    signalName  = a string that identifies this signal
//
//  This file is imported by BOTH:
//    - workflow files (to receive the signal)
//    - client.ts       (to send the signal)
//
// ═══════════════════════════════════════════════════════════════

import { defineSignal } from '@temporalio/workflow';
import type { SecurityDecision, AdminDecision } from './types';

// ─── WF1 SIGNALS ─────────────────────────────────────────────

// Sent when the vehicle exits (PortNum=2 scan detected)
// Payload: the exit timestamp
export const exitSignal = defineSignal<[{ timestamp: string; gate: string }]>(
  'exitSignal'
);

// ─── WF3 SIGNALS ─────────────────────────────────────────────

// Sent by the security officer (approve or deny the unauthorized vehicle)
export const securityDecisionSignal = defineSignal<[SecurityDecision]>(
  'securityDecisionSignal'
);

// ─── WF9 SIGNALS ─────────────────────────────────────────────

// Sent when the security desk clicks "Request Override" for the blocked vehicle
// No payload needed — just the act of requesting is enough
export const overrideRequestSignal = defineSignal<[]>(
  'overrideRequestSignal'
);

// Sent when the Company Admin clicks Approve or Deny on the override request
export const adminDecisionSignal = defineSignal<[AdminDecision]>(
  'adminDecisionSignal'
);

// ─── WF2 SIGNALS ─────────────────────────────────────────────

// Sent by WF1 to WF2 when the vehicle EXITS before 24 hours.
// This cancels the overstay timer — no alert needed.
//
// WHY WF1 SENDS THIS TO WF2:
//   WF1 and WF2 run at the SAME TIME (in parallel).
//   WF1 sleeps waiting for exit.
//   WF2 sleeps waiting for 24 hours.
//   When WF1 detects exit, it sends this signal to WF2 saying
//   "vehicle left — stop counting, don't send the overstay alert."
//
// No payload needed — the signal itself is the cancellation.
export const cancelOverstaySignal = defineSignal<[]>(
  'cancelOverstaySignal'
);

// ─── WF7 SIGNALS ─────────────────────────────────────────────

// Sent by WF1 to WF7 when the vehicle EXITS.
// WF7 uses this to:
//   1. Broadcast the exit event to the dashboard (WebSocket)
//   2. Update the LED display at the gate (slot count freed)
//
// WHY A SEPARATE SIGNAL FROM cancelOverstaySignal?
//   WF2 and WF7 run in parallel but have DIFFERENT jobs.
//   WF2 wants to be "cancelled" (stop monitoring) — no payload.
//   WF7 wants the EXIT DATA (timestamp + gate) to broadcast properly.
//   So WF7 gets its own signal with payload.
//
// Payload: { timestamp: string; gate: string }
//   timestamp = when the vehicle exited (ISO string)
//   gate      = which gate it exited from (exit gate may differ from entry gate)
export const vehicleExitedSignal = defineSignal<[{ timestamp: string; gate: string }]>(
  'vehicleExitedSignal'
);
