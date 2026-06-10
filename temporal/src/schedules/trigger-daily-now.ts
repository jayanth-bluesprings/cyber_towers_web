// ═══════════════════════════════════════════════════════════════
//  TRIGGER DAILY REPORT NOW — Test WF4 on demand
// ═══════════════════════════════════════════════════════════════
//
//  Use this to run WF4 immediately without waiting for 11:59 PM.
//
//  USAGE:
//    cd temporal
//    npm run trigger-daily-now
//
// ═══════════════════════════════════════════════════════════════

import { Client, Connection } from '@temporalio/client';
import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

async function triggerDailyNow(): Promise<void> {
  console.log('🔌 Connecting to Temporal Server...');

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const client = new Client({ connection, namespace: 'default' });

  const workflowId = `wf4-manual-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  console.log(`🚀 Starting WF4 now (ID: ${workflowId})...`);

  const handle = await client.workflow.start('wf4DailyReport', {
    taskQueue:               'cyber-towers-task-queue',
    workflowId,
    workflowExecutionTimeout: '10 minutes',
    args: [],
  });

  console.log('');
  console.log('✅ WF4 started!');
  console.log(`   Workflow ID : ${workflowId}`);
  console.log(`   Track it at : http://localhost:8233/namespaces/default/workflows/${workflowId}`);
  console.log('');
  console.log('Waiting for completion...');

  await handle.result();

  console.log('');
  console.log('🎉 WF4 completed successfully!');
  console.log('   Check your ADMIN_EMAIL inbox for the daily report.');
  console.log('   Check TemporalAuditLog for the DAILY_REPORT_SENT entry.');
  console.log('');

  await connection.close();
}

triggerDailyNow().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
