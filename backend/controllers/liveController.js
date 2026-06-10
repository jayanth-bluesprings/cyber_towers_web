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
    const personnelMap = await getPersonnelMap();

    // Query unique card holders from CardRecord — this table always has real data
    // because every scan is recorded here. We group by CardData to get one row
    // per unique card, taking the most recent PName and PCode for each.
    const result = await query(`
      SET NOCOUNT ON;
      SELECT TOP 3000
        CardData,
        MAX(PName)        AS PName,
        MAX(PCode)        AS PCode,
        MAX(DeptName)     AS DeptName,
        MAX(PersonnelID)  AS PersonnelID
      FROM CardRecord WITH (NOLOCK)
      WHERE CardData IS NOT NULL
        AND CardData != ''
        AND CardData != '0'
      GROUP BY CardData
      ORDER BY MAX(CardRecordID) DESC
    `);

    // enrichWithCache adds CarNumber, BloodGroup, vehicleType, Addr from the
    // Personnel / PersonnelExtend2 tables where that data exists.
    const records = result.recordset.map(r => enrichWithCache(r, personnelMap));
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('getAuthorizedVehicles error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getLive, getNew, search, getAuthorizedVehicles };
