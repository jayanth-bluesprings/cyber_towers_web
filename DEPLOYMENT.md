# CyberTowers Vehicle Access Dashboard — Deployment Guide

Production deployment, hardening, and operations runbook (Phase 12).

---

## 1. Architecture at a glance

```
┌──────────────┐   HTTPS    ┌─────────────────────┐   TCP/UDP   ┌────────────────┐
│   Browser    │ ─────────▶ │  Express backend    │ ──────────▶ │  FC8900        │
│  (SPA build) │ ◀───────── │  + WebSocket + SPA  │             │  controllers   │
└──────────────┘   WS       └─────────┬───────────┘             └────────▲───────┘
                                      │ PG                                │
                              ┌───────▼────────┐        localhost HTTP    │
                              │  PostgreSQL    │ ◀──────────────────┐     │
                              │ cybertowers_…  │                    │     │
                              └────────────────┘        ┌───────────┴─────┴──┐
                                                         │  Bridge Service     │
                                                         │  (Windows, C#/.NET) │
                                                         └─────────────────────┘
```

- **Backend** serves the built frontend, the REST API (`/api`, API-key protected, rate-limited), internal Bridge routes (`/internal/bridge`, localhost only), and the WebSocket stream.
- **Bridge Service** runs on the same LAN as the controllers and talks to Express over localhost `/internal` routes.

---

## 2. Prerequisites

| Component   | Version            | Notes                                   |
|-------------|--------------------|-----------------------------------------|
| Node.js     | 18 LTS or 20 LTS   | Backend + frontend build                |
| PostgreSQL  | 14+                | `gen_random_uuid()` requires `pgcrypto` |
| .NET        | 8.0 (x86)          | Bridge Service only                     |
| OS          | Windows Server 2019+ | Bridge must run on Windows            |

---

## 3. First-time setup

```powershell
# 1. Backend dependencies
cd backend
npm ci --omit=dev          # production install

# 2. Configure environment
copy .env.example .env
#    → edit .env: set NODE_ENV=production, API_KEY, BRIDGE_ENCRYPTION_KEY,
#      ALLOWED_ORIGINS, PG_* credentials. Generate secrets with:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Create the database schema (first install only)
psql -U postgres -d cybertowers_access -f database\cybertowers_access_schema.sql

# 4. Apply migrations (idempotent, tracked in schema_migrations)
npm run migrate

# 5. Build the frontend
cd ..\frontend
npm ci
npm run build              # outputs frontend/dist, served by the backend

# 6. Start
cd ..\backend
npm start                  # or install as a Windows service (section 6)
```

Browse to `http://<host>:5000` (or behind your reverse proxy on 443).

---

## 4. Security hardening (built in)

The backend enforces the following automatically:

- **Config validation** (`config.js`) — in `NODE_ENV=production` the server **refuses to start** if `API_KEY` is missing/weak, `ALLOWED_ORIGINS` is `*`, or `BRIDGE_ENCRYPTION_KEY` is missing/short.
- **Helmet** security headers on every response.
- **Rate limiting** on `/api/*` (default 300 req/min/IP, tunable via `RATE_LIMIT_*`). Internal Bridge/Temporal routes are exempt.
- **API-key auth** (`X-API-Key` header) on all `/api/*` routes.
- **Body size limits** (`JSON_BODY_LIMIT`, default 1 MB).
- **No stack traces** leak to clients in production; errors return generic JSON.
- **Parameterised SQL** everywhere (no string interpolation of user input).
- **Controller passwords** encrypted at rest with AES-256 (`BRIDGE_ENCRYPTION_KEY`).
- **Graceful shutdown** on SIGTERM/SIGINT — drains WebSocket clients, HTTP server, and the PG pool.

### Operator checklist
- [ ] `.env` is **not** committed (it is git-ignored; rotate any secret ever committed).
- [ ] `NODE_ENV=production`.
- [ ] `ALLOWED_ORIGINS` lists only your real dashboard origin(s).
- [ ] `TRUST_PROXY=true` if running behind nginx/IIS.
- [ ] TLS terminated at the reverse proxy; only 443 exposed publicly.
- [ ] `/internal/bridge` is **not** reachable from outside the host (firewall + localhost binding).
- [ ] PostgreSQL not exposed to the public internet.

---

## 5. Reverse proxy (nginx example)

```nginx
server {
    listen 443 ssl;
    server_name access.yourdomain.com;

    ssl_certificate     /etc/ssl/access.crt;
    ssl_certificate_key /etc/ssl/access.key;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;       # WebSocket
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Set `TRUST_PROXY=true` in `.env` so client IPs and rate limiting are accurate.

---

## 6. Running as a Windows service

Use [NSSM](https://nssm.cc/) to supervise `node server.js`:

```powershell
nssm install CyberTowersBackend "C:\Program Files\nodejs\node.exe" "server.js"
nssm set CyberTowersBackend AppDirectory "C:\apps\vehicle-access-dashboard\backend"
nssm set CyberTowersBackend AppEnvironmentExtra NODE_ENV=production
nssm set CyberTowersBackend Start SERVICE_AUTO_START
nssm start CyberTowersBackend
```

The Bridge Service has its own installer — see `bridge/install-service.ps1`.

---

## 7. Backups

Nightly compressed backups with 14-day retention:

```powershell
# Manual run
powershell -ExecutionPolicy Bypass -File backend\database\backup.ps1

# Restore a specific archive
powershell -File backend\database\backup.ps1 -Restore -File backend\database\backups\cybertowers_access_20260618_020000.dump
```

Schedule it (Task Scheduler, runs 02:00 daily):

```powershell
schtasks /create /tn "CyberTowers DB Backup" /tr ^
  "powershell -ExecutionPolicy Bypass -File C:\apps\vehicle-access-dashboard\backend\database\backup.ps1" ^
  /sc daily /st 02:00 /ru SYSTEM
```

`pg_dump`/`pg_restore` must be on PATH (add `C:\Program Files\PostgreSQL\<ver>\bin`).

---

## 8. Health monitoring

`GET /health` returns HTTP 200 when healthy, 503 when the database is unreachable:

```json
{ "status": "ok", "db": "ok", "env": "production", "uptimeSeconds": 3600, "time": "…" }
```

Point your uptime monitor / load balancer probe at this endpoint. The in-app
**Bridge Monitor** tab (Config page) shows live controller health, push queue,
sync activity, and recent failures.

---

## 9. Upgrades

```powershell
git pull
cd backend && npm ci --omit=dev && npm run migrate
cd ..\frontend && npm ci && npm run build
# restart the service
nssm restart CyberTowersBackend
```

`npm run migrate` only applies migrations not yet recorded in
`cybertowers.schema_migrations`, so it is safe to run on every deploy.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Server exits immediately in prod | Config validation failed | Read the printed list; fix `.env` |
| `relation … does not exist` | Migrations not applied | `npm run migrate` |
| 401 on every API call | `API_KEY` mismatch | Align frontend `VITE_API_KEY` with backend `API_KEY` |
| 429 Too many requests | Rate limit hit | Raise `RATE_LIMIT_MAX` or check for a runaway client |
| Controllers show "Offline" | No Bridge heartbeats | Check Bridge Service is running and can reach Express |
| WebSocket won't connect behind proxy | Missing upgrade headers | Add the `Upgrade`/`Connection` headers (section 5) |
