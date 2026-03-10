# Vehicle Access Dashboard

A real-time vehicle access monitoring dashboard connected to the **TimeWatch** SQL Server database.

## Project Structure

```
vehicle-access-dashboard/
├── backend/          # Node.js + Express API
└── frontend/         # Vite + React + Tailwind dashboard
```

---

## Quick Start

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your SQL Server credentials
npm start
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open: **http://localhost:3000**

---

## Environment Variables (backend/.env)

```
DB_SERVER=localhost
DB_DATABASE=TimeWatch
DB_USER=sa
DB_PASSWORD=yourpassword
PORT=5000
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/live | Latest 100 access events |
| GET | /api/new?lastId=# | Events newer than lastId |
| GET | /api/search?q=# | Search by card/name/flat |
| GET | /api/vehicle-stats | Daily stats (last 30 days) |
| GET | /api/vehicle-type-count | 2W / 4W / Other counts |
| GET | /api/vehicle-count | Day / Week / Month totals |
| GET | /health | Health check |

---

## WebSocket

Connect to `ws://localhost:5000`

Messages:
- `{ type: "connected" }` — on connect
- `{ type: "new_scans", data: [...] }` — new CardRecord rows pushed every 3s

---

## Features

- ✅ Live table with WebSocket push updates
- ✅ Highlights new rows on arrival
- ✅ Illegal card detection
- ✅ Search by Card ID, Name, Flat Number
- ✅ CSV export
- ✅ Vehicle type badges (2W / 4W)
- ✅ Stats cards (Today / Week / Month)
- ✅ Stacked bar chart by day
- ✅ Doughnut chart by vehicle type
- ✅ Dark mode toggle
- ✅ Responsive mobile layout

---

## Database Notes

- **Read-only** — no writes to TimeWatch
- `DataTime` is in Access serial format, converted via:
  ```sql
  DATEADD(SECOND, DataTime * 86400, '1899-12-30')
  ```
- Vehicle type detection: `CardData LIKE '2W%'` → Two-Wheeler, `4W%` → Four-Wheeler
