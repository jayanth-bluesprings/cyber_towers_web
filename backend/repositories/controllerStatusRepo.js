/**
 * controllerStatusRepo.js — Upsert / query for cybertowers.controller_status
 *
 * This table has one row per controller, maintained entirely by the Bridge
 * via PATCH /internal/bridge/controller-status.
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

/**
 * Upsert runtime status for a controller identified by serial number.
 * Resolves the controller UUID from the sn lookup automatically.
 */
async function upsertStatusBySn({ sn, isOnline, lastHeartbeatAt, consecutiveFailures }) {
  // Look up controller id by sn first
  const lookup = await pgQuery(
    `SELECT id FROM ${SCHEMA}.controllers WHERE sn = $1 AND deleted_at IS NULL`,
    [sn]
  );
  if (!lookup.rows.length) return null;

  const controllerId = lookup.rows[0].id;

  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.controller_status
      (controller_id, is_online, last_heartbeat_at, consecutive_failures, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (controller_id) DO UPDATE SET
      is_online            = EXCLUDED.is_online,
      last_heartbeat_at    = EXCLUDED.last_heartbeat_at,
      consecutive_failures = EXCLUDED.consecutive_failures,
      updated_at           = NOW()
    RETURNING *
  `, [
    controllerId,
    isOnline,
    lastHeartbeatAt || null,
    consecutiveFailures || 0,
  ]);

  return rows[0];
}

/**
 * Get status for a single controller by its UUID.
 */
async function getStatusById(controllerId) {
  const { rows } = await pgQuery(
    `SELECT * FROM ${SCHEMA}.controller_status WHERE controller_id = $1`,
    [controllerId]
  );
  return rows[0] || null;
}

/**
 * Get status for all controllers (joined with controller name for display).
 */
async function getAllStatuses() {
  const { rows } = await pgQuery(`
    SELECT
      c.id, c.sn, c.location_label, c.ip_address,
      cs.is_online, cs.last_heartbeat_at, cs.consecutive_failures, cs.updated_at
    FROM ${SCHEMA}.controllers c
    LEFT JOIN ${SCHEMA}.controller_status cs ON cs.controller_id = c.id
    WHERE c.deleted_at IS NULL AND c.is_active = TRUE
    ORDER BY c.location_label
  `);
  return rows;
}

/**
 * Return controllers that have not sent a heartbeat within the last N seconds.
 */
async function getUnresponsiveControllers(timeoutSeconds = 60) {
  const { rows } = await pgQuery(`
    SELECT c.id, c.sn, c.location_label, cs.last_heartbeat_at, cs.consecutive_failures
    FROM ${SCHEMA}.controllers c
    LEFT JOIN ${SCHEMA}.controller_status cs ON cs.controller_id = c.id
    WHERE c.is_active = TRUE AND c.deleted_at IS NULL
      AND (
        cs.is_online = FALSE
        OR cs.last_heartbeat_at < NOW() - ($1 || ' seconds')::interval
        OR cs.last_heartbeat_at IS NULL
      )
  `, [timeoutSeconds]);
  return rows;
}

module.exports = {
  upsertStatusBySn,
  getStatusById,
  getAllStatuses,
  getUnresponsiveControllers,
};
