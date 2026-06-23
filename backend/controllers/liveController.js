const { getRecentEvents } = require('../repositories/scanEventsRepo');
const { listCards } = require('../repositories/cardsRepo');
const { pgQuery } = require('../pgdb');

const SCHEMA = 'cybertowers';

async function getLive(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '4000', 10) || 4000, 5000);
    const since = startDate ? new Date(startDate).toISOString() : undefined;
    const rows = await getRecentEvents({ limit, since });
    const data = endDate
      ? rows.filter(r => new Date(r.event_date) <= new Date(endDate + 'T23:59:59Z'))
      : rows;
    res.json({ success: true, data });
  } catch (err) {
    console.error('getLive error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// 'since' is an ISO timestamp — returns events newer than that timestamp
async function getNew(req, res) {
  try {
    const since = req.query.since || req.query.lastId;
    const rows = await getRecentEvents({ limit: 500, since });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getNew error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function search(req, res) {
  const { q, startDate, endDate } = req.query;
  if (!q) return res.json({ success: true, data: [] });
  try {
    const params = [`%${q}%`];
    const conditions = [
      `(card_no ILIKE $1 OR person_name ILIKE $1 OR vehicle_number ILIKE $1 OR company_code ILIKE $1)`,
    ];
    if (startDate) {
      params.push(new Date(startDate).toISOString());
      conditions.push(`event_date >= $${params.length}`);
    }
    if (endDate) {
      params.push(new Date(endDate + 'T23:59:59Z').toISOString());
      conditions.push(`event_date <= $${params.length}`);
    }
    params.push(100);
    const { rows } = await pgQuery(`
      SELECT id, event_date, card_no, controller_sn, direction, access_result, denial_reason,
             person_name, company_code, vehicle_number, location_label, is_alert
      FROM ${SCHEMA}.scan_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_date DESC
      LIMIT $${params.length}
    `, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getAuthorizedVehicles(req, res) {
  try {
    const { cards } = await listCards({ limit: 2000 });
    const data = cards.map(c => ({
      card_no: c.card_no,
      person_name: c.person_name,
      company_code: c.company_code,
      vehicle_number: c.vehicle_number,
      vehicle_type: c.vehicle_type,
      blood_group: c.blood_group,
      // Legacy aliases — the Config Vehicles tab / Parking page use an inverted
      // convention where PName = the VEHICLE NUMBER and CarNumber = the PERSON NAME.
      CardData: c.card_no,
      PName: c.vehicle_number,                       // displayed as "Vehicle No."
      CarNumber: c.person_name,                      // displayed as the title (Name)
      PCode: c.company_code || c.person_code,
      // Company is registered into the `department` column (UI label "Company").
      Addr: c.department || c.company_name || c.company_code || '',
      BloodGroup: c.blood_group || '',
      Remark: c.vehicle_type,
      vehicleType: c.vehicle_type,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('getAuthorizedVehicles error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getLive, getNew, search, getAuthorizedVehicles };
