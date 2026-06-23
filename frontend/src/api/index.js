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
  return apiFetch('/api/live', { startDate: params.startDate, endDate: params.endDate });
}

export function fetchNew(lastId) {
  return apiFetch('/api/new', { lastId });
}

export function fetchSearch(q, params = {}) {
  return apiFetch('/api/search', { q, startDate: params.startDate, endDate: params.endDate });
}

// ─── Config / Authorized Vehicles ────────────────────────────────────────────

export function fetchAuthorizedVehicles() {
  return apiFetch('/api/authorized-vehicles');
}

export function getPersonPhotoUrl(cardId) {
  if (!cardId) return null;
  const url = `${BASE_URL}/api/person-photo/${encodeURIComponent(cardId)}`;
  return API_KEY ? `${url}?apiKey=${encodeURIComponent(API_KEY)}` : url;
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

// ─── Cards ────────────────────────────────────────────────────────────────────

export function fetchCards(params = {}) {
  return apiFetch('/api/cards', params);
}

export function fetchCardById(id) {
  return apiFetch(`/api/cards/${encodeURIComponent(id)}`);
}

export async function createCard(data) {
  const res = await fetch(buildUrl('/api/cards'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || (json.errors && json.errors[0]) || `HTTP ${res.status}`);
  return json;
}

export async function bulkCreateCards(cards) {
  const res = await fetch(buildUrl('/api/cards/bulk'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({ cards }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function updateCard(id, data) {
  const res = await fetch(buildUrl(`/api/cards/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || (json.errors && json.errors[0]) || `HTTP ${res.status}`);
  return json;
}

export async function deleteCard(id) {
  const res = await fetch(buildUrl(`/api/cards/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function assignCardUser(id, userId) {
  const res = await fetch(buildUrl(`/api/cards/${encodeURIComponent(id)}/assign`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({ userId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function unassignCardUser(id) {
  const res = await fetch(buildUrl(`/api/cards/${encodeURIComponent(id)}/unassign`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function bulkDeactivateCards(ids) {
  const res = await fetch(buildUrl('/api/cards/bulk-status'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({ ids, cardStatus: 'Suspended' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export function fetchUsers(params = {}) {
  return apiFetch('/api/users', params);
}

// ─── Card Push ────────────────────────────────────────────────────────────────

export async function pushCardToController(id) {
  const res = await fetch(buildUrl(`/api/cards/${encodeURIComponent(id)}/push-to-controller`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function pushAllCards() {
  const res = await fetch(buildUrl('/api/cards/push-all'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export function fetchCardPushStatus(id) {
  return apiFetch(`/api/cards/${encodeURIComponent(id)}/push-status`);
}

export async function removeCardFromControllers(id) {
  const res = await fetch(buildUrl(`/api/cards/${encodeURIComponent(id)}/remove-from-controllers`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ─── Access Groups ────────────────────────────────────────────────────────────

export function fetchAccessGroups() {
  return apiFetch('/api/access-groups');
}

export function fetchAccessGroupById(id) {
  return apiFetch(`/api/access-groups/${encodeURIComponent(id)}`);
}

export async function createAccessGroup(data) {
  const res = await fetch(buildUrl('/api/access-groups'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function updateAccessGroup(id, data) {
  const res = await fetch(buildUrl(`/api/access-groups/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function deleteAccessGroup(id) {
  const res = await fetch(buildUrl(`/api/access-groups/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function setAccessGroupControllers(id, assignments) {
  const res = await fetch(buildUrl(`/api/access-groups/${encodeURIComponent(id)}/controllers`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify({ assignments }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ─── Companies ────────────────────────────────────────────────────────────────

export function fetchCompanies() {
  return apiFetch('/api/companies');
}

export async function createCompany(data) {
  const res = await fetch(buildUrl('/api/companies'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ─── Bridge Monitoring (Phase 11) ─────────────────────────────────────────────

export function fetchMonitoringOverview() {
  return apiFetch('/api/monitoring/overview');
}

export function fetchPushFailures(params = {}) {
  return apiFetch('/api/monitoring/push-failures', params);
}

export function fetchSyncLogs(params = {}) {
  return apiFetch('/api/monitoring/sync-logs', params);
}

// ─── Events (Scan Events / Access Log) ────────────────────────────────────────

export function fetchEvents(params = {}) {
  return apiFetch('/api/events', params);
}

export function fetchEventStats() {
  return apiFetch('/api/events/stats');
}

export function fetchEventsByController(sn, params = {}) {
  return apiFetch(`/api/events/by-controller/${encodeURIComponent(sn)}`, params);
}

// ─── Controllers ─────────────────────────────────────────────────────────────

export function fetchControllers(params = {}) {
  return apiFetch('/api/controllers', params);
}

export function fetchControllerHealth() {
  return apiFetch('/api/controllers/health');
}

export async function createController(data) {
  const res = await fetch(buildUrl('/api/controllers'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || (json.errors && json.errors[0]) || `HTTP ${res.status}`);
  return json;
}

export async function updateController(id, data) {
  const res = await fetch(buildUrl(`/api/controllers/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildHeaders() },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || (json.errors && json.errors[0]) || `HTTP ${res.status}`);
  return json;
}

export async function deleteController(id) {
  const res = await fetch(buildUrl(`/api/controllers/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export default {
  fetchLive, fetchNew, fetchSearch, fetchAuthorizedVehicles,
  fetchVehicleStats, fetchVehicleTypeCount, fetchVehicleCount,
  fetchVehicleOccupancy, fetchReportRecords, fetchTrigger24hAlert,
  fetchControllers, fetchControllerHealth, createController, updateController, deleteController,
  fetchCards, fetchCardById, createCard, updateCard, deleteCard,
  assignCardUser, unassignCardUser, bulkDeactivateCards, fetchUsers,
  pushCardToController, pushAllCards, fetchCardPushStatus, removeCardFromControllers,
  fetchEvents, fetchEventStats, fetchEventsByController,
  fetchAccessGroups, fetchAccessGroupById, createAccessGroup, updateAccessGroup, deleteAccessGroup, setAccessGroupControllers,
  fetchMonitoringOverview, fetchPushFailures, fetchSyncLogs,
  fetchCompanies, createCompany,
};
