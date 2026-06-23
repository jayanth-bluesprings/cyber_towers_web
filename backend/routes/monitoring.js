/**
 * /api/monitoring — Bridge Monitoring dashboard (Phase 11)
 * Mounted with requireApiKey at server level.
 */

const express = require('express');
const router  = express.Router();
const repo    = require('../repositories/monitoringRepo');
const { getRecentSyncLogs } = require('../repositories/syncLogRepo');

// ── GET /api/monitoring/overview ──────────────────────────────────────────────
// Single aggregated snapshot for the dashboard.
router.get('/overview', async (req, res) => {
  try {
    const overview = await repo.getOverview();
    res.json({ success: true, data: overview, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[monitoring] GET /overview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/monitoring/push-failures ─────────────────────────────────────────
router.get('/push-failures', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const failures = await repo.getRecentPushFailures(limit);
    res.json({ success: true, data: failures });
  } catch (err) {
    console.error('[monitoring] GET /push-failures error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/monitoring/sync-logs ─────────────────────────────────────────────
router.get('/sync-logs', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const logs = await getRecentSyncLogs({ limit, controllerId: req.query.controllerId });
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('[monitoring] GET /sync-logs error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
