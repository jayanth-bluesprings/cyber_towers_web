const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { config, validate } = require('./config');
const { initWebSocket, broadcast } = require('./websocket');
const apiRoutes = require('./routes/api');
const bridgeRoutes = require('./routes/bridge');
const controllerRoutes = require('./routes/controllers');
const cardRoutes = require('./routes/cards');
const eventRoutes = require('./routes/events');
const accessGroupRoutes = require('./routes/accessGroups');
const monitoringRoutes = require('./routes/monitoring');
const companyRoutes = require('./routes/companies');
const { testPgConnection, pgPool } = require('./pgdb');
const { requireApiKey } = require('./middleware/auth');
const { initCronJobs } = require('./services/cronJobs');
const temporalEvents = require('./temporalEvents');

// Validate environment before doing anything else (throws in production on errors).
validate();

const app = express();
const PORT = config.port;
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

function getAllowedOrigins() {
  const raw = config.allowedOrigins;
  if (!raw || raw === '*') return '*';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function hasFrontendBuild() {
  return fs.existsSync(frontendIndexPath);
}

// Behind a reverse proxy (nginx/IIS) trust the first hop so req.ip + rate-limit work.
if (config.trustProxy) app.set('trust proxy', 1);

// ── Security & performance middleware ────────────────────────────────────────
// CSP is disabled because the SPA + person-photo images are same-origin and a
// strict policy breaks Vite's inlined assets; all other helmet headers apply.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(compression());

// Middleware
app.use(cors({
  origin: getAllowedOrigins(),
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));
app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.jsonBodyLimit }));

// Rate limiter — applied to browser-facing /api routes only. The high-frequency
// localhost Bridge and Temporal /internal routes are deliberately exempt.
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests — slow down.' },
});

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// API Routes (rate-limited + API-key protected)
app.use('/api', apiLimiter, requireApiKey, apiRoutes);
app.use('/api/controllers', apiLimiter, requireApiKey, controllerRoutes);
app.use('/api/cards', apiLimiter, requireApiKey, cardRoutes);
app.use('/api/events', apiLimiter, requireApiKey, eventRoutes);
app.use('/api/access-groups', apiLimiter, requireApiKey, accessGroupRoutes);
app.use('/api/monitoring', apiLimiter, requireApiKey, monitoringRoutes);
app.use('/api/companies', apiLimiter, requireApiKey, companyRoutes);

// GET /api/users/:userId/cards
app.get('/api/users/:userId/cards', apiLimiter, requireApiKey, cardRoutes._getUserCards);

// Bridge internal routes — called by the Windows Bridge Service (localhost only, no auth)
app.use('/internal/bridge', bridgeRoutes);

// ── Internal routes for Temporal workflows ────────────────────────────────────
// These are called by the Temporal worker (localhost only), not the browser.
// No auth required — they're only reachable from the same machine.

// Convert a true-UTC ISO timestamp to "IST wall-clock expressed as fake UTC" —
// the same convention used by the TimeWatch DB so that formatTime() in the frontend
// displays the correct IST time after stripping the Z suffix.
// Example: "2026-06-09T13:29:05.000Z" (true UTC, = 18:59 IST) → "2026-06-09T18:59:05.000Z"
const IST_OFFSET_MS = 330 * 60 * 1000; // 5h 30m
function toFakeUtcIST(isoStr) {
  const ms = isoStr ? new Date(isoStr).getTime() : Date.now();
  return isNaN(ms) ? (isoStr || new Date().toISOString()) : new Date(ms + IST_OFFSET_MS).toISOString();
}

