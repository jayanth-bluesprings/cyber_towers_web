/**
 * /api/cards — Card management routes
 * Mounted with requireApiKey at server level.
 */

const express = require('express');
const router  = express.Router();

const {
  getCardById,
  listCards,
  createCard,
  updateCard,
  assignUser,
  bulkUpdateStatus,
  deleteCard,
  getCardsByUserId,
} = require('../repositories/cardsRepo');
const { getUserById }         = require('../repositories/usersRepo');
const { getGroupControllerIds } = require('../repositories/accessGroupsRepo');
const { pgQuery }             = require('../pgdb');

// Returns controllers scoped to the card's access group, or ALL active controllers as fallback.
async function getScopedControllers(card) {
  const { getActiveControllers } = require('../repositories/controllersRepo');
  const allActive = await getActiveControllers();
  if (!card.access_group_id) return allActive;

  const scopedIds = await getGroupControllerIds(card.access_group_id);
  if (!scopedIds.length) return allActive; // group has no assignments yet — fallback

  const scoped = allActive.filter(c => scopedIds.includes(c.id));
  return scoped.length ? scoped : allActive; // extra safety fallback
}

const SCHEMA = 'cybertowers';

// ── Audit helper ─────────────────────────────────────────────────────────────
async function audit(action, cardId, details, req) {
  try {
    await pgQuery(`
      INSERT INTO ${SCHEMA}.audit_log (table_name, record_id, action, changed_by, details)
      VALUES ('cards', $1, $2, $3, $4)
    `, [cardId, action, req.ip || 'api', JSON.stringify(details)]);
  } catch (_) { /* non-fatal */ }
}

// ── Validation ───────────────────────────────────────────────────────────────
const VALID_STATUSES    = ['Active', 'Suspended', 'Expired', 'Deleted'];
const VALID_CARD_TYPES  = ['Normal', 'FirstCard', 'AlwaysOpen', 'Patrol', 'AntiTheft'];
const VALID_VEHICLE_TYPES = ['2W', '4W', 'LMV', 'HMV', 'Other'];

function validate(body, requireCardNo = true) {
  const errors = [];
  if (requireCardNo && !body.cardNo) errors.push('cardNo is required');
  if (body.cardStatus  && !VALID_STATUSES.includes(body.cardStatus))
    errors.push(`cardStatus must be one of: ${VALID_STATUSES.join(', ')}`);
  if (body.cardType    && !VALID_CARD_TYPES.includes(body.cardType))
    errors.push(`cardType must be one of: ${VALID_CARD_TYPES.join(', ')}`);
  if (body.validFrom   && isNaN(Date.parse(body.validFrom)))  errors.push('validFrom must be a valid ISO date');
  if (body.validUntil  && isNaN(Date.parse(body.validUntil))) errors.push('validUntil must be a valid ISO date');
  return errors;
}

// ── GET /api/cards ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      search, companyId, status, vehicleType, accessGroupId,
      assignedUserId, validOnly,
      page = 1, limit = 50,
    } = req.query;

    const p   = Math.max(1, parseInt(page)  || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));

    const { cards, total } = await listCards({
      search,
      companyId,
      status,
      vehicleType,
      accessGroupId,
      assignedUserId,
      validOnly: validOnly === 'true',
      limit: lim,
      offset: (p - 1) * lim,
    });

    res.json({
      success: true,
      data: cards,
      total,
      page: p,
      limit: lim,
      totalPages: Math.ceil(total / lim) || 1,
    });
  } catch (err) {
    console.error('[cards] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/cards/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const card = await getCardById(req.params.id);
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });
    res.json({ success: true, data: card });
  } catch (err) {
    console.error('[cards] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/cards/bulk ─────────────────────────────────────────────────────
// Body: { cards: [ { cardNo, personName, ... }, ... ] }
// Returns per-row results so the UI can show success/failure per row.
router.post('/bulk', async (req, res) => {
  const rows = req.body?.cards;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ success: false, error: 'cards array is required and must not be empty' });
  if (rows.length > 500)
    return res.status(400).json({ success: false, error: 'Maximum 500 records per bulk upload' });

  const results = [];

  for (const [idx, row] of rows.entries()) {
    const rowNum = idx + 2; // 1-based + header row
    const errors = validate(row, true);
    if (errors.length) {
      results.push({ row: rowNum, cardNo: row.cardNo || '', status: 'error', error: errors.join('; ') });
      continue;
    }

    try {
      const { rows: dup } = await pgQuery(
        `SELECT id FROM ${SCHEMA}.cards WHERE card_no = $1 AND deleted_at IS NULL`,
        [row.cardNo]
      );
      if (dup.length) {
        results.push({ row: rowNum, cardNo: row.cardNo, status: 'skipped', error: 'Card ID already exists' });
        continue;
      }

      await createCard({
        cardNo:        row.cardNo,
        personName:    row.personName    || null,
        personCode:    row.personCode    || null,
        department:    row.department    || null,
        vehicleNumber: row.vehicleNumber || null,
        vehicleType:   row.vehicleType   || null,
        vehicleBrand:  row.vehicleBrand  || null,
        vehicleColor:  row.vehicleColor  || null,
        cardType:      row.cardType      || 'Normal',
        cardStatus:    'Active',
        bloodGroup:    row.bloodGroup    || null,
        validFrom:     row.validFrom     || null,
        validUntil:    row.validUntil    || null,
        notes:         row.notes         || null,
      });

      results.push({ row: rowNum, cardNo: row.cardNo, status: 'created' });
    } catch (err) {
      results.push({ row: rowNum, cardNo: row.cardNo || '', status: 'error', error: err.message });
    }
  }

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed  = results.filter(r => r.status === 'error').length;

  res.json({ success: true, summary: { total: rows.length, created, skipped, failed }, results });
});

