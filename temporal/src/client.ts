// ═══════════════════════════════════════════════════════════════
//  TEMPORAL CLIENT — How your Express backend triggers workflows
// ═══════════════════════════════════════════════════════════════
//
//  WHAT IS THE CLIENT?
//  The Temporal Client is how your existing Express server STARTS
//  a workflow. Think of it as the "trigger button".
//
//  Flow:
//    1. Vehicle scans card at gate
//    2. websocket.js / a route detects the new scan
//    3. It calls  triggerWF1(entryEvent)  from this file
//    4. Temporal Server receives the request and queues WF1
//    5. The Worker picks up WF1 and starts executing it
//
//  HOW TO USE IN YOUR EXPRESS SERVER:
//    In backend/websocket.js (or wherever new scans are detected):
//
//      const { triggerWF1 } = require('../temporal/lib/client');
//      // When new entry scan detected:
//      await triggerWF1({ cardId, vehicleNumber, gate, timestamp, portNum: 1 });
//
//  SENDING A SIGNAL:
//    When vehicle exits:
//      await sendExitSignal(workflowId, { timestamp, gate });
//
//    For WF3 (security approval):
//      await sendSecurityDecision(workflowId, { action: 'approve', officerId: 'SEC001' });
//
// ═══════════════════════════════════════════════════════════════

import { Client, Connection } from '@temporalio/client';
import * as path from 'path';
import * as dotenv from 'dotenv';

import { exitSignal, securityDecisionSignal, overrideRequestSignal, adminDecisionSignal, cancelOverstaySignal } from './shared/signals';
import type { EntryEvent, SecurityDecision, AdminDecision } from './shared/types';

dotenv.config({ path: path.join(__dirname, '../../backend/.env') });

export const TASK_QUEUE = 'cyber-towers-task-queue';

// ─── CHILD WORKFLOW ID HELPERS ────────────────────────────────
// WF1 uses these deterministic patterns when starting WF3 / WF9 as children.
// Knowing the ID lets you send signals directly without querying the server.
export function childWf3Id(cardId: string, timestamp: string): string {
  return `wf3-${cardId}-${timestamp.replace(/[:.]/g, '-')}`;
}
export function childWf9Id(cardId: string, timestamp: string): string {
  return `wf9-${cardId}-${timestamp.replace(/[:.]/g, '-')}`;
}

// ─── BUILD CLIENT ─────────────────────────────────────────────
// The client is created once and reused.
// It connects to the same Temporal Server the worker uses.
async function getClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  return new Client({ connection, namespace: 'default' });
}

// ─── TRIGGER WF1 ─────────────────────────────────────────────
// Call this from websocket.js when a new entry scan is detected.
// workflowId is a unique ID for this specific vehicle visit.
// Using cardId + timestamp makes it unique per entry.
export async function triggerWF1(event: EntryEvent): Promise<string> {
  const client = await getClient();

  // workflowId = a unique name for this specific workflow run
  // If the same cardId scans again, it starts a NEW workflow with a new ID
  const workflowId = `wf1-${event.cardId}-${Date.now()}`;

  await client.workflow.start('wf1EntryExit', {
    taskQueue:  TASK_QUEUE,
    workflowId,
    args:       [event],
    // WF1 can run for max 24 hours (in case vehicle stays overnight)
    workflowExecutionTimeout: '24 hours',
  });

  console.log(`[Client] Started WF1: ${workflowId}`);
  return workflowId;
}

// ─── SEND EXIT SIGNAL ─────────────────────────────────────────
// Call this from websocket.js when an exit scan (PortNum=2) is detected.
// workflowId must be the same ID returned when WF1 was started.
export async function sendExitSignal(
  workflowId: string,
  data: { timestamp: string; gate: string }
): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal(exitSignal, data);
  console.log(`[Client] Exit signal sent to ${workflowId}`);
}

// ─── SEND SECURITY DECISION (WF3) ─────────────────────────────
// Call this from the dashboard API when security officer approves/denies.
// The Express route would call this after receiving the officer's action.
export async function sendSecurityDecision(
  workflowId: string,
  decision:   SecurityDecision
): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal(securityDecisionSignal, decision);
  console.log(`[Client] Security decision (${decision.action}) sent to ${workflowId}`);
}

// ─── SEND OVERRIDE REQUEST (WF9) ──────────────────────────────
// Call this when the security desk clicks "Request Override" on dashboard.
export async function sendOverrideRequest(workflowId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal(overrideRequestSignal);
  console.log(`[Client] Override request sent to ${workflowId}`);
}

// ─── TRIGGER WF4 ─────────────────────────────────────────────
// Trigger the Daily Report workflow immediately (for testing / manual runs).
export async function triggerWF4(): Promise<string> {
  const client = await getClient();
  const workflowId = `wf4-manual-${Date.now()}`;
  await client.workflow.start('wf4DailyReport', {
    taskQueue:               TASK_QUEUE,
    workflowId,
    workflowExecutionTimeout: '10 minutes',
    args: [],
  });
  console.log(`[Client] Started WF4: ${workflowId}`);
  return workflowId;
}

// ─── SEND ADMIN DECISION (WF9) ────────────────────────────────
// Call this when the Company Admin clicks Approve or Deny override.
export async function sendAdminDecision(
  workflowId: string,
  decision:   AdminDecision
): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal(adminDecisionSignal, decision);
  console.log(`[Client] Admin decision (${decision.action}) sent to ${workflowId}`);
}
