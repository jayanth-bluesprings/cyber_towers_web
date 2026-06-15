const { query } = require('../db');
const { invalidatePersonnelCache } = require('../personnelCache');

function sanitize(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === '' || s === '-' ? null : s;
}

async function updatePerson(req, res) {
  const { cardId } = req.params;
  if (!cardId) return res.status(400).json({ success: false, error: 'cardId required' });

  const PName      = sanitize(req.body.PName);
  const CarNumber  = sanitize(req.body.CarNumber);
  const Addr       = sanitize(req.body.Addr);
  const vehicleType = sanitize(req.body.vehicleType);
  const BloodGroup = sanitize(req.body.BloodGroup);

  try {
    // Verify the card exists in Personnel
    const check = await query(
      `SELECT PersonnelID FROM Personnel WITH (NOLOCK) WHERE CardData = @cardId`,
      { cardId }
    );
    if (!check.recordset.length) {
      return res.status(404).json({ success: false, error: 'Card not found in Personnel' });
    }
    const personnelId = check.recordset[0].PersonnelID;

    // Update Personnel core fields
    await query(
      `UPDATE Personnel
       SET PName          = COALESCE(@PName, PName),
           Addr           = @Addr,
           PDesc          = @vehicleType,
           graduateSchool = @BloodGroup
       WHERE CardData = @cardId`,
      { cardId, PName, Addr, vehicleType, BloodGroup }
    );

    // Upsert PersonnelExtend2 for CarNumber
    await query(
      `IF EXISTS (SELECT 1 FROM PersonnelExtend2 WITH (NOLOCK) WHERE PersonnelID = @personnelId)
         UPDATE PersonnelExtend2 SET CarNumber = @CarNumber WHERE PersonnelID = @personnelId
       ELSE
         INSERT INTO PersonnelExtend2 (PersonnelID, CarNumber) VALUES (@personnelId, @CarNumber)`,
      { personnelId, CarNumber }
    );

    invalidatePersonnelCache();

    res.json({ success: true, personnelId });
  } catch (err) {
    console.error('[updatePerson] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { updatePerson };
