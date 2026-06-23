const express = require('express');
const router = express.Router();
const { getLive, getNew, search, getAuthorizedVehicles } = require('../controllers/liveController');
const { getVehicleStats, getVehicleTypeCount, getVehicleCount } = require('../controllers/statsController');
const { getDebug, getReportSummary, getReportRecords, getVehicleOccupancy, trigger24hAlert } = require('../controllers/reportcontroller');
const { sendSecurityDecision, deriveWf3WorkflowId } = require('../temporalClient');
const { getPersonPhoto, getPhotoSchema } = require('../controllers/photoController');
const { updatePerson } = require('../controllers/personController');
const { getRecentEvents } = require('../repositories/scanEventsRepo');
const { listUsers }       = require('../repositories/usersRepo');

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
router.get('/person-photo/:cardId', getPersonPhoto);
router.get('/photo-schema', getPhotoSchema);
router.put('/person/:cardId', updatePerson);

// ── GET /api/scan-events — raw scan events from PostgreSQL ───────────────────
router.get('/scan-events', async (req, res) => {
  try {
    const { limit = 100, since, controllerSn, cardNo, accessResult } = req.query;
    const rows = await getRecentEvents({
      limit: Math.min(parseInt(limit) || 100, 1000),
      since,
      controllerSn,
      cardNo,
      accessResult,
    });
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('scan-events error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/health/events — recent device health events (RFID scans + alerts) ─
router.get('/health/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const rows = await getRecentEvents({ limit });
    res.json({
      success: true,
      data: rows,
      total: rows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('health/events error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/users — list active users (for card assignment dropdown) ─────────
router.get('/users', async (req, res) => {
  try {
    const { limit = 200, offset = 0 } = req.query;
    const users = await listUsers({ limit: parseInt(limit) || 200, offset: parseInt(offset) || 0 });
    res.json({ success: true, data: users, total: users.length });
  } catch (err) {
    console.error('users list error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Security decision for unauthorized vehicle approval ──────────────────────
router.post('/security-decision', async (req, res) => {
  const { workflowId, cardId, action, vehicleNumber, companyName, reason } = req.body;

  if (!action || !['approve', 'deny'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "deny"' });
  }

  let wfId = workflowId;
  if (!wfId && cardId && req.body.timestamp) {
    wfId = deriveWf3WorkflowId(cardId, req.body.timestamp);
  }

  if (!wfId) {
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
    console.warn(`[SecurityDecision] Signal failed for ${wfId}:`, err.message);
    res.json({ ok: true, signaled: false, error: err.message });
  }
});

module.exports = router;
