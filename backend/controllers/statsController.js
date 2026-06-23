const { pgQuery } = require('../pgdb');
const { getHourlyStats } = require('../repositories/scanEventsRepo');
const temporalEvents = require('../temporalEvents');

const SCHEMA = 'cybertowers';
const IST_OFFSET_MS = 330 * 60 * 1000; // 5h 30m

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function istDayBounds(offsetDays = 0) {
  const d = nowIST();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays, 0, 0, 0) - IST_OFFSET_MS);
  const end   = new Date(start.getTime() + 86400000);
  return { start, end };
}

function istRangeBounds(daysBack) {
  const today = istDayBounds();
  const past  = new Date(today.start.getTime() - (daysBack - 1) * 86400000);
  return { start: past, end: today.end };
}

// Returns localised time windows as UTC Date objects suitable for PostgreSQL
function getTimeWindows() {
  const day   = istDayBounds();
  const week  = { start: istRangeBounds(7).start,  end: day.end };
  const month = { start: istRangeBounds(30).start, end: day.end };
  return { day, week, month };
}

async function getVehicleStats(req, res) {
  try {
    const period = String(req.query.period || 'day').toLowerCase();
    const tw = getTimeWindows();
    const rangeStart = period === 'week' ? tw.week.start : period === 'month' ? tw.month.start : tw.day.start;
    const rangeEnd   = period === 'day' ? tw.day.end : tw.month.end;

    if (period === 'day') {
      // Use getHourlyStats for today — returns { hour, total, granted, denied }
      const rows = await getHourlyStats(tw.day.start);

      // We need entry/exit breakdown — query directly for that
      const { rows: dirRows } = await pgQuery(`
        SELECT
          EXTRACT(HOUR FROM event_date AT TIME ZONE 'Asia/Kolkata')::int AS hour,
          direction,
          COUNT(*) AS cnt
        FROM ${SCHEMA}.scan_events
        WHERE event_date >= $1 AND event_date < $2
          AND direction IN ('In', 'Out')
        GROUP BY hour, direction
      `, [tw.day.start, tw.day.end]);

      const byHour = new Map();
      for (let i = 0; i < 24; i++) {
        byHour.set(i, { hour: i, entry: 0, exit: 0, twoWheelerEntry: 0, twoWheelerExit: 0, fourWheelerEntry: 0, fourWheelerExit: 0 });
      }
      for (const r of dirRows) {
        const b = byHour.get(r.hour);
        if (!b) continue;
        if (r.direction === 'In')  b.entry += Number(r.cnt);
        if (r.direction === 'Out') b.exit  += Number(r.cnt);
      }

      // Merge Temporal in-memory events
      for (const ev of temporalEvents.getAll()) {
        const ms = ev.timestampMs;
        if (ms < tw.day.start.getTime() || ms >= tw.day.end.getTime()) continue;
        const h = new Date(ms + IST_OFFSET_MS).getUTCHours();
        const b = byHour.get(h);
        if (!b) continue;
        if (ev.type === 'ENTRY') b.entry++;
        else if (ev.type === 'EXIT') b.exit++;
      }

      return res.json({ success: true, data: Array.from(byHour.values()) });
    } else {
      // Week / Month: group by IST date
      const { rows: dirRows } = await pgQuery(`
        SELECT
          TO_CHAR(event_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
          direction,
          COUNT(*) AS cnt
        FROM ${SCHEMA}.scan_events
        WHERE event_date >= $1 AND event_date < $2
          AND direction IN ('In', 'Out')
        GROUP BY date, direction
        ORDER BY date
      `, [rangeStart, rangeEnd]);

      const byDay = new Map();
      for (const r of dirRows) {
        if (!byDay.has(r.date)) {
          byDay.set(r.date, { date: r.date, entry: 0, exit: 0, twoWheelerEntry: 0, twoWheelerExit: 0, fourWheelerEntry: 0, fourWheelerExit: 0 });
        }
        const b = byDay.get(r.date);
        if (r.direction === 'In')  b.entry += Number(r.cnt);
        if (r.direction === 'Out') b.exit  += Number(r.cnt);
      }

      // Merge Temporal events
      for (const ev of temporalEvents.getAll()) {
        const ms = ev.timestampMs;
        if (ms < rangeStart.getTime()) continue;
        const day = new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, { date: day, entry: 0, exit: 0, twoWheelerEntry: 0, twoWheelerExit: 0, fourWheelerEntry: 0, fourWheelerExit: 0 });
        const b = byDay.get(day);
        if (ev.type === 'ENTRY') b.entry++;
        else if (ev.type === 'EXIT') b.exit++;
      }

      return res.json({ success: true, data: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)) });
    }
  } catch (err) {
    console.error('getVehicleStats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleTypeCount(req, res) {
  try {
    // Count distinct cards that scanned this month, grouped by vehicle_type stored on the card
    const tw = getTimeWindows();
    const { rows } = await pgQuery(`
      SELECT
        COUNT(*) FILTER (WHERE vehicle_type ILIKE '2%' OR vehicle_type ILIKE '%2W%') AS two_wheeler,
        COUNT(*) FILTER (WHERE vehicle_type ILIKE '4%' OR vehicle_type ILIKE '%4W%') AS four_wheeler,
        COUNT(*) AS total
      FROM (
        SELECT DISTINCT ON (se.card_no) se.card_no, c.vehicle_type
        FROM ${SCHEMA}.scan_events se
        LEFT JOIN ${SCHEMA}.cards c ON c.card_no = se.card_no AND c.deleted_at IS NULL
        WHERE se.event_date >= $1 AND se.card_no <> ''
        ORDER BY se.card_no, se.event_date DESC
      ) sub
    `, [tw.month.start]);

    const r = rows[0] || { two_wheeler: 0, four_wheeler: 0, total: 0 };
    res.json({ success: true, data: {
      twoWheeler:  Number(r.two_wheeler),
      fourWheeler: Number(r.four_wheeler),
      total:       Number(r.total),
    }});
  } catch (err) {
    console.error('getVehicleTypeCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getVehicleCount(req, res) {
  try {
    const tw = getTimeWindows();

    const { rows } = await pgQuery(`
      SELECT
        event_date, card_no, direction
      FROM ${SCHEMA}.scan_events
      WHERE event_date >= $1 AND direction IN ('In', 'Out')
    `, [tw.month.start]);

    function process(recs) {
      const unique = new Set();
      let entry = 0, exit = 0;
      for (const r of recs) {
        if (r.direction === 'In')  entry++;
        if (r.direction === 'Out') exit++;
        unique.add(r.card_no);
      }
      return { total: unique.size, entry, exit };
    }

    const dayStart   = tw.day.start.getTime();
    const dayEnd     = tw.day.end.getTime();
    const weekStart  = tw.week.start.getTime();
    const monthStart = tw.month.start.getTime();

    const dayData   = process(rows.filter(r => { const ms = new Date(r.event_date).getTime(); return ms >= dayStart && ms < dayEnd; }));
    const weekData  = process(rows.filter(r => new Date(r.event_date).getTime() >= weekStart));
    const monthData = process(rows);

    // Merge Temporal events
    for (const ev of temporalEvents.getAll()) {
      const ms = ev.timestampMs;
      const isEntry = ev.type === 'ENTRY';
      const isExit  = ev.type === 'EXIT';
      if (!isEntry && !isExit) continue;
      if (ms >= dayStart && ms < dayEnd) {
        if (isEntry) { dayData.entry++; dayData.total++; }
        else           dayData.exit++;
      }
      if (ms >= weekStart) {
        if (isEntry) { weekData.entry++; weekData.total++; }
        else           weekData.exit++;
      }
      if (ms >= monthStart) {
        if (isEntry) { monthData.entry++; monthData.total++; }
        else           monthData.exit++;
      }
    }

    res.json({ success: true, data: { day: dayData, week: weekData, month: monthData } });
  } catch (err) {
    console.error('getVehicleCount error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// Exported so reportController can use the same time windows
function getLocalTimeWindows() {
  const tw = getTimeWindows();
  return {
    dayStart:   tw.day.start,
    dayEnd:     tw.day.end,
    weekStart:  tw.week.start,
    monthStart: tw.month.start,
  };
}

module.exports = { getVehicleStats, getVehicleTypeCount, getVehicleCount, getLocalTimeWindows };
