// ═══════════════════════════════════════════════════════════════
//  TEMPORAL WORKER — The process that runs your workflows + activities
// ═══════════════════════════════════════════════════════════════
//
//  WHAT IS A WORKER?
//  A Worker is a Node.js process that:
//    1. Connects to the Temporal Server (localhost:7233)
//    2. Registers all your workflow functions
//    3. Registers all your activity functions
//    4. Polls Temporal for tasks and executes them
//
//  You run ONE worker process alongside your Express server.
//  The worker listens on a "task queue" named 'cyber-towers-task-queue'.
//  When WF1 is triggered, Temporal sends the task to this queue,
//  and the worker picks it up and runs it.
//
//  HOW TO RUN:
//    cd temporal
//    npm run worker:dev
//
//  This runs worker.ts using ts-node (no compilation step needed in dev).
//
// ═══════════════════════════════════════════════════════════════

import { Worker, NativeConnection } from '@temporalio/worker';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from backend folder
dotenv.config({ path: path.join(__dirname, '../../backend/.env') });

// ─── IMPORT ALL ACTIVITIES ────────────────────────────────────
// We import the ACTUAL modules here (not 'import type') because
// the worker needs the real functions to execute them.
import * as dbActivities      from './activities/db.activities';
import * as gateActivities    from './activities/gate.activities';
import * as emailActivities   from './activities/email.activities';
import * as reportActivities  from './activities/report.activities';   // WF4
import * as wsActivities      from './activities/websocket.activities'; // WF7

// ─── TASK QUEUE NAME ──────────────────────────────────────────
// This string must match what the client uses when starting workflows.
// Think of it as a channel name.
export const TASK_QUEUE = 'cyber-towers-task-queue';

// ─── MAIN FUNCTION ────────────────────────────────────────────
async function run(): Promise<void> {
  console.log('🚀 Starting Cyber Towers Temporal Worker...');

  // Connect to Temporal Server
  // Default address is localhost:7233 (local dev mode)
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  // Create the worker
  const worker = await Worker.create({
    connection,
    namespace:  'default',           // Temporal namespace (default for local dev)
    taskQueue:  TASK_QUEUE,

    // workflowsPath tells Temporal where to find your workflow files.
    // It bundles them automatically — this is why workflows must be
    // deterministic (the bundler enforces it).
    workflowsPath: require.resolve('./workflows/index'),

    // activities = spread all activity objects into one flat object
    // { ...dbActivities, ...gateActivities, ...emailActivities }
    // means: "all functions from all three files are available as activities"
    activities: {
      ...dbActivities,
      ...gateActivities,
      ...emailActivities,
      ...reportActivities,   // WF4: getDailyStats, sendDailyReportEmail
      ...wsActivities,       // WF7: broadcastParkingUpdate
    },
  });

  console.log(`✅ Worker running on task queue: "${TASK_QUEUE}"`);
  console.log('   Temporal Server: ' + (process.env.TEMPORAL_ADDRESS || 'localhost:7233'));
  console.log('   Press Ctrl+C to stop.\n');

  // Start polling — this runs forever until you Ctrl+C
  await worker.run();
}

// ─── START ────────────────────────────────────────────────────
run().catch((err) => {
  console.error('❌ Worker failed to start:', err);
  process.exit(1);
});
