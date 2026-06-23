/**
 * alertsRepo.js — CRUD for cybertowers.alerts
 *
 * Alerts are created whenever the Bridge posts an event with is_alert=true.
 * Dashboard operators acknowledge them.
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

/**
 * Create an alert from an inbound bridge event.
 */
async function createAlert({ scanEventId, scanEventDate, controllerSn, severity,
  eventCode, cardNo, locationLabel }) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.alerts
      (scan_event_id, scan_event_date, controller_sn, severity,
       event_code, card_no, location_label)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    scanEventId   || null,
    scanEventDate || new Date(),
    controllerSn,
    severity      || 'Medium',
    eventCode     || '',
    cardNo        || null,
    locationLabel || null,
  ]);
  return rows[0];
}

/**
 * List active (unacknowledged) alerts, newest first.
 */
async function getActiveAlerts({ limit = 100 } = {}) {
  const { rows } = await pgQuery(`
    SELECT * FROM ${SCHEMA}.alerts
    WHERE is_acknowledged = FALSE
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

/**
 * List all alerts (for history view), paginated.
 */
async function listAlerts({ limit = 50, offset = 0, severity, acknowledged } = {}) {
  const params = [];
  const conditions = [];

  if (severity) {
    params.push(severity);
    conditions.push(`severity = $${params.length}`);
  }
  if (acknowledged != null) {
    params.push(acknowledged);
    conditions.push(`is_acknowledged = $${params.length}`);
  }

  params.push(limit, offset);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pgQuery(`
    SELECT
      a.*,
      u.name AS acknowledged_by_name
    FROM ${SCHEMA}.alerts a
    LEFT JOIN ${SCHEMA}.users u ON u.id = a.acknowledged_by
    ${where}
    ORDER BY a.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return rows;
}

/**
 * Acknowledge an alert. Returns the updated row or null if not found.
 */
async function acknowledgeAlert(id, { userId, notes } = {}) {
  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.alerts SET
      is_acknowledged = TRUE,
      acknowledged_by = $2,
      acknowledged_at = NOW(),
      notes           = COALESCE($3, notes),
      updated_at      = NOW()
    WHERE id = $1 AND is_acknowledged = FALSE
    RETURNING *
  `, [id, userId || null, notes || null]);
  return rows[0] || null;
}

/**
 * Count unacknowledged alerts by severity (for dashboard badge).
 */
async function getUnacknowledgedCounts() {
  const { rows } = await pgQuery(`
    SELECT severity, COUNT(*) AS count
    FROM ${SCHEMA}.alerts
    WHERE is_acknowledged = FALSE
    GROUP BY severity
  `);
  return rows;
}

module.exports = {
  createAlert,
  getActiveAlerts,
  listAlerts,
  acknowledgeAlert,
  getUnacknowledgedCounts,
};
