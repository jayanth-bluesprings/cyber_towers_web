// In-memory store for events broadcast by Temporal workflows via /internal/parking-update.
// Augments DB-based stats and report queries so they reflect simulator events in real-time.
// Events are pruned after 24 hours. State resets on server restart.

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** @type {Array<{type:string,cardId:string,vehicleNumber:string,gate:string,personName:string,companyCode:string,timestamp:string,timestampMs:number}>} */
const _events = [];

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  let i = 0;
  while (i < _events.length && _events[i].timestampMs < cutoff) i++;
  if (i > 0) _events.splice(0, i);
}

// IST offset: UTC+5:30
const IST_OFFSET_MS = 330 * 60 * 1000;

function addEvent({ type, cardId, vehicleNumber, gate, personName, companyCode, timestamp }) {
  prune();
  const ts = timestamp || new Date().toISOString();
  const ms = new Date(ts).getTime() || Date.now();
  // Store display timestamp as "IST wall-clock expressed as fake UTC" — matches
  // the TimeWatch DB convention so formatTime/formatDateTime in the frontend works
  // correctly. timestampMs stays as true UTC ms for time-window arithmetic.
  const istFakeUtc = new Date(ms + IST_OFFSET_MS).toISOString();
  _events.push({
    type:          (type || 'ENTRY').toUpperCase(),
    cardId:        cardId        || '',
    vehicleNumber: vehicleNumber || '',
    gate:          gate          || 'GATE_1',
    personName:    personName    || '',
    companyCode:   companyCode   || '',
    timestamp:     istFakeUtc,
    timestampMs:   ms,
  });
}

function getAll() {
  prune();
  return [..._events];
}

// Build synthetic session records from in-memory ENTRY/EXIT pairs.
// Returns objects matching the shape used by getReportRecords and getVehicleOccupancy.
// fromMs/toMs filter by UTC milliseconds (0 / Infinity = no filter).
function buildSessions(fromMs, toMs) {
  prune();
  const from = (fromMs == null) ? 0         : fromMs;
  const to   = (toMs   == null) ? Infinity  : toMs;

  const relevant = _events.filter(e => e.timestampMs >= from && e.timestampMs < to);

  const byCard = new Map();
  for (const ev of relevant) {
    const key = ev.cardId || ev.vehicleNumber || 'UNKNOWN';
    if (!byCard.has(key)) byCard.set(key, []);
    byCard.get(key).push(ev);
  }

  const sessions = [];
  for (const [cardId, evs] of byCard) {
    const sorted = [...evs].sort((a, b) => a.timestampMs - b.timestampMs);
    let i = 0;
    while (i < sorted.length) {
      const ev = sorted[i];
      if (ev.type === 'ENTRY') {
        // Find the next EXIT for this card
        let nextExitIdx = -1;
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].type === 'EXIT') { nextExitIdx = j; break; }
        }
        const nextExit = nextExitIdx >= 0 ? sorted[nextExitIdx] : null;
        sessions.push({
          CardData:      cardId,
          PName:         ev.personName  || ev.vehicleNumber || cardId,
          PCode:         ev.companyCode || '',
          PersonnelID:   null,
          EntryTime:     ev.timestamp,
          EntryGate:     ev.gate,
          ExitTime:      nextExit ? nextExit.timestamp : null,
          ExitGate:      nextExit ? nextExit.gate      : null,
          Status:        nextExit ? 'Exited' : 'Still Inside',
          Addr:          ev.companyCode || null,
          VehicleType:   null,
          Authorization: ev.companyCode ? 'Authorized' : 'Unauthorized',
        });
        i = nextExitIdx >= 0 ? nextExitIdx + 1 : i + 1;
      } else {
        i++;
      }
    }
  }

  // Newest first — matches the ORDER BY EntryTime DESC used in getReportRecords
  return sessions.sort((a, b) => new Date(b.EntryTime).getTime() - new Date(a.EntryTime).getTime());
}

module.exports = { addEvent, getAll, buildSessions };
