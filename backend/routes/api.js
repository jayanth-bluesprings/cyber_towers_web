const express = require('express');
const router = express.Router();
const { getLive, getNew, search, getAuthorizedVehicles } = require('../controllers/liveController');
const { getVehicleStats, getVehicleTypeCount, getVehicleCount, getEventCounts } = require('../controllers/statsController');
const { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy, trigger24hAlert } = require('../controllers/reportcontroller');
const { sendSecurityDecision, deriveWf3WorkflowId } = require('../temporalClient');

router.get('/live', getLive);
router.get('/new', getNew);
router.get('/search', search);
router.get('/authorized-vehicles', getAuthorizedVehicles);
router.get('/vehicle-stats', getVehicleStats);
router.get('/vehicle-type-count', getVehicleTypeCount);
router.get('/vehicle-count', getVehicleCount);
router.get('/report/debug', getDebug);
router.get('/report/summary', getReportSummary);
router.get('/report/records', getReportRecords);
router.get('/report/occupancy', getVehicleOccupancy);
router.get('/alerts/trigger-24h', trigger24hAlert);
router.get('/health/events', getEventCounts);

// ── Security decision for unauthorized vehicle approval ──────
// Called by the Allow button in Live Entry/Exit.
// Signals the running WF3 workflow to approve entry.
router.post('/security-decision', async (req, res) => {
  const { workflowId, cardId, action, vehicleNumber, companyName, reason } = req.body;

  if (!action || !['approve', 'deny'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "deny"' });
  }

  // Determine the workflow ID: prefer explicit, fall back to deriving from cardId + timestamp
  let wfId = workflowId;
  if (!wfId && cardId && req.body.timestamp) {
    wfId = deriveWf3WorkflowId(cardId, req.body.timestamp);
  }

  if (!wfId) {
    // If no workflowId provided, log but return success — dashboard still saves locally
    console.warn('[SecurityDecision] No workflowId provided — local save only');
    return res.json({ ok: true, signaled: false, note: 'No workflowId — local save only' });
  }

  try {
    await sendSecurityDecision(wfId, {
      action,
      officerId: 'SECURITY_DESK',
      vehicleNumber: vehicleNumber || '',
      companyName:   companyName   || '',
      reason:        reason        || '',
    });
    res.json({ ok: true, signaled: true, workflowId: wfId });
  } catch (err) {
    // Workflow may have already completed or timed out
    console.warn(`[SecurityDecision] Signal failed for ${wfId}:`, err.message);
    res.json({ ok: true, signaled: false, error: err.message });
  }
});

module.exports = router;
