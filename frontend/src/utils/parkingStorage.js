const STORAGE_KEY = 'vehicleAccess.parkingAllocations.v1';

export function loadParkingAllocations() {
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

export function saveParkingAllocations(allocations) {
  if (typeof window === 'undefined') return;
  try {
    const safe = Array.isArray(allocations) ? allocations : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (_err) {
    // Ignore storage errors for now.
  }
}
