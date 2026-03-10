const WebSocket = require('ws');

let wss = null;
let lastKnownId = 0;
let pollInterval = null;

// Must match DEDUP_SECONDS in liveController.js
const DEDUP_SECONDS = 30;

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
      // Use the same dedup CTE as liveController so WS pushes are also deduped.
      // We fetch rows with CardRecordID > lastKnownId, then apply 30-second dedup
      // within that window so the frontend never receives duplicate card scans.
      const result = await queryFn(`
        WITH NewRows AS (
          SELECT
            CardRecordID,
            CardData,
            PName,
            PCode,
            DeptName,
            EquptName,
            DATEADD(SECOND, DataTime * 86400, '1899-12-30') AS ScanTime,
            ROW_NUMBER() OVER (
              PARTITION BY
                CardData,
                CAST(DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
              ORDER BY CardRecordID DESC
            ) AS rn
          FROM CardRecord
          WHERE CardRecordID > ${lastKnownId}
        )
        SELECT TOP 50
          CardRecordID, CardData, PName, PCode, DeptName, EquptName, ScanTime
        FROM NewRows
        WHERE rn = 1
        ORDER BY CardRecordID ASC
      `);

      if (result.recordset.length > 0) {
        const newRecords = result.recordset.map(enrichRecord);
        // Advance lastKnownId to the absolute max — including dupes we filtered out —
        // so we don't re-fetch them next tick.
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
  const card = (record.CardData || '').toUpperCase();
  let vehicleType = 'Unknown';
  if (card.startsWith('2W')) vehicleType = '2W';
  else if (card.startsWith('4W')) vehicleType = '4W';

  const flatMatch = (record.PCode || '').match(/^[A-Z]-\d{3}$/i);
  const flatNumber = flatMatch ? record.PCode : null;

  return { ...record, vehicleType, flatNumber };
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
}

module.exports = { initWebSocket, broadcast, startPolling, stopPolling, enrichRecord };