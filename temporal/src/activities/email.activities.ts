// ─── EMAIL ACTIVITIES ─────────────────────────────────────────
//
//  Uses the same nodemailer config as backend/utils/emailService.js
//  Reads from the SAME .env file — so EMAIL_USER, EMAIL_PASS, etc.
//  are already configured if the backend email already works.
//
// ─────────────────────────────────────────────────────────────

import * as nodemailer from 'nodemailer';
import * as path      from 'path';
import * as dotenv    from 'dotenv';
import type { EntryEvent, PersonnelRecord, CompanyQuota, SecurityDecision, AdminDecision } from '../shared/types';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });

// ─── BUILD TRANSPORTER ────────────────────────────────────────
// Transporter = the thing that actually connects to your SMTP server
// and sends emails. Created fresh for each email to avoid stale connections.
function makeTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// ─── HELPER: skip if email not configured ─────────────────────
function emailConfigured(): boolean {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS &&
            process.env.EMAIL_PASS !== 'YOUR_APP_PASSWORD_HERE');
}

async function send(subject: string, html: string, toOverride?: string): Promise<void> {
  if (!emailConfigured()) {
    console.warn(`[Email] Not configured — skipping: "${subject}"`);
    return;
  }
  const to = toOverride || process.env.ADMIN_EMAIL || '';
  if (!to) { console.warn('[Email] No recipient — skipping'); return; }

  const transporter = makeTransporter();
  const info = await transporter.sendMail({
    from:    `"Cyber Towers Access" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
  console.log(`[Email] Sent: "${subject}" → ${to} (${info.messageId})`);
}

// ─── ACTIVITY: sendUnauthorizedAlert ─────────────────────────
// WF3 — sent to security/admin when an unauthorized vehicle arrives
export async function sendUnauthorizedAlert(
  event: EntryEvent
): Promise<void> {
  const subject = `🚨 UNAUTHORIZED VEHICLE at ${event.gate} — ${event.vehicleNumber}`;
  const html = `
    <h2 style="color:#dc2626">Unauthorized Vehicle Detected</h2>
    <table>
      <tr><td><b>Vehicle</b></td><td>${event.vehicleNumber}</td></tr>
      <tr><td><b>Card ID</b></td><td>${event.cardId}</td></tr>
      <tr><td><b>Gate</b></td><td>${event.gate}</td></tr>
      <tr><td><b>Time</b></td><td>${event.timestamp}</td></tr>
    </table>
    <p>The gate is currently <b>CLOSED</b>.</p>
    <p>Please use the dashboard to <b>Approve</b> or <b>Deny</b> entry.</p>
  `;
  await send(subject, html);
}

// ─── ACTIVITY: sendSecurityApprovalConfirm ───────────────────
// WF3 — sent after security officer approves the unauthorized vehicle
export async function sendSecurityApprovalConfirm(
  event: EntryEvent,
  decision: SecurityDecision
): Promise<void> {
  const subject = `✅ Override Approved — ${event.vehicleNumber} granted entry`;
  const html = `
    <h2 style="color:#16a34a">Entry Override Approved</h2>
    <p>Security Officer <b>${decision.officerId}</b> approved entry for:</p>
    <table>
      <tr><td><b>Vehicle</b></td><td>${event.vehicleNumber}</td></tr>
      <tr><td><b>Gate</b></td><td>${event.gate}</td></tr>
      <tr><td><b>Time</b></td><td>${event.timestamp}</td></tr>
      ${decision.reason ? `<tr><td><b>Reason</b></td><td>${decision.reason}</td></tr>` : ''}
    </table>
  `;
  await send(subject, html);
}

// ─── ACTIVITY: sendQuotaFullEmail ─────────────────────────────
// WF9 — informational email to Company Admin when a vehicle is denied
// because the company parking quota is full
export async function sendQuotaFullEmail(
  event: EntryEvent,
  personnel: PersonnelRecord,
  quota: CompanyQuota,
  companyAdminEmail?: string
): Promise<void> {
  const subject = `🔴 Parking Full — Vehicle ${event.vehicleNumber} was denied entry`;
  const html = `
    <h2 style="color:#dc2626">Company Parking Quota Full</h2>
    <p>An authorized vehicle was denied entry because your company's parking is full.</p>
    <table>
      <tr><td><b>Vehicle</b></td><td>${event.vehicleNumber}</td></tr>
      <tr><td><b>Employee</b></td><td>${personnel.pName}</td></tr>
      <tr><td><b>Company</b></td><td>${quota.companyName}</td></tr>
      <tr><td><b>Quota</b></td><td>${quota.occupiedSlots}/${quota.totalSlots} (FULL)</td></tr>
      <tr><td><b>Gate</b></td><td>${event.gate}</td></tr>
      <tr><td><b>Time</b></td><td>${event.timestamp}</td></tr>
    </table>
    <p>The vehicle must park outside or request an override.</p>
  `;
  // Send to company admin (if known) AND system admin
  const to = [companyAdminEmail, process.env.ADMIN_EMAIL].filter(Boolean).join(',');
  await send(subject, html, to);
}

// ─── ACTIVITY: sendOverrideRequestEmail ───────────────────────
// WF9 — sent to Company Admin asking them to approve or deny override
export async function sendOverrideRequestEmail(
  event: EntryEvent,
  personnel: PersonnelRecord,
  quota: CompanyQuota,
  companyAdminEmail?: string
): Promise<void> {
  const subject = `⚠ Override Request — ${personnel.pName} needs urgent entry`;
  const html = `
    <h2 style="color:#d97706">Parking Override Request</h2>
    <p><b>${personnel.pName}</b> is requesting urgent entry despite company quota being full.</p>
    <table>
      <tr><td><b>Vehicle</b></td><td>${event.vehicleNumber}</td></tr>
      <tr><td><b>Company</b></td><td>${quota.companyName}</td></tr>
      <tr><td><b>Quota</b></td><td>${quota.occupiedSlots}/${quota.totalSlots}</td></tr>
      <tr><td><b>Gate</b></td><td>${event.gate}</td></tr>
      <tr><td><b>Time</b></td><td>${event.timestamp}</td></tr>
    </table>
    <p>Please log in to the <b>Cyber Towers Dashboard</b> and click
       <b>Approve Override</b> or <b>Deny Override</b> within <b>5 minutes</b>.</p>
    <p><i>If no action is taken within 5 minutes, the request will be auto-denied.</i></p>
  `;
  const to = [companyAdminEmail, process.env.ADMIN_EMAIL].filter(Boolean).join(',');
  await send(subject, html, to);
}

// ─── ACTIVITY: sendOverstayAlert ─────────────────────────────
// WF2 — sent when a vehicle has been inside too long.
//
// alertHours  = total hours the vehicle has been inside (24, 32, 40)
// alertLevel  = 1 (first warning), 2 (escalation), 3 (urgent)
//
// HOW THE TIME IS CALCULATED:
//   Activities CAN use Date.now() — they are NOT required to be deterministic.
//   Only WORKFLOW CODE must be deterministic.
//   So here we safely calculate the actual elapsed time using real system time.
//
export async function sendOverstayAlert(
  event:      EntryEvent,
  personnel:  PersonnelRecord,
  alertHours: number,
  alertLevel: number
): Promise<void> {

  // Calculate actual time inside using real clock (safe in activities)
  const entryTime   = new Date(event.timestamp);
  const now         = new Date();
  const elapsedMs   = now.getTime() - entryTime.getTime();
  const elapsedHrs  = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedMins = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));

  // Build subject and urgency colour based on alert level
  //   Level 1 = yellow warning  (24h)
  //   Level 2 = orange          (32h)
  //   Level 3 = red urgent      (40h)
  const levels = [
    { emoji: '⚠️',  label: 'OVERSTAY ALERT',        color: '#d97706' },
    { emoji: '🔶',  label: 'OVERSTAY ESCALATION',   color: '#ea580c' },
    { emoji: '🚨',  label: 'URGENT OVERSTAY',        color: '#dc2626' },
  ];
  const lvl = levels[alertLevel - 1] ?? levels[2];

  const subject =
    `${lvl.emoji} ${lvl.label}: Vehicle ${event.vehicleNumber} — ${elapsedHrs}h ${elapsedMins}m inside`;

  const urgencyNote = alertLevel === 3
    ? '<p style="color:#dc2626;font-weight:bold">This is the final automated alert. Physical intervention is now required.</p>'
    : `<p>Next alert in ${alertLevel === 1 ? '8' : '8'} hours if vehicle has not exited.</p>`;

  const html = `
    <h2 style="color:${lvl.color}">${lvl.label}</h2>
    <p>A vehicle has been inside Cyber Towers for an extended period.</p>
    <table style="border-collapse:collapse;font-family:Arial">
      <tr style="background:#f1f5f9">
        <td style="padding:6px 12px"><b>Vehicle Number</b></td>
        <td style="padding:6px 12px">${event.vehicleNumber}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px"><b>Employee Name</b></td>
        <td style="padding:6px 12px">${personnel.pName}</td>
      </tr>
      <tr style="background:#f1f5f9">
        <td style="padding:6px 12px"><b>Company</b></td>
        <td style="padding:6px 12px">${personnel.company || personnel.pCode}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px"><b>Entry Gate</b></td>
        <td style="padding:6px 12px">${event.gate}</td>
      </tr>
      <tr style="background:#f1f5f9">
        <td style="padding:6px 12px"><b>Entry Time</b></td>
        <td style="padding:6px 12px">${event.timestamp}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px"><b>Time Inside</b></td>
        <td style="padding:6px 12px;color:${lvl.color};font-weight:bold">
          ${elapsedHrs} hours ${elapsedMins} minutes
        </td>
      </tr>
      <tr style="background:#f1f5f9">
        <td style="padding:6px 12px"><b>Alert Level</b></td>
        <td style="padding:6px 12px">${alertLevel} of 3</td>
      </tr>
    </table>
    <br/>
    ${urgencyNote}
    <p style="color:#64748b;font-size:12px">
      This is an automated alert from Cyber Towers Vehicle Access System.
    </p>
  `;

  await send(subject, html);
}

// ─── ACTIVITY: sendCapacityWarningEmail ──────────────────────
// WF7 — proactive warning when company reaches 80% of parking quota.
//
// WHY 80%?
//   If we only send alerts when quota is 100% full (WF9), it's too late.
//   At 80%, the company admin has time to:
//     - Ask employees to carpool
//     - Temporarily expand the quota in the dashboard
//     - Plan for the overflow
//
// This is the PROACTIVE warning. WF9 is the REACTIVE denial.
//
// occupancyPercent: number   ← e.g. 80 (means 80%)
//   TypeScript will give an error if you pass text by mistake.
//
export async function sendCapacityWarningEmail(
  personnel:        PersonnelRecord,
  quota:            CompanyQuota,
  occupancyPercent: number
): Promise<void> {

  // Pick colour based on how full we are
  // 80-89% = amber warning
  // 90-99% = orange (serious)
  const color   = occupancyPercent >= 90 ? '#ea580c' : '#d97706';
  const emoji   = occupancyPercent >= 90 ? '🔶'     : '⚠️';
  const urgency = occupancyPercent >= 90 ? 'Urgent' : 'Warning';

  const subject =
    `${emoji} Parking Capacity ${urgency} — ${quota.companyName} at ${occupancyPercent}%`;

  // Calculate remaining slots
  // e.g. totalSlots=10, occupiedSlots=8 → remaining=2
  const remaining = quota.totalSlots - quota.occupiedSlots;

  const html = `
    <h2 style="color:${color}">Parking Capacity ${urgency}</h2>
    <p>
      Your company's parking allocation at Cyber Towers is <b>${occupancyPercent}% full</b>.
      Only <b>${remaining} slot${remaining === 1 ? '' : 's'}</b> remaining.
    </p>
    <table style="border-collapse:collapse;font-family:Arial;margin-top:12px">
      <tr style="background:#f1f5f9">
        <td style="padding:8px 16px"><b>Company</b></td>
        <td style="padding:8px 16px">${quota.companyName}</td>
      </tr>
      <tr>
        <td style="padding:8px 16px"><b>Slots Used</b></td>
        <td style="padding:8px 16px;color:${color};font-weight:bold">
          ${quota.occupiedSlots} of ${quota.totalSlots}
        </td>
      </tr>
      <tr style="background:#f1f5f9">
        <td style="padding:8px 16px"><b>Occupancy</b></td>
        <td style="padding:8px 16px;color:${color};font-weight:bold">${occupancyPercent}%</td>
      </tr>
      <tr>
        <td style="padding:8px 16px"><b>Remaining</b></td>
        <td style="padding:8px 16px">${remaining} slot${remaining === 1 ? '' : 's'}</td>
      </tr>
      <tr style="background:#f1f5f9">
        <td style="padding:8px 16px"><b>Triggered By</b></td>
        <td style="padding:8px 16px">${personnel.pName} entering at ${new Date().toLocaleTimeString('en-IN')}</td>
      </tr>
    </table>
    <br/>
    <p>
      When all slots are filled, the next vehicle will be automatically denied entry
      and an override request process will begin (WF9).
    </p>
    <p>
      To increase the quota, log into the Cyber Towers dashboard → Company Settings.
    </p>
    <p style="color:#64748b;font-size:12px">
      Automated alert from Cyber Towers Vehicle Access System.
    </p>
  `;

  // Send to the system admin (ADMIN_EMAIL env var)
  // In a future version, send to the company-specific admin email as well
  await send(subject, html);
}

// ─── ACTIVITY: sendOverrideResult ─────────────────────────────
// WF9 — confirmation email after admin approves or denies
export async function sendOverrideResult(
  event: EntryEvent,
  personnel: PersonnelRecord,
  decision: AdminDecision
): Promise<void> {
  const approved = decision.action === 'approve';
  const subject = approved
    ? `✅ Override Approved — ${event.vehicleNumber} entered`
    : `❌ Override Denied — ${event.vehicleNumber} turned away`;

  const html = `
    <h2 style="color:${approved ? '#16a34a' : '#dc2626'}">
      Override ${approved ? 'Approved' : 'Denied'}
    </h2>
    <table>
      <tr><td><b>Vehicle</b></td><td>${event.vehicleNumber}</td></tr>
      <tr><td><b>Employee</b></td><td>${personnel.pName}</td></tr>
      <tr><td><b>Decision By</b></td><td>${decision.adminId}</td></tr>
      <tr><td><b>Time</b></td><td>${event.timestamp}</td></tr>
      ${decision.reason ? `<tr><td><b>Reason</b></td><td>${decision.reason}</td></tr>` : ''}
    </table>
  `;
  await send(subject, html);
}
