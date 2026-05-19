const WebSocket = require('ws');
const { isAuthorizedApiKey } = require('./middleware/auth');
const { getPersonnelMap, enrichWithCache } = require('./personnelCache');

let wss = null;
let lastKnownId = 0;
let pollInterval = null;

const DEDUP_SECONDS = 30;

function initWebSocket(server) {
  wss = new WebSocket.Server({
    server,
    verifyClient: ({ req }, done) => {
      try {
        const requestUrl = new URL(req.url, 'http://localhost');
        const apiKey = requestUrl.searchParams.get('apiKey');
        if (isAuthorizedApiKey(apiKey)) {
          return done(true);
        }
      } catch (_err) {}
      return done(false, 401, 'Unauthorized');
    },
  });
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

  queryFn(`SET NOCOUNT ON; SELECT TOP 1 CardRecordID FROM CardRecord WITH (NOLOCK) ORDER BY CardRecordID DESC`)
    .then((r) => { if (r.recordset.length > 0) lastKnownId = r.recordset[0].CardRecordID; })
    .catch(() => {});

  let isPolling = false;
  pollInterval = setInterval(async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const personnelMap = await getPersonnelMap();
      const result = await queryFn(`
        SET NOCOUNT ON;
        WITH NewRows AS (
          SELECT
            c.CardRecordID, c.CardData, c.PName, c.PCode, c.DeptName, c.EquptName, c.PersonnelID, c.PortNum,
            DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
            ROW_NUMBER() OVER (
              PARTITION BY c.CardData, c.PortNum, CAST(c.DataTime * 86400 / ${DEDUP_SECONDS} AS BIGINT)
              ORDER BY c.CardRecordID DESC
            ) AS rn
          FROM CardRecord c WITH (NOLOCK)
          WHERE c.CardRecordID > ${lastKnownId}
        )
        SELECT TOP 50 *
        FROM NewRows
        WHERE rn = 1
        ORDER BY CardRecordID ASC
      `);

      if (result.recordset.length > 0) {
        const newRecords = result.recordset.map(r => enrichWithCache(r, personnelMap));
        const maxIdResult = await queryFn(`SELECT MAX(CardRecordID) AS MaxId FROM CardRecord WHERE CardRecordID > ${lastKnownId}`);
        const maxId = maxIdResult.recordset[0]?.MaxId;
        if (maxId) lastKnownId = maxId;

        broadcast({ type: 'new_scans', data: newRecords });
        console.log(`📡 Broadcasted ${newRecords.length} records (lastId=${lastKnownId})`);
      }
    } catch (_err) {
    } finally {
      isPolling = false;
    }
  }, 3000);
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
}

module.exports = { initWebSocket, broadcast, startPolling, stopPolling, enrichWithCache };
