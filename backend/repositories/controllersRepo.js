/**
 * controllersRepo.js — CRUD for cybertowers.controllers
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

/**
 * Return all active, non-deleted controllers.
 * This is what GET /internal/bridge/controllers returns to the Bridge at startup.
 */
async function getActiveControllers() {
  const { rows } = await pgQuery(`
    SELECT
      id, sn, ip_address, tcp_port, udp_port,
      password_encrypted, door_count, controller_type,
      location_label, door_labels, is_active, company_id,
      notes, created_at, updated_at
    FROM ${SCHEMA}.controllers
    WHERE is_active = TRUE
      AND deleted_at IS NULL
    ORDER BY location_label
  `);
  return rows;
}

/**
 * Return a single controller by its serial number (business key).
 */
async function getControllerBySn(sn) {
  const { rows } = await pgQuery(
    `SELECT * FROM ${SCHEMA}.controllers WHERE sn = $1 AND deleted_at IS NULL`,
    [sn]
  );
  return rows[0] || null;
}

/**
 * Return a single controller by UUID primary key.
 */
async function getControllerById(id) {
  const { rows } = await pgQuery(
    `SELECT * FROM ${SCHEMA}.controllers WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Return all controllers (including inactive) for the config page.
 */
async function getAllControllers() {
  const { rows } = await pgQuery(`
    SELECT
      c.*,
      cs.is_online, cs.last_heartbeat_at, cs.consecutive_failures, cs.updated_at AS status_updated_at
    FROM ${SCHEMA}.controllers c
    LEFT JOIN ${SCHEMA}.controller_status cs ON cs.controller_id = c.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.location_label
  `);
  return rows;
}

/**
 * Insert a newly discovered controller (from UDP broadcast) if it doesn't exist.
 * Returns the upserted row.
 */
async function upsertDiscoveredController({ sn, ipAddress, tcpPort, udpPort, companyId, locationLabel }) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.controllers
      (sn, ip_address, tcp_port, udp_port, password_encrypted, door_count,
       controller_type, location_label, is_active, company_id)
    VALUES ($1, $2, $3, $4, '', 1, 'Unknown', $5, TRUE, $6)
    ON CONFLICT (sn) DO UPDATE SET
      ip_address     = EXCLUDED.ip_address,
      tcp_port       = EXCLUDED.tcp_port,
      updated_at     = NOW()
    RETURNING *
  `, [sn, ipAddress, tcpPort || 8000, udpPort || 8101, locationLabel || null, companyId || null]);
  return rows[0];
}

/**
 * Create a new controller (from Config page / admin API).
 */
async function createController({ sn, ipAddress, tcpPort, udpPort, passwordEncrypted,
  doorCount, controllerType, locationLabel, doorLabels, companyId, notes }) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.controllers
      (sn, ip_address, tcp_port, udp_port, password_encrypted,
       door_count, controller_type, location_label, door_labels,
       is_active, company_id, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11)
    RETURNING *
  `, [
    sn, ipAddress, tcpPort || 8000, udpPort || 8101, passwordEncrypted || '',
    doorCount || 1, controllerType || 'FC8900', locationLabel || null,
    JSON.stringify(doorLabels || {}), companyId || null, notes || null,
  ]);
  return rows[0];
}

/**
 * Update an existing controller's configuration.
 */
async function updateController(id, fields) {
  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.controllers SET
      ip_address         = COALESCE($2, ip_address),
      tcp_port           = COALESCE($3, tcp_port),
      password_encrypted = COALESCE($4, password_encrypted),
      door_count         = COALESCE($5, door_count),
      location_label     = COALESCE($6, location_label),
      door_labels        = COALESCE($7::jsonb, door_labels),
      is_active          = COALESCE($8, is_active),
      notes              = COALESCE($9, notes),
      updated_at         = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `, [
    id,
    fields.ipAddress       || null,
    fields.tcpPort         || null,
    fields.passwordEncrypted || null,
    fields.doorCount       || null,
    fields.locationLabel   || null,
    fields.doorLabels      ? JSON.stringify(fields.doorLabels) : null,
    fields.isActive        != null ? fields.isActive : null,
    fields.notes           || null,
  ]);
  return rows[0] || null;
}

/**
 * Soft-delete a controller.
 */
async function deleteController(id) {
  const { rowCount } = await pgQuery(
    `UPDATE ${SCHEMA}.controllers SET deleted_at = NOW(), is_active = FALSE WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  getActiveControllers,
  getControllerBySn,
  getControllerById,
  getAllControllers,
  upsertDiscoveredController,
  createController,
  updateController,
  deleteController,
};
