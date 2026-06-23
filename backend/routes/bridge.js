/**
 * Bridge routes — called by the CyberTowers Windows Bridge Service (localhost only).
 * No API-key auth: these are internal-only routes, never exposed to the browser.
 *
 * All routes are mounted at /internal/bridge/
 */

const express = require('express');
const router  = express.Router();

const controllersRepo      = require('../repositories/controllersRepo');
const controllerStatusRepo = require('../repositories/controllerStatusRepo');
const syncLogRepo          = require('../repositories/syncLogRepo');
const scanEventsRepo       = require('../repositories/scanEventsRepo');
const alertsRepo           = require('../repositories/alertsRepo');
const { getGroupControllerIds } = require('../repositories/accessGroupsRepo');

// broadcast is injected at registration time via router.locals
// (see server.js where we call: bridgeRouter.locals.broadcast = broadcast)

// ── POST /internal/bridge/events ─────────────────────────────────────────────
// Single live event from the controller.
router.post('/events', async (req, res) => {
  const event = req.body;
  if (!event || !event.controllerSn) {
    return res.status(400).json({ ok: false, error: 'Missing controllerSn' });
  }
  try {
    const row = await scanEventsRepo.insertEvent(event);

    if (event.isAlert && event.alertSeverity) {
      const alert = await alertsRepo.createAlert({
        scanEventId:   row?.id         || null,
        scanEventDate: event.eventDate || new Date(),
        controllerSn:  event.controllerSn,
        severity:      event.alertSeverity,
        eventCode:     event.eventCode || '',
        cardNo:        event.cardNo    || null,
        locationLabel: null,
      });
      const { broadcast } = req.app.locals;
      if (broadcast) broadcast({ type: 'bridge_alert', data: alert });
    }

    const { broadcast } = req.app.locals;
    if (broadcast) {
      // Broadcast the full enriched row so the frontend has person_name, vehicle_number, location_label
      broadcast({ type: 'bridge_event', data: row });
    }

    console.log(`[Bridge] Live event — controller=${event.controllerSn} card=${event.cardNo || '-'} result=${event.accessResult}`);

    // Trigger WF1 for approved entry scans — fire-and-forget, never blocks the response
    if (event.accessResult === 'Approved' && event.portNum === 1 && event.cardNo) {
      try {
        const { triggerWF1 } = require('../../temporal/lib/client');
        triggerWF1({
          cardId:        String(event.cardNo),
          vehicleNumber: event.vehicleNumber || event.cardNo || '',
          gate:          event.locationLabel || `Controller-${event.controllerSn}`,
          timestamp:     event.eventDate     || new Date().toISOString(),
          portNum:       1,
        }).catch(err => console.warn('[Bridge] WF1 trigger failed (non-fatal):', err.message));
      } catch (_) {
        // temporal/lib not compiled yet — worker not running, skip silently
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Bridge] Failed to insert event:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error storing event' });
  }
});

// ── POST /internal/bridge/events/batch ───────────────────────────────────────
// Batch of historical events from getRecord() sync pass.
// Body: { controllerSn, events: EventIngestDto[] }
router.post('/events/batch', async (req, res) => {
  const { controllerSn, events } = req.body;
  if (!controllerSn || !Array.isArray(events)) {
    return res.status(400).json({ ok: false, error: 'Missing controllerSn or events array' });
  }
  try {
    const { inserted, duplicates } = await scanEventsRepo.insertEventBatch(controllerSn, events);
    const { broadcast } = req.app.locals;
    if (broadcast) broadcast({ type: 'bridge_sync', data: { controllerSn, inserted, duplicates } });
    console.log(`[Bridge] Batch — controller=${controllerSn} total=${events.length} inserted=${inserted} dup=${duplicates}`);
    res.json({ ok: true, inserted, duplicates });
  } catch (err) {
    console.error('[Bridge] Failed to insert batch:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error storing batch' });
  }
});

