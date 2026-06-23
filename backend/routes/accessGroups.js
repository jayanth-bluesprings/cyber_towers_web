/**
 * /api/access-groups — Access Group CRUD + controller assignment
 * Mounted with requireApiKey at server level.
 */

const express = require('express');
const router  = express.Router();
const repo    = require('../repositories/accessGroupsRepo');
const { getControllerById } = require('../repositories/controllersRepo');

// ── GET /api/access-groups ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const groups = await repo.listAccessGroups();
    res.json({ success: true, data: groups, total: groups.length });
  } catch (err) {
    console.error('[access-groups] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/access-groups ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, description, companyId } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ success: false, error: 'name is required' });

    const group = await repo.createAccessGroup({ name: name.trim(), description, companyId });
    res.status(201).json({ success: true, data: group });
  } catch (err) {
    console.error('[access-groups] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/access-groups/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const group = await repo.getAccessGroupById(req.params.id);
    if (!group) return res.status(404).json({ success: false, error: 'Access group not found' });

    const controllers = await repo.getGroupControllers(req.params.id);
    res.json({ success: true, data: { ...group, controllers } });
  } catch (err) {
    console.error('[access-groups] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/access-groups/:id ─────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const group = await repo.getAccessGroupById(req.params.id);
    if (!group) return res.status(404).json({ success: false, error: 'Access group not found' });

    const { name, description, isActive } = req.body;
    const updated = await repo.updateAccessGroup(req.params.id, { name, description, isActive });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[access-groups] PATCH /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/access-groups/:id ────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const group = await repo.getAccessGroupById(req.params.id);
    if (!group) return res.status(404).json({ success: false, error: 'Access group not found' });

    await repo.deleteAccessGroup(req.params.id);
    res.json({ success: true, message: `Access group "${group.name}" deleted` });
  } catch (err) {
    console.error('[access-groups] DELETE /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/access-groups/:id/controllers ───────────────────────────────────
router.get('/:id/controllers', async (req, res) => {
  try {
    const group = await repo.getAccessGroupById(req.params.id);
    if (!group) return res.status(404).json({ success: false, error: 'Access group not found' });

    const controllers = await repo.getGroupControllers(req.params.id);
    res.json({ success: true, data: controllers });
  } catch (err) {
    console.error('[access-groups] GET /:id/controllers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/access-groups/:id/controllers ───────────────────────────────────
// Replace all controller/door assignments for this group.
// Body: { assignments: [{ controllerId, doorNum }] }
router.put('/:id/controllers', async (req, res) => {
  try {
    const group = await repo.getAccessGroupById(req.params.id);
    if (!group) return res.status(404).json({ success: false, error: 'Access group not found' });

    const { assignments } = req.body;
    if (!Array.isArray(assignments))
      return res.status(400).json({ success: false, error: 'assignments must be an array' });

    // Validate each controller exists
    for (const a of assignments) {
      if (!a.controllerId) return res.status(400).json({ success: false, error: 'each assignment needs controllerId' });
      if (!a.doorNum || a.doorNum < 1) return res.status(400).json({ success: false, error: 'each assignment needs doorNum >= 1' });
      const ctrl = await getControllerById(a.controllerId);
      if (!ctrl) return res.status(404).json({ success: false, error: `Controller ${a.controllerId} not found` });
    }

    const inserted = await repo.setGroupControllers(req.params.id, assignments);
    const controllers = await repo.getGroupControllers(req.params.id);
    res.json({ success: true, assigned: inserted.length, data: controllers });
  } catch (err) {
    console.error('[access-groups] PUT /:id/controllers error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
