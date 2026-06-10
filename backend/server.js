const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { initWebSocket, startPolling, broadcast } = require('./websocket');
const apiRoutes = require('./routes/api');
const { query } = require('./db');
const { requireApiKey } = require('./middleware/auth');
const { initCronJobs } = require('./services/cronJobs');
const temporalEvents = require('./temporalEvents');

const app = express();
const PORT = process.env.PORT || 5000;
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '*';
  if (!raw || raw === '*') return '*';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function hasFrontendBuild() {
  return fs.existsSync(frontendIndexPath);
}

// Middleware
app.use(cors({
  origin: getAllowedOrigins(),
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api', requireApiKey, apiRoutes);

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

  // 2. Also broadcast as a new_scans event so the Live Entry/Exit table shows
  //    the Temporal-processed scan immediately — without waiting for the DB poll.
  //    CardRecordID uses Date.now() (13-digit ms timestamp) which will never clash
  //    with real TimeWatch sequential IDs (typically 6-8 digits).
  //    ScanTime is converted to "IST as fake UTC" to match the DB convention that
  //    the frontend formatTime() function expects.
  const scanRecord = {
    CardRecordID: Date.now(),
    CardData:     d.cardId       || '',
    PName:        d.personName   || '',
    PCode:        d.companyCode  || '',
    DeptName:     d.companyName  || d.companyCode || '',
    EquptName:    d.gate         || 'GATE_1',
    PortNum:      d.type === 'EXIT' ? 2 : 1,
    ScanTime:     toFakeUtcIST(d.timestamp),
    CarNumber:    d.vehicleNumber || null,
    vehicleType:  '-',
    flatNumber:   null,
    Addr:         null,
  };
  broadcast({ type: 'new_scans', data: [scanRecord] });

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use(express.static(frontendDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }

  if (hasFrontendBuild()) {
    return res.sendFile(frontendIndexPath);
  }

  return res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Create HTTP server
const server = http.createServer(app);

// Init WebSocket
const wss = initWebSocket(server);

// Start DB polling for live updates
startPolling((q) => query(q));

// Init automated email cron jobs
initCronJobs();

// Start server
server.listen(PORT, () => {
  console.log(`\n🚀 Vehicle Access Backend running on port ${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  if (hasFrontendBuild()) {
    console.log(`   App:       http://localhost:${PORT}`);
  } else {
    console.log(`   Frontend:  Build frontend/dist to serve the dashboard from this server`);
  }
  console.log(`\n   DB Server: ${process.env.DB_SERVER}`);
  console.log(`   Database:  ${process.env.DB_DATABASE}\n`);
});

module.exports = server;
