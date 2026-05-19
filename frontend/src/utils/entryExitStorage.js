const STORAGE_KEY = 'vehicleAccess.entryExitRecords.v1';
const STORAGE_MAX_RECORDS = 5000;

export function loadStoredEntryExitRecords() {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

export function saveStoredEntryExitRecords(records) {
  if (typeof window === 'undefined') return;

  try {
    const safe = Array.isArray(records) ? records.slice(0, STORAGE_MAX_RECORDS) : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (_err) {
    // Ignore quota/storage errors for now to avoid interrupting live updates.
  }
}
