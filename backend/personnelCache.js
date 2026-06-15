const { query } = require('./db');

let cache = {
  personnel: new Map(),
  lastUpdated: 0
};

const CACHE_TTL = 60000; // 1 minute

async function getPersonnelMap() {
  const now = Date.now();
  if (cache.personnel.size > 0 && (now - cache.lastUpdated < CACHE_TTL)) {
    return cache.personnel;
  }

  try {
    console.log('🔄 Refreshing Personnel Cache...');
    const result = await query(`
      SELECT 
        p.PersonnelID, p.CardData, p.PName, p.PCode, p.Addr, 
        pe2.CarNumber, p.PDesc AS Remark, p.graduateSchool AS BloodGroup
      FROM Personnel p WITH (NOLOCK)
      LEFT JOIN PersonnelExtend2 pe2 WITH (NOLOCK) ON pe2.PersonnelID = p.PersonnelID
    `);
    
    const newMap = new Map();
    for (const r of result.recordset) {
      const rawType = (r.Remark || '').toString().trim();
      const upper = rawType.toUpperCase();
      const vehicleType = upper.startsWith('2') ? '2W' : upper.startsWith('4') ? '4W' : rawType || '-';
      const item = { ...r, vehicleType };
      newMap.set(r.PersonnelID, item);
      if (r.CardData) {
        newMap.set(String(r.CardData), item);
      }
    }
    
    cache.personnel = newMap;
    cache.lastUpdated = now;
    console.log(`✅ Cached ${newMap.size} personnel records.`);
    return newMap;
  } catch (err) {
    console.error('❌ Failed to refresh personnel cache:', err.message);
    return cache.personnel; // Return stale cache if DB fails
  }
}

function enrichWithCache(record, personnelMap) {
  const p = personnelMap.get(record.PersonnelID) || personnelMap.get(String(record.CardData)) || {};
  const rawType = (p.vehicleType || p.Remark || record.Remark || '').toString().trim();

  const upper = rawType.toUpperCase();
  const normalizedType = upper.startsWith('2') ? '2W' : upper.startsWith('4') ? '4W' : rawType || '-';
  return {
    ...record,
    PName: record.PName || p.PName || '-',
    PCode: record.PCode || p.PCode || '-',
    Addr: p.Addr || null,
    CarNumber: p.CarNumber || null,
    Remark: p.Remark || null,
    flatNumber: p.Addr || null,
    vehicleType: normalizedType,
  };
}

function invalidatePersonnelCache() {
  cache.personnel = new Map();
  cache.lastUpdated = 0;
}

module.exports = { getPersonnelMap, enrichWithCache, invalidatePersonnelCache };
