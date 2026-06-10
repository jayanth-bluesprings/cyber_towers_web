# Temporal Workflows — Vehicle Access Dashboard (Cyber Towers)
### Document Version 1.0 | For Review

---

## Table of Contents

1. [What is Temporal — A Quick Reference](#1-what-is-temporal)
2. [Why This Project Needs Temporal](#2-why-this-project-needs-temporal)
3. [Current Problems in the Codebase](#3-current-problems-in-the-codebase)
4. [Workflow 1 — Vehicle Session Lifecycle](#workflow-1--vehicle-session-lifecycle)
5. [Workflow 2 — Overstay Alert & Escalation](#workflow-2--overstay-alert--escalation)
6. [Workflow 3 — Unauthorized Vehicle Approval](#workflow-3--unauthorized-vehicle-approval)
7. [Workflow 4 — Daily Summary Report](#workflow-4--daily-summary-report)
8. [Workflow 5 — Weekly Analytics Report](#workflow-5--weekly-analytics-report)
9. [Workflow 6 — Gate Health Monitor](#workflow-6--gate-health-monitor)
10. [Workflow 7 — Parking Slot Management](#workflow-7--parking-slot-management)
11. [Workflow 8 — Vehicle Registry Sync](#workflow-8--vehicle-registry-sync)
12. [Workflow Relationship Map](#12-workflow-relationship-map)
13. [Implementation Priority Order](#13-implementation-priority-order)

---

## 1. What is Temporal

Temporal is a **durable workflow execution platform**. It runs your business logic as code — but survives crashes, restarts, and failures automatically.

**Key Concepts you need to know:**

| Concept | What it means in simple terms |
|---------|-------------------------------|
| **Workflow** | A function that describes a long-running business process. It can sleep for hours/days and resume exactly where it left off. |
| **Activity** | A single unit of work inside a workflow — like sending an email, querying the DB, or writing a record. Activities are retried automatically if they fail. |
| **Signal** | A message sent INTO a running workflow from outside. Like telling a waiting workflow "the vehicle has now exited". |
| **Query** | Reading the current state of a running workflow without changing it. Like asking "is this vehicle still inside?" |
| **Timer** | `await sleep('24 hours')` — survives server restarts. Temporal remembers the timer even if your server goes down and comes back up. |
| **Schedule** | Run a workflow on a cron schedule. Replaces `node-cron`. |
| **Worker** | The process that runs your workflow and activity code. Your Node.js server runs a Temporal Worker. |

---

## 2. Why This Project Needs Temporal

The vehicle access dashboard has several business processes that are **time-sensitive**, **stateful**, and **must not be lost** even if the server restarts:

- A vehicle enters and must be tracked for the next 24+ hours
- An unauthorized vehicle needs a security officer to approve it — that approval process has a timeout
- Emails must be sent at exactly the right time, even if the server was down at that moment
- Gate RFID readers can go offline — someone must be notified
- Parking conflicts must be resolved — a workflow should wait for human input

Currently, all of this is handled by:
- `node-cron` (which forgets everything on restart)
- In-memory JavaScript objects (lost on crash)
- `localStorage` in the browser (not reliable for business workflows)

**Temporal replaces and enhances all of these.**

---

## 3. Current Problems in the Codebase

Here is a precise mapping of what exists today and what the problem is:

### Problem 1 — `backend/services/cronJobs.js`

```javascript
// Line 7 — In-memory store for 24h warnings
const warned24hVehicles = {};
// This dictionary is wiped out every time the server restarts.
// If the server crashes at 3:30 AM and restarts at 3:31 AM,
// all vehicles that were already warned will be warned AGAIN.

// Line 238 — Simple cron, no crash recovery
cron.schedule('30 * * * *', () => { check24HourStays(); });
cron.schedule('59 23 * * *', () => { sendDailySummary(); });
// If the server is down at 11:59 PM, the daily summary is NEVER sent.
// node-cron does not catch up on missed schedules.
```

**What we lose:** Overstay warning history, missed daily reports, no retry if email fails.

---

### Problem 2 — `frontend/src/utils/localAccessApprovalsStorage.js`

The unauthorized vehicle approval system is entirely in the browser's `localStorage`. This means:
- If security opens the dashboard in a different browser tab, they cannot see approvals
- If the browser is cleared, all approval history is gone
- There is no timeout — an unauthorized vehicle can stay "pending approval" forever
- There is no notification to the security officer

---

### Problem 3 — No Gate Health Monitoring

There is no code that detects if a gate's RFID reader has gone offline. If `14070001` (Gate 1) stops sending scans, nobody knows. The `getEventCounts` endpoint in `statsController.js` checks RFID vs traffic light mismatch, but it is only triggered manually from the dashboard health check button — it does not run automatically.

---

### Problem 4 — No Parking Conflict Workflow

`ConfigPage.jsx` prevents double-allocation of parking slots in the UI, but there is no server-side process to handle what happens when a vehicle enters and has no assigned slot. The facility manager is never automatically notified.

---

### Problem 5 — Personnel Cache is Fragile

`personnelCache.js` has a 1-minute in-memory TTL. If the DB goes down, it returns stale data. But there is no background process that verifies the cache is healthy or retries failed refreshes with backoff. Every cache miss hits the DB synchronously during a live scan.

---

---

# WORKFLOW DEFINITIONS

---

## Workflow 1 — Vehicle Session Lifecycle

### Purpose

This is the **core workflow** of the entire system. One instance of this workflow runs for every vehicle that enters the premises. It tracks the complete lifecycle: entry → (optional) overstay timer → exit.

### What Problem It Solves

Right now, session reconstruction happens in SQL at query time (the `buildSessionCTE` function in `reportcontroller.js`). The system has no live, running state per vehicle. Temporal makes each vehicle's session a first-class stateful object.

### Trigger

**When:** A new RFID entry scan is detected (PortNum = 1) by the WebSocket polling loop in `websocket.js`.

**How:** The polling loop, after broadcasting to WebSocket clients, also starts a new Temporal Workflow for the entering vehicle.

**Workflow ID:** `vehicle-session-{CardData}-{entryTimestamp}` — unique per entry event.

### Inputs (Workflow Arguments)

```
{
  cardData: string,          // RFID card ID (e.g. "5248007")
  pName: string,             // Vehicle registration number
  pCode: string,             // Company code (flat number)
  vehicleType: string,       // "2W" or "4W"
  equipmentName: string,     // Device ID (e.g. "14070001 - 1")
  entryTime: string,         // ISO timestamp of entry scan
  personnelId: number,       // From Personnel table
  cardRecordId: number,      // CardRecordID of the entry scan
}
```

### Signals (Inputs from Outside While Running)

| Signal Name | Sent By | Payload | What It Does |
|-------------|---------|---------|--------------|
| `vehicle-exited` | WebSocket polling loop, when exit scan (PortNum=2) detected for this cardData | `{ exitTime, exitGateEqupt, exitCardRecordId }` | Completes the session, stops overstay timer |
| `manually-closed` | Admin triggers from dashboard | `{ reason, adminName }` | Force-closes the session (e.g., RFID exit scanner failed) |

### Queries (Reading State from Outside)

| Query Name | Returns | Used By |
|------------|---------|---------|
| `getSessionStatus` | `{ status: 'active'/'exited'/'overstay', entryTime, vehicleType, hoursInside }` | Dashboard health check, occupancy API |
| `isInsidePremises` | `boolean` | Quick check before allocating parking |

### Workflow Steps (in order)

```
Step 1: ACTIVITY — recordEntryToAuditLog(entryData)
        → Write entry event to a Temporal-managed audit table or log
        → Retry: 5 times with 10s backoff

Step 2: ACTIVITY — checkParkingSlotAssignment(cardData)
        → Query the parking allocations for this card
        → Returns: { hasSlot: boolean, slotLabel: string | null }

Step 3: If no parking slot assigned:
        → START CHILD WORKFLOW: ParkingSlotManagementWorkflow
        → Do NOT wait for it (detached child)

Step 4: START CHILD WORKFLOW: OverstayAlertWorkflow
        → Pass: { cardData, entryTime, vehicleType, pCode }
        → This child runs independently and handles the 24h timer

Step 5: WAIT — await Signal('vehicle-exited') OR manually-closed
        → The workflow SLEEPS here — could be minutes, hours, or days
        → Temporal's durable timer keeps this alive across restarts

Step 6: On receiving 'vehicle-exited' signal:
        → Cancel the OverstayAlertWorkflow child (vehicle has exited, no need for alert)
        → ACTIVITY — recordExitToAuditLog(exitData)
        → ACTIVITY — releaseParkedSlot(cardData)  [if slot was active]
        → ACTIVITY — computeSessionDuration(entryTime, exitTime)
        → WORKFLOW ENDS SUCCESSFULLY

Step 7: If 'manually-closed' received:
        → Log the forced closure with admin reason
        → Cancel OverstayAlertWorkflow
        → WORKFLOW ENDS (with status: force-closed)
```

### Timeout

- **Maximum workflow duration:** 72 hours. If a vehicle has neither exited nor been manually closed after 72 hours, the workflow terminates and sends a final escalation alert.

### Activities Detail

| Activity | Input | Output | Retry Policy |
|----------|-------|--------|--------------|
| `recordEntryToAuditLog` | entry data object | void | 5 retries, 10s exponential backoff |
| `checkParkingSlotAssignment` | cardData | `{ hasSlot, slotLabel }` | 3 retries, 5s backoff |
| `recordExitToAuditLog` | exit data object | void | 5 retries, 10s exponential backoff |
| `releaseParkedSlot` | cardData | void | 3 retries, 5s backoff |
| `computeSessionDuration` | entryTime, exitTime | durationString | No retry needed (pure calculation) |

### What This Replaces in the Current Code

- The SQL CTE `buildSessionCTE` in `reportcontroller.js` (lines 7–60) — session state is now live, not computed at query time
- The `getVehicleOccupancy` function — can now query running workflows directly

---

## Workflow 2 — Overstay Alert & Escalation

### Purpose

Monitor a vehicle that has entered and not exited. Send an alert email at 24 hours. Escalate every 12 hours after that if the vehicle is still inside. Stop when the vehicle exits.

This workflow runs as a **child of Workflow 1** (Vehicle Session Lifecycle).

### What Problem It Solves

**Current code (cronJobs.js lines 7–172):**
- `warned24hVehicles` object is in-memory → wiped on restart
- Runs every 30 minutes checking all sessions → inefficient
- No per-vehicle timer → uses repeated SQL queries to find vehicles >24h
- If server crashes after sending the first 24h alert, it will send the alert again on restart

**With Temporal:** Each vehicle has its own independent 24-hour timer. The timer survives crashes. Sent-alert state is stored durably in Temporal's event history, not in a JavaScript object.

### Trigger

Started as a child workflow from Workflow 1 (Vehicle Session Lifecycle), Step 4.

### Inputs

```
{
  cardData: string,
  entryTime: string,          // ISO timestamp
  vehicleType: string,
  pCode: string,              // Company code
  pName: string,              // Vehicle registration
  parentWorkflowId: string,   // ID of the parent Vehicle Session Workflow
}
```

### Signals

| Signal Name | Sent By | What It Does |
|-------------|---------|--------------|
| `vehicle-exited` | Parent Workflow 1 (cancellation) | Stops the overstay monitoring loop cleanly |

### Workflow Steps (in order)

```
Step 1: TIMER — await sleep('24 hours') from entryTime
        → If the vehicle exits before this timer fires, the parent workflow
          cancels this child workflow. The timer is simply discarded.
        → This timer survives server restarts. Temporal stores it.

Step 2: On timer firing (vehicle is STILL inside after 24 hours):
        → ACTIVITY — fetchVehicleDetails(cardData)
           → Query Personnel cache for latest vehicle info
        → ACTIVITY — sendOverstayAlertEmail({
             cardData, vehicleType, pCode, entryTime, hoursInside: 24
           })
           → Calls the existing sendNotification() in emailService.js
           → Retry: 5 times with 30s backoff (emails are critical)
        → Record: alertsSent = 1

Step 3: LOOP — repeat until cancelled (vehicle exits) or max 2 days:
        → TIMER — await sleep('12 hours')
        
        → Check: Is vehicle still inside?
          ACTIVITY — checkVehicleStillInside(cardData)
          → This queries running Workflow 1 via its Query: 'isInsidePremises'
          → If workflow 1 has completed (vehicle exited), this child exits too
        
        → If still inside:
          ACTIVITY — sendEscalationEmail({
            cardData, vehicleType, pCode, entryTime,
            hoursInside: 24 + (loopCount * 12),
            alertNumber: loopCount + 2
          })
          → Each escalation email has increasing urgency in the subject line

Step 4: MAX ESCALATION (48 hours total, 3 emails sent):
        → ACTIVITY — sendCriticalEscalationEmail()
           → This goes to both admin AND facility manager
           → Subject: "CRITICAL: Vehicle inside for 48+ hours"
        → Workflow enters a 24-hour sleep then terminates

Step 5: Parent workflow cancels this child → WORKFLOW ENDS CLEANLY
```

### Alert Email Schedule

| Time from Entry | Alert Level | Recipient |
|-----------------|-------------|-----------|
| 24 hours | Warning | Admin email (EMAIL_FROM) |
| 36 hours | Escalation Level 1 | Admin email |
| 48 hours | Critical | Admin + Facility Manager |
| 72 hours | Final | Admin + Facility Manager + Security Head |

### What This Replaces in the Current Code

- `check24HourStays()` function in `cronJobs.js` (lines 68–172)
- `warned24hVehicles` in-memory dictionary (line 7 of cronJobs.js)
- The hourly cron `cron.schedule('30 * * * *', ...)` (line 238 of cronJobs.js)

### Key Improvement Over Current Code

| | Current Code | With Temporal |
|---|---|---|
| State storage | `warned24hVehicles` JS object (in-memory) | Temporal event history (durable) |
| Timer mechanism | Cron polls ALL vehicles every 30 min | Per-vehicle timer, fires exactly once |
| Crash recovery | Lost on restart | Resumable, timers preserved |
| Re-alert after 12h | Manual dedup check against JS object | Timer-based, automatic |
| Escalation | Not implemented | Built-in (36h, 48h, 72h) |

---

## Workflow 3 — Unauthorized Vehicle Approval

### Purpose

When an unauthorized vehicle (empty PCode) scans at the entry gate, start an approval workflow. A security officer must approve the vehicle within a configurable timeout. The workflow waits for human input.

### What Problem It Solves

**Current code (LiveEntryExitPage.jsx and LiveTable.jsx):**
- Approval is stored in `vehicleAccess.localApprovals.v1` localStorage key
- Only the browser that added the approval knows about it
- No timeout — unapproved vehicles stay "pending" forever
- No notification to security officer
- If the browser is cleared, all approval history is gone
- The approval is not server-side, so it cannot be audited

**With Temporal:** Approval is a server-side durable workflow. Any browser can query it. It has a timeout. The security officer receives a notification.

### Trigger

**When:** The WebSocket polling loop detects a new scan where:
- The record's `PCode` is empty or `-` (unauthorized)
- `PortNum` is 1 (entry direction)

**Workflow ID:** `unauthorized-approval-{cardData}-{date}` — one per unauthorized entry per day.

### Inputs

```
{
  cardData: string,           // The unregistered RFID card
  scanTime: string,           // ISO timestamp of scan
  vehicleType: string,        // "2W" or "4W" if detectable
  gateNumber: number,         // 1 or 2 (from EquptName device ID)
  equipmentName: string,      // Raw EquptName from CardRecord
  cardRecordId: number,
}
```

### Signals

| Signal Name | Payload | Sent By | What It Does |
|-------------|---------|---------|--------------|
| `approval-granted` | `{ vehicleNo, remark, approvedBy, approvedAt }` | Security officer via dashboard API | Grants access, records in audit log |
| `approval-denied` | `{ reason, deniedBy }` | Security officer | Marks vehicle as denied, triggers security alert |

### Queries

| Query Name | Returns |
|------------|---------|
| `getApprovalStatus` | `{ status: 'pending'/'approved'/'denied'/'timed-out', vehicleNo?, remark?, approvedBy? }` |

### Workflow Steps

```
Step 1: ACTIVITY — notifySecurityOfficer({
          cardData, scanTime, gateNumber, vehicleType
        })
        → Send WhatsApp / SMS / Email to security officer on duty
        → Push notification to dashboard (new unauthorized entry badge)
        → Retry: 3 times with 15s backoff

Step 2: WAIT with TIMEOUT — await Signal('approval-granted') OR
                              await Signal('approval-denied') OR
                              TIMER fires after 30 minutes

Step 3a: If 'approval-granted' signal received within 30 minutes:
         → ACTIVITY — recordApproval({
               cardData, vehicleNo, remark, approvedBy, approvedAt
             })
             → Store in a proper approvals table (not localStorage)
         → ACTIVITY — updateDashboardApprovalState(cardData, approvalData)
             → Push update to all connected WebSocket clients
         → WORKFLOW ENDS SUCCESSFULLY (status: approved)

Step 3b: If 'approval-denied' signal received:
         → ACTIVITY — recordDenial({ cardData, reason, deniedBy })
         → ACTIVITY — triggerSecurityAlert({
               message: "Denied unauthorized entry - vehicle may still be on premises",
               cardData, gateNumber
             })
         → WORKFLOW ENDS (status: denied)

Step 3c: If TIMER fires (no response in 30 minutes):
         → ACTIVITY — sendNoResponseAlert()
             → Alert: "Unauthorized vehicle pending approval for 30 minutes. 
               No security officer response."
         → WORKFLOW ENTERS ESCALATION MODE:
           → TIMER — await sleep('30 minutes')
           → Send escalation to facility manager
         → WORKFLOW ENDS (status: timed-out)
```

### Approval Timeout Configuration

| Timeout Level | Duration | Action |
|---------------|----------|--------|
| Level 1 | 30 minutes | Alert to security officer again |
| Level 2 | 60 minutes total | Alert to facility manager |
| Level 3 | 2 hours total | Alert to senior management |

### What This Replaces in the Current Code

- `localAccessApprovalsStorage.js` (frontend/src/utils/)
- `saveAllowRemark()` function in both `LiveEntryExitPage.jsx` (lines 291–310) and `LiveTable.jsx` (lines 276–295)
- `localApprovals` state in both pages (stored in browser localStorage)

### New API Endpoints Needed

```
POST /api/approvals/grant
  Body: { workflowId, vehicleNo, remark, approvedBy }
  → Sends 'approval-granted' signal to the workflow

POST /api/approvals/deny
  Body: { workflowId, reason, deniedBy }
  → Sends 'approval-denied' signal

GET /api/approvals/status/:cardData
  → Queries the workflow for current approval status
  → Used by the dashboard to show "pending/approved/denied" badge
```

---

## Workflow 4 — Daily Summary Report

### Purpose

Every night at 11:59 PM IST, generate a daily vehicle access summary and send it via email. This is a **scheduled workflow** — it runs on a fixed cron schedule, but with Temporal's guarantee that it will catch up even if the server was down at the scheduled time.

### What Problem It Solves

**Current code (cronJobs.js lines 174–232):**

```javascript
// Line 243 — If server is down at 11:59 PM, this email is never sent
cron.schedule('59 23 * * *', () => { sendDailySummary(); });
// node-cron does not have catch-up/backfill logic.
```

**With Temporal Schedules:** If the server was down at 11:59 PM, Temporal will run the missed schedule immediately when the worker comes back online (configurable catch-up window).

### Schedule

- **Cron Expression:** `59 23 * * *` (11:59 PM every day — IST, assuming server is in IST)
- **Catch-up Policy:** Run the last missed schedule if the worker was down
- **Overlap Policy:** Skip (don't run twice if previous run is still going)

### Inputs (from Schedule, passed to workflow)

```
{
  reportDate: string,         // "YYYY-MM-DD" — the date to report on
  scheduledAt: string,        // ISO timestamp when schedule fired
}
```

### Workflow Steps

```
Step 1: ACTIVITY — fetchDayEntryExitStats(reportDate)
        → Query CardRecord WHERE DataTime between day start and day end
        → Returns: { totalEntries, totalExits, uniqueVehicles }
        → Retry: 5 times with 30s backoff
        → Timeout per attempt: 2 minutes

Step 2: ACTIVITY — fetchCurrentlyInsideCount()
        → Query all running VehicleSessionLifecycle workflows
        → OR query Sessions CTE (same as current code)
        → Returns: { insideCount, overstayCount }
        → Retry: 3 times with 20s backoff

Step 3: ACTIVITY — fetchVehicleTypeBreakdown(reportDate)
        → Returns: { twoWheeler: { entries, exits }, fourWheeler: { entries, exits } }
        → Same data currently shown in StatsCards.jsx

Step 4: ACTIVITY — fetchUnauthorizedEntryCount(reportDate)
        → New data — how many unauthorized entry scans today
        → Useful for security reporting

Step 5: ACTIVITY — generateDailyReportEmail({
          reportDate,
          totalEntries,
          totalExits,
          uniqueVehicles,
          insideCount,
          overstayCount,
          twoWheeler,
          fourWheeler,
          unauthorizedCount
        })
        → Build the HTML email body
        → Returns: htmlContent string

Step 6: ACTIVITY — sendEmailReport({
          subject: `📊 Daily Vehicle Access Summary — ${reportDate}`,
          htmlContent,
          recipients: [EMAIL_FROM, facilityManagerEmail]
        })
        → Uses existing sendNotification() from emailService.js
        → Retry: 5 times with exponential backoff (1 min, 2 min, 4 min, 8 min, 16 min)
        → If all retries fail: store failed report for next-day retry

Step 7: ACTIVITY — archiveReportData({
          reportDate, stats: allFetchedData
        })
        → Store the report data to DB or file for audit trail
        → Retry: 3 times

Step 8: WORKFLOW ENDS SUCCESSFULLY
```

### Error Handling

- If `fetchDayEntryExitStats` fails after all retries: skip report for this day, send an alert email saying "Daily report generation failed for {date}"
- If `sendEmailReport` fails after all retries: save the HTML to a file on disk for manual sending

### What This Replaces in the Current Code

- `sendDailySummary()` function in `cronJobs.js` (lines 174–232)
- `cron.schedule('59 23 * * *', ...)` (line 243 of cronJobs.js)

### Enhancement Over Current Code

| | Current Code | With Temporal |
|---|---|---|
| Missed schedules | Lost forever | Caught up automatically |
| Email retry | None | 5 retries with backoff |
| Unauthorized count | Not included | New metric added |
| Vehicle type breakdown | Basic | Detailed (entry/exit split) |
| Report archival | None | Stored for audit |

---

## Workflow 5 — Weekly Analytics Report

### Purpose

Every Friday at 11:00 PM IST, generate a week-in-review report with trend analysis, peak hours, overstay incidents, and unauthorized entry summary. This is richer than the daily report and is meant for facility management review.

### Schedule

- **Cron Expression:** `0 23 * * 5` (11:00 PM every Friday IST)
- **Catch-up Policy:** Run only the most recent missed schedule (max 1)

### Inputs

```
{
  weekStartDate: string,      // Monday date "YYYY-MM-DD"
  weekEndDate: string,        // Sunday date "YYYY-MM-DD"
}
```

### Workflow Steps

```
Step 1: ACTIVITY — fetchWeeklyVehicleStats(weekStart, weekEnd)
        → Same as /api/vehicle-stats?period=week
        → Daily entry/exit counts per day of week
        → Returns 7-day array

Step 2: ACTIVITY — fetchPeakHoursAnalysis(weekStart, weekEnd)
        → Find the top 3 busiest hours across the week
        → Returns: [{ hour, dayOfWeek, count }]

Step 3: ACTIVITY — fetchOverstayIncidents(weekStart, weekEnd)
        → All vehicles that stayed >24 hours this week
        → Returns list of incidents with duration, company, vehicle type

Step 4: ACTIVITY — fetchUnauthorizedEntrySummary(weekStart, weekEnd)
        → Total unauthorized entries, approvals granted, denials
        → By gate, by day of week

Step 5: ACTIVITY — fetchVehicleTypeWeeklyTrend(weekStart, weekEnd)
        → 2W vs 4W ratio per day
        → Week-over-week comparison if previous week data exists

Step 6: ACTIVITY — generateWeeklyReportEmail({
          all fetched data above
        })
        → Rich HTML with tables and summary statistics

Step 7: ACTIVITY — sendEmailReport({
          subject: `📈 Weekly Vehicle Access Report — Week of ${weekStart}`,
          htmlContent,
          recipients: [EMAIL_FROM, facilityManagerEmail, seniorManagementEmail]
        })
        → Retry: 5 times with backoff

Step 8: WORKFLOW ENDS
```

### What New Data Is in This Report (Not in Current System)

- Peak hours analysis across the week
- Overstay incidents with company name and duration
- Gate utilization (Gate 1 vs Gate 2 traffic split)
- Unauthorized entry trend (increasing/decreasing week over week)
- 2W vs 4W trend

---

## Workflow 6 — Gate Health Monitor

### Purpose

A long-running workflow that continuously monitors whether the RFID gate readers are sending scans. If Gate 1 or Gate 2 has been silent for more than 30 minutes during business hours (8 AM – 8 PM), send an alert because the equipment may be offline.

### What Problem It Solves

Currently, there is no automated monitoring of gate reader health. The health check in `statsController.js` (`getEventCounts`) only compares RFID reads vs traffic light events, and it is only triggered manually from the dashboard. Nobody is automatically alerted if a gate stops working.

### Trigger

This is a **singleton long-running workflow** — one instance runs continuously, started when the backend server starts. It never ends (until intentionally stopped).

**Workflow ID:** `gate-health-monitor-singleton` (only one exists at a time)

### Workflow Steps

```
Step 1: TIMER — await sleep until next check interval (5 minutes)

Step 2: ACTIVITY — fetchRecentScanCountPerGate({
          windowMinutes: 30,
          businessHoursStart: 8,
          businessHoursEnd: 20,
        })
        → Query: COUNT of CardRecord rows in last 30 minutes, grouped by EquptName
        → Returns: [
            { gate: 1, deviceId: '14070001', scanCount: N, isBusinessHours: boolean },
            { gate: 2, deviceId: '24074151', scanCount: N, isBusinessHours: boolean }
          ]

Step 3: For each gate:
        → If isBusinessHours AND scanCount === 0:
           → Check: has an alert already been sent in the last 2 hours for this gate?
             (tracked in workflow local state — durable)
           → If no alert sent recently:
             ACTIVITY — sendGateOfflineAlert({
               gateNumber,
               deviceId,
               lastScanTime,  // when was the last scan?
               alertedAt: now
             })
             → Update local state: lastAlertSent[gateNumber] = now

        → If isBusinessHours AND scanCount > 0:
           → Clear alert state for this gate (it's back online)
           → If gate was previously offline:
             ACTIVITY — sendGateBackOnlineNotification({ gateNumber })

Step 4: LOOP BACK to Step 1
        → Repeat every 5 minutes during business hours
        → During non-business hours: extend sleep to 30 minutes
```

### Alert Conditions

| Condition | Action |
|-----------|--------|
| Gate silent for 30 min (business hours) | Email alert to facility manager |
| Gate silent for 60 min (business hours) | Escalation email to senior management |
| Gate comes back online after being offline | Confirmation email "Gate X is back online" |
| Both gates silent simultaneously | Critical alert — possible server or network issue |

### Local State (Durable in Temporal)

```javascript
{
  gate1: {
    lastScanTime: string,
    isCurrentlyOffline: boolean,
    offlineSince: string | null,
    alertsSentCount: number,
    lastAlertSent: string | null,
  },
  gate2: {
    // same structure
  }
}
```

This state survives server restarts because Temporal stores it in its event history.

### What Is New (Does Not Exist in Current Code)

This entire workflow is **new functionality**. There is no equivalent in the current codebase. The closest thing is `getEventCounts` in `statsController.js` which does a manual count check when the user clicks "Health Check" in the dashboard — but that is manual, not automated.

---

## Workflow 7 — Parking Slot Management

### Purpose

When a registered vehicle enters the premises, verify it has an assigned parking slot. If the vehicle has no parking slot assigned, notify the facility manager and wait for a slot to be assigned before the vehicle parks in the wrong place.

### What Problem It Solves

**Current system:**
- Parking allocation is done in `ConfigPage.jsx` in the browser's localStorage
- `loadParkingAllocations()` is called from localStorage in multiple places
- If a vehicle enters and has no assigned slot, nothing happens — no notification
- Parking assignments are not server-side, so they are not durable

**With Temporal:** The parking assignment check is server-side, with a notification system and a workflow that waits for human resolution.

### Trigger

Started as a **detached child workflow** from Workflow 1 (Vehicle Session Lifecycle), Step 3, when `checkParkingSlotAssignment` returns `hasSlot: false`.

**Workflow ID:** `parking-management-{cardData}-{date}`

### Inputs

```
{
  cardData: string,
  vehicleNo: string,
  companyCode: string,
  vehicleType: string,
  entryTime: string,
  parentSessionWorkflowId: string,
}
```

### Signals

| Signal Name | Payload | Sent By |
|-------------|---------|---------|
| `slot-assigned` | `{ slotLabel, assignedBy }` | Facility manager via config page |
| `no-slot-available` | `{ reason }` | Facility manager |

### Workflow Steps

```
Step 1: ACTIVITY — fetchCompanyParkingInfo(companyCode)
        → Check how many slots the company has, how many are currently occupied
        → Returns: { totalSlots, occupiedSlots, availableSlots }

Step 2a: If availableSlots > 0:
         → ACTIVITY — notifyFacilityManager({
               message: `Vehicle ${vehicleNo} (${companyCode}) entered without slot assignment.
                         ${availableSlots} slots available.`,
               vehicleType, entryTime, cardData
             })
         
         → WAIT with TIMEOUT:
           await Signal('slot-assigned') OR TIMER ('30 minutes')
         
         → On 'slot-assigned': 
           ACTIVITY — recordParkingAssignment({ cardData, slotLabel, assignedBy })
           → Broadcast to all WebSocket clients: parking slot updated for this card
           → WORKFLOW ENDS SUCCESSFULLY
         
         → On TIMER (30 min, no response):
           → Send reminder to facility manager
           → TIMER ('60 minutes')
           → If still no assignment: send escalation and WORKFLOW ENDS (unresolved)

Step 2b: If availableSlots === 0:
         → ACTIVITY — notifyFacilityManagerNoSlots({
               message: `Vehicle ${vehicleNo} entered but NO slots available for ${companyCode}.
                         Total: ${totalSlots}, All occupied.`,
             })
         → ACTIVITY — sendVehicleToOverflowParking(cardData)
           → This could trigger a notification to the vehicle owner
         → WORKFLOW ENDS (resolved: overflow parking)
```

### What This Replaces / Enhances

- `upsertParkingForCard()` in `ConfigPage.jsx` (lines 268–300) — this currently only checks for double-allocation in the UI, not a server-side workflow
- The `loadParkingAllocations()` / `saveParkingAllocations()` localStorage system — allocations should be server-side

---

## Workflow 8 — Vehicle Registry Sync

### Purpose

The `personnelCache.js` in the backend caches the `Personnel` and `PersonnelExtend2` SQL tables in memory with a 1-minute TTL. This workflow is a background process that keeps the cache warm, monitors the DB health, and syncs registry data to a lightweight local store so it survives crashes.

### What Problem It Solves

**Current `personnelCache.js` problems:**
- Cache is refreshed synchronously inside a live WebSocket poll (websocket.js line 55: `await getPersonnelMap()`)
- If the DB is slow, this delays real-time scan broadcasting
- On server restart, the cache is empty — the first poll will hit the DB during a potentially busy period
- There is no proactive cache warming on startup

**With Temporal:** Cache refresh is a scheduled background activity, decoupled from the live scan path.

### Trigger

This is a **scheduled workflow** running every 55 seconds (slightly under the 1-min TTL).

**Schedule:** `*/55 * * * * *` (every 55 seconds)

### Workflow Steps

```
Step 1: ACTIVITY — fetchPersonnelFromDB()
        → Same query as current personnelCache.js getPersonnelMap()
        → SELECT p.*, pe2.CarNumber FROM Personnel p
          LEFT JOIN PersonnelExtend2 pe2 ON pe2.PersonnelID = p.PersonnelID
        → Retry: 3 times, 10s backoff
        → Timeout: 30 seconds per attempt

Step 2: ACTIVITY — validatePersonnelData(records)
        → Check for obviously malformed records
        → Return count of valid vs invalid records

Step 3: ACTIVITY — writePersonnelToCache(validRecords)
        → Update the in-memory personnelCache.js Map
        → Also write to a local Redis cache or SQLite (for crash recovery)
        → Returns: { totalRecords, twoWheelers, fourWheelers, unknownType }

Step 4: ACTIVITY — logCacheSyncResult({
          timestamp, totalRecords, duration, validCount, invalidCount
        })
        → Write to a sync log table or file
        → Used for monitoring: "cache last synced X seconds ago"

Step 5: WORKFLOW ENDS (will be re-triggered by schedule in 55 seconds)
```

### What New API This Enables

```
GET /api/cache/status
  → Returns: { lastSyncTime, totalRecords, twoWheelers, fourWheelers, isStale }
  → Used in Dashboard Health Check modal (currently only shows DB reachable/not)
```

### What This Enhances in Current Code

- `getPersonnelMap()` in `personnelCache.js` (lines 10–46) — currently triggered on-demand inside polls
- The health check modal in `Dashboard.jsx` (lines 50–80) — can now show "Personnel Cache: 1,245 records, synced 45 seconds ago"

---

## 12. Workflow Relationship Map

```
                          RFID Scan Detected
                          (websocket.js polling)
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
               PortNum = 1                 PortNum = 2
               (Entry Scan)                (Exit Scan)
                    │                           │
                    ▼                           ▼
         ┌─────────────────────┐    Signal 'vehicle-exited'
         │  Workflow 1          │    sent to running Workflow 1
         │  Vehicle Session     │◄──────────────┘
         │  Lifecycle           │
         └──────┬──────┬───────┘
                │      │
        ┌───────┘      └────────────────┐
        ▼                               ▼
┌──────────────────┐          ┌──────────────────────┐
│  Workflow 2      │          │  Workflow 7           │
│  Overstay Alert  │          │  Parking Slot Mgmt    │
│  & Escalation    │          │  (if no slot assigned)│
│  (child)         │          │  (detached child)     │
└──────────────────┘          └──────────────────────┘

                    Unauthorized Entry (PCode empty)
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  Workflow 3             │
                    │  Unauthorized Vehicle   │
                    │  Approval               │
                    └─────────────────────────┘

                         SCHEDULED WORKFLOWS
                    ┌────────────────────────────┐
                    │  Workflow 4               │
                    │  Daily Summary Report     │
                    │  (11:59 PM every day)     │
                    └────────────────────────────┘
                    ┌────────────────────────────┐
                    │  Workflow 5               │
                    │  Weekly Analytics Report  │
                    │  (Friday 11 PM)           │
                    └────────────────────────────┘
                    ┌────────────────────────────┐
                    │  Workflow 8               │
                    │  Vehicle Registry Sync    │
                    │  (every 55 seconds)       │
                    └────────────────────────────┘

                         SINGLETON WORKFLOW
                    ┌────────────────────────────┐
                    │  Workflow 6               │
                    │  Gate Health Monitor      │
                    │  (runs continuously)      │
                    └────────────────────────────┘
```

---

## 13. Implementation Priority Order

Based on business impact and complexity, implement in this order:

| Priority | Workflow | Reason | Replaces Existing Code |
|----------|----------|--------|----------------------|
| 1 | Workflow 4 — Daily Summary Report | Easiest to implement, immediate value, fixes missed emails | `sendDailySummary()` in cronJobs.js |
| 2 | Workflow 2 — Overstay Alert & Escalation | High business value, fixes crash-recovery bug | `check24HourStays()` + `warned24hVehicles` in cronJobs.js |
| 3 | Workflow 1 — Vehicle Session Lifecycle | Core workflow, needed for others to work | `buildSessionCTE` query, `getVehicleOccupancy` |
| 4 | Workflow 3 — Unauthorized Vehicle Approval | Moves approval server-side, removes localStorage dependency | `localAccessApprovalsStorage.js`, `saveAllowRemark()` |
| 5 | Workflow 6 — Gate Health Monitor | New feature, high operational value | Nothing (new capability) |
| 6 | Workflow 5 — Weekly Analytics Report | Enhancement, builds on existing stats | Enhancement of daily report |
| 7 | Workflow 7 — Parking Slot Management | Enhancement, replaces localStorage parking | `parkingStorage.js`, `upsertParkingForCard()` |
| 8 | Workflow 8 — Vehicle Registry Sync | Low urgency but improves cache reliability | `personnelCache.js` `getPersonnelMap()` |

---

## Summary Table — All Workflows

| # | Workflow Name | Type | Duration | Current Code It Replaces |
|---|--------------|------|----------|--------------------------|
| 1 | Vehicle Session Lifecycle | Per-vehicle, event-driven | Hours to days | SQL session CTE in reportcontroller.js |
| 2 | Overstay Alert & Escalation | Child of Workflow 1 | 24–72 hours | check24HourStays() in cronJobs.js |
| 3 | Unauthorized Vehicle Approval | Per-unauthorized-entry | Up to 2 hours | localAccessApprovalsStorage.js |
| 4 | Daily Summary Report | Scheduled (daily) | ~5 minutes | sendDailySummary() in cronJobs.js |
| 5 | Weekly Analytics Report | Scheduled (weekly) | ~10 minutes | New capability |
| 6 | Gate Health Monitor | Singleton, continuous | Forever | New capability |
| 7 | Parking Slot Management | Per-vehicle, event-driven | Up to 2 hours | parkingStorage.js in frontend |
| 8 | Vehicle Registry Sync | Scheduled (every 55s) | ~10 seconds | personnelCache.js getPersonnelMap() |

---

*Document prepared for review. Please review each workflow and indicate which ones to implement and in what order. No code has been written yet.*