// ── PATCH /internal/bridge/controller-status ─────────────────────────────────
// Controller heartbeat from the Bridge.
// Body: ControllerStatusUpdateDto { sn, isOnline, lastHeartbeatAt, consecutiveFailures, updatedAt }
router.patch('/controller-status', async (req, res) => {
  const body = req.body;
  if (!body || !body.sn) {
    return res.status(400).json({ ok: false, error: 'Missing sn' });
  }
  try {
    await controllerStatusRepo.upsertStatusBySn({
      sn:                  body.sn,
      isOnline:            body.isOnline            ?? true,
      lastHeartbeatAt:     body.lastHeartbeatAt      || body.updatedAt || new Date(),
      consecutiveFailures: body.consecutiveFailures  || 0,
    });
    const { broadcast } = req.app.locals;
    if (broadcast) broadcast({ type: 'controller_status', data: body });
    console.log(`[Bridge] Status — sn=${body.sn} online=${body.isOnline} failures=${body.consecutiveFailures}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Bridge] Failed to upsert controller status:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error updating status' });
  }
});

// ── GET /internal/bridge/controllers ─────────────────────────────────────────
// Bridge requests the list of controllers to connect to at startup.
router.get('/controllers', async (req, res) => {
  try {
    const controllers = await controllersRepo.getActiveControllers();
    console.log(`[Bridge] Controller list — ${controllers.length} active controller(s)`);
    res.json({ data: controllers });
  } catch (err) {
    console.error('[Bridge] Failed to fetch controllers:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error fetching controllers' });
  }
});

// ── POST /internal/bridge/controllers/discovered ─────────────────────────────
// Bridge found a controller via UDP discovery.
router.post('/controllers/discovered', async (req, res) => {
  const body = req.body;
  if (!body || !body.sn) {
    return res.status(400).json({ ok: false, error: 'Missing sn' });
  }
  try {
    const row = await controllersRepo.upsertDiscoveredController({
      sn:            body.sn,
      ipAddress:     body.ipAddress,
      tcpPort:       body.tcpPort       || 8000,
      udpPort:       body.udpPort       || 8101,
      locationLabel: body.locationLabel || null,
      companyId:     body.companyId     || null,
    });
    const { broadcast } = req.app.locals;
    if (broadcast) broadcast({ type: 'controller_discovered', data: row });
    console.log(`[Bridge] Discovered — sn=${body.sn} ip=${body.ipAddress}`);
    res.json({ ok: true, ...row });
  } catch (err) {
    console.error('[Bridge] Failed to upsert discovered controller:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error registering controller' });
  }
});

// ── POST /internal/bridge/sync ───────────────────────────────────────────────
// Bridge creates a sync log row when a historical getRecord() pass begins.
// Body: { controllerId, syncType, recTypeIndex }
router.post('/sync', async (req, res) => {
  const { controllerId, syncType, recTypeIndex } = req.body;
  if (!controllerId) return res.status(400).json({ ok: false, error: 'Missing controllerId' });
  try {
    const row = await syncLogRepo.createSyncLog({ controllerId, syncType, recTypeIndex });
    res.json({ ok: true, syncLogId: row.id, syncLog: row });
  } catch (err) {
    console.error('[Bridge] Failed to create sync log:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /internal/bridge/sync/:syncLogId/complete ──────────────────────────
router.patch('/sync/:syncLogId/complete', async (req, res) => {
  const { syncLogId } = req.params;
  const { inserted = 0, duplicates = 0, pulled } = req.body;
  try {
    const row = await syncLogRepo.completeSyncLog(syncLogId, { inserted, duplicates, pulled });
    console.log(`[Bridge] Sync complete — id=${syncLogId} inserted=${inserted} dup=${duplicates}`);
    res.json({ ok: true, syncLog: row });
  } catch (err) {
    console.error('[Bridge] Failed to complete sync log:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error completing sync log' });
  }
});

// ── PATCH /internal/bridge/sync/:syncLogId/fail ──────────────────────────────
router.patch('/sync/:syncLogId/fail', async (req, res) => {
  const { syncLogId } = req.params;
  const { error, retryAt } = req.body;
  try {
    const row = await syncLogRepo.failSyncLog(syncLogId, { error, retryAt });
    console.log(`[Bridge] Sync failed — id=${syncLogId} error=${error}`);
    res.json({ ok: true, syncLog: row });
  } catch (err) {
    console.error('[Bridge] Failed to fail sync log:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error failing sync log' });
  }
});

// ── POST /internal/bridge/cards/push ─────────────────────────────────────────
// Bridge calls this after completing WriteCardMain() + ReadCardMain() verify.
// Body: CardPushResultDto
// {
//   pushLogId:      string (UUID from card_push_log)
//   cardId:         string (UUID)
//   cardNo:         string
//   controllerSn:   string
//   success:        bool
//   attempts:       number
//   verifiedByRead: bool
//   errorMessage?:  string
// }
router.post('/cards/push', async (req, res) => {
  const body = req.body;
  if (!body || !body.cardId || !body.controllerSn) {
    return res.status(400).json({ ok: false, error: 'Missing cardId or controllerSn' });
  }
  try {
    const { pgQuery } = require('../pgdb');
    const SCHEMA = 'cybertowers';

    const now = new Date().toISOString();

    if (body.pushLogId) {
      await pgQuery(`
        UPDATE ${SCHEMA}.card_push_log
        SET status       = $2,
            attempts     = $3,
            error_message = $4,
            completed_at  = $5
        WHERE id = $1
      `, [
        body.pushLogId,
        body.success ? 'Success' : 'Failed',
        body.attempts || 1,
        body.errorMessage || null,
        now,
      ]);
    }

    if (body.success) {
      // Update the card's push_status based on aggregate across all controllers
      const { rows: failedRows } = await pgQuery(`
        SELECT COUNT(*) AS cnt
        FROM ${SCHEMA}.card_push_log
        WHERE card_id = $1
          AND operation = 'push'
          AND status = 'Failed'
          AND completed_at >= NOW() - INTERVAL '10 minutes'
      `, [body.cardId]);

      const hasFailed = parseInt(failedRows[0]?.cnt || 0) > 0;

      await pgQuery(`
        UPDATE ${SCHEMA}.cards
        SET push_status    = $2,
            last_pushed_at = $3,
            push_error     = $4,
            updated_at     = NOW()
        WHERE id = $1 AND deleted_at IS NULL
      `, [
        body.cardId,
        hasFailed ? 'PartialFail' : 'Synced',
        now,
        null,
      ]);
    } else {
      await pgQuery(`
        UPDATE ${SCHEMA}.cards
        SET push_status = 'Failed',
            push_error  = $2,
            updated_at  = NOW()
        WHERE id = $1 AND deleted_at IS NULL
      `, [body.cardId, body.errorMessage || 'Push failed']);
    }

    const { broadcast } = req.app.locals;
    if (broadcast) {
      broadcast({
        type: 'card_push_result',
        data: {
          cardId:       body.cardId,
          cardNo:       body.cardNo,
          controllerSn: body.controllerSn,
          success:      body.success,
          attempts:     body.attempts,
          pushLogId:    body.pushLogId,
        },
      });
    }

    console.log(`[Bridge] Card push — card=${body.cardNo} ctrl=${body.controllerSn} ok=${body.success} attempts=${body.attempts}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Bridge] card push callback error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /internal/bridge/cards/remove ─────────────────────────────────────
// Bridge calls this after completing DelCardMain().
// Body: { pushLogId, cardId, cardNo, controllerSn, success, attempts, errorMessage }
router.delete('/cards/remove', async (req, res) => {
  const body = req.body;
  if (!body || !body.cardId || !body.controllerSn) {
    return res.status(400).json({ ok: false, error: 'Missing cardId or controllerSn' });
  }
  try {
    const { pgQuery } = require('../pgdb');
    const SCHEMA = 'cybertowers';
    const now = new Date().toISOString();

    if (body.pushLogId) {
      await pgQuery(`
        UPDATE ${SCHEMA}.card_push_log
        SET status        = $2,
            attempts      = $3,
            error_message = $4,
            completed_at  = $5
        WHERE id = $1
      `, [
        body.pushLogId,
        body.success ? 'Success' : 'Failed',
        body.attempts || 1,
        body.errorMessage || null,
        now,
      ]);
    }

    if (body.success) {
      await pgQuery(`
        UPDATE ${SCHEMA}.cards
        SET push_status    = 'Removed',
            last_pushed_at = $2,
            push_error     = NULL,
            updated_at     = NOW()
        WHERE id = $1 AND deleted_at IS NULL
      `, [body.cardId, now]);
    }

    const { broadcast } = req.app.locals;
    if (broadcast) {
      broadcast({
        type: 'card_remove_result',
        data: {
          cardId:       body.cardId,
          cardNo:       body.cardNo,
          controllerSn: body.controllerSn,
          success:      body.success,
          attempts:     body.attempts,
          pushLogId:    body.pushLogId,
          errorMessage: body.errorMessage || null,
        },
      });
    }

    console.log(`[Bridge] Card remove — card=${body.cardNo} ctrl=${body.controllerSn} ok=${body.success}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Bridge] card remove callback error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /internal/bridge/cards/pending-remove ────────────────────────────────
// Bridge polls this to get cards queued for removal via DelCardMain().
router.get('/cards/pending-remove', async (req, res) => {
  try {
    const { pgQuery } = require('../pgdb');
    const SCHEMA = 'cybertowers';

    const { rows } = await pgQuery(`
      SELECT
        cpl.id AS push_log_id,
        cpl.card_id, cpl.card_no, cpl.controller_sn,
        cpl.controller_id, cpl.attempts,
        c.person_name, c.card_type
      FROM ${SCHEMA}.card_push_log cpl
      JOIN ${SCHEMA}.cards c ON c.id = cpl.card_id
      WHERE cpl.operation = 'remove'
        AND cpl.status = 'Pending'
        AND c.deleted_at IS NULL
      ORDER BY cpl.created_at ASC
      LIMIT 200
    `);

    const activeControllers = await require('../repositories/controllersRepo').getActiveControllers();
    res.json({ ok: true, removeJobs: rows, controllers: activeControllers });
  } catch (err) {
    console.error('[Bridge] pending-remove error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /internal/bridge/cards/pending-push ───────────────────────────────────
// Bridge polls this to get cards that need to be written to controllers.
// Returns cards whose push_status != 'Synced' and card_status = 'Active'.
router.get('/cards/pending-push', async (req, res) => {
  try {
    const { pgQuery } = require('../pgdb');
    const SCHEMA = 'cybertowers';

    const { rows } = await pgQuery(`
      SELECT
        c.id, c.card_no, c.person_name, c.person_code,
        c.card_type, c.card_status, c.access_group_id,
        c.valid_from, c.valid_until,
        c.push_status, c.last_pushed_at
      FROM ${SCHEMA}.cards c
      WHERE c.deleted_at IS NULL
        AND c.card_status = 'Active'
        AND (c.push_status IS NULL OR c.push_status IN ('Pending','Failed','PartialFail'))
      ORDER BY c.created_at DESC
      LIMIT 500
    `);

    const activeControllers = await require('../repositories/controllersRepo').getActiveControllers();

    // Attach scoped controller IDs for each card so Bridge pushes only to the right controllers
    const scopeCache = new Map();
    const cardsWithScope = await Promise.all(rows.map(async card => {
      if (!card.access_group_id) return { ...card, scopedControllerIds: null };
      if (!scopeCache.has(card.access_group_id)) {
        const ids = await getGroupControllerIds(card.access_group_id);
        scopeCache.set(card.access_group_id, ids);
      }
      const ids = scopeCache.get(card.access_group_id);
      return { ...card, scopedControllerIds: ids.length ? ids : null };
    }));

    res.json({ ok: true, cards: cardsWithScope, controllers: activeControllers });
  } catch (err) {
    console.error('[Bridge] pending-push error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
