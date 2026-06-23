const WebSocket = require('ws');
const { isAuthorizedApiKey } = require('./middleware/auth');

let wss = null;

function initWebSocket(server) {
  wss = new WebSocket.Server({
    server,
    verifyClient: ({ req }, done) => {
      try {
        const requestUrl = new URL(req.url, 'http://localhost');
        const apiKey = requestUrl.searchParams.get('apiKey');
        if (isAuthorizedApiKey(apiKey)) return done(true);
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

module.exports = { initWebSocket, broadcast };
