/**
 * /api/controllers — Controller management routes
 * Mounted under /api (requireApiKey applied at server level)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const {
  getAllControllers,
  getControllerById,
  getControllerBySn,
  createController,
  updateController,
  deleteController,
} = require('../repositories/controllersRepo');
const { getAllStatuses } = require('../repositories/controllerStatusRepo');
const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

// ── Encryption helpers (AES-256-CBC, key from env) ───────────────────────────
function getEncKey() {
  const raw = process.env.BRIDGE_ENCRYPTION_KEY || '';
  if (!raw) return null;
  return Buffer.from(raw.slice(0, 32).padEnd(32, '0'));
}

function encryptPassword(plain) {
  if (!plain) return '';
  const key = getEncKey();
  if (!key) return plain; // no key configured: store plaintext (dev only)
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// ── Validation helpers ───────────────────────────────────────────────────────
function isValidIp(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}
function isValidPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}
function validate(body, requireSn = true) {
  const errors = [];
  if (requireSn && !body.sn) errors.push('sn (serial number) is required');
  if (body.ipAddress && !isValidIp(body.ipAddress)) errors.push('ipAddress must be a valid IPv4 address');
  if (body.tcpPort  !== undefined && !isValidPort(body.tcpPort))  errors.push('tcpPort must be 1–65535');
  if (body.udpPort  !== undefined && !isValidPort(body.udpPort))  errors.push('udpPort must be 1–65535');
  if (body.doorCount !== undefined && (Number(body.doorCount) < 1 || Number(body.doorCount) > 8)) errors.push('doorCount must be 1–8');
  return errors;
}

// ── Audit log helper ─────────────────────────────────────────────────────────
async function audit(action, controllerId, details, req) {
  try {
    await pgQuery(`
      INSERT INTO ${SCHEMA}.audit_log (table_name, record_id, action, changed_by, details)
      VALUES ('controllers', $1, $2, $3, $4)
    `, [controllerId, action, req.ip || 'api', JSON.stringify(details)]);
  } catch (_) {
    // audit_log may not exist yet — non-fatal
  }
}

// ── GET /api/controllers ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    let rows = await getAllControllers();

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        (r.sn           || '').toLowerCase().includes(s) ||
        (r.ip_address   || '').toLowerCase().includes(s) ||
        (r.location_label || '').toLowerCase().includes(s)
      );
    }

    const total      = rows.length;
    const p          = Math.max(1, parseInt(page));
    const l          = Math.min(200, Math.max(1, parseInt(limit)));
    const totalPages = Math.ceil(total / l) || 1;
    const paged      = rows.slice((p - 1) * l, p * l);

    res.json({ success: true, data: paged, total, page: p, limit: l, totalPages });
  } catch (err) {
    console.error('[controllers] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/controllers/health ──────────────────────────────────────────────
// Must be BEFORE /:id so it doesn't get swallowed
router.get('/health', async (req, res) => {
  try {
    const statuses = await getAllStatuses();
    res.json({ success: true, data: statuses });
  } catch (err) {
    console.error('[controllers] GET /health error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/controllers/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await getControllerById(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Controller not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[controllers] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/controllers ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const errors = validate(body, true);
    if (errors.length) return res.status(400).json({ success: false, errors });

    // Duplicate SN check
    const existing = await getControllerBySn(body.sn);
    if (existing) return res.status(409).json({ success: false, error: `Controller with SN "${body.sn}" already exists` });

    const passwordEncrypted = encryptPassword(body.password || '');
    const doorLabels = body.doorLabels || {};

    const row = await createController({
      sn:               body.sn,
      ipAddress:        body.ipAddress       || '',
      tcpPort:          body.tcpPort         || 8000,
      udpPort:          body.udpPort         || 8101,
      passwordEncrypted,
      doorCount:        body.doorCount       || 1,
      controllerType:   body.controllerType  || 'FC8900',
      locationLabel:    body.locationLabel   || null,
      doorLabels,
      companyId:        body.companyId       || null,
      notes:            body.notes           || null,
    });

    await audit('CREATE', row.id, { sn: row.sn, ipAddress: row.ip_address }, req);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('[controllers] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/controllers/:id ───────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getControllerById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Controller not found' });

    const body   = req.body;
    const errors = validate(body, false);
    if (errors.length) return res.status(400).json({ success: false, errors });

    const passwordEncrypted = body.password
      ? encryptPassword(body.password)
      : undefined; // undefined → COALESCE keeps existing

    const row = await updateController(id, {
      ipAddress:         body.ipAddress      ?? null,
      tcpPort:           body.tcpPort        ?? null,
      passwordEncrypted: passwordEncrypted   ?? null,
      doorCount:         body.doorCount      ?? null,
      locationLabel:     body.locationLabel  ?? null,
      doorLabels:        body.doorLabels     ?? null,
      isActive:          body.isActive       ?? null,
      notes:             body.notes          ?? null,
    });

    await audit('UPDATE', id, body, req);
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[controllers] PATCH /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/controllers/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await getControllerById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Controller not found' });

    const deleted = await deleteController(id);
    if (!deleted) return res.status(500).json({ success: false, error: 'Delete failed' });

    await audit('DELETE', id, { sn: existing.sn }, req);
    res.json({ success: true, message: `Controller ${existing.sn} deleted` });
  } catch (err) {
    console.error('[controllers] DELETE /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