// WF7 → posts parking slot update after every entry/exit
// Worker calls: POST /internal/parking-update { type, vehicleNumber, companyName, occupiedSlots, totalSlots, ... }
app.post('/internal/parking-update', (req, res) => {
  const d = req.body;

  // Store in in-memory event store so stats/chart/report APIs reflect this immediately
  if (d.cardId) {
    temporalEvents.addEvent({
      type:          d.type,
      cardId:        d.cardId,
      vehicleNumber: d.vehicleNumber || '',
      gate:          d.gate          || 'GATE_1',
      personName:    d.personName    || '',
      companyCode:   d.companyCode   || '',
      timestamp:     d.timestamp     || new Date().toISOString(),
    });
  }

  // 1. Broadcast slot count change to any widgets listening for parkingUpdate
  broadcast({ type: 'parkingUpdate', data: d });

  // 2. Broadcast as bridge_event so LiveEntryExitPage picks it up via the new handler.
  //    ScanTime uses fake-UTC convention for legacy formatTime compatibility.
  const scanRecord = {
    id:             `temporal-${Date.now()}`,
    card_no:        d.cardId       || '',
    person_name:    d.personName   || '',
    company_code:   d.companyCode  || '',
    location_label: d.gate         || 'GATE_1',
    direction:      d.type === 'EXIT' ? 'Out' : 'In',
    event_date:     d.timestamp    || new Date().toISOString(),
    vehicle_number: d.vehicleNumber || '',
    vehicle_type:   '',
    access_result:  'Granted',
    source:         'Temporal',
  };
  broadcast({ type: 'bridge_event', data: scanRecord });

  console.log(`[Temporal] ${d.type} — ${d.personName || d.companyCode} | ${d.vehicleNumber} | ${d.gate} | ${d.occupiedSlots}/${d.totalSlots} slots`);
  res.json({ ok: true });
});

// Gate activities → posts gate open/deny/LED command
// Worker calls: POST /internal/gate-command { command, gate, message }
app.post('/internal/gate-command', (req, res) => {
  const d = req.body;
  broadcast({ type: 'gateCommand', data: d });
  console.log(`[Temporal] Gate ${d.command} → ${d.gate} | "${d.message}"`);
  res.json({ ok: true });
});
// ─────────────────────────────────────────────────────────────────────────────

// Health check — reports DB connectivity + uptime so load balancers can probe it.
app.get('/health', async (req, res) => {
  let db = 'unknown';
  try {
    await pgPool.query('SELECT 1');
    db = 'ok';
  } catch (_) {
    db = 'down';
  }
  const healthy = db === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db,
    env: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.use(express.static(frontendDistPath));

// Unknown /api routes get a JSON 404 (not the SPA shell).
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }

  if (hasFrontendBuild()) {
    return res.sendFile(frontendIndexPath);
  }

  return res.status(404).json({ error: 'Route not found' });
});

// Centralised error handler — never leak stack traces to clients in production.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err.message || err);
  const body = { success: false, error: 'Internal server error' };
  if (!config.isProd) body.detail = err.message;
  res.status(err.status || 500).json(body);
});

// Create HTTP server
const server = http.createServer(app);

// Init WebSocket
const wss = initWebSocket(server);

// Make broadcast available to route handlers (bridge routes use this)
app.locals.broadcast = broadcast;

// Init automated email cron jobs
initCronJobs();

// Start server
server.listen(PORT, () => {
  // Test PostgreSQL connection (non-fatal — runs in background)
  testPgConnection().catch(() => {});

  console.log(`\n🚀 Vehicle Access Backend running on port ${PORT} (env=${config.env})`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  if (hasFrontendBuild()) {
    console.log(`   App:       http://localhost:${PORT}`);
  } else {
    console.log(`   Frontend:  Build frontend/dist to serve the dashboard from this server`);
  }
  console.log(`   PostgreSQL: ${config.db.host}:${config.db.port}/${config.db.database}\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} received — closing gracefully…`);

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] Forced exit after 10s timeout.');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  try {
    if (wss) {
      wss.clients.forEach((c) => { try { c.terminate(); } catch (_) {} });
      await new Promise((resolve) => wss.close(resolve));
      console.log('[shutdown] WebSocket server closed.');
    }
    await new Promise((resolve) => server.close(resolve));
    console.log('[shutdown] HTTP server closed.');
    await pgPool.end();
    console.log('[shutdown] PostgreSQL pool drained.');
    clearTimeout(forceTimer);
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] Error during shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGBREAK', () => shutdown('SIGBREAK')); // Windows console / NSSM
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err.stack || err.message);
});

module.exports = server;
