# CyberTowers Vehicle Access Dashboard — Complete Implementation Roadmap

**Last Updated**: 2026-06-17  
**Status**: Phase 6 complete (Bridge Service files created); Phase 7 starting  
**User**: pavank@bluesprings.ai

---

## Overview

This document outlines all remaining work to make the CyberTowers vehicle access dashboard fully functional. It covers Bridge Service validation, real-time events, UI for access logs, and end-to-end testing.

### Quick Facts
- **Total Phases**: 12 (6 complete, 6 pending)
- **Pending Phases**: 7–12
- **Critical Path**: 7 → 8 → 9 (blocking full functionality)
- **Nice-to-Have**: 10–12

---

## Phase 7: Bridge Service Validation & Real-Time Events

**Goal**: Compile Bridge Service, verify no syntax errors, implement live event streaming.

### 7.1 Compile & Test Bridge Service (No Hardware Needed)

**Why**: Catch C# compilation errors before user tests on real hardware.

**Steps**:

1. Open PowerShell in `bridge\CyberTowers.Bridge` directory
   ```powershell
   cd "bridge\CyberTowers.Bridge"
   ```

2. Run `dotnet build` to compile
   ```powershell
   dotnet build -c Release
   ```
   - If errors: report them — likely missing namespaces or incorrect syntax
   - If warnings: acceptable (e.g., unused variables in stub)

3. Run in Development mode with stub SDK
   ```powershell
   $env:DOTNET_ENVIRONMENT = "Development"
   dotnet run
   ```
   - Should log: `[1] Started UDP discovery` / `[2] Connected to stub controller`
   - Should show heartbeat ticks every 10s
   - Let it run for 60s, verify no crashes

4. Test Express API integration
   - Ensure Express backend is running on `http://localhost:5000`
   - Bridge should POST to `/internal/bridge/controllers` on startup
   - Check Express logs for incoming requests

**Files**:
- No new files (validation only)

**Testing Checklist**:
- [ ] `dotnet build` succeeds
- [ ] `dotnet run` starts without exceptions
- [ ] Logs show UDP discovery cycle
- [ ] Logs show heartbeat events every 10s
- [ ] Express logs show API calls from Bridge (GET /internal/bridge/controllers, POST /internal/bridge/status)

---

### 7.2 Implement Live Event Streaming (Bridge → Express)

**Why**: Currently, Bridge batches events via `/internal/bridge/events/batch` every hour (sync). We need real-time event streaming as they happen.

**Architecture**:
```
FC8900 Controller (live access)
         ↓
Bridge ControllerSession (GetRecords streams events)
         ↓
Express POST /internal/bridge/events (one event = one POST)
         ↓
PostgreSQL scan_events table
         ↓
WebSocket broadcast to browser
```

**Changes to Make**:

#### 7.2.1 Modify `ControllerSession.cs` — Add Live Event Thread

**File**: `bridge/CyberTowers.Bridge/Services/ControllerSession.cs`

**Current Code** (SyncHistoricalAsync):
```csharp
public async Task SyncHistoricalAsync(CancellationToken ct)
{
    // Fetches old records once per hour
}
```

**New Code** (add live monitoring):
```csharp
// Add at class level:
private Task? _liveMonitorTask;
private int _lastLiveIndex = 0;

// Add method:
public async Task StartLiveMonitoringAsync(CancellationToken ct)
{
    _liveMonitorTask = Task.Run(async () =>
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!await EnsureConnectedAsync(ct)) 
                { 
                    await Task.Delay(5000, ct); 
                    continue; 
                }

                int total = await Task.Run(() => _sdk.GetRecordCount(0), ct);
                if (total > _lastLiveIndex)
                {
                    var records = await Task.Run(
                        () => _sdk.GetRecords(0, _lastLiveIndex, total - _lastLiveIndex), ct);

                    foreach (var r in records)
                    {
                        var evt = MapRecord(r, 0);
                        await _api.PostEventAsync(evt, ct);
                        _lastLiveIndex++;
                    }
                }

                await Task.Delay(2000, ct); // poll every 2 seconds
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Live monitoring error for {Sn}", _ctrl.Sn);
                await Task.Delay(5000, ct);
            }
        }
    }, ct);
}

// Stop live monitoring on disconnect
public void StopLiveMonitoring()
{
    // signal cancellation via CancellationToken
}
```

