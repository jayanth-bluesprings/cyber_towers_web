const express = require('express');
const router = express.Router();

const scanEventsRepo = require('../repositories/scanEventsRepo');
const controllersRepo = require('../repositories/controllersRepo');
const { requireApiKey } = require('../middleware/auth');

// GET /api/events?controller=XXX&door=1&result=Granted&from=2026-01-01&to=2026-12-31&limit=100&offset=0
router.get('/', requireApiKey, async (req, res) => {
  try {
    const {
      controller,    // controller SN
      door,          // door number
      result,        // access result (Granted, Denied, Alarm, System)
      from,          // date from (ISO string)
      to,            // date to (ISO string)
      limit = 50,
      offset = 0,
    } = req.query;

    // Parse and validate parameters
    const doorNum = door ? parseInt(door) : null;
    const pageLimit = Math.min(parseInt(limit) || 50, 500); // Cap at 500
    const pageOffset = parseInt(offset) || 0;

    const dateFrom = from ? new Date(from) : null;
    const dateTo = to ? new Date(to) : null;

    // Validate date range
    if (dateFrom && isNaN(dateFrom.getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid from date (use ISO format)' });
    }
    if (dateTo && isNaN(dateTo.getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid to date (use ISO format)' });
    }

    // Query events
    const events = await scanEventsRepo.listEvents({
      controllerSn: controller,
      doorNum: doorNum,
      accessResult: result,
      dateFrom: dateFrom,
      dateTo: dateTo,
      limit: pageLimit,
      offset: pageOffset,
    });

    // Count total
    const total = await scanEventsRepo.countEvents({
      controllerSn: controller,
      doorNum: doorNum,
      accessResult: result,
      dateFrom: dateFrom,
      dateTo: dateTo,
    });

    res.json({
      ok: true,
      events,
      pagination: {
        total,
        limit: pageLimit,
        offset: pageOffset,
        hasMore: pageOffset + pageLimit < total,
      },
    });
  } catch (err) {
    console.error('[Events API] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch events' });
  }
});

// GET /api/events/stats — quick statistics for events
router.get('/stats', requireApiKey, async (req, res) => {
  try {
    const stats = await scanEventsRepo.getEventStats();
    res.json({ ok: true, stats });
  } catch (err) {
    console.error('[Events API] Stats error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch stats' });
  }
});

// GET /api/events/by-controller/:sn — events for a specific controller
router.get('/by-controller/:sn', requireApiKey, async (req, res) => {
  try {
    const { sn } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const events = await scanEventsRepo.listEvents({
      controllerSn: sn,
      limit: Math.min(parseInt(limit) || 50, 500),
      offset: parseInt(offset) || 0,
    });

    const total = await scanEventsRepo.countEvents({
      controllerSn: sn,
    });

    res.json({
      ok: true,
      controller: sn,
      events,
      total,
    });
  } catch (err) {
    console.error('[Events API] Controller events error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch controller events' });
  }
});

module.exports = router;
