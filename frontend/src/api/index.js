const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_KEY  = import.meta.env.VITE_API_KEY || '';

export const WS_URL = BASE_URL.replace(/^https/, 'wss').replace(/^http/, 'ws');

function buildHeaders() {
  const h = {};
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
}

function buildUrl(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function apiFetch(path, params = {}) {
  const res = await fetch(buildUrl(path, params), { headers: buildHeaders() });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Live Records ─────────────────────────────────────────────────────────────

export function fetchLive(params = {}) {
  return apiFetch('/api/live', {
    startDate: params.startDate,
    endDate:   params.endDate,
  });
}

export function fetchNew(lastId) {
  return apiFetch('/api/new', { lastId });
}

export function fetchSearch(q, params = {}) {
  return apiFetch('/api/search', {
    q,
    startDate: params.startDate,
    endDate:   params.endDate,
  });
}

// ─── Config / Authorized Vehicles ────────────────────────────────────────────

export function fetchAuthorizedVehicles() {
  return apiFetch('/api/authorized-vehicles');
}

export function getPersonPhotoUrl(cardId) {
  if (!cardId) return null;
  return `${BASE_URL}/api/person-photo/${encodeURIComponent(cardId)}`;
}

export async function updatePerson(cardId, data) {
  const res = await fetch(`${BASE_URL}/api/person/${encodeURIComponent(cardId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function fetchVehicleStats(period = 'day') {
  return apiFetch('/api/vehicle-stats', { period });
}

export function fetchVehicleTypeCount() {
  return apiFetch('/api/vehicle-type-count');
}

export function fetchVehicleCount() {
  return apiFetch('/api/vehicle-count');
}

// ─── Occupancy ────────────────────────────────────────────────────────────────

export function fetchVehicleOccupancy(status = '') {
  return apiFetch('/api/report/occupancy', { status });
}

// ─── Report Records ───────────────────────────────────────────────────────────

export function fetchReportRecords(params = {}) {
  return apiFetch('/api/report/records', params);
}

// ─── 24h Alert ────────────────────────────────────────────────────────────────

export function fetchTrigger24hAlert() {
  return apiFetch('/api/alerts/trigger-24h');
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export function fetchHealthEvents() {
  return apiFetch('/api/health/events');
}

export default {
  fetchLive, fetchNew, fetchSearch, fetchAuthorizedVehicles,
  fetchVehicleStats, fetchVehicleTypeCount, fetchVehicleCount,
  fetchVehicleOccupancy, fetchReportRecords, fetchTrigger24hAlert, fetchHealthEvents,
};
