/**
 * accessGroupsRepo.js — CRUD for cybertowers.access_groups + access_group_doors
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

async function listAccessGroups() {
  const { rows } = await pgQuery(`
    SELECT
      ag.*,
      COUNT(DISTINCT agd.controller_id)::int AS controller_count,
      COUNT(DISTINCT c.id)::int              AS card_count
    FROM ${SCHEMA}.access_groups ag
    LEFT JOIN ${SCHEMA}.access_group_doors agd ON agd.access_group_id = ag.id
    LEFT JOIN ${SCHEMA}.cards c ON c.access_group_id = ag.id AND c.deleted_at IS NULL
    WHERE ag.deleted_at IS NULL
    GROUP BY ag.id
    ORDER BY ag.name
  `);
  return rows;
}

async function getAccessGroupById(id) {
  const { rows } = await pgQuery(`
    SELECT ag.*
    FROM ${SCHEMA}.access_groups ag
    WHERE ag.id = $1 AND ag.deleted_at IS NULL
  `, [id]);
  return rows[0] || null;
}

async function getGroupControllers(groupId) {
  const { rows } = await pgQuery(`
    SELECT
      agd.controller_id,
      agd.door_num,
      agd.created_at AS assigned_at,
      co.sn, co.location_label, co.ip_address, co.door_count, co.door_labels, co.is_active
    FROM ${SCHEMA}.access_group_doors agd
    JOIN ${SCHEMA}.controllers co ON co.id = agd.controller_id AND co.deleted_at IS NULL
    WHERE agd.access_group_id = $1
    ORDER BY co.location_label, agd.door_num
  `, [groupId]);
  return rows;
}

// Returns controller IDs that have ANY door assigned to this group
async function getGroupControllerIds(groupId) {
  const { rows } = await pgQuery(`
    SELECT DISTINCT controller_id
    FROM ${SCHEMA}.access_group_doors
    WHERE access_group_id = $1
  `, [groupId]);
  return rows.map(r => r.controller_id);
}

async function createAccessGroup({ name, description, companyId }) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.access_groups (name, description, company_id, is_active)
    VALUES ($1, $2, $3, TRUE)
    RETURNING *
  `, [name, description || null, companyId || null]);
  return rows[0];
}

async function updateAccessGroup(id, { name, description, isActive }) {
  const sets = [];
  const params = [id];

  if (name      !== undefined) { params.push(name);      sets.push(`name = $${params.length}`); }
  if (description !== undefined) { params.push(description || null); sets.push(`description = $${params.length}`); }
  if (isActive  !== undefined) { params.push(isActive);  sets.push(`is_active = $${params.length}`); }

  if (!sets.length) return getAccessGroupById(id);

  sets.push(`updated_at = NOW()`);

  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.access_groups
    SET ${sets.join(', ')}
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `, params);
  return rows[0] || null;
}

async function deleteAccessGroup(id) {
  const { rowCount } = await pgQuery(`
    UPDATE ${SCHEMA}.access_groups
    SET deleted_at = NOW(), is_active = FALSE
    WHERE id = $1 AND deleted_at IS NULL
  `, [id]);
  return rowCount > 0;
}

// Replace all controller/door assignments for a group.
// assignments: [{ controllerId, doorNum }]
async function setGroupControllers(groupId, assignments) {
  // Delete existing
  await pgQuery(`
    DELETE FROM ${SCHEMA}.access_group_doors WHERE access_group_id = $1
  `, [groupId]);

  if (!assignments || !assignments.length) return [];

  // Deduplicate by controller+door
  const seen = new Set();
  const unique = assignments.filter(a => {
    const key = `${a.controllerId}:${a.doorNum}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const inserted = [];
  for (const { controllerId, doorNum } of unique) {
    const { rows } = await pgQuery(`
      INSERT INTO ${SCHEMA}.access_group_doors (access_group_id, controller_id, door_num)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [groupId, controllerId, doorNum]);
    if (rows[0]) inserted.push(rows[0]);
  }
  return inserted;
}

module.exports = {
  listAccessGroups,
  getAccessGroupById,
  getGroupControllers,
  getGroupControllerIds,
  createAccessGroup,
  updateAccessGroup,
  deleteAccessGroup,
  setGroupControllers,
};
