const WebSocket = require('ws');
let wss = null;
let lastKnownId = 0;
let pollInterval = null;

// Must match DEDUP_SECONDS in liveController.js
const DEDUP_SECONDS = 30;

function authorizedSql(fieldName) {
  return `
    ${fieldName} IS NOT NULL
    AND LTRIM(RTRIM(CAST(${fieldName} AS NVARCHAR(255)))) NOT IN ('', '-', '0')
    AND LOWER(LTRIM(RTRIM(CAST(${fieldName} AS NVARCHAR(255))))) NOT IN ('null', 'undefined')
  `;
}

function initWebSocket(server) {
  wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => {
    console.log('🔌 WebSocket client connected');
    ws.send(JSON.stringify({ type: 'connected', message: 'Live feed connected' }));
    ws.on('close', () => console.log('🔌 WebSocket client disconnected'));
    ws.on('error', (err) => console.error('WebSocket error:', err.message));
  });
  console.log('✅ WebSocket server initialized');
  return wss;
}

function broadcast(data) {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function startPolling(queryFn) {
  if (pollInterval) clearInterval(pollInterval);

  // Seed lastKnownId from the latest record in DB
  queryFn(`SELECT TOP 1 CardRecordID FROM CardRecord ORDER BY CardRecordID DESC`)
    .then((r) => { if (r.recordset.length > 0) lastKnownId = r.recordset[0].CardRecordID; })
    .catch(() => { });

  let isPolling = false;
  pollInterval = setInterval(async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const result = await queryFn(`
        WITH NewRows AS (
          SELECT
            c.CardRecordID,
            c.CardData,
            c.PName,
            c.PCode,
            c.DeptName,
            c.EquptName,
            p.Addr,
            pe2.CarNumber,
            p.PDesc AS Remark,
            DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
            ROW_NUMBER() OVER (
              PARTITION BY
                c.CardData,
                CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
              ORDER BY c.CardRecordID DESC
            ) AS rn
          FROM CardRecord c
          LEFT JOIN Personnel p ON p.PersonnelID = c.PersonnelID
          LEFT JOIN PersonnelExtend2 pe2 ON pe2.PersonnelID = c.PersonnelID
          WHERE c.CardRecordID > ${lastKnownId}
            AND ${authorizedSql('c.PCode')}
        )
        SELECT TOP 50
          CardRecordID, CardData, PName, PCode, DeptName, EquptName, Addr, CarNumber, Remark, ScanTime
        FROM NewRows
        WHERE rn = 1
        ORDER BY CardRecordID ASC
      `);

      if (result.recordset.length > 0) {
        const newRecords = result.recordset.map(enrichRecord);

        // Advance lastKnownId to the absolute max including dupes we filtered out
        const maxIdResult = await queryFn(
          `SELECT MAX(CardRecordID) AS MaxId FROM CardRecord WHERE CardRecordID > ${lastKnownId}`
        );
        const maxId = maxIdResult.recordset[0]?.MaxId;
        if (maxId) lastKnownId = maxId;

        broadcast({ type: 'new_scans', data: newRecords });
        console.log(`📡 Broadcasted ${newRecords.length} deduped records (lastId=${lastKnownId})`);
      }
    } catch (_err) {
      // DB unavailable — skip tick silently
    } finally {
      isPolling = false;
    }
  }, 3000);
}

function enrichRecord(record) {
  const remark = record.Remark == null ? '' : record.Remark.toString().trim().toUpperCase();
  const vehicleType = remark === '2W' || remark === '4W' ? remark : null;
  return {
    ...record,
    flatNumber: record.Addr || null,
    vehicleType,
  };
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
}

module.exports = { initWebSocket, broadcast, startPolling, stopPolling, enrichRecord };
