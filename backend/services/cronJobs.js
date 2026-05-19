const cron = require('node-cron');
const { query } = require('../db');
const { getPersonnelMap } = require('../personnelCache');
const { sendNotification } = require('../utils/emailService');

// Track warned vehicles to avoid spamming the same 24h alert every hour
// We'll store: { [CardRecordID]: timestamp }
const warned24hVehicles = {};

function buildSessionQuery() {
    return `
      WITH RawData AS (
        SELECT
          c.CardRecordID,
          c.CardData,
          c.PName,
          c.PCode,
          c.PersonnelID,
          c.EquptName,
          c.PortNum,
          c.DataTime,
          DATEADD(SECOND, c.DataTime * 86400, '1899-12-30') AS ScanTime,
          CASE
             WHEN c.PortNum = 1 THEN 'Entry'
             WHEN c.PortNum = 2 THEN 'Exit'
             ELSE 'Unknown'
          END AS GateDir
        FROM CardRecord c WITH (NOLOCK)
        WHERE c.DataTime >= @startFloat -- Filter for last couple of days to optimize
      ),
      Deduped AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY CardData, CAST(DataTime * 86400 / 30 AS BIGINT)
            ORDER BY CardRecordID DESC
          ) AS rn
        FROM RawData
      ),
      Clean AS (
        SELECT * FROM Deduped 
        WHERE rn = 1 AND GateDir <> 'Unknown'
      ),
      WithNext AS (
        SELECT
          CardData, PName, PCode, PersonnelID, CardRecordID,
          ScanTime AS CurTime, EquptName AS CurGate, GateDir AS CurDir,
          LEAD(ScanTime) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextTime,
          LEAD(GateDir) OVER (PARTITION BY CardData ORDER BY ScanTime) AS NextDir
        FROM Clean
      ),
      Sessions AS (
        SELECT
          CardRecordID, CardData, PName, PCode, PersonnelID,
          CurTime AS EntryTime, CurGate AS EntryGate,
          CASE WHEN NextDir = 'Exit' THEN NextTime ELSE NULL END AS ExitTime,
          CASE WHEN NextDir = 'Exit' THEN 'Exited' ELSE 'Still Inside' END AS Status
        FROM WithNext
        WHERE CurDir = 'Entry'
      ),
      LatestSessions AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY CardData ORDER BY EntryTime DESC) AS session_rn
        FROM Sessions
      )
      SELECT * FROM LatestSessions WHERE session_rn = 1 AND Status = 'Still Inside'
    `;
}

async function check24HourStays(force = false) {
    console.log(`⏳ Running 24-hour stay check... (forced: ${force})`);
    try {
        // Look back 7 days to find open sessions
        const lookbackDays = 7;
        const now = new Date();
        const baseDate = Date.UTC(1899, 11, 30, 0, 0, 0);
        const nowFloat = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()) - baseDate) / (24 * 60 * 60 * 1000);
        const startFloat = nowFloat - lookbackDays;

        const result = await query(buildSessionQuery(), { startFloat });
        const personnelMap = await getPersonnelMap();

        const overdueVehicles = [];

        for (const record of result.recordset) {
            const entryRaw = new Date(record.EntryTime);
            // record.EntryTime was parsed by mssql treating the local DB time as UTC.
            const entryTimeLocalAsUtc = entryRaw.getTime();
            const nowLocalAsUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
            const hoursInside = (nowLocalAsUtc - entryTimeLocalAsUtc) / (1000 * 60 * 60);

            if (hoursInside > 24) {
                // If not already warned in the last 12 hours (skip this check if forced)
                const lastWarning = warned24hVehicles[record.CardRecordID];
                const twelveHoursMs = 12 * 60 * 60 * 1000;

                if (force || !lastWarning || (now.getTime() - lastWarning) > twelveHoursMs) {
                    const p = personnelMap.get(record.PersonnelID) || {};
                    // Generate local time representation from false UTC
                    const entryTimeFormatted = entryRaw.toISOString().replace('Z', '').split('T').join(' ').slice(0, 16);
                    overdueVehicles.push({
                        cardId: record.CardData,
                        flat: p.Addr || record.PCode || '-',
                        name: record.PName || '-',
                        entryTime: entryTimeFormatted,
                        hours: Math.floor(hoursInside)
                    });
                    if (!force) {
                        warned24hVehicles[record.CardRecordID] = now.getTime();
                    }
                }
            }
        }

        if (overdueVehicles.length > 0) {
            let htmlTableRows = overdueVehicles.map(v =>
                `<tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">${v.cardId}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${v.name}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${v.flat}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${v.entryTime}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; color: #dc2626; font-weight: bold;">${v.hours} hrs</td>
                </tr>`
            ).join('');

            const htmlContent = `
                <div style="font-family: sans-serif; color: #333;">
                    <h2 style="color: #dc2626;">⚠️ 24-Hour Stay Alert</h2>
                    <p>The following vehicles have been inside the premises for more than 24 hours without an exit scan:</p>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                        <thead>
                            <tr style="background-color: #f3f4f6; text-align: left;">
                                <th style="padding: 8px; border: 1px solid #ddd;">Card ID</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Vehicle No.</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Company Name</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Entry Time</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${htmlTableRows}
                        </tbody>
                    </table>
                    <p style="margin-top: 20px; font-size: 12px; color: #666;">This is an automated alert from the Vehicle Access Dashboard.</p>
                </div>
            `;

            await sendNotification('⚠️ Alert: Vehicles inside for over 24 hours', htmlContent);
        } else if (force) {
            const htmlContent = `
                <div style="font-family: sans-serif; color: #333;">
                    <h2 style="color: #166534;">✅ 24-Hour Stay Check: All Clear</h2>
                    <p>A manual check was requested from the dashboard.</p>
                    <p>Great news: <strong>There are currently no vehicles inside the premises for more than 24 hours.</strong></p>
                    <p style="margin-top: 20px; font-size: 12px; color: #666;">This is an automated alert from the Vehicle Access Dashboard.</p>
                </div>
            `;
            await sendNotification('✅ All Clear: No vehicles inside for over 24 hours', htmlContent);
        }

        // Clean up old tracked warnings (older than 3 days)
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        for (const key in warned24hVehicles) {
            if (now.getTime() - warned24hVehicles[key] > threeDaysMs) {
                delete warned24hVehicles[key];
            }
        }

        return overdueVehicles;

    } catch (error) {
        console.error('❌ Error checking 24h stays:', error);
    }
}

