const STORAGE_KEY = 'vehicleAccess.localApprovals.v1';

export function loadLocalAccessApprovals() {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

export function saveLocalAccessApprovals(approvals) {
  if (typeof window === 'undefined') return;

  try {
    const safe = approvals && typeof approvals === 'object' ? approvals : {};
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (_err) {
    // Ignore storage errors; live table should keep working.
  }
}
