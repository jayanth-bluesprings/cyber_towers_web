// ═══════════════════════════════════════════════════════════════
//  TRIGGER WEEKLY REPORT NOW — Test WF5 on demand
// ═══════════════════════════════════════════════════════════════
//
//  Use this to test WF5 immediately without waiting for Monday.
//
//  USAGE:
//    cd temporal
//    npm run trigger-weekly-now
//
//  This starts ONE WF5 run right now and returns a workflow ID
//  you can track in the Temporal Web UI.
//
//  NOTE: This starts a fresh workflow run — it does NOT affect
//  the weekly schedule. The schedule will still fire on Monday.
//
// ═══════════════════════════════════════════════════════════════

import { Client, Connection } from '@temporalio/client';
import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

async function triggerWeeklyNow(): Promise<void> {
  console.log('🔌 Connecting to Temporal Server...');

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const client = new Client({ connection, namespace: 'default' });

  // Use a timestamp in the ID so you can run this multiple times
  const workflowId = `wf5-manual-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  console.log(`🚀 Starting WF5 now (ID: ${workflowId})...`);

  const handle = await client.workflow.start('wf5WeeklyReport', {
    taskQueue:               'cyber-towers-task-queue',
    workflowId,
    workflowExecutionTimeout: '30 minutes',
    args: [],
  });

  console.log('');
  console.log('✅ WF5 started!');
  console.log(`   Workflow ID : ${workflowId}`);
  console.log(`   Track it at : http://localhost:8233/namespaces/default/workflows/${workflowId}`);
  console.log('');
  console.log('Waiting for completion...');

  // Wait for the workflow to finish and show the result
  await handle.result();

  console.log('');
  console.log('🎉 WF5 completed successfully!');
  console.log('   Check your ADMIN_EMAIL inbox for the weekly report.');
  console.log('   Check TemporalAuditLog for the WEEKLY_REPORT_SENT entry.');
  console.log('');

  await connection.close();
}

triggerWeeklyNow().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