async function sendDailySummary() {
    console.log('📊 Running daily summary report...');
    try {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

        const baseDate = Date.UTC(1899, 11, 30, 0, 0, 0);
        const startFloat = (Date.UTC(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate(), startOfDay.getHours(), startOfDay.getMinutes(), startOfDay.getSeconds()) - baseDate) / (24 * 60 * 60 * 1000);
        const endFloat = (Date.UTC(endOfDay.getFullYear(), endOfDay.getMonth(), endOfDay.getDate(), endOfDay.getHours(), endOfDay.getMinutes(), endOfDay.getSeconds()) - baseDate) / (24 * 60 * 60 * 1000);

        // Get total entries and exits today
        const scansResult = await query(`
            SELECT 
                SUM(CASE WHEN PortNum = 1 THEN 1 ELSE 0 END) as TotalEntries,
                SUM(CASE WHEN PortNum = 2 THEN 1 ELSE 0 END) as TotalExits
            FROM CardRecord WITH (NOLOCK)
            WHERE DataTime >= @startFloat AND DataTime < @endFloat
        `, { startFloat, endFloat });

        const { TotalEntries = 0, TotalExits = 0 } = scansResult.recordset[0] || {};

        // Get current total vehicles inside
        // Look back 30 days for currently open sessions since sometimes vehicles stay a while
        const activeStartFloat = startFloat - 30;
        const insideResult = await query(buildSessionQuery(), { startFloat: activeStartFloat });
        const currentlyInside = insideResult.recordset.length;

        const htmlContent = `
            <div style="font-family: sans-serif; color: #333;">
                <h2 style="color: #0284c7;">📊 Daily Vehicle Summary Report</h2>
                <p>Here is the vehicle access summary for today (${today.toLocaleDateString('en-IN')}):</p>
                
                <div style="display: flex; gap: 20px; margin-top: 20px;">
                    <div style="padding: 15px; background-color: #f0fdf4; border-radius: 8px; flex: 1; border: 1px solid #bbf7d0;">
                        <h3 style="margin: 0; color: #166534; font-size: 16px;">Total Entries Today</h3>
                        <p style="font-size: 24px; font-weight: bold; margin: 10px 0 0 0; color: #15803d;">${TotalEntries}</p>
                    </div>
                    <div style="padding: 15px; background-color: #fef2f2; border-radius: 8px; flex: 1; border: 1px solid #fecaca;">
                        <h3 style="margin: 0; color: #991b1b; font-size: 16px;">Total Exits Today</h3>
                        <p style="font-size: 24px; font-weight: bold; margin: 10px 0 0 0; color: #b91c1c;">${TotalExits}</p>
                    </div>
                </div>

                <div style="margin-top: 20px; padding: 15px; background-color: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe; display: inline-block;">
                    <h3 style="margin: 0; color: #1e40af; font-size: 16px;">Active Vehicles Currently Inside</h3>
                    <p style="font-size: 24px; font-weight: bold; margin: 10px 0 0 0; color: #1d4ed8;">${currentlyInside}</p>
                </div>

                <p style="margin-top: 30px; font-size: 12px; color: #666;">This is an automated daily report from the Vehicle Access Dashboard.</p>
            </div>
        `;

        await sendNotification('📊 Daily Vehicle Access Summary', htmlContent);

    } catch (error) {
        console.error('❌ Error running daily summary:', error);
    }
}

function initCronJobs() {
    console.log('⏰ Initializing automated email jobs...');

    // Check for 24h stays every hour on the half-hour (e.g., 2:30, 3:30)
    cron.schedule('30 * * * *', () => {
        check24HourStays();
    });

    // Send daily summary every night at 11:59 PM (IST time if server is in IST)
    cron.schedule('59 23 * * *', () => {
        sendDailySummary();
    });
}

module.exports = { initCronJobs, check24HourStays, sendDailySummary };
