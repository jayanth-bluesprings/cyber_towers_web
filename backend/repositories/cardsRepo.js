/**
 * cardsRepo.js — CRUD for cybertowers.cards
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

async function getCardByNo(cardNo) {
  const { rows } = await pgQuery(
    `SELECT * FROM ${SCHEMA}.cards WHERE card_no = $1 AND deleted_at IS NULL`,
    [cardNo]
  );
  return rows[0] || null;
}

async function getCardById(id) {
  const { rows } = await pgQuery(`
    SELECT
      c.*,
      co.name AS company_name, co.code AS company_code,
      ag.name AS access_group_name,
      u.name  AS assigned_user_name, u.email AS assigned_user_email
    FROM ${SCHEMA}.cards c
    LEFT JOIN ${SCHEMA}.companies     co ON co.id = c.company_id
    LEFT JOIN ${SCHEMA}.access_groups ag ON ag.id = c.access_group_id
    LEFT JOIN ${SCHEMA}.users          u  ON u.id  = c.assigned_user_id
    WHERE c.id = $1 AND c.deleted_at IS NULL
  `, [id]);
  return rows[0] || null;
}

async function listCards({
  search, companyId, status, vehicleType, accessGroupId,
  assignedUserId, validOnly,
  limit = 50, offset = 0,
} = {}) {
  const params = [];
  const conditions = ['c.deleted_at IS NULL'];

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(
      `(c.person_name ILIKE $${n} OR c.card_no ILIKE $${n} OR c.vehicle_number ILIKE $${n} OR c.person_code ILIKE $${n})`
    );
  }
  if (companyId) {
    params.push(companyId);
    conditions.push(`c.company_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`c.card_status = $${params.length}`);
  }
  if (vehicleType) {
    params.push(vehicleType);
    conditions.push(`c.vehicle_type = $${params.length}`);
  }
  if (accessGroupId) {
    params.push(accessGroupId);
    conditions.push(`c.access_group_id = $${params.length}`);
  }
  if (assignedUserId) {
    params.push(assignedUserId);
    conditions.push(`c.assigned_user_id = $${params.length}`);
  }
  if (validOnly) {
    conditions.push(`(c.valid_until IS NULL OR c.valid_until >= NOW())`);
    conditions.push(`(c.valid_from  IS NULL OR c.valid_from  <= NOW())`);
  }

  const countParams = [...params];

  params.push(limit, offset);
  const limitN  = params.length - 1;
  const offsetN = params.length;

  const { rows } = await pgQuery(`
    SELECT
      c.*,
      co.name AS company_name, co.code AS company_code,
      ag.name AS access_group_name,
      u.name  AS assigned_user_name, u.email AS assigned_user_email
    FROM ${SCHEMA}.cards c
    LEFT JOIN ${SCHEMA}.companies     co ON co.id = c.company_id
    LEFT JOIN ${SCHEMA}.access_groups ag ON ag.id = c.access_group_id
    LEFT JOIN ${SCHEMA}.users          u  ON u.id  = c.assigned_user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.person_name NULLS LAST, c.card_no
    LIMIT $${limitN} OFFSET $${offsetN}
  `, params);

  const { rows: countRows } = await pgQuery(`
    SELECT COUNT(*) AS total
    FROM ${SCHEMA}.cards c
    WHERE ${conditions.join(' AND ')}
  `, countParams);

  return { cards: rows, total: parseInt(countRows[0].total) };
}

async function createCard({
  cardNo, personName, personCode, companyId, department,
  vehicleNumber, vehicleType, vehicleBrand, vehicleColor, cardType, cardStatus,
  accessGroupId, assignedUserId, validFrom, validUntil, notes, bloodGroup,
  photoUrl, photoData,
}) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.cards
      (card_no, person_name, person_code, company_id, department,
       vehicle_number, vehicle_type, vehicle_brand, vehicle_color, card_type, card_status,
       access_group_id, assigned_user_id, valid_from, valid_until, notes, blood_group,
       photo_url, photo_data)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING *
  `, [
    cardNo,
    personName     || null,
    personCode     || null,
    companyId      || null,
    department     || null,
    vehicleNumber  || null,
    vehicleType    || null,
    vehicleBrand   || null,
    vehicleColor   || null,
    cardType       || 'Normal',
    cardStatus     || 'Active',
    accessGroupId  || null,
    assignedUserId || null,
    validFrom      || null,
    validUntil     || null,
    notes          || null,
    bloodGroup     || null,
    photoUrl       || null,
    photoData      || null,
  ]);
  return rows[0];
}

async function updateCard(id, fields) {
  // Build dynamic SET clause — only update fields explicitly passed (not undefined)
  const sets = [];
  const params = [id];

  const add = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (fields.personName    !== undefined) add('person_name',    fields.personName    || null);
  if (fields.personCode    !== undefined) add('person_code',    fields.personCode    || null);
  if (fields.companyId     !== undefined) add('company_id',     fields.companyId     || null);
  if (fields.department    !== undefined) add('department',     fields.department    || null);
  if (fields.vehicleNumber !== undefined) add('vehicle_number', fields.vehicleNumber || null);
  if (fields.vehicleType   !== undefined) add('vehicle_type',   fields.vehicleType   || null);
  if (fields.cardType      !== undefined) add('card_type',      fields.cardType      || null);
  if (fields.cardStatus    !== undefined) add('card_status',    fields.cardStatus    || null);
  if (fields.accessGroupId !== undefined) add('access_group_id', fields.accessGroupId || null);
  if (fields.assignedUserId !== undefined) add('assigned_user_id', fields.assignedUserId || null);
  if (fields.validFrom     !== undefined) add('valid_from',     fields.validFrom     || null);
  if (fields.validUntil    !== undefined) add('valid_until',    fields.validUntil    || null);
  if (fields.notes         !== undefined) add('notes',          fields.notes         || null);
  if (fields.bloodGroup    !== undefined) add('blood_group',    fields.bloodGroup    || null);
  if (fields.vehicleBrand  !== undefined) add('vehicle_brand',  fields.vehicleBrand  || null);
  if (fields.vehicleColor  !== undefined) add('vehicle_color',  fields.vehicleColor  || null);
  if (fields.photoUrl      !== undefined) add('photo_url',      fields.photoUrl      || null);
  if (fields.photoData     !== undefined) add('photo_data',     fields.photoData     || null);

  if (sets.length === 0) return getCardById(id);

  sets.push(`updated_at = NOW()`);

  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.cards
    SET ${sets.join(', ')}
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `, params);
  return rows[0] || null;
}

async function assignUser(id, userId) {
  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.cards
    SET assigned_user_id = $2, updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `, [id, userId || null]);
  return rows[0] || null;
}

async function bulkUpdateStatus(ids, cardStatus) {
  if (!ids.length) return 0;
  const { rowCount } = await pgQuery(`
    UPDATE ${SCHEMA}.cards
    SET card_status = $1, updated_at = NOW()
    WHERE id = ANY($2) AND deleted_at IS NULL
  `, [cardStatus, ids]);
  return rowCount;
}

async function deleteCard(id) {
  const { rowCount } = await pgQuery(
    `UPDATE ${SCHEMA}.cards SET deleted_at = NOW(), card_status = 'Deleted'
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rowCount > 0;
}

async function getCardsByNos(cardNos) {
  if (!cardNos.length) return new Map();
  const { rows } = await pgQuery(
    `SELECT card_no, person_name, company_id, vehicle_number,
            (SELECT code FROM ${SCHEMA}.companies WHERE id = cards.company_id) AS company_code
     FROM ${SCHEMA}.cards
     WHERE card_no = ANY($1) AND deleted_at IS NULL`,
    [cardNos]
  );
  return new Map(rows.map(r => [r.card_no, r]));
}

async function getCardsByUserId(userId) {
  const { rows } = await pgQuery(`
    SELECT
      c.*,
      co.name AS company_name, co.code AS company_code,
      ag.name AS access_group_name
    FROM ${SCHEMA}.cards c
    LEFT JOIN ${SCHEMA}.companies     co ON co.id = c.company_id
    LEFT JOIN ${SCHEMA}.access_groups ag ON ag.id = c.access_group_id
    WHERE c.assigned_user_id = $1 AND c.deleted_at IS NULL
    ORDER BY c.person_name NULLS LAST
  `, [userId]);
  return rows;
}

module.exports = {
  getCardByNo,
  getCardById,
  listCards,
  createCard,
  updateCard,
  assignUser,
  bulkUpdateStatus,
  deleteCard,
  getCardsByNos,
  getCardsByUserId,
};
