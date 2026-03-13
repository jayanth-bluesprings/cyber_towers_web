const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { initWebSocket, startPolling } = require('./websocket');
const apiRoutes = require('./routes/api');
const { query } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

function hasFrontendBuild() {
  return fs.existsSync(frontendIndexPath);
}

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api', apiRoutes);

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
