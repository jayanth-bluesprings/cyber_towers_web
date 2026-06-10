// Temporal client for sending signals from Express backend to running workflows.
// Used by POST /api/security-decision to signal WF3 (unauthorized approval).

const { Connection, Client } = require('@temporalio/client');

let _client = null;

async function getClient() {
  if (_client) return _client;
  const connection = await Connection.connect({ address: 'localhost:7233' });
  _client = new Client({ connection });
  return _client;
}

// Send securityDecisionSignal to a WF3 workflow.
// workflowId: the exact WF3 workflow ID (wf3-<cardId>-<timestamp>)
// decision: { action: 'approve'|'deny', officerId, vehicleNumber, companyName, reason }
async function sendSecurityDecision(workflowId, decision) {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('securityDecisionSignal', decision);
}

// Derive the WF3 workflow ID from cardId and scan timestamp.
// Must match the pattern used in wf1-entry-exit.ts:
//   `wf3-${input.cardId}-${input.timestamp.replace(/[:.]/g, '-')}`
function deriveWf3WorkflowId(cardId, timestamp) {
  return `wf3-${cardId}-${String(timestamp).replace(/[:.]/g, '-')}`;
}

module.exports = { sendSecurityDecision, deriveWf3WorkflowId };
