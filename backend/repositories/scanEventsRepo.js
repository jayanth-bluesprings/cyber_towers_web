/**
 * scanEventsRepo.js — Insert and query cybertowers.scan_events (partitioned table)
 *
 * The Bridge posts single events (live) and batches (historical sync).
 * The Express backend writes them here and also reads them for the dashboard.
 */

const { pgQuery } = require('../pgdb');
const { getCardByNo } = require('./cardsRepo');

const SCHEMA = 'cybertowers';

/**
 * Enrich an event DTO with denormalised fields from the cards table.
 * Avoids joins on every read query by storing person_name / vehicle_number
 * directly on the scan_events row.
 */
async function enrichEvent(event) {
  if (!event.cardNo) return event;
  try {
    const card = await getCardByNo(event.cardNo);
    if (card) {
      return {
        ...event,
        personName:    card.person_name    || null,
        companyCode:   card.company_code   || null,
        vehicleNumber: card.vehicle_number || null,
      };
    }
  } catch (_) { /* enrichment is best-effort */ }
  return event;
}

/**
 * Resolve the location_label for a controller serial number.
 * Cached in a simple Map per process restart (controllers rarely change).
 */
const _locationCache = new Map();
async function getLocationLabel(controllerSn) {
  if (_locationCache.has(controllerSn)) return _locationCache.get(controllerSn);
  try {
    const { rows } = await pgQuery(
      `SELECT location_label FROM ${SCHEMA}.controllers WHERE sn = $1 AND deleted_at IS NULL`,
      [controllerSn]
    );
    const label = rows[0]?.location_label || null;
    _locationCache.set(controllerSn, label);
    return label;
  } catch (_) { return null; }
}

/**
 * Insert a single live scan event.
 * Returns the inserted row.
 */
async function insertEvent(event) {
  const enriched = await enrichEvent(event);
  const locationLabel = await getLocationLabel(event.controllerSn);

  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.scan_events (
      event_date, received_at, card_no, controller_sn, door_num, direction,
      record_type, event_code, event_code_int, access_result, denial_reason,
      is_alert, alert_severity, source,
      person_name, company_code, vehicle_number, location_label
    ) VALUES (
      $1, NOW(), $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16, $17
    )
    RETURNING id, event_date, card_no, controller_sn, door_num, direction,
              access_result, denial_reason, is_alert, alert_severity, source,
              person_name, company_code, vehicle_number, location_label
  `, [
    event.eventDate    || new Date(),
    event.cardNo       || '',
    event.controllerSn,
    event.doorNum      || 1,
    event.direction    || 'N/A',
    event.recordType   || '',
    event.eventCode    || '',
    event.eventCodeInt || null,
    event.accessResult || 'Unknown',
    event.denialReason || null,
    event.isAlert      || false,
    event.alertSeverity || null,
    event.source       || 'Live',
    enriched.personName    || null,
    enriched.companyCode   || null,
    enriched.vehicleNumber || null,
    locationLabel,
  ]);
  return rows[0];
}

/**
 * Insert a batch of historical events.
 * Uses a single multi-row INSERT for efficiency.
 * Returns { inserted, duplicates } counts.
 */
async function insertEventBatch(controllerSn, events) {
  if (!events || !events.length) return { inserted: 0, duplicates: 0 };

  // Fetch card data for all unique card numbers in the batch in one query
  const { getCardsByNos } = require('./cardsRepo');
  const uniqueCardNos = [...new Set(events.map(e => e.cardNo).filter(Boolean))];
  const cardMap = await getCardsByNos(uniqueCardNos);
  const locationLabel = await getLocationLabel(controllerSn);

  let inserted = 0;
  let duplicates = 0;

  // Insert in chunks of 500 to avoid parameter limit
  const CHUNK = 500;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const values = [];
    const placeholders = chunk.map((e, idx) => {
      const base = idx * 17;
      const card = cardMap.get(e.cardNo) || {};
      values.push(
        e.eventDate    || new Date(),
        e.cardNo       || '',
        controllerSn,
        e.doorNum      || 1,
        e.direction    || 'N/A',
        e.recordType   || '',
        e.eventCode    || '',
        e.eventCodeInt || null,
        e.accessResult || 'Unknown',
        e.denialReason || null,
        e.isAlert      || false,
        e.alertSeverity || null,
        'Sync',
        card.person_name    || null,
        card.company_code   || null,
        card.vehicle_number || null,
        locationLabel
      );
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17})`;
    });

    const sql = `
      INSERT INTO ${SCHEMA}.scan_events (
        event_date, card_no, controller_sn, door_num, direction,
        record_type, event_code, event_code_int, access_result, denial_reason,
        is_alert, alert_severity, source,
        person_name, company_code, vehicle_number, location_label
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT DO NOTHING
    `;

    const result = await pgQuery(sql, values);
    inserted   += result.rowCount;
    duplicates += chunk.length - result.rowCount;
  }

  return { inserted, duplicates };
}

/**
 * Query recent scan events for the live feed.
 *
 * @param {object} opts
 * @param {number} [opts.limit=100]
 * @param {string} [opts.since]         ISO timestamp — only events after this
 * @param {string} [opts.controllerSn]  Filter by controller
 * @param {string} [opts.cardNo]        Filter by card
 * @param {string} [opts.accessResult]  'Granted' | 'Denied' | etc.
 */
