/**
 * monitoringRepo.js — aggregated metrics for the Bridge Monitoring dashboard (Phase 11)
 *
 * Pulls together controller health, card-push queue, sync activity, alerts and
 * event throughput into a single snapshot the frontend can poll.
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

// Heartbeat older than this ⇒ controller considered stale/offline.
const HEARTBEAT_TIMEOUT_SECONDS = 90;

async function getControllerHealth() {
  const { rows } = await pgQuery(`
    SELECT
      c.id, c.sn, c.location_label, c.ip_address, c.is_active,
      cs.is_online, cs.last_heartbeat_at, cs.consecutive_failures, cs.updated_at AS status_updated_at,
      CASE
        WHEN cs.last_heartbeat_at IS NULL THEN 'unknown'
        WHEN cs.is_online = TRUE
             AND cs.last_heartbeat_at >= NOW() - ($1 || ' seconds')::interval THEN 'online'
        ELSE 'offline'
      END AS health
    FROM ${SCHEMA}.controllers c
    LEFT JOIN ${SCHEMA}.controller_status cs ON cs.controller_id = c.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.location_label NULLS LAST, c.sn
  `, [HEARTBEAT_TIMEOUT_SECONDS]);
  return rows;
}

async function getCardPushQueueStats() {
  const { rows } = await pgQuery(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'Pending')                                              AS pending,
      COUNT(*) FILTER (WHERE status = 'Success' AND completed_at >= NOW() - INTERVAL '24 hours') AS success_24h,
      COUNT(*) FILTER (WHERE status = 'Failed'  AND completed_at >= NOW() - INTERVAL '24 hours') AS failed_24h,
      COUNT(*) FILTER (WHERE operation = 'push'   AND status = 'Pending')                     AS pending_push,
      COUNT(*) FILTER (WHERE operation = 'remove' AND status = 'Pending')                     AS pending_remove,
      COUNT(*)                                                                                AS total_logs
    FROM ${SCHEMA}.card_push_log
  `);
  const r = rows[0] || {};
  return {
    pending:       parseInt(r.pending        || 0),
    success24h:    parseInt(r.success_24h     || 0),
    failed24h:     parseInt(r.failed_24h      || 0),
    pendingPush:   parseInt(r.pending_push    || 0),
    pendingRemove: parseInt(r.pending_remove  || 0),
    totalLogs:     parseInt(r.total_logs      || 0),
  };
}

async function getRecentPushFailures(limit = 10) {
  const { rows } = await pgQuery(`
    SELECT
      cpl.id, cpl.card_no, cpl.controller_sn, cpl.operation,
      cpl.attempts, cpl.error_message, cpl.completed_at,
      co.location_label
    FROM ${SCHEMA}.card_push_log cpl
    LEFT JOIN ${SCHEMA}.controllers co ON co.id = cpl.controller_id
    WHERE cpl.status = 'Failed'
    ORDER BY cpl.completed_at DESC NULLS LAST, cpl.started_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

async function getSyncStats() {
  const { rows } = await pgQuery(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'Running')                                            AS running,
      COUNT(*) FILTER (WHERE status = 'Success' AND completed_at >= NOW() - INTERVAL '24 hours') AS success_24h,
      COUNT(*) FILTER (WHERE status = 'Failed'  AND completed_at >= NOW() - INTERVAL '24 hours') AS failed_24h,
      COALESCE(SUM(inserted_count) FILTER (WHERE completed_at >= NOW() - INTERVAL '24 hours'), 0) AS records_24h,
      MAX(completed_at) FILTER (WHERE status = 'Success')                                   AS last_success_at
    FROM ${SCHEMA}.sync_log
  `);
  const r = rows[0] || {};
  return {
    running:      parseInt(r.running      || 0),
    success24h:   parseInt(r.success_24h   || 0),
    failed24h:    parseInt(r.failed_24h    || 0),
    records24h:   parseInt(r.records_24h   || 0),
    lastSuccessAt: r.last_success_at || null,
  };
}

async function getEventThroughput() {
  const { rows } = await pgQuery(`
    SELECT
      COUNT(*) FILTER (WHERE event_date >= NOW() - INTERVAL '1 hour')   AS last_1h,
      COUNT(*) FILTER (WHERE event_date >= NOW() - INTERVAL '24 hours') AS last_24h,
      MAX(event_date)                                                   AS latest_event_at
    FROM ${SCHEMA}.scan_events
  `);
  const r = rows[0] || {};
  return {
    last1h:        parseInt(r.last_1h  || 0),
    last24h:       parseInt(r.last_24h || 0),
    latestEventAt: r.latest_event_at || null,
  };
}

async function getAlertStats() {
  const { rows } = await pgQuery(`
    SELECT
      COUNT(*) FILTER (WHERE is_acknowledged = FALSE)                                       AS unacknowledged,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')                      AS last_24h,
      COUNT(*) FILTER (WHERE severity = 'Critical' AND is_acknowledged = FALSE)             AS critical_open
    FROM ${SCHEMA}.alerts
  `);
  const r = rows[0] || {};
  return {
    unacknowledged: parseInt(r.unacknowledged || 0),
    last24h:        parseInt(r.last_24h        || 0),
    criticalOpen:   parseInt(r.critical_open   || 0),
  };
}

// One-shot snapshot used by GET /api/monitoring/overview
async function getOverview() {
  const [controllers, pushQueue, sync, events, alerts] = await Promise.all([
    getControllerHealth(),
    getCardPushQueueStats(),
    getSyncStats(),
    getEventThroughput(),
    getAlertStats(),
  ]);

  const total   = controllers.length;
  const online  = controllers.filter(c => c.health === 'online').length;
  const offline = controllers.filter(c => c.health === 'offline').length;
  const unknown = controllers.filter(c => c.health === 'unknown').length;

  // Bridge is considered "up" if at least one controller has reported online recently.
  const bridgeOnline = online > 0;

  return {
    bridge: {
      online: bridgeOnline,
      heartbeatTimeoutSeconds: HEARTBEAT_TIMEOUT_SECONDS,
    },
    controllers: {
      total, online, offline, unknown,
      list: controllers,
    },
    pushQueue,
    sync,
    events,
    alerts,
  };
}

module.exports = {
  HEARTBEAT_TIMEOUT_SECONDS,
  getControllerHealth,
  getCardPushQueueStats,
  getRecentPushFailures,
  getSyncStats,
  getEventThroughput,
  getAlertStats,
  getOverview,
};
