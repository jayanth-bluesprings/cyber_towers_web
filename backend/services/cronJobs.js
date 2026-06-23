const cron = require('node-cron');
const { pgQuery } = require('../pgdb');
const { sendNotification } = require('../utils/emailService');

const SCHEMA = 'cybertowers';

// Track warned vehicles to avoid spamming the same 24h alert every 12 hours
const warned24hVehicles = {};

// Find vehicles currently inside (no exit scan) with entry older than 24h
async function check24HourStays(force = false) {
  console.log(`⏳ Running 24-hour stay check... (forced: ${force})`);
  try {
    const lookbackStart = new Date(Date.now() - 7 * 86400000);

    const { rows } = await pgQuery(`
      WITH ordered AS (
        SELECT
          card_no, person_name, company_code, vehicle_number,
          event_date, direction,
          LEAD(direction) OVER (PARTITION BY card_no ORDER BY event_date) AS next_direction
        FROM ${SCHEMA}.scan_events
        WHERE event_date >= $1 AND direction IN ('In', 'Out')
      ),
      sessions AS (
        SELECT
          card_no, person_name, company_code, vehicle_number,
          event_date AS entry_time,
          CASE WHEN next_direction = 'Out' THEN 'Exited' ELSE 'Still Inside' END AS status
        FROM ordered
        WHERE direction = 'In'
      ),
      latest AS (
        SELECT DISTINCT ON (card_no) *
        FROM sessions
        ORDER BY card_no, entry_time DESC
      )
      SELECT * FROM latest WHERE status = 'Still Inside'
    `, [lookbackStart]);

    const now = Date.now();
    const overdueVehicles = [];

    for (const record of rows) {
      const entryMs = new Date(record.entry_time).getTime();
      const hoursInside = (now - entryMs) / 3600000;

      if (hoursInside > 24) {
        const lastWarning = warned24hVehicles[record.card_no];
        const twelveHoursMs = 12 * 60 * 60 * 1000;

        if (force || !lastWarning || (now - lastWarning) > twelveHoursMs) {
          const entryTimeFormatted = new Date(record.entry_time).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false,
          });
          overdueVehicles.push({
            cardId:     record.card_no,
            flat:       record.company_code || '-',
            name:       record.person_name || record.vehicle_number || '-',
            entryTime:  entryTimeFormatted,
            hours:      Math.floor(hoursInside),
          });
          if (!force) warned24hVehicles[record.card_no] = now;
        }
      }
    }

    if (overdueVehicles.length > 0) {
      const htmlTableRows = overdueVehicles.map(v => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd">${v.cardId}</td>
          <td style="padding:8px;border:1px solid #ddd">${v.name}</td>
          <td style="padding:8px;border:1px solid #ddd">${v.flat}</td>
          <td style="padding:8px;border:1px solid #ddd">${v.entryTime}</td>
          <td style="padding:8px;border:1px solid #ddd;color:#dc2626;font-weight:bold">${v.hours} hrs</td>
        </tr>`).join('');

      const htmlContent = `
        <div style="font-family:sans-serif;color:#333">
          <h2 style="color:#dc2626">⚠️ 24-Hour Stay Alert</h2>
          <p>The following vehicles have been inside the premises for more than 24 hours without an exit scan:</p>
          <table style="width:100%;border-collapse:collapse;margin-top:20px">
            <thead>
              <tr style="background-color:#f3f4f6;text-align:left">
                <th style="padding:8px;border:1px solid #ddd">Card ID</th>
                <th style="padding:8px;border:1px solid #ddd">Vehicle No.</th>
                <th style="padding:8px;border:1px solid #ddd">Company</th>
                <th style="padding:8px;border:1px solid #ddd">Entry Time</th>
                <th style="padding:8px;border:1px solid #ddd">Duration</th>
              </tr>
            </thead>
            <tbody>${htmlTableRows}</tbody>
          </table>
          <p style="margin-top:20px;font-size:12px;color:#666">Automated alert from Vehicle Access Dashboard.</p>
        </div>`;
      await sendNotification('⚠️ Alert: Vehicles inside for over 24 hours', htmlContent);
    } else if (force) {
      await sendNotification('✅ All Clear: No vehicles inside for over 24 hours', `
        <div style="font-family:sans-serif;color:#333">
          <h2 style="color:#166534">✅ 24-Hour Stay Check: All Clear</h2>
          <p>A manual check was requested. <strong>No vehicles have been inside for more than 24 hours.</strong></p>
        </div>`);
    }

    // Prune old warnings
    const threeDaysMs = 3 * 86400000;
    for (const key in warned24hVehicles) {
      if (now - warned24hVehicles[key] > threeDaysMs) delete warned24hVehicles[key];
    }

    return overdueVehicles;
  } catch (error) {
    console.error('❌ Error checking 24h stays:', error);
    return [];
  }
}

async function sendDailySummary() {
  console.log('📊 Running daily summary report...');
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const { rows } = await pgQuery(`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'In')  AS total_entries,
        COUNT(*) FILTER (WHERE direction = 'Out') AS total_exits
      FROM ${SCHEMA}.scan_events
      WHERE event_date >= $1 AND event_date < $2
    `, [dayStart, dayEnd]);

    const { total_entries = 0, total_exits = 0 } = rows[0] || {};

    const insideRows = await pgQuery(`
      WITH ordered AS (
        SELECT card_no, event_date, direction,
          LEAD(direction) OVER (PARTITION BY card_no ORDER BY event_date) AS next_dir
        FROM ${SCHEMA}.scan_events
        WHERE event_date >= $1 AND direction IN ('In','Out')
      ),
      sessions AS (
        SELECT card_no,
          CASE WHEN next_dir = 'Out' THEN 'Exited' ELSE 'Still Inside' END AS status
        FROM ordered WHERE direction = 'In'
      ),
      latest AS (
        SELECT DISTINCT ON (card_no) * FROM sessions ORDER BY card_no
      )
      SELECT COUNT(*) AS currently_inside FROM latest WHERE status = 'Still Inside'
    `, [new Date(Date.now() - 30 * 86400000)]);

    const currentlyInside = Number(insideRows.rows[0]?.currently_inside || 0);
    const today = new Date().toLocaleDateString('en-IN');

    const htmlContent = `
      <div style="font-family:sans-serif;color:#333">
        <h2 style="color:#0284c7">📊 Daily Vehicle Summary Report</h2>
        <p>Vehicle access summary for today (${today}):</p>
        <div style="display:flex;gap:20px;margin-top:20px">
          <div style="padding:15px;background:#f0fdf4;border-radius:8px;flex:1;border:1px solid #bbf7d0">
            <h3 style="margin:0;color:#166534;font-size:16px">Total Entries Today</h3>
            <p style="font-size:24px;font-weight:bold;margin:10px 0 0;color:#15803d">${total_entries}</p>
          </div>
          <div style="padding:15px;background:#fef2f2;border-radius:8px;flex:1;border:1px solid #fecaca">
            <h3 style="margin:0;color:#991b1b;font-size:16px">Total Exits Today</h3>
            <p style="font-size:24px;font-weight:bold;margin:10px 0 0;color:#b91c1c">${total_exits}</p>
          </div>
        </div>
        <div style="margin-top:20px;padding:15px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;display:inline-block">
          <h3 style="margin:0;color:#1e40af;font-size:16px">Active Vehicles Currently Inside</h3>
          <p style="font-size:24px;font-weight:bold;margin:10px 0 0;color:#1d4ed8">${currentlyInside}</p>
        </div>
        <p style="margin-top:30px;font-size:12px;color:#666">Automated daily report from Vehicle Access Dashboard.</p>
      </div>`;

    await sendNotification('📊 Daily Vehicle Access Summary', htmlContent);
  } catch (error) {
    console.error('❌ Error running daily summary:', error);
  }
}

function initCronJobs() {
  console.log('⏰ Initializing automated email jobs...');
  cron.schedule('30 * * * *', () => { check24HourStays(); });
  cron.schedule('59 23 * * *', () => { sendDailySummary(); });
}

module.exports = { initCronJobs, check24HourStays, sendDailySummary };