// ── POST /api/cards ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const body   = req.body;
    const errors = validate(body, true);
    if (errors.length) return res.status(400).json({ success: false, errors });

    // Duplicate card_no check
    const { rows: dup } = await pgQuery(
      `SELECT id FROM ${SCHEMA}.cards WHERE card_no = $1 AND deleted_at IS NULL`,
      [body.cardNo]
    );
    if (dup.length) return res.status(409).json({ success: false, error: `Card number "${body.cardNo}" already exists` });

    const card = await createCard({
      cardNo:        body.cardNo,
      personName:    body.personName    || null,
      personCode:    body.personCode    || null,
      companyId:     body.companyId     || null,
      department:    body.department    || null,
      vehicleNumber: body.vehicleNumber || null,
      vehicleType:   body.vehicleType   || null,
      vehicleBrand:  body.vehicleBrand  || null,
      vehicleColor:  body.vehicleColor  || null,
      cardType:      body.cardType      || 'Normal',
      cardStatus:    body.cardStatus    || 'Active',
      accessGroupId: body.accessGroupId || null,
      assignedUserId:body.assignedUserId|| null,
      validFrom:     body.validFrom     || null,
      validUntil:    body.validUntil    || null,
      notes:         body.notes         || null,
      bloodGroup:    body.bloodGroup    || null,
      photoUrl:      body.photoUrl      || null,
      photoData:     body.photoData     || null,
    });

    await audit('CREATE', card.id, { cardNo: card.card_no, personName: card.person_name }, req);
    res.status(201).json({ success: true, data: card });
  } catch (err) {
    console.error('[cards] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/cards/:id ─────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const existing = await getCardById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Card not found' });

    const errors = validate(req.body, false);
    if (errors.length) return res.status(400).json({ success: false, errors });

    const card = await updateCard(req.params.id, {
      personName:    req.body.personName,
      personCode:    req.body.personCode,
      companyId:     req.body.companyId,
      department:    req.body.department,
      vehicleNumber: req.body.vehicleNumber,
      vehicleType:   req.body.vehicleType,
      cardType:      req.body.cardType,
      cardStatus:    req.body.cardStatus,
      accessGroupId: req.body.accessGroupId,
      assignedUserId:req.body.assignedUserId,
      validFrom:     req.body.validFrom,
      validUntil:    req.body.validUntil,
      notes:         req.body.notes,
      bloodGroup:    req.body.bloodGroup,
      vehicleBrand:  req.body.vehicleBrand,
      vehicleColor:  req.body.vehicleColor,
      photoUrl:      req.body.photoUrl,
      photoData:     req.body.photoData,
    });

    await audit('UPDATE', req.params.id, req.body, req);
    res.json({ success: true, data: card });
  } catch (err) {
    console.error('[cards] PATCH /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/cards/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getCardById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Card not found' });

    const ok = await deleteCard(req.params.id);
    if (!ok) return res.status(500).json({ success: false, error: 'Delete failed' });

    await audit('DELETE', req.params.id, { cardNo: existing.card_no }, req);
    res.json({ success: true, message: `Card ${existing.card_no} deleted` });
  } catch (err) {
    console.error('[cards] DELETE /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/cards/:id/assign ──────────────────────────────────────────────
router.patch('/:id/assign', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

    const existing = await getCardById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Card not found' });

    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const card = await assignUser(req.params.id, userId);
    await audit('ASSIGN', req.params.id, { userId, userName: user.name }, req);
    res.json({ success: true, data: card });
  } catch (err) {
    console.error('[cards] PATCH /:id/assign error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/cards/:id/unassign ────────────────────────────────────────────
router.patch('/:id/unassign', async (req, res) => {
  try {
    const existing = await getCardById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Card not found' });

    const card = await assignUser(req.params.id, null);
    await audit('UNASSIGN', req.params.id, { cardNo: existing.card_no }, req);
    res.json({ success: true, data: card });
  } catch (err) {
    console.error('[cards] PATCH /:id/unassign error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/cards/bulk-status ──────────────────────────────────────────────
router.post('/bulk-status', async (req, res) => {
  try {
    const { ids, cardStatus } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ success: false, error: 'ids array is required' });
    if (!VALID_STATUSES.includes(cardStatus))
      return res.status(400).json({ success: false, error: `cardStatus must be one of: ${VALID_STATUSES.join(', ')}` });

    const count = await bulkUpdateStatus(ids, cardStatus);
    await audit('BULK_STATUS', null, { ids, cardStatus, count }, req);
    res.json({ success: true, updated: count });
  } catch (err) {
    console.error('[cards] POST /bulk-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/cards/push-all  (MUST be before /:id routes) ───────────────────
// Queues ALL active cards that are not already Synced for a push.
// Returns immediately; Bridge picks up via /internal/bridge/cards/pending-push.
router.post('/push-all', async (req, res) => {
  try {
    const { pgQuery }            = require('../pgdb');
    const { getActiveControllers } = require('../repositories/controllersRepo');

    const allControllers = await getActiveControllers();
    if (!allControllers.length)
      return res.status(409).json({ success: false, error: 'No active controllers configured' });

    // Reset push_status to Pending for all Active cards not already Synced
    await pgQuery(`
      UPDATE ${SCHEMA}.cards
      SET push_status = 'Pending', push_error = NULL, updated_at = NOW()
      WHERE card_status = 'Active'
        AND deleted_at IS NULL
        AND (push_status IS NULL OR push_status NOT IN ('Synced'))
    `);

    const { rows: pendingCards } = await pgQuery(`
      SELECT id, card_no, access_group_id FROM ${SCHEMA}.cards
      WHERE card_status = 'Active' AND deleted_at IS NULL AND push_status = 'Pending'
    `);

    let logsCreated = 0;
    for (const card of pendingCards) {
      // Scope to access group controllers if assigned
      let controllers = allControllers;
      if (card.access_group_id) {
        const scopedIds = await getGroupControllerIds(card.access_group_id);
        if (scopedIds.length) {
          const scoped = allControllers.filter(c => scopedIds.includes(c.id));
          if (scoped.length) controllers = scoped;
        }
      }
      for (const ctrl of controllers) {
        const { rows: existing } = await pgQuery(`
          SELECT id FROM ${SCHEMA}.card_push_log
          WHERE card_id = $1 AND controller_id = $2 AND operation = 'push' AND status = 'Pending'
          LIMIT 1
        `, [card.id, ctrl.id]);
        if (!existing.length) {
          await pgQuery(`
            INSERT INTO ${SCHEMA}.card_push_log
              (card_id, controller_id, card_no, controller_sn, operation, status, attempts)
            VALUES ($1,$2,$3,$4,'push','Pending',0)
          `, [card.id, ctrl.id, card.card_no, ctrl.sn]);
          logsCreated++;
        }
      }
    }

    const broadcast = req.app.locals.broadcast;
    if (broadcast) {
      broadcast({ type: 'card_push_all_queued', data: { cards: pendingCards.length, controllers: controllers.length } });
    }

    await audit('PUSH_ALL', null, { cards: pendingCards.length, controllers: controllers.length, logs: logsCreated }, req);
    res.json({ success: true, queued: pendingCards.length, controllers: controllers.length, logsCreated });
  } catch (err) {
    console.error('[cards] push-all error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/cards/:id/push-to-controller ───────────────────────────────────
// Initiates a WriteCardMain + ReadCardMain cycle for one card across all active
// controllers.  The actual SDK call happens inside the Bridge Service; Express
// creates the card_push_log rows and tells the Bridge what to do.
router.post('/:id/push-to-controller', async (req, res) => {
  try {
    const card = await getCardById(req.params.id);
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });
    if (card.card_status === 'Deleted')
      return res.status(400).json({ success: false, error: 'Cannot push a deleted card' });

    const { pgQuery } = require('../pgdb');
    const controllers = await getScopedControllers(card);

    if (!controllers.length)
      return res.status(409).json({ success: false, error: 'No active controllers configured' });

    // Create a push-log row for each controller
    const logRows = [];
    for (const ctrl of controllers) {
      const { rows } = await pgQuery(`
        INSERT INTO ${SCHEMA}.card_push_log
          (card_id, controller_id, card_no, controller_sn, operation, status, attempts)
        VALUES ($1, $2, $3, $4, 'push', 'Pending', 0)
        RETURNING *
      `, [card.id, ctrl.id, card.card_no, ctrl.sn]);
      logRows.push(rows[0]);
    }

    // Mark card as Pending
    await pgQuery(`
      UPDATE ${SCHEMA}.cards
      SET push_status = 'Pending', push_error = NULL, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
    `, [card.id]);

    // Tell the Bridge via WebSocket broadcast
    const broadcast = req.app.locals.broadcast;
    if (broadcast) {
      broadcast({
        type: 'card_push_command',
        data: {
          operation:   'push',
          card: {
            id:         card.id,
            cardNo:     card.card_no,
            personName: card.person_name,
            cardType:   card.card_type,
            validFrom:  card.valid_from,
            validUntil: card.valid_until,
          },
          controllers: controllers.map((c, i) => ({
            id:           c.id,
            sn:           c.sn,
            ipAddress:    c.ip_address,
            tcpPort:      c.tcp_port,
            pushLogId:    logRows[i]?.id,
          })),
        },
      });
    }

    await audit('PUSH', card.id, { controllers: controllers.map(c => c.sn) }, req);
    res.json({ success: true, pushLogs: logRows, controllers: controllers.length });
  } catch (err) {
    console.error('[cards] push-to-controller error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/cards/:id/remove-from-controllers ──────────────────────────────
// Queues a DelCardMain job for one card across all active controllers.
// Bridge picks it up via GET /internal/bridge/cards/pending-remove.
router.post('/:id/remove-from-controllers', async (req, res) => {
  try {
    const card = await getCardById(req.params.id);
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });

    const { pgQuery } = require('../pgdb');
    const controllers = await getScopedControllers(card);

    if (!controllers.length)
      return res.status(409).json({ success: false, error: 'No active controllers configured' });

    const logRows = [];
    for (const ctrl of controllers) {
      const { rows } = await pgQuery(`
        INSERT INTO ${SCHEMA}.card_push_log
          (card_id, controller_id, card_no, controller_sn, operation, status, attempts)
        VALUES ($1, $2, $3, $4, 'remove', 'Pending', 0)
        RETURNING *
      `, [card.id, ctrl.id, card.card_no, ctrl.sn]);
      logRows.push(rows[0]);
    }

    // Mark card as PendingRemoval
    await pgQuery(`
      UPDATE ${SCHEMA}.cards
      SET push_status = 'PendingRemoval', push_error = NULL, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
    `, [card.id]);

    const broadcast = req.app.locals.broadcast;
    if (broadcast) {
      broadcast({
        type: 'card_remove_queued',
        data: {
          cardId:      card.id,
          cardNo:      card.card_no,
          controllers: controllers.length,
        },
      });
    }

    await audit('REMOVE_FROM_CONTROLLERS', card.id, { controllers: controllers.map(c => c.sn) }, req);
    res.json({ success: true, removeLogs: logRows, controllers: controllers.length });
  } catch (err) {
    console.error('[cards] remove-from-controllers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/cards/:id/push-status ──────────────────────────────────────────
router.get('/:id/push-status', async (req, res) => {
  try {
    const card = await getCardById(req.params.id);
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });

    const { pgQuery } = require('../pgdb');
    const { rows: logs } = await pgQuery(`
      SELECT
        cpl.*,
        co.location_label, co.sn AS ctrl_sn
      FROM ${SCHEMA}.card_push_log cpl
      JOIN ${SCHEMA}.controllers co ON co.id = cpl.controller_id
      WHERE cpl.card_id = $1
      ORDER BY cpl.started_at DESC
      LIMIT 20
    `, [card.id]);

    res.json({
      success: true,
      pushStatus:  card.push_status,
      lastPushedAt: card.last_pushed_at,
      pushError:   card.push_error,
      logs,
    });
  } catch (err) {
    console.error('[cards] push-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/users/:userId/cards ─────────────────────────────────────────────
// NOTE: This is mounted on the cards router but uses a userId param.
// Register separately in server.js as: app.use('/api/users', requireApiKey, userCardRoutes)
// OR call it via /api/cards?assignedUserId=:userId (already supported above).
// We export a helper for server.js to wire up the path directly:
router._getUserCards = async (req, res) => {
  try {
    const user = await getUserById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const cards = await getCardsByUserId(req.params.userId);
    res.json({ success: true, data: cards, total: cards.length });
  } catch (err) {
    console.error('[cards] GET /users/:userId/cards error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = router;
