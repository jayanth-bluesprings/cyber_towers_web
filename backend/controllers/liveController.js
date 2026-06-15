const { query } = require('../db');
const { getPersonnelMap, enrichWithCache } = require('../personnelCache');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BASE_DATE = new Date('1899-12-30').getTime();

function toDataTimeFloat(dateStr, inclusiveEnd = false) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  if (inclusiveEnd) d.setDate(d.getDate() + 1); // include end date fully
  return (d.getTime() - BASE_DATE) / MS_PER_DAY;
}

async function getLive(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const startFloat = toDataTimeFloat(startDate);
    const endFloat = toDataTimeFloat(endDate, true);
    const limit = Math.min(parseInt(req.query.limit || '4000', 10) || 4000, 5000);

    const personnelMap = await getPersonnelMap();
    const whereParts = [];
    const params = {};
    if (startFloat !== null) { whereParts.push('c.DataTime >= @startFloat'); params.startFloat = startFloat; }
    if (endFloat !== null) { whereParts.push('c.DataTime < @endFloat'); params.endFloat = endFloat; }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const result = await query(`
      SET NOCOUNT ON;
      SELECT TOP ${limit}
        c.CardRecordID, c.CardData, c.PName, c.PCode, c.DeptName, c.EquptName, c.PersonnelID, c.PortNum,
        DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime
      FROM CardRecord c WITH (NOLOCK)
      ${whereClause}
      ORDER BY c.CardRecordID DESC
    `, params);
    const records = result.recordset.map(r => enrichWithCache(r, personnelMap));
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getLive error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getNew(req, res) {
  const lastId = parseInt(req.query.lastId || '0');
  try {
    const personnelMap = await getPersonnelMap();
    const result = await query(
      `SET NOCOUNT ON;
      WITH RecentRows AS (
        SELECT TOP 500 * 
        FROM CardRecord WITH (NOLOCK)
        WHERE CardRecordID > @lastId
        ORDER BY CardRecordID ASC
      )
      SELECT
        c.CardRecordID, c.CardData, c.PName, c.PCode, c.DeptName, c.EquptName, c.PersonnelID, c.PortNum,
        DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime
      FROM RecentRows c
      ORDER BY c.CardRecordID ASC`,
      { lastId }
    );
    const records = result.recordset.map(r => enrichWithCache(r, personnelMap));
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getNew error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function search(req, res) {
  const { q, startDate, endDate } = req.query;
  if (!q) return res.json({ success: true, data: [] });
  const like = `%${q}%`;
  const startFloat = toDataTimeFloat(startDate);
  const endFloat = toDataTimeFloat(endDate, true);
  try {
    const personnelMap = await getPersonnelMap();
    const whereParts = [];
    const params = { like };
    if (startFloat !== null) { whereParts.push('c.DataTime >= @startFloat'); params.startFloat = startFloat; }
    if (endFloat !== null) { whereParts.push('c.DataTime < @endFloat'); params.endFloat = endFloat; }
    const whereClause = whereParts.length ? `AND ${whereParts.join(' AND ')}` : '';

    const result = await query(
      `SET NOCOUNT ON;
      WITH RecentRows AS (
        SELECT TOP 3000 * 
        FROM CardRecord WITH (NOLOCK)
        ORDER BY CardRecordID DESC
      )
      SELECT TOP 100
        c.CardRecordID, c.CardData, c.PName, c.PCode, c.DeptName, c.EquptName, c.PersonnelID, c.PortNum,
        DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime
      FROM RecentRows c
      WHERE (c.CardData LIKE @like OR c.PName LIKE @like OR c.PCode LIKE @like)
        ${whereClause}
      ORDER BY c.CardRecordID DESC`,
      params
    );
    const records = result.recordset.map(r => enrichWithCache(r, personnelMap));
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getAuthorizedVehicles(req, res) {
  try {
    const result = await query(`
      SET NOCOUNT ON;
      SELECT
        p.PersonnelID,
        p.CardData,
        p.PName,
        p.PCode,
        p.Addr,
        pe2.CarNumber,
        p.PDesc        AS Remark,
        p.graduateSchool AS BloodGroup
      FROM Personnel p WITH (NOLOCK)
      LEFT JOIN PersonnelExtend2 pe2 WITH (NOLOCK) ON pe2.PersonnelID = p.PersonnelID
      WHERE p.CardData IS NOT NULL
        AND p.CardData != ''
        AND p.CardData != '0'
      ORDER BY p.PersonnelID DESC
    `);

    const records = result.recordset.map(r => {
      const rawType = (r.Remark || '').toString().trim();
      const upper = rawType.toUpperCase();
      const vehicleType = upper.startsWith('2') ? '2W' : upper.startsWith('4') ? '4W' : rawType || '-';
      return { ...r, vehicleType };
    });

    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getAuthorizedVehicles error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getLive, getNew, search, getAuthorizedVehicles };
