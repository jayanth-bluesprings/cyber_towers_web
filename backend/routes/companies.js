/**
 * /api/companies — company registry (PostgreSQL cybertowers.companies).
 * Used by the Company Registration form and the Tag Registration company dropdown.
 */
const express = require('express');
const router  = express.Router();
const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

// ── GET /api/companies — list active companies ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pgQuery(`
      SELECT id, code, name, address, contact_email, contact_phone, is_active
      FROM ${SCHEMA}.companies
      WHERE deleted_at IS NULL AND is_active = TRUE
      ORDER BY name
    `);
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('[companies] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/companies — create a company ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, code, address, contactEmail, contactPhone } = req.body;
    if (!name || !String(name).trim())
      return res.status(400).json({ success: false, error: 'name is required' });

    const trimmedName = String(name).trim();
    // Derive a short code from the name if none supplied (e.g. "Microsoft India" → "MICR").
    const finalCode = (code && String(code).trim())
      || trimmedName.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()
      || 'CO';

    // Avoid duplicates by name (case-insensitive).
    const { rows: dup } = await pgQuery(
      `SELECT id FROM ${SCHEMA}.companies WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [trimmedName]
    );
    if (dup.length)
      return res.status(409).json({ success: false, error: `Company "${trimmedName}" already exists` });

    const { rows } = await pgQuery(`
      INSERT INTO ${SCHEMA}.companies (code, name, address, contact_email, contact_phone, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id, code, name, address, contact_email, contact_phone, is_active
    `, [finalCode, trimmedName, address || null, contactEmail || null, contactPhone || null]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[companies] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