async function getRecentEvents({ limit = 100, since, controllerSn, cardNo, accessResult } = {}) {
  const params = [];
  const conditions = [];

  if (since) {
    params.push(since);
    conditions.push(`se.event_date > $${params.length}`);
  }
  if (controllerSn) {
    params.push(controllerSn);
    conditions.push(`se.controller_sn = $${params.length}`);
  }
  if (cardNo) {
    params.push(cardNo);
    conditions.push(`se.card_no = $${params.length}`);
  }
  if (accessResult) {
    params.push(accessResult);
    conditions.push(`se.access_result = $${params.length}`);
  }

  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pgQuery(`
    SELECT
      se.id, se.event_date, se.received_at, se.card_no, se.controller_sn, se.door_num, se.direction,
      se.record_type, se.event_code, se.access_result, se.denial_reason,
      se.is_alert, se.alert_severity, se.source,
      se.person_name, se.company_code, se.vehicle_number, se.location_label,
      c.vehicle_brand, c.vehicle_color
    FROM ${SCHEMA}.scan_events se
    LEFT JOIN ${SCHEMA}.cards c ON c.card_no = se.card_no AND c.deleted_at IS NULL
    ${where}
    ORDER BY se.event_date DESC
    LIMIT $${params.length}
  `, params);

  return rows;
}

/**
 * Count events per hour for a given day (dashboard chart).
 * Returns an array of { hour (0–23), total, granted, denied }.
 */
async function getHourlyStats(date) {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const { rows } = await pgQuery(`
    SELECT
      EXTRACT(HOUR FROM event_date AT TIME ZONE 'Asia/Kolkata')::int AS hour,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE access_result = 'Granted') AS granted,
      COUNT(*) FILTER (WHERE access_result = 'Denied')  AS denied
    FROM ${SCHEMA}.scan_events
    WHERE event_date >= $1 AND event_date < $2
    GROUP BY hour
    ORDER BY hour
  `, [dayStart, dayEnd]);
  return rows;
}

/**
 * Return alert events within a time window.
 */
async function getAlertEvents({ since, limit = 50 } = {}) {
  const since_ = since || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { rows } = await pgQuery(`
    SELECT * FROM ${SCHEMA}.scan_events
    WHERE is_alert = TRUE AND event_date >= $1
    ORDER BY event_date DESC
    LIMIT $2
  `, [since_, limit]);
  return rows;
}

/**
 * List events with filtering and pagination (for Events API / ConfigPage).
 *
 * @param {object} opts
 * @param {string} [opts.controllerSn]  Filter by controller serial number
 * @param {number} [opts.doorNum]       Filter by door number
 * @param {string} [opts.accessResult]  Filter by access result (Granted, Denied, etc.)
 * @param {Date}   [opts.dateFrom]      Filter events after this date
 * @param {Date}   [opts.dateTo]        Filter events before this date
 * @param {number} [opts.limit=50]      Limit results
 * @param {number} [opts.offset=0]      Pagination offset
 */
async function listEvents({
  controllerSn,
  doorNum,
  accessResult,
  dateFrom,
  dateTo,
  limit = 50,
  offset = 0,
} = {}) {
  const params = [];
  const conditions = [];

  if (controllerSn) {
    params.push(controllerSn);
    conditions.push(`controller_sn = $${params.length}`);
  }
  if (doorNum !== null && doorNum !== undefined) {
    params.push(doorNum);
    conditions.push(`door_num = $${params.length}`);
  }
  if (accessResult) {
    params.push(accessResult);
    conditions.push(`access_result = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`event_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`event_date <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);

  const { rows } = await pgQuery(`
    SELECT
      id, event_date, received_at, card_no, controller_sn, door_num, direction,
      record_type, event_code, event_code_int, access_result, denial_reason,
      is_alert, alert_severity, source,
      person_name, company_code, vehicle_number, location_label
    FROM ${SCHEMA}.scan_events
    ${where}
    ORDER BY event_date DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return rows;
}

/**
 * Count total events matching the filter criteria.
 */
async function countEvents({
  controllerSn,
  doorNum,
  accessResult,
  dateFrom,
  dateTo,
} = {}) {
  const params = [];
  const conditions = [];

  if (controllerSn) {
    params.push(controllerSn);
    conditions.push(`controller_sn = $${params.length}`);
  }
  if (doorNum !== null && doorNum !== undefined) {
    params.push(doorNum);
    conditions.push(`door_num = $${params.length}`);
  }
  if (accessResult) {
    params.push(accessResult);
    conditions.push(`access_result = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`event_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`event_date <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pgQuery(`
    SELECT COUNT(*) as total FROM ${SCHEMA}.scan_events ${where}
  `, params);

  return parseInt(rows[0].total);
}

/**
 * Get overall event statistics.
 */
async function getEventStats() {
  const { rows } = await pgQuery(`
    SELECT
      COUNT(*) as total_events,
      COUNT(DISTINCT controller_sn) as unique_controllers,
      COUNT(DISTINCT card_no) as unique_cards,
      COUNT(*) FILTER (WHERE access_result = 'Granted') as granted,
      COUNT(*) FILTER (WHERE access_result = 'Denied') as denied,
      COUNT(*) FILTER (WHERE is_alert = true) as alerts,
      MAX(event_date) as latest_event,
      MIN(event_date) as oldest_event
    FROM ${SCHEMA}.scan_events
  `, []);

  return rows[0];
}

module.exports = {
  insertEvent,
  insertEventBatch,
  getRecentEvents,
  getHourlyStats,
  getAlertEvents,
  listEvents,
  countEvents,
  getEventStats,
};