#### 7.2.2 Modify `BridgeWorker.cs` — Start Live Monitoring

**File**: `bridge/CyberTowers.Bridge/Workers/BridgeWorker.cs`

**Change**: After creating a ControllerSession, call `StartLiveMonitoringAsync`

```csharp
private ControllerSession CreateSession(ControllerRecord ctrl)
{
    var session = new ControllerSession(/* ... */);
    
    // Start live monitoring in background
    _ = Task.Run(() => session.StartLiveMonitoringAsync(_cancellationToken), _cancellationToken);
    
    return session;
}
```

**Testing**:
1. Start Bridge (stub or real controller)
2. Trigger a card access (scan card on controller or simulate in stub)
3. Check Express logs — should see `POST /internal/bridge/events` within 2–3 seconds
4. Verify event appears in `scan_events` table: `SELECT * FROM cybertowers.scan_events ORDER BY created_at DESC LIMIT 1;`

**Files Modified**:
- `bridge/CyberTowers.Bridge/Services/ControllerSession.cs` (add live monitoring methods)
- `bridge/CyberTowers.Bridge/Workers/BridgeWorker.cs` (call StartLiveMonitoringAsync)

**Estimated Time**: 2 hours

---

## Phase 8: Scan Events / Access Log UI

**Goal**: Create a frontend page to display access logs in real-time.

### 8.1 Create Access Events Table Schema (if needed)

**Current State**: `scan_events` table already exists from Phase 1 migration.

**Check columns**:
```sql
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'cybertowers' AND table_name = 'scan_events'
ORDER BY ordinal_position;
```

**Expected columns**:
- `id` (UUID)
- `controller_sn` (string)
- `card_no` (string)
- `event_date` (timestamp)
- `door_num` (int)
- `direction` (string: "In" | "Out" | "N/A")
- `record_type` (string)
- `event_code` (string)
- `access_result` (string: "Granted" | "Denied" | "Alarm" | "System" | "Unknown")
- `denial_reason` (string, nullable)
- `is_alert` (boolean)
- `alert_severity` (string, nullable)
- `source` (string: "Live" | "Sync")
- `created_at` (timestamp)

**If missing columns**: Run migration to add them.

### 8.2 Create Express API Endpoint — Fetch Events

**File**: `backend/routes/events.js` (NEW)

```javascript
const express = require('express');
const { scanEventsRepo } = require('../repositories');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// GET /api/events?controller=XXXX&door=1&result=Granted&from=2026-01-01&to=2026-12-31&limit=100
router.get('/', requireApiKey, async (req, res) => {
  try {
    const {
      controller,
      door,
      result,
      from,
      to,
      limit = 100,
      offset = 0,
    } = req.query;

    const events = await scanEventsRepo.listEvents({
      controllerSn: controller,
      doorNum: door ? parseInt(door) : null,
      accessResult: result,
      dateFrom: from ? new Date(from) : null,
      dateTo: to ? new Date(to) : null,
      limit: Math.min(parseInt(limit) || 100, 500), // cap at 500
      offset: parseInt(offset) || 0,
    });

    const total = await scanEventsRepo.countEvents({
      controllerSn: controller,
      doorNum: door ? parseInt(door) : null,
      accessResult: result,
      dateFrom: from ? new Date(from) : null,
      dateTo: to ? new Date(to) : null,
    });

    res.json({
      ok: true,
      events,
      total,
      limit: Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0,
    });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
```

**File**: `backend/repositories/scanEventsRepo.js` (NEW or EXTEND if exists)

