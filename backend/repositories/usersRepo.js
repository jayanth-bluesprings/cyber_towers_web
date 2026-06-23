/**
 * usersRepo.js — CRUD for cybertowers.users
 *
 * Dashboard operator accounts. Passwords are stored as bcrypt hashes.
 * This module does NOT hash passwords — callers must pass pre-hashed values
 * (use bcrypt in the auth route before calling createUser/updatePassword).
 */

const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

/**
 * Find a user by email address (used during login).
 * Returns the full row including password_hash.
 */
async function getUserByEmail(email) {
  const { rows } = await pgQuery(
    `SELECT u.*, r.name AS role_name
     FROM ${SCHEMA}.users u
     LEFT JOIN ${SCHEMA}.roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.deleted_at IS NULL`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

/**
 * Find a user by UUID.
 */
async function getUserById(id) {
  const { rows } = await pgQuery(
    `SELECT u.*, r.name AS role_name
     FROM ${SCHEMA}.users u
     LEFT JOIN ${SCHEMA}.roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Return all active users (without password_hash).
 */
async function listUsers({ limit = 100, offset = 0 } = {}) {
  const { rows } = await pgQuery(`
    SELECT
      u.id, u.email, u.name, u.is_active, u.last_login_at,
      u.must_change_password, u.created_at,
      r.name AS role_name, r.id AS role_id,
      co.name AS company_name
    FROM ${SCHEMA}.users u
    LEFT JOIN ${SCHEMA}.roles     r  ON r.id  = u.role_id
    LEFT JOIN ${SCHEMA}.companies co ON co.id = u.company_id
    WHERE u.deleted_at IS NULL
    ORDER BY u.name
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return rows;
}

/**
 * Create a new user. passwordHash must be a bcrypt hash.
 */
async function createUser({ email, name, passwordHash, roleId, companyId }) {
  const { rows } = await pgQuery(`
    INSERT INTO ${SCHEMA}.users
      (email, name, password_hash, role_id, company_id, must_change_password)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    RETURNING id, email, name, is_active, created_at
  `, [email.toLowerCase(), name, passwordHash, roleId || null, companyId || null]);
  return rows[0];
}

/**
 * Update a user's role or active status.
 */
async function updateUser(id, { name, roleId, isActive, companyId }) {
  const { rows } = await pgQuery(`
    UPDATE ${SCHEMA}.users SET
      name       = COALESCE($2, name),
      role_id    = COALESCE($3, role_id),
      is_active  = COALESCE($4, is_active),
      company_id = COALESCE($5, company_id),
      updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, email, name, is_active, role_id, updated_at
  `, [id, name || null, roleId || null, isActive != null ? isActive : null, companyId || null]);
  return rows[0] || null;
}

/**
 * Update the password hash for a user.
 */
async function updatePassword(id, newPasswordHash) {
  const { rowCount } = await pgQuery(
    `UPDATE ${SCHEMA}.users SET password_hash = $2, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, newPasswordHash]
  );
  return rowCount > 0;
}

/**
 * Record a successful login timestamp.
 */
async function recordLogin(id) {
  await pgQuery(
    `UPDATE ${SCHEMA}.users SET last_login_at = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Soft-delete a user.
 */
async function deleteUser(id) {
  const { rowCount } = await pgQuery(
    `UPDATE ${SCHEMA}.users SET deleted_at = NOW(), is_active = FALSE WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rowCount > 0;
}

/**
 * Return all permissions for a user (via their role).
 */
async function getUserPermissions(userId) {
  const { rows } = await pgQuery(`
    SELECT p.resource, p.action
    FROM ${SCHEMA}.users u
    JOIN ${SCHEMA}.role_permissions rp ON rp.role_id = u.role_id
    JOIN ${SCHEMA}.permissions       p  ON p.id = rp.permission_id
    WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = TRUE
  `, [userId]);
  return rows;
}

module.exports = {
  getUserByEmail,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  updatePassword,
  recordLogin,
  deleteUser,
  getUserPermissions,
};
