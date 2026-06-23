const { pgQuery } = require('../pgdb');

function sanitize(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === '' || s === '-' ? null : s;
}

async function updatePerson(req, res) {
  const { cardId } = req.params;
  if (!cardId) return res.status(400).json({ success: false, error: 'cardId required' });

  const personName   = sanitize(req.body.PName    || req.body.personName);
  const vehicleNumber = sanitize(req.body.CarNumber || req.body.vehicleNumber);
  const vehicleType   = sanitize(req.body.vehicleType || req.body.Remark);
  const companyCode   = sanitize(req.body.PCode   || req.body.companyCode);
  const notes         = sanitize(req.body.BloodGroup || req.body.notes);

  try {
    const { rows } = await pgQuery(`
      UPDATE cybertowers.cards SET
        person_name    = COALESCE($2, person_name),
        vehicle_number = COALESCE($3, vehicle_number),
        vehicle_type   = COALESCE($4, vehicle_type),
        notes          = COALESCE($5, notes),
        updated_at     = NOW()
      WHERE card_no = $1 AND deleted_at IS NULL
      RETURNING id, card_no, person_name, vehicle_number, vehicle_type
    `, [cardId, personName, vehicleNumber, vehicleType, notes]);

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Card not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[updatePerson] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { updatePerson };