```javascript
const { pool } = require('../db');

const scanEventsRepo = {
  async listEvents({
    controllerSn,
    doorNum,
    accessResult,
    dateFrom,
    dateTo,
    limit,
    offset,
  }) {
    let query = 'SELECT * FROM cybertowers.scan_events WHERE 1=1';
    const params = [];

    if (controllerSn) {
      params.push(controllerSn);
      query += ` AND controller_sn = $${params.length}`;
    }
    if (doorNum !== null && doorNum !== undefined) {
      params.push(doorNum);
      query += ` AND door_num = $${params.length}`;
    }
    if (accessResult) {
      params.push(accessResult);
      query += ` AND access_result = $${params.length}`;
    }
    if (dateFrom) {
      params.push(dateFrom);
      query += ` AND event_date >= $${params.length}`;
    }
    if (dateTo) {
      params.push(dateTo);
      query += ` AND event_date <= $${params.length}`;
    }

    query += ' ORDER BY event_date DESC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  },

  async countEvents({
    controllerSn,
    doorNum,
    accessResult,
    dateFrom,
    dateTo,
  }) {
    let query = 'SELECT COUNT(*) as total FROM cybertowers.scan_events WHERE 1=1';
    const params = [];

    if (controllerSn) {
      params.push(controllerSn);
      query += ` AND controller_sn = $${params.length}`;
    }
    if (doorNum !== null && doorNum !== undefined) {
      params.push(doorNum);
      query += ` AND door_num = $${params.length}`;
    }
    if (accessResult) {
      params.push(accessResult);
      query += ` AND access_result = $${params.length}`;
    }
    if (dateFrom) {
      params.push(dateFrom);
      query += ` AND event_date >= $${params.length}`;
    }
    if (dateTo) {
      params.push(dateTo);
      query += ` AND event_date <= $${params.length}`;
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].total);
  },

  async insertEvent(eventData) {
    const {
      controllerSn,
      cardNo,
      eventDate,
      doorNum,
      direction,
      recordType,
      eventCode,
      eventCodeInt,
      accessResult,
      denialReason,
      isAlert,
      alertSeverity,
      source,
    } = eventData;

    const query = `
      INSERT INTO cybertowers.scan_events (
        controller_sn, card_no, event_date, door_num, direction, 
        record_type, event_code, event_code_int, access_result, 
        denial_reason, is_alert, alert_severity, source, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *
    `;

    const result = await pool.query(query, [
      controllerSn,
      cardNo,
      eventDate,
      doorNum,
      direction,
      recordType,
      eventCode,
      eventCodeInt,
      accessResult,
      denialReason,
      isAlert,
      alertSeverity,
      source,
    ]);

    return result.rows[0];
  },
};

module.exports = { scanEventsRepo };
```

**File**: `backend/server.js` (MODIFY)

Add to route imports:
```javascript
const eventRoutes = require('./routes/events');
```

Add to route mounting:
```javascript
app.use('/api/events', requireApiKey, eventRoutes);
```

### 8.3 Create Frontend API Client

**File**: `frontend/src/api/index.js` (ADD to existing file)

```javascript
// Add to the exports:
export async function fetchEvents(filters = {}) {
  const params = new URLSearchParams();
  if (filters.controller) params.append('controller', filters.controller);
  if (filters.door) params.append('door', filters.door);
  if (filters.result) params.append('result', filters.result);
  if (filters.from) params.append('from', filters.from);
  if (filters.to) params.append('to', filters.to);
  if (filters.limit) params.append('limit', filters.limit);
  if (filters.offset) params.append('offset', filters.offset);

  const response = await fetch(`/api/events?${params}`, {
    headers: { 'Authorization': `Bearer ${getApiKey()}` },
  });
  if (!response.ok) throw new Error(`Fetch events failed: ${response.status}`);
  return response.json();
}
```

### 8.4 Create Events Tab in ConfigPage

**File**: `frontend/src/pages/ConfigPage.jsx` (MODIFY)

**Add new state**:
```javascript
// Events tab state
const [eventSearch, setEventSearch] = useState('');
const [eventFilterResult, setEventFilterResult] = useState(''); // Granted, Denied, etc.
const [eventFilterController, setEventFilterController] = useState('');
const [eventPage, setEventPage] = useState(0);
const [eventLoadingMore, setEventLoadingMore] = useState(false);
const [events, setEvents] = useState([]);
const [eventsTotal, setEventsTotal] = useState(0);
```

**Add API call** (using React Query):
```javascript
const eventQuery = useQuery({
  queryKey: [
    'events',
    eventFilterResult,
    eventFilterController,
    eventPage,
  ],
  queryFn: async () => {
    const res = await fetchEvents({
      controller: eventFilterController,
      result: eventFilterResult,
      limit: 50,
      offset: eventPage * 50,
    });
    return res;
  },
  enabled: activeTab === 'events',
  keepPreviousData: true,
});

useEffect(() => {
  if (eventQuery.data) {
    setEvents(eventQuery.data.events);
    setEventsTotal(eventQuery.data.total);
  }
}, [eventQuery.data]);
```

**Add WebSocket listener for real-time events**:
```javascript
useEffect(() => {
  const handleScanEvent = (event) => {
    // Prepend new event to list
    setEvents(prev => [event.detail, ...prev.slice(0, 49)]);
  };
  socket.addEventListener('scan_event', handleScanEvent);
  return () => socket.removeEventListener('scan_event', handleScanEvent);
}, []);
```

**Add Events Tab JSX**:
```jsx
{activeTab === 'events' && (
  <div className="space-y-4">
    <div className="flex gap-4">
      <input
        type="text"
        placeholder="Card #"
        value={eventSearch}
        onChange={(e) => setEventSearch(e.target.value)}
        className="px-3 py-2 border rounded"
      />
      <select
        value={eventFilterResult}
        onChange={(e) => setEventFilterResult(e.target.value)}
        className="px-3 py-2 border rounded"
      >
        <option value="">All Results</option>
        <option value="Granted">Granted</option>
        <option value="Denied">Denied</option>
        <option value="Alarm">Alarm</option>
      </select>
      <select
        value={eventFilterController}
        onChange={(e) => setEventFilterController(e.target.value)}
        className="px-3 py-2 border rounded"
      >
        <option value="">All Controllers</option>
        {controllers.map(c => (
          <option key={c.id} value={c.sn}>{c.location_label || c.sn}</option>
        ))}
      </select>
      <span className="text-sm text-gray-600 ml-auto">
        Total: {eventsTotal} events
      </span>
    </div>

    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-gray-100">
          <th className="border p-2 text-left">Time</th>
          <th className="border p-2 text-left">Card #</th>
          <th className="border p-2 text-left">Controller</th>
          <th className="border p-2 text-left">Door</th>
          <th className="border p-2 text-left">Direction</th>
          <th className="border p-2 text-left">Result</th>
          <th className="border p-2 text-left">Alert</th>
        </tr>
      </thead>
      <tbody>
        {events.filter(e => !eventSearch || e.card_no.includes(eventSearch)).map(e => (
          <tr key={e.id} className={e.access_result === 'Denied' ? 'bg-red-50' : ''}>
            <td className="border p-2">{new Date(e.event_date).toLocaleString()}</td>
            <td className="border p-2 font-mono">{e.card_no}</td>
            <td className="border p-2">{e.controller_sn}</td>
            <td className="border p-2">{e.door_num}</td>
            <td className="border p-2">{e.direction}</td>
            <td className="border p-2">
              <span className={`px-2 py-1 rounded text-xs font-bold ${
                e.access_result === 'Granted' ? 'bg-green-200 text-green-800' :
                e.access_result === 'Denied' ? 'bg-red-200 text-red-800' :
                'bg-yellow-200 text-yellow-800'
              }`}>
                {e.access_result}
              </span>
            </td>
            <td className="border p-2">
              {e.is_alert && <span className="bg-red-500 text-white px-2 py-1 rounded text-xs">⚠ {e.alert_severity}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    <div className="flex justify-between items-center">
      <button
        onClick={() => setEventPage(p => Math.max(0, p - 1))}
        disabled={eventPage === 0}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
      >
        ← Previous
      </button>
      <span className="text-sm">Page {eventPage + 1} of {Math.ceil(eventsTotal / 50)}</span>
      <button
        onClick={() => setEventPage(p => p + 1)}
        disabled={(eventPage + 1) * 50 >= eventsTotal}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
      >
        Next →
      </button>
    </div>
  </div>
)}
```

### 8.5 Modify Express to Broadcast Events to Browser

**File**: `backend/routes/bridge.js` (MODIFY `/internal/bridge/events` route)

```javascript
// POST /internal/bridge/events
router.post('/events', async (req, res) => {
  try {
    const event = req.body; // EventIngestDto from Bridge
    const saved = await scanEventsRepo.insertEvent(event);

    // ← ADD BROADCAST HERE
    io.emit('scan_event', saved);

    res.json({ ok: true, id: saved.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Files Modified**:
- `backend/routes/events.js` (NEW)
- `backend/repositories/scanEventsRepo.js` (NEW)
- `backend/server.js` (add event routes)
- `backend/routes/bridge.js` (add WebSocket broadcast)
- `frontend/src/api/index.js` (add fetchEvents)
- `frontend/src/pages/ConfigPage.jsx` (add Events tab + real-time listener)

**Estimated Time**: 4 hours

**Testing**:
1. Start Bridge (stub or real)
2. Open ConfigPage → Events tab
3. Trigger an access event (scan card or simulate)
4. Verify event appears in table within 2–3 seconds
5. Test filters: controller, access result, search by card #
6. Test pagination

---

## Phase 9: Card Removal Workflow

**Goal**: Allow users to delete cards from controllers.

### 9.1 Add Card Remove Button to Cards Tab

**File**: `frontend/src/pages/ConfigPage.jsx` (MODIFY CardsTab)

Add state:
```javascript
const [removeDialog, setRemoveDialog] = useState(null); // { cardId, cardNo }
```

Add action column to cards table:
```jsx
<td className="border p-2">
  <button
    onClick={() => setRemoveDialog({ cardId: card.id, cardNo: card.card_no })}
    className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
  >
    Remove from Controllers
  </button>
</td>
```

Add remove dialog:
```jsx
{removeDialog && (
  <dialog open className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
    <div className="bg-white p-6 rounded shadow-lg max-w-sm">
      <h3 className="text-lg font-bold mb-4">Remove Card from All Controllers?</h3>
      <p className="mb-4">
        Card <code>{removeDialog.cardNo}</code> will be deleted from all online controllers.
        This cannot be undone.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => setRemoveDialog(null)}
          className="px-4 py-2 bg-gray-300 rounded"
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            await removeCardFromControllers(removeDialog.cardId);
            setRemoveDialog(null);
          }}
          className="px-4 py-2 bg-red-600 text-white rounded"
        >
          Confirm Remove
        </button>
      </div>
    </div>
  </dialog>
)}
```

### 9.2 Create Express API Endpoint

**File**: `backend/routes/cards.js` (MODIFY POST /bulk-remove or add new route)

```javascript
// POST /api/cards/:id/remove-all
// Queues the card for deletion on all controllers
router.post('/:id/remove-all', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const card = await cardsRepo.getCardById(id);
    if (!card) return res.status(404).json({ ok: false, error: 'Card not found' });

    // Get all active controllers
    const controllers = await controllersRepo.listControllers({ isActive: true });

    // Insert a remove job for each controller
    const jobs = [];
    for (const ctrl of controllers) {
      const job = await cardPushLogRepo.createRemoveJob({
        card_id: id,
        controller_id: ctrl.id,
        controller_sn: ctrl.sn,
        card_no: card.card_no,
      });
      jobs.push(job);
    }

    res.json({ ok: true, jobs_created: jobs.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

### 9.3 Modify Bridge to Handle Card Removal

**File**: `bridge/CyberTowers.Bridge/Services/CardPushService.cs` (MODIFY)

Add method to poll and process remove jobs:
```csharp
public async Task PollAndRemoveAsync(CancellationToken ct)
{
    // Similar to PollAndPushAsync, but calls session.DeleteCardAsync
    // instead of WriteCardAsync
}
```

**File**: `bridge/CyberTowers.Bridge/Workers/BridgeWorker.cs` (MODIFY)

Add timer for removal polling (every 10s, same as push):
```csharp
if ((now - _lastCardRemoveTime).TotalSeconds >= _opts.CardPushPollIntervalSeconds)
{
    _lastCardRemoveTime = now;
    _cardPush.Sessions = _sessions;
    try { await _cardPush.PollAndRemoveAsync(stoppingToken); }
    catch (Exception ex)
    { _log.LogWarning(ex, "Card removal poll error"); }
}
```

### 9.4 Update Frontend API

**File**: `frontend/src/api/index.js` (ADD)

```javascript
export async function removeCardFromControllers(cardId) {
  const response = await fetch(`/api/cards/${cardId}/remove-all`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getApiKey()}` },
  });
  if (!response.ok) throw new Error(`Remove card failed: ${response.status}`);
  return response.json();
}
```

**Files Modified**:
- `backend/routes/cards.js` (add remove endpoint)
- `backend/repositories/cardPushLogRepo.js` (add createRemoveJob method)
- `bridge/CyberTowers.Bridge/Services/CardPushService.cs` (add PollAndRemoveAsync)
- `bridge/CyberTowers.Bridge/Workers/BridgeWorker.cs` (add remove poll timer)
- `frontend/src/api/index.js` (add removeCardFromControllers)
- `frontend/src/pages/ConfigPage.jsx` (add remove button + dialog)

**Estimated Time**: 2 hours

**Testing**:
1. Add a card to a controller (Phase 5)
2. Click "Remove from Controllers"
3. Confirm dialog
4. Bridge should call `DelCardMain` on controller
5. Verify card is no longer on controller

---

## Phase 10: Access Group Scoping

**Goal**: Cards push only to controllers in their assigned access group.

### 10.1 Link Cards ↔ Controllers via Access Groups

**Database**: Access groups already have a controller_ids JSONB field. Cards have an access_group_id.

**Logic**:
```
Card → access_group_id → AccessGroup.controller_ids (array) → which controllers to push to
```

### 10.2 Modify Card Push Service

**File**: `bridge/CyberTowers.Bridge/Services/CardPushService.cs` (MODIFY ProcessCardAsync)

```csharp
private async Task ProcessCardAsync(PendingCard card, CancellationToken ct)
{
    // Instead of pushing to all online controllers,
    // fetch the access group and only push to specified controllers

    if (string.IsNullOrEmpty(card.AccessGroupId))
    {
        // No access group = don't push
        _log.LogWarning("Card {CardNo} has no access group — skipping push", card.CardNo);
        return;
    }

    // Get the access group from Express (add new API endpoint)
    var group = await _api.GetAccessGroupAsync(card.AccessGroupId, ct);
    if (group?.ControllerIds == null || group.ControllerIds.Count == 0)
    {
        _log.LogWarning("Access group {GroupId} has no controllers", card.AccessGroupId);
        return;
    }

    // Push to specified controllers only
    foreach (var controllerSn in group.ControllerIds)
    {
        if (!Sessions.TryGetValue(controllerSn, out var session))
        {
            _log.LogWarning("Controller {Sn} not found for card {CardNo}", controllerSn, card.CardNo);
            continue;
        }
        if (ct.IsCancellationRequested) break;
        await PushToControllerWithRetryAsync(card, session, ct);
    }
}
```

### 10.3 Add Express Endpoint to Get Access Group

**File**: `backend/routes/api.js` or `backend/routes/accessGroups.js` (ADD or MODIFY)

```javascript
router.get('/access-groups/:id', requireApiKey, async (req, res) => {
  try {
    const group = await accessGroupsRepo.getById(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: group });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

### 10.4 Add to ExpressApiClient

**File**: `bridge/CyberTowers.Bridge/Services/ExpressApiClient.cs` (ADD)

```csharp
public async Task<dynamic?> GetAccessGroupAsync(string groupId, CancellationToken ct = default)
{
    try
    {
        return await _http.GetFromJsonAsync<dynamic>(
            $"api/access-groups/{groupId}", ct);
    }
    catch (Exception ex)
    {
        _log.LogWarning(ex, "Failed to fetch access group {GroupId}", groupId);
        return null;
    }
}
```

**Files Modified**:
- `backend/routes/api.js` (add GET /access-groups/:id)
- `bridge/CyberTowers.Bridge/Services/ExpressApiClient.cs` (add GetAccessGroupAsync)
- `bridge/CyberTowers.Bridge/Services/CardPushService.cs` (modify ProcessCardAsync to use access groups)

**Estimated Time**: 1.5 hours

**Testing**:
1. Create an access group with 2 controllers
2. Assign a card to that access group
3. Push card
4. Verify card appears only on the 2 assigned controllers, not others

---

## Phase 11: Bridge Monitoring & Status Dashboard

**Goal**: Show Bridge health, controller status, push metrics in the UI.

### 11.1 Create Bridge Status Endpoint

**File**: `backend/routes/bridge.js` (MODIFY or ADD new endpoint)

```javascript
// GET /internal/bridge/status
router.get('/status', async (req, res) => {
  try {
    const stats = {
      lastHeartbeat: new Date(),
      controllersOnline: await db.query(
        'SELECT COUNT(*) as count FROM cybertowers.controllers WHERE is_online = true'
      ).then(r => r.rows[0].count),
      controllersTotal: await db.query(
        'SELECT COUNT(*) as count FROM cybertowers.controllers'
      ).then(r => r.rows[0].count),
      pendingCardPushes: await db.query(
        'SELECT COUNT(*) as count FROM cybertowers.card_push_log WHERE status = \'Pending\''
      ).then(r => r.rows[0].count),
      failedCardPushes: await db.query(
        'SELECT COUNT(*) as count FROM cybertowers.card_push_log WHERE status = \'Failed\''
      ).then(r => r.rows[0].count),
      lastEventTime: await db.query(
        'SELECT event_date FROM cybertowers.scan_events ORDER BY event_date DESC LIMIT 1'
      ).then(r => r.rows[0]?.event_date || null),
    };
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

### 11.2 Create Frontend Dashboard Widget

**File**: `frontend/src/pages/Dashboard.jsx` (MODIFY or ADD Bridge status section)

```jsx
const BridgeStatusWidget = () => {
  const { data: status, isLoading, isError } = useQuery({
    queryKey: ['bridgeStatus'],
    queryFn: async () => {
      const res = await fetch('/api/bridge/status', {
        headers: { 'Authorization': `Bearer ${getApiKey()}` },
      });
      return res.json();
    },
    refetchInterval: 30000, // poll every 30s
  });

  if (isLoading) return <div>Loading Bridge status...</div>;
  if (isError) return <div className="text-red-500">Bridge status unavailable</div>;

  return (
    <div className="bg-white p-6 rounded shadow-lg">
      <h2 className="text-xl font-bold mb-4">Bridge Service Status</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="border p-3 rounded">
          <p className="text-sm text-gray-600">Controllers Online</p>
          <p className="text-2xl font-bold text-green-600">
            {status.stats.controllersOnline} / {status.stats.controllersTotal}
          </p>
        </div>
        <div className="border p-3 rounded">
          <p className="text-sm text-gray-600">Pending Card Pushes</p>
          <p className={`text-2xl font-bold ${status.stats.pendingCardPushes > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
            {status.stats.pendingCardPushes}
          </p>
        </div>
        <div className="border p-3 rounded">
          <p className="text-sm text-gray-600">Failed Pushes (last 24h)</p>
          <p className={`text-2xl font-bold ${status.stats.failedCardPushes > 5 ? 'text-red-600' : 'text-green-600'}`}>
            {status.stats.failedCardPushes}
          </p>
        </div>
        <div className="border p-3 rounded">
          <p className="text-sm text-gray-600">Last Event</p>
          <p className="text-sm font-mono">
            {status.stats.lastEventTime 
              ? new Date(status.stats.lastEventTime).toLocaleString()
              : 'No events'}
          </p>
        </div>
      </div>
    </div>
  );
};
```

### 11.3 Create Controller Details Endpoint

**File**: `backend/routes/controllers.js` (MODIFY GET /:id)

```javascript
// GET /api/controllers/:id/details
router.get('/:id/details', requireApiKey, async (req, res) => {
  try {
    const ctrl = await controllersRepo.getControllerById(req.params.id);
    if (!ctrl) return res.status(404).json({ ok: false, error: 'Not found' });

    // Get status
    const status = await db.query(
      'SELECT * FROM cybertowers.controller_status WHERE controller_sn = $1 ORDER BY updated_at DESC LIMIT 1',
      [ctrl.sn]
    );

    // Get recent push results
    const pushResults = await db.query(
      'SELECT * FROM cybertowers.card_push_log WHERE controller_sn = $1 ORDER BY started_at DESC LIMIT 10',
      [ctrl.sn]
    );

    res.json({
      ok: true,
      controller: ctrl,
      status: status.rows[0] || null,
      recentPushes: pushResults.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Files Modified**:
- `backend/routes/bridge.js` (add GET /internal/bridge/status)
- `backend/routes/controllers.js` (add GET /:id/details)
- `frontend/src/pages/Dashboard.jsx` (add BridgeStatusWidget)
- `frontend/src/pages/ConfigPage.jsx` (show controller details modal with push history)

**Estimated Time**: 2 hours

**Testing**:
1. Open Dashboard → Bridge Status widget
2. Verify controller counts update every 30s
3. Click on a controller in ConfigPage → see details modal with recent push history
4. Trigger a card push, verify pending count increments

---

## Phase 12: Production Deployment & Hardening

**Goal**: Prepare the full system for production use.

### 12.1 Environment Configuration

**Files**:
- `backend/.env.production` — production secrets (DB URL, API keys, etc.)
- `bridge/CyberTowers.Bridge/appsettings.Production.json` — production Bridge config
- `.github/workflows/deploy.yml` — CI/CD pipeline (if using GitHub)

### 12.2 Database Backups

Create a backup schedule:
```bash
# Cron job to backup PostgreSQL daily
0 2 * * * pg_dump cybertowers_access > /backups/cybertowers_$(date +\%Y\%m\%d).sql
```

### 12.3 Bridge Service Monitoring

Add Windows Task Scheduler job to monitor Bridge service health:
```powershell
# If service crashes, automatically restart it
$trigger = New-ScheduledTaskTrigger -AtStartup
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-Command 'Start-Service -Name CyberTowersBridge -ErrorAction SilentlyContinue'"
Register-ScheduledTask -TaskName "RestartBridgeService" -Trigger $trigger -Action $action -RunLevel Highest
```

### 12.4 Security Hardening

| Item | Details |
|------|---------|
| **API Key Rotation** | Implement key rotation in Express (invalidate old keys after 90 days) |
| **HTTPS** | Enable SSL/TLS for Express (use Let's Encrypt or self-signed cert) |
| **Network Isolation** | Bridge should run on DMZ, restrict access to controller LAN only |
| **Audit Logging** | Log all card push/remove operations with user who requested it |
| **Rate Limiting** | Add rate limiting to Express endpoints to prevent abuse |
| **Database Encryption** | Enable encryption at rest for PostgreSQL (pgcrypto or native) |

### 12.5 Performance Testing

- Load test with 100+ concurrent users
- Test Bridge with 50+ controllers
- Verify event ingestion can handle 100+ events/second
- Test card push with 1000+ cards

### 12.6 Documentation

| Document | Contents |
|----------|----------|
| **DEPLOYMENT.md** | Step-by-step production deployment guide |
| **RUNBOOK.md** | Operational procedures (monitoring, troubleshooting, escalation) |
| **API.md** | OpenAPI/Swagger spec for all `/api/*` endpoints |
| **ARCHITECTURE.md** | System design overview, data flows, tech stack |

**Files to Create**:
- `DEPLOYMENT.md`
- `RUNBOOK.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `backend/.env.production`
- `bridge/appsettings.Production.json`
- `.github/workflows/deploy.yml` (optional, if using GitHub Actions)

**Estimated Time**: 4–6 hours (depends on deployment platform)

---

## Summary Table

| Phase | Feature | Dependencies | Status | Est. Time |
|-------|---------|--------------|--------|-----------|
| 7 | Bridge Service validation & live events | — | Pending | 2 hours |
| 8 | Scan events / Access log UI | Phase 7 | Pending | 4 hours |
| 9 | Card removal workflow | Phase 8 | Pending | 2 hours |
| 10 | Access group scoping | Phase 9 | Pending | 1.5 hours |
| 11 | Bridge monitoring & dashboard | Phase 10 | Pending | 2 hours |
| 12 | Production deployment | Phase 11 | Pending | 4–6 hours |
| **Total** | | | | **15.5–17.5 hours** |

---

## Critical Path (Minimum Viable Product)

To get a working system:

1. ✅ Phase 6: Bridge Service files (DONE)
2. **→ Phase 7**: Compile Bridge, verify no errors
3. **→ Phase 8**: Events UI (so you can see what's happening)
4. **→ Phase 9**: Card removal (complete CRUD)
5. **→ Phase 11**: Bridge monitoring (so you know service health)

**Est. 2–3 days for a working MVP.**

---

## Next Steps

1. **Read this document** with the user to confirm understanding
2. **Start Phase 7** — compile Bridge, verify it runs
3. **Report any compilation errors** — we'll fix them
4. **Once Phase 7 passes, move to Phase 8** — Events UI
5. Continue sequentially through remaining phases

---

**Questions?** For each phase, we'll provide exact code snippets and walk through implementation step by step.
