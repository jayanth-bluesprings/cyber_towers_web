const STORAGE_KEY = 'vehicleAccess.registeredVehicles.v1';

const DEFAULT_STATE = {
  customVehicles: [],
  editsByCardId: {},
  deletedCardIds: [],
};

export function loadRegisteredVehiclesState() {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      customVehicles: Array.isArray(parsed?.customVehicles) ? parsed.customVehicles : [],
      editsByCardId: parsed?.editsByCardId && typeof parsed.editsByCardId === 'object' ? parsed.editsByCardId : {},
      deletedCardIds: Array.isArray(parsed?.deletedCardIds) ? parsed.deletedCardIds : [],
    };
  } catch (_err) {
    return DEFAULT_STATE;
  }
}

export function saveRegisteredVehiclesState(state) {
  if (typeof window === 'undefined') return;
  try {
    const safe = {
      customVehicles: Array.isArray(state?.customVehicles) ? state.customVehicles : [],
      editsByCardId: state?.editsByCardId && typeof state.editsByCardId === 'object' ? state.editsByCardId : {},
      deletedCardIds: Array.isArray(state?.deletedCardIds) ? state.deletedCardIds : [],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (_err) {
    // Ignore local storage write errors.
  }
}
