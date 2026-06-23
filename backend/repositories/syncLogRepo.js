/**
 * syncLogRepo.js — CRUD for cybertowers.sync_log
 *
 * The Bridge writes to this table via PATCH /internal/bridge/sync/:id/complete
 * and PATCH /internal/bridge/sync/:id/fail.
 * The Express backend also creates rows when a sync pass begins.
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

/**
 * Create a new sync log row when a sync pass starts.
 * Returns the new row including the generated UUID.
 */
async function createSyncLog({ controllerId, syncType, recTypeIndex }) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.sync_log
      (controller_id, sync_type, rec_type_index, status, started_at)
    VALUES ($1, $2, $3, 'Running', NOW())
    RETURNING *
  `, [controllerId, syncType || 'Scheduled', recTypeIndex]);
  return rows[0];
}

/**
 * Mark a sync log row as completed successfully.
 */
async function completeSyncLog(syncLogId, { inserted, duplicates, pulled }) {
  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.sync_log SET
      status          = 'Success',
      pulled_count    = COALESCE($2, pulled_count),
      inserted_count  = $3,
      duplicate_count = $4,
      completed_at    = NOW(),
      updated_at      = NOW()
    WHERE id = $1
    RETURNING *
  `, [syncLogId, pulled || null, inserted || 0, duplicates || 0]);
  return rows[0] || null;
}

/**
 * Mark a sync log row as failed.
 */
async function failSyncLog(syncLogId, { error, retryAt }) {
  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.sync_log SET
      status        = 'Failed',
      error_message = $2,
      retry_count   = retry_count + 1,
      next_retry_at = $3,
      completed_at  = NOW(),
      updated_at    = NOW()
    WHERE id = $1
    RETURNING *
  `, [syncLogId, error || 'Unknown error', retryAt || null]);
  return rows[0] || null;
}

/**
 * Return the most recent successful sync for a given controller + recTypeIndex.
 * Used by the Bridge to calculate the time window for the next historical pull.
 */
async function getLastSuccessfulSync(controllerId, recTypeIndex) {
  const { rows } = await pgQuery(`
    SELECT * FROM ${SCHEMA}.sync_log
    WHERE controller_id  = $1
      AND rec_type_index = $2
      AND status         = 'Success'
    ORDER BY completed_at DESC
    LIMIT 1
  `, [controllerId, recTypeIndex]);
  return rows[0] || null;
}

/**
 * Return failed sync rows that are eligible for retry.
 */
async function getFailedSyncsForRetry(maxRetries = 3) {
  const { rows } = await pgQuery(`
    SELECT * FROM ${SCHEMA}.sync_log
    WHERE status       = 'Failed'
      AND retry_count  < $1
      AND next_retry_at <= NOW()
    ORDER BY next_retry_at
  `, [maxRetries]);
  return rows;
}

/**
 * Return recent sync log rows (for the admin / status page).
 */
async function getRecentSyncLogs({ limit = 50, controllerId } = {}) {
  const params = [limit];
  let filter = '';
  if (controllerId) {
    params.push(controllerId);
    filter = `AND sl.controller_id = $${params.length}`;
  }
  const { rows } = await pgQuery(`
    SELECT
      sl.*,
      c.sn AS controller_sn, c.location_label
    FROM ${SCHEMA}.sync_log sl
    JOIN ${SCHEMA}.controllers c ON c.id = sl.controller_id
    WHERE 1=1 ${filter}
    ORDER BY sl.started_at DESC
    LIMIT $1
  `, params);
  return rows;
}

module.exports = {
  createSyncLog,
  completeSyncLog,
  failSyncLog,
  getLastSuccessfulSync,
  getFailedSyncsForRetry,
  getRecentSyncLogs,
};
