import {
  DUMMY_LIVE_RECORDS,
  DUMMY_AUTHORIZED_VEHICLES,
  DUMMY_VEHICLE_COUNT,
  getDummyVehicleStats,
  DUMMY_VEHICLE_TYPE_COUNT,
  DUMMY_OCCUPANCY_SUMMARY,
  getDummyOccupancyRecords,
  DUMMY_24H_ALERT,
} from '../data/dummyData.js';

// No real WebSocket in demo mode — setting null so components skip connection
export const WS_URL = null;

// ─── Live Records ─────────────────────────────────────────────────────────────

export function fetchLive(params = {}) {
  let records = [...DUMMY_LIVE_RECORDS];

  if (params.startDate) {
    records = records.filter(r => r.ScanTime >= params.startDate);
  }
  if (params.endDate) {
    records = records.filter(r => r.ScanTime <= params.endDate + 'T23:59:59');
  }

  return Promise.resolve({ data: records });
}

export function fetchNew() {
  return Promise.resolve({ data: [] });
}

export function fetchSearch(q, params = {}) {
  if (!q) return Promise.resolve({ data: DUMMY_LIVE_RECORDS });

  const term = String(q).trim().toLowerCase();
  let results = DUMMY_LIVE_RECORDS.filter(r =>
    String(r.CardData || '').toLowerCase().includes(term) ||
    String(r.PName || '').toLowerCase().includes(term) ||
    String(r.flatNumber || '').toLowerCase().includes(term) ||
    String(r.vehicleType || '').toLowerCase().includes(term)
  );

  if (params.startDate) results = results.filter(r => r.ScanTime >= params.startDate);
  if (params.endDate)   results = results.filter(r => r.ScanTime <= params.endDate + 'T23:59:59');

  return Promise.resolve({ data: results });
}

// ─── Config / Authorized Vehicles ────────────────────────────────────────────

export function fetchAuthorizedVehicles() {
  return Promise.resolve({ data: DUMMY_AUTHORIZED_VEHICLES });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function fetchVehicleStats(period = 'day') {
  return Promise.resolve({ data: getDummyVehicleStats(period) });
}

export function fetchVehicleTypeCount() {
  return Promise.resolve({ data: DUMMY_VEHICLE_TYPE_COUNT });
}

export function fetchVehicleCount() {
  return Promise.resolve(DUMMY_VEHICLE_COUNT);
}

// ─── Occupancy ────────────────────────────────────────────────────────────────

export function fetchVehicleOccupancy(status = '') {
  if (!status) {
    return Promise.resolve({ data: DUMMY_OCCUPANCY_SUMMARY });
  }
  return Promise.resolve({ data: { records: getDummyOccupancyRecords(status) } });
}

// ─── 24h Alert ────────────────────────────────────────────────────────────────

export function fetchTrigger24hAlert() {
  return Promise.resolve({ data: DUMMY_24H_ALERT });
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export function fetchHealthEvents() {
  return Promise.resolve({
    data: {
      rfidCount: 29,
      lightCount: 29,
      mismatch: 0,
    },
  });
}

export default { fetchLive, fetchNew, fetchSearch, fetchAuthorizedVehicles, fetchVehicleStats, fetchVehicleTypeCount, fetchVehicleCount, fetchVehicleOccupancy, fetchTrigger24hAlert, fetchHealthEvents };
