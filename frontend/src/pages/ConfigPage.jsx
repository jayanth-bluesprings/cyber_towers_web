import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import {
  fetchAuthorizedVehicles, getPersonPhotoUrl, updatePerson, WS_URL,
  fetchControllers, fetchControllerHealth, createController, updateController, deleteController,
  fetchCards, createCard, updateCard, deleteCard, bulkCreateCards,
  assignCardUser, unassignCardUser, bulkDeactivateCards, fetchUsers,
  pushCardToController, pushAllCards,
  removeCardFromControllers,
  fetchAccessGroups, fetchAccessGroupById,
  createAccessGroup, updateAccessGroup, deleteAccessGroup, setAccessGroupControllers,
  fetchEvents, createCompany, fetchCompanies,
} from '../api/index.js';
import EventsTab from '../components/EventsTab.jsx';
import BridgeMonitorTab from '../components/BridgeMonitorTab.jsx';
import { loadParkingAllocations, saveParkingAllocations } from '../utils/parkingStorage.js';
import { loadRegisteredVehiclesState, saveRegisteredVehiclesState } from '../utils/registeredVehiclesStorage.js';

function normalize(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text === '-' || text === '0') return '';
  return text;
}

function cardKey(value) {
  return normalize(value).toUpperCase();
}

function createEmptyForm() {
  return {
    CardData: '',
    PName: '',
    CarNumber: '',
    Addr: '',
    vehicleType: '',
    BloodGroup: '',
    Authorization: 'Active',
    ParkingSpace: '',
  };
}

function createEmptyCompanyForm() {
  return {
    companyName: '',
    parkingSlots: '',
    blockOrQuadrant: '',
    adminName: '',
    adminEmail: '',
    phoneNumber: '',
  };
}

function createEmptyCardForm() {
  return {
    cardNo: '', personName: '', personCode: '', department: '',
    vehicleNumber: '', vehicleType: '', vehicleBrand: '', vehicleColor: '',
    cardType: 'Normal', cardStatus: 'Active', accessGroupId: '', assignedUserId: '',
    bloodGroup: '', validFrom: '', validUntil: '', notes: '',
    photoUrl: '', photoData: '',
  };
}

// Downscale a locally-picked image to a small JPEG data URI so the base64 payload
// stays well under the API body limit. Returns a Promise<string> (data: URI).
function compressImageFile(file, maxDim = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height > maxDim)            { width  = Math.round(width  * maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function createEmptyControllerForm() {
  return {
    sn: '',
    ipAddress: '',
    tcpPort: '8000',
    udpPort: '8101',
    password: '',
    locationLabel: '',
    doorCount: '1',
    doorLabels: { 1: 'Door 1' },
    notes: '',
  };
}

function authBadgeClass(authorization) {
  return authorization === 'Inactive' || authorization === 'Unauthorized'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
}

const COMPANY_NAME_MAP = {
  MSF: 'Microsoft India',
  GGL: 'Google India',
  AMZ: 'Amazon India',
  INF: 'Infosys Ltd',
  WIP: 'Wipro Technologies',
  TCS: 'Tata Consultancy Services',
  TM:  'Tech Mahindra',
  COG: 'Cognizant Technology Solutions',
  DEL: 'Deloitte India',
  JPM: 'JP Morgan Services India',
};

function getCompanyName(addr) {
  if (!addr || addr === '-') return '-';
  const prefix = String(addr).split('-')[0].toUpperCase();
  return COMPANY_NAME_MAP[prefix] || addr;
}

// "Microsoft India PS-1/22" → "1/22"
function getSlotLabel(parkingSpace) {
  if (!parkingSpace || parkingSpace === '-') return null;
  const match = String(parkingSpace).match(/PS-(\d+\/\d+)/);
  return match ? match[1] : null;
}

function loadCompanies() {
  try {
    const stored = localStorage.getItem('registeredCompanies');
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCompanies(list) {
  try {
    localStorage.setItem('registeredCompanies', JSON.stringify(list));
  } catch {
    // ignore
  }
}

function PersonPhoto({ cardId, name, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const url = getPersonPhotoUrl(cardId);
  const dim = size === 'lg' ? 'w-14 h-14 text-base' : size === 'xl' ? 'w-20 h-20 text-xl' : 'w-10 h-10 text-xs';

  if (!url || failed) {
    const initials = (name || '?')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return (
      <div className={`${dim} rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-500 dark:text-slate-300 shrink-0`}>
        {initials}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name || 'photo'}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${dim} rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0`}
    />
  );
}

export default function ConfigPage({ dark, setDark, onNavigate, onLogout, activePage = 'config', role = 'admin' }) {
  const [registryState, setRegistryState] = useState(() => loadRegisteredVehiclesState());
  const [parkingAllocations, setParkingAllocations] = useState(() => loadParkingAllocations());
  const [companies, setCompanies] = useState(() => loadCompanies());
  const [activeTab, setActiveTab] = useState('vehicles');
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [search, setSearch] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterVehicleType, setFilterVehicleType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [latestScannedCard, setLatestScannedCard] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [editingCardId, setEditingCardId] = useState('');
  const [form, setForm] = useState(createEmptyForm());
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState(createEmptyCompanyForm());
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'db-ok' | 'local-only' | 'error'

  // ── Controller state ──────────────────────────────────────────────────────
  const [controllerSearch, setControllerSearch] = useState('');
  const [ctrlModal, setCtrlModal] = useState({ open: false, mode: 'add', data: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, controller: null });
  const [ctrlForm, setCtrlForm] = useState(createEmptyControllerForm());
  const [ctrlSaving, setCtrlSaving] = useState(false);
  const [ctrlError, setCtrlError] = useState('');
  // Live status from WebSocket: Map<sn, { is_online, last_heartbeat_at }>
  const [liveStatus, setLiveStatus] = useState(new Map());

  // ── Card state ────────────────────────────────────────────────────────────
  const [cardSearch,   setCardSearch]   = useState('');
  const [cardFilterStatus,      setCardFilterStatus]      = useState('');
  const [cardFilterVehicleType, setCardFilterVehicleType] = useState('');
  const [cardPage,     setCardPage]     = useState(1);
  const [cardModal,    setCardModal]    = useState({ open: false, mode: 'add', data: null });
  const [cardDeleteDialog, setCardDeleteDialog] = useState({ open: false, card: null });
  const [csvModal,     setCsvModal]     = useState({ open: false, step: 'upload', preview: [], results: null, uploading: false, error: '' });
  const [cardAssignDialog, setCardAssignDialog] = useState({ open: false, card: null });
  const [cardForm,     setCardForm]     = useState(createEmptyCardForm());
  const [cardSaving,   setCardSaving]   = useState(false);
  const [cardError,    setCardError]    = useState('');
  const [cardPhotoMode, setCardPhotoMode] = useState('url'); // 'url' | 'upload'
  const [cardPhotoBusy, setCardPhotoBusy] = useState(false);
  const cardPhotoInputRef = useRef(null);
  const [selectedCardIds, setSelectedCardIds] = useState(new Set());
  const [bulkWorking,  setBulkWorking]  = useState(false);
  // push_status live overrides: Map<cardId, { push_status, last_pushed_at, push_error }>
  const [pushStatusMap, setPushStatusMap] = useState(new Map());
  const [pushingIds,   setPushingIds]   = useState(new Set()); // cards with in-flight push
  const [syncAllWorking, setSyncAllWorking] = useState(false);
  const [syncAllResult,  setSyncAllResult]  = useState(null); // { queued, controllers } | null

  // Push notice: { cardId, type: 'queued'|'offline'|'error', msg } — shown inline in the row
  const [pushNotice, setPushNotice] = useState(null);

  // Remove-from-controllers state
  const [removeDialog,  setRemoveDialog]  = useState({ open: false, card: null });
  const [removingIds,   setRemovingIds]   = useState(new Set()); // cards with in-flight remove

  const queryClient = useQueryClient();
  const scanWsRef = useRef(null);
  const scanReconnectRef = useRef(null);

  const { data } = useQuery({
    queryKey: ['authorizedVehicles'],
    queryFn: fetchAuthorizedVehicles,
  });

  const { data: controllersData, isLoading: controllersLoading, refetch: refetchControllers } = useQuery({
    queryKey: ['controllers', controllerSearch],
    queryFn: () => fetchControllers({ search: controllerSearch, limit: 200 }),
    refetchInterval: 30000,
  });

  const { data: cardsData, isLoading: cardsLoading, refetch: refetchCards } = useQuery({
    queryKey: ['cards', cardSearch, cardFilterStatus, cardFilterVehicleType, cardPage],
    queryFn: () => fetchCards({
      search: cardSearch || undefined,
      status: cardFilterStatus || undefined,
      vehicleType: cardFilterVehicleType || undefined,
      page: cardPage,
      limit: 50,
    }),
    enabled: activeTab === 'cards',
    keepPreviousData: true,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => fetchUsers({ limit: 200 }),
    enabled: activeTab === 'cards',
    staleTime: 60000,
  });

  const { data: companiesListData } = useQuery({
    queryKey: ['companies-list'],
    queryFn: fetchCompanies,
    staleTime: 30000,
  });
  const companiesList = companiesListData?.data ?? [];

  const { data: accessGroupsData, refetch: refetchAccessGroups } = useQuery({
    queryKey: ['access-groups'],
    queryFn: fetchAccessGroups,
    staleTime: 30000,
  });

  // Access Groups tab state
  const [agModal,  setAgModal]  = useState({ open: false, mode: 'add', data: null });
  const [agForm,   setAgForm]   = useState({ name: '', description: '' });
  const [agSaving, setAgSaving] = useState(false);
  const [agError,  setAgError]  = useState('');
  const [agAssignModal, setAgAssignModal] = useState({ open: false, group: null, assignments: [] });
  const [agAssignSaving, setAgAssignSaving] = useState(false);

  const apiVehicles = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.map((vehicle) => ({
      CardData: normalize(vehicle.CardData),
      PName: normalize(vehicle.PName),
      CarNumber: normalize(vehicle.CarNumber),
      Addr: normalize(vehicle.flatNumber || vehicle.Addr),
      vehicleType: normalize(vehicle.vehicleType),
      BloodGroup: normalize(vehicle.BloodGroup || vehicle.BloodGrp || vehicle.BloodGroupName),
      Authorization: 'Active',
      isCustom: false,
    }));
  }, [data]);

  useEffect(() => {
    saveRegisteredVehiclesState(registryState);
  }, [registryState]);

  useEffect(() => {
    saveParkingAllocations(parkingAllocations);
  }, [parkingAllocations]);

  useEffect(() => {
    saveCompanies(companies);
  }, [companies]);

  useEffect(() => {
    function connectScanWs() {
      if (!WS_URL) return;
      if (scanWsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const ws = new WebSocket(WS_URL);
        scanWsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);

            // Auto-fill card ID when new scan arrives in Add modal
            if (payload?.type === 'new_scans' || payload?.type === 'bridge_event') {
              const rec = payload.type === 'bridge_event' ? payload.data : (Array.isArray(payload?.data) ? payload.data[0] : null);
              const nextCard = normalize(rec?.CardData || rec?.card_no || rec?.cardNo);
              if (nextCard) setLatestScannedCard(nextCard);
            }

            // Update live controller status without a full refetch
            if (payload?.type === 'controller_status' && payload?.data?.sn) {
              const { sn, isOnline, lastHeartbeatAt } = payload.data;
              setLiveStatus(prev => {
                const next = new Map(prev);
                next.set(sn, { is_online: isOnline, last_heartbeat_at: lastHeartbeatAt });
                return next;
              });
            }

            // Card push result — update push status map in real-time
            if (payload?.type === 'card_push_result' && payload?.data?.cardId) {
              const { cardId, success } = payload.data;
              setPushStatusMap(prev => {
                const next = new Map(prev);
                next.set(cardId, {
                  push_status:    success ? 'Synced' : 'Failed',
                  last_pushed_at: new Date().toISOString(),
                  push_error:     payload.data.errorMessage || null,
                });
                return next;
              });
              setPushingIds(prev => { const n = new Set(prev); n.delete(cardId); return n; });
            }

            // push-all queued confirmation
            if (payload?.type === 'card_push_all_queued') {
              setSyncAllWorking(false);
              setSyncAllResult(payload.data);
              refetchCards();
            }

            // Card remove result — update push status map in real-time
            if (payload?.type === 'card_remove_result' && payload?.data?.cardId) {
              const { cardId, success } = payload.data;
              setPushStatusMap(prev => {
                const next = new Map(prev);
                next.set(cardId, {
                  push_status:    success ? 'Removed' : 'Failed',
                  last_pushed_at: new Date().toISOString(),
                  push_error:     payload.data.errorMessage || null,
                });
                return next;
              });
              setRemovingIds(prev => { const n = new Set(prev); n.delete(cardId); return n; });
            }
          } catch (_err) { /* ignore */ }
        };

        ws.onclose = () => {
          scanReconnectRef.current = setTimeout(connectScanWs, 5000);
        };
      } catch (_err) {
        scanReconnectRef.current = setTimeout(connectScanWs, 5000);
      }
    }

    connectScanWs();
    return () => {
      if (scanReconnectRef.current) clearTimeout(scanReconnectRef.current);
      if (scanWsRef.current) scanWsRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (!modalOpen || modalMode !== 'add') return;
    if (!latestScannedCard) return;
    setForm((prev) => ({ ...prev, CardData: latestScannedCard }));
  }, [latestScannedCard, modalOpen, modalMode]);

  useEffect(() => {
    if (!cardModal.open || cardModal.mode !== 'add') return;
    if (!latestScannedCard) return;
    setCardForm((prev) => prev.cardNo ? prev : { ...prev, cardNo: latestScannedCard });
  }, [latestScannedCard, cardModal.open, cardModal.mode]);

  const parkingByCardId = useMemo(() => {
    const map = new Map();
    for (const item of parkingAllocations) {
      const key = cardKey(item.cardId);
      if (!key) continue;
      map.set(key, normalize(item.parkingSpace) || '-');
    }
    return map;
  }, [parkingAllocations]);

  const vehicles = useMemo(() => {
    const deleted = new Set((registryState.deletedCardIds || []).map((id) => cardKey(id)));
    const edits = registryState.editsByCardId || {};
    const customVehicles = Array.isArray(registryState.customVehicles) ? registryState.customVehicles : [];

    const merged = [];
    for (const row of apiVehicles) {
      const key = cardKey(row.CardData);
      if (!key || deleted.has(key)) continue;
      const edit = edits[key] || {};
      merged.push({ ...row, ...edit, CardData: row.CardData, isCustom: false });
    }

    for (const row of customVehicles) {
      const key = cardKey(row.CardData);
      if (!key || deleted.has(key)) continue;
      const edit = edits[key] || {};
      merged.push({
        CardData: normalize(row.CardData),
        PName: normalize(row.PName),
        CarNumber: normalize(row.CarNumber),
        Addr: normalize(row.Addr),
        vehicleType: normalize(row.vehicleType),
        BloodGroup: normalize(row.BloodGroup),
        Authorization: normalize(row.Authorization) || 'Active',
        ...edit,
        isCustom: true,
      });
    }

    return merged;
  }, [apiVehicles, registryState]);

  const filteredVehicles = useMemo(() => {
    let list = vehicles;

    if (filterCompany) {
      list = list.filter((v) => getCompanyName(v.Addr) === filterCompany);
    }
    if (filterVehicleType) {
      list = list.filter((v) => {
        const vt = normalize(v.vehicleType).toUpperCase();
        if (filterVehicleType === '2W') return vt.startsWith('2');
        if (filterVehicleType === '4W') return vt.startsWith('4');
        return !vt.startsWith('2') && !vt.startsWith('4');
      });
    }
    if (filterStatus) {
      list = list.filter((v) => {
        const auth = normalize(v.Authorization);
        if (filterStatus === 'Active') return auth !== 'Inactive' && auth !== 'Unauthorized';
        return auth === 'Inactive' || auth === 'Unauthorized';
      });
    }

    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((vehicle) =>
      [
        vehicle.CardData,
        vehicle.PName,
        vehicle.CarNumber,
        vehicle.Addr,
        getCompanyName(vehicle.Addr),
        vehicle.vehicleType,
        vehicle.BloodGroup,
        vehicle.Authorization,
      ]
        .map((value) => normalize(value).toLowerCase())
        .some((value) => value.includes(term))
    );
  }, [search, filterCompany, filterVehicleType, filterStatus, vehicles]);

  const configStats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter((v) => normalize(v.Authorization) === 'Active' || (normalize(v.Authorization) !== 'Inactive' && normalize(v.Authorization) !== 'Unauthorized' && normalize(v.Authorization) !== '')).length;
    const inactive = total - active;
    const withParking = vehicles.filter((v) => {
      const slot = parkingByCardId.get(cardKey(v.CardData));
      return Boolean(normalize(slot));
    }).length;
    const withoutParking = Math.max(0, total - withParking);
    const twoW = vehicles.filter((v) => normalize(v.vehicleType).toUpperCase().startsWith('2')).length;
    const fourW = vehicles.filter((v) => normalize(v.vehicleType).toUpperCase().startsWith('4')).length;
    const custom = (registryState.customVehicles || []).length;

    return { total, active, inactive, withParking, withoutParking, twoW, fourW, custom };
  }, [vehicles, parkingByCardId, registryState.customVehicles]);

  const companyOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const v of vehicles) {
      const name = getCompanyName(v.Addr);
      if (name && name !== '-' && !seen.has(name)) {
        seen.add(name);
        opts.push(name);
      }
    }
    return opts.sort();
  }, [vehicles]);

  const allCompanies = useMemo(() => {
    const countMap = new Map();
    for (const v of vehicles) {
      const name = getCompanyName(v.Addr);
      if (name && name !== '-') {
        countMap.set(name, (countMap.get(name) || 0) + 1);
      }
    }
    const registered = companies.map((c) => ({
      ...c,
      displayName: c.companyName,
      vehicleCount: countMap.get(c.companyName) || 0,
      fromRegistry: true,
    }));
    const registeredNames = new Set(companies.map((c) => c.companyName));
    const derived = [];
    for (const [name, count] of countMap) {
      if (!registeredNames.has(name)) {
        derived.push({ displayName: name, vehicleCount: count, fromRegistry: false });
      }
    }
    return [...registered, ...derived].sort((a, b) => b.vehicleCount - a.vehicleCount);
  }, [vehicles, companies]);

  function upsertParkingForCard(vehicle, slotValue) {
    const key = cardKey(vehicle.CardData);
    const slot = normalize(slotValue).toUpperCase();

    if (!key) return true;
    if (!slot) {
      setParkingAllocations((prev) => prev.filter((item) => cardKey(item.cardId) !== key));
      return true;
    }

    const taken = parkingAllocations.find(
      (item) => normalize(item.parkingSpace).toUpperCase() === slot && cardKey(item.cardId) !== key
    );
    if (taken) {
      alert(`Parking space ${slot} is already allotted to ${taken.cardId}.`);
      return false;
    }

    setParkingAllocations((prev) => {
      const existing = prev.find((item) => cardKey(item.cardId) === key);
      const next = prev.filter((item) => cardKey(item.cardId) !== key);
      next.unshift({
        cardId: normalize(vehicle.CardData),
        vehicleNo: normalize(vehicle.PName) || '-',
        companyName: normalize(vehicle.Addr) || '-',
        vehicleType: normalize(vehicle.vehicleType) || '-',
        parkingSpace: slot,
        remark: existing?.remark || '',
        allottedAt: existing?.allottedAt || new Date().toISOString(),
      });
      return next;
    });
    return true;
  }

  function openAddModal() {
    setCardForm(createEmptyCardForm());
    setCardError('');
    setCardPhotoMode('url');
    setCardModal({ open: true, mode: 'add', data: null });
  }

  async function handleCardPhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setCardError('Please choose an image file (JPG, PNG, etc.).'); return; }
    setCardPhotoBusy(true);
    setCardError('');
    try {
      const dataUri = await compressImageFile(file);
      setCardForm((p) => ({ ...p, photoData: dataUri, photoUrl: '' }));
    } catch (err) {
      setCardError(err.message || 'Could not process that image.');
    } finally {
      setCardPhotoBusy(false);
    }
  }

  function clearCardPhoto() {
    setCardForm((p) => ({ ...p, photoUrl: '', photoData: '' }));
    if (cardPhotoInputRef.current) cardPhotoInputRef.current.value = '';
  }

  // ── CSV Bulk Upload ──────────────────────────────────────────────────────────
  const CSV_COLUMNS = ['card_no','person_name','person_code','department','vehicle_number','vehicle_type','vehicle_brand','vehicle_color','blood_group','card_type','valid_from','valid_until','notes'];

  function downloadCsvTemplate() {
    const header = CSV_COLUMNS.join(',');
    const example = '1234567890,John Doe,EMP001,TechCorp,TS09AB1234,4W,Honda,White,O+,Normal,2025-01-01,2026-12-31,Permanent employee';
    const blob = new Blob([header + '\n' + example], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'bulk_upload_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function parseCsvText(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return { error: 'CSV must have a header row and at least one data row.' };

    // Parse a single CSV line respecting quoted fields
    function parseLine(line) {
      const fields = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      fields.push(cur.trim());
      return fields;
    }

    const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
      // Map csv column names to API field names
      const record = {
        cardNo:        obj['card_no']        || obj['cardno']       || '',
        personName:    obj['person_name']    || obj['personname']   || '',
        personCode:    obj['person_code']    || obj['personcode']   || '',
        department:    obj['department']     || obj['company']      || '',
        vehicleNumber: obj['vehicle_number'] || obj['vehiclenumber']|| '',
        vehicleType:   obj['vehicle_type']   || obj['vehicletype']  || '',
        vehicleBrand:  obj['vehicle_brand']  || obj['vehiclebrand'] || '',
        vehicleColor:  obj['vehicle_color']  || obj['vehiclecolor'] || '',
        bloodGroup:    obj['blood_group']    || obj['bloodgroup']   || '',
        cardType:      obj['card_type']      || obj['cardtype']     || 'Normal',
        validFrom:     obj['valid_from']     || obj['validfrom']    || '',
        validUntil:    obj['valid_until']    || obj['validuntil']   || '',
        notes:         obj['notes']          || '',
      };
      if (record.cardNo) records.push(record);
    }
    if (records.length === 0) return { error: 'No valid data rows found (card_no column is required).' };
    return { records };
  }

  async function handleCsvFile(file) {
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      setCsvModal(p => ({ ...p, error: 'Please upload a .csv file.' }));
      return;
    }
    const text = await file.text();
    const { records, error } = parseCsvText(text);
    if (error) { setCsvModal(p => ({ ...p, error })); return; }
    setCsvModal(p => ({ ...p, step: 'preview', preview: records, error: '' }));
  }

  async function submitBulkUpload() {
    setCsvModal(p => ({ ...p, uploading: true, error: '' }));
    try {
      const res = await bulkCreateCards(csvModal.preview);
      setCsvModal(p => ({ ...p, step: 'results', results: res, uploading: false }));
      refetchCards();
    } catch (err) {
      setCsvModal(p => ({ ...p, uploading: false, error: err.message }));
    }
  }

  async function openEditModal(vehicle) {
    const key = cardKey(vehicle.CardData);
    if (!key) return;

    try {
      const res = await fetchCards({ search: key, limit: 10 });
      const card = (res?.data ?? []).find(
        (c) => cardKey(c.card_no) === key
      );

      if (card) {
        setCardForm({
          cardNo:        card.card_no        || '',
          personName:    card.person_name    || '',
          personCode:    card.person_code    || '',
          department:    card.department     || card.company_code || '',
          vehicleNumber: card.vehicle_number || '',
          vehicleType:   card.vehicle_type   || '',
          vehicleBrand:  card.vehicle_brand  || '',
          vehicleColor:  card.vehicle_color  || '',
          cardType:      card.card_type      || 'Normal',
          cardStatus:    card.card_status    || 'Active',
          bloodGroup:    card.blood_group    || '',
          accessGroupId: card.access_group_id|| '',
          assignedUserId:card.assigned_user_id|| '',
          validFrom:     card.valid_from ? card.valid_from.slice(0, 10) : '',
          validUntil:    card.valid_until ? card.valid_until.slice(0, 10) : '',
          notes:         card.notes          || '',
          photoUrl:      card.photo_url      || '',
          photoData:     '',
        });
        setCardError('');
        setCardPhotoMode('url');
        setCardModal({ open: true, mode: 'edit', data: card });
      } else {
        // Fallback: Construct a dummy card object from vehicle details
        const fallbackCard = {
          id: vehicle.CardData,
          card_no: vehicle.CardData,
          person_name: vehicle.CarNumber,
          vehicle_number: vehicle.PName,
          department: vehicle.Addr,
          vehicle_type: vehicle.vehicleType,
          blood_group: vehicle.BloodGroup,
          card_status: vehicle.Authorization || 'Active',
        };
        setCardForm({
          cardNo:        fallbackCard.card_no || '',
          personName:    fallbackCard.person_name || '',
          personCode:    '',
          department:    fallbackCard.department || '',
          vehicleNumber: fallbackCard.vehicle_number || '',
          vehicleType:   fallbackCard.vehicle_type || '',
          vehicleBrand:  '',
          vehicleColor:  '',
          cardType:      'Normal',
          cardStatus:    fallbackCard.card_status || 'Active',
          bloodGroup:    fallbackCard.blood_group || '',
          accessGroupId: '',
          assignedUserId:'',
          validFrom:     '',
          validUntil:    '',
          notes:         '',
          photoUrl:      '',
          photoData:     '',
        });
        setCardError('');
        setCardPhotoMode('url');
        setCardModal({ open: true, mode: 'edit', data: fallbackCard });
      }
    } catch (err) {
      console.error('Failed to load card for editing:', err);
    }
  }

  function closeModal() {
    setModalOpen(false);
    setForm(createEmptyForm());
    setEditingCardId('');
  }

  async function handleSaveVehicle(event) {
    event.preventDefault();
    const nextCardId = cardKey(form.CardData);
    if (!nextCardId) {
      alert('Card ID is required.');
      return;
    }

    const payload = {
      CardData: normalize(form.CardData),
      PName: normalize(form.PName),
      CarNumber: normalize(form.CarNumber),
      Addr: normalize(form.Addr),
      vehicleType: normalize(form.vehicleType),
      BloodGroup: normalize(form.BloodGroup),
      Authorization: normalize(form.Authorization) || 'Active',
    };

    // ── ADD mode: local-only (creating new Personnel rows is out of scope) ──
    if (modalMode === 'add') {
      const exists = vehicles.some((vehicle) => cardKey(vehicle.CardData) === nextCardId);
      if (exists) {
        alert('This Card ID already exists.');
        return;
      }
      const ok = upsertParkingForCard(payload, form.ParkingSpace);
      if (!ok) return;
      setRegistryState((prev) => ({
        ...prev,
        customVehicles: [...(prev.customVehicles || []), payload],
        deletedCardIds: (prev.deletedCardIds || []).filter((id) => cardKey(id) !== nextCardId),
      }));
      closeModal();
      return;
    }

    // ── EDIT mode: try DB first, fall back to localStorage ──
    const targetKey = editingCardId || nextCardId;
    const isCustom = (registryState.customVehicles || []).some((row) => cardKey(row.CardData) === targetKey);
    const ok = upsertParkingForCard(payload, form.ParkingSpace);
    if (!ok) return;

    function applyLocalEdit() {
      if (isCustom) {
        setRegistryState((prev) => ({
          ...prev,
          customVehicles: (prev.customVehicles || []).map((row) =>
            cardKey(row.CardData) === targetKey ? { ...row, ...payload } : row
          ),
        }));
      } else {
        setRegistryState((prev) => ({
          ...prev,
          editsByCardId: {
            ...(prev.editsByCardId || {}),
            [targetKey]: {
              PName: payload.PName,
              CarNumber: payload.CarNumber,
              Addr: payload.Addr,
              vehicleType: payload.vehicleType,
              BloodGroup: payload.BloodGroup,
              Authorization: payload.Authorization,
            },
          },
        }));
      }
    }

    if (!isCustom) {
      // DB-first for Personnel records
      setSaveStatus('saving');
      closeModal();
      try {
        await updatePerson(payload.CardData, {
          PName: payload.PName,
          CarNumber: payload.CarNumber,
          Addr: payload.Addr,
          vehicleType: payload.vehicleType,
          BloodGroup: payload.BloodGroup,
        });
        applyLocalEdit();
        setSaveStatus('db-ok');
        queryClient.invalidateQueries({ queryKey: ['authorizedVehicles'] });
      } catch (err) {
        console.warn('[ConfigPage] DB update failed, saving locally:', err.message);
        applyLocalEdit();
        setSaveStatus('local-only');
      }
      setTimeout(() => setSaveStatus(null), 4000);
    } else {
      // Custom vehicles only exist locally
      applyLocalEdit();
      closeModal();
    }
  }

  async function handleSaveCompany(event) {
    event.preventDefault();
    if (!companyForm.companyName.trim()) {
      alert('Company Name is required.');
      return;
    }
    // Save to the database so it appears in the Tag Registration company dropdown.
    try {
      await createCompany({
        name:         companyForm.companyName.trim(),
        address:      companyForm.blockOrQuadrant || null,
        contactEmail: companyForm.adminEmail      || null,
        contactPhone: companyForm.phoneNumber     || null,
      });
      queryClient.invalidateQueries({ queryKey: ['companies-list'] });
    } catch (err) {
      // Duplicate or backend error — keep the local copy but inform the user.
      if (!/already exists/i.test(err.message)) {
        alert('Saved locally, but could not save to database: ' + err.message);
      }
    }
    setCompanies((prev) => [...prev, { ...companyForm, id: Date.now() }]);
    setCompanyForm(createEmptyCompanyForm());
    setCompanyModalOpen(false);
  }

  function handleDeleteCompany(id) {
    if (!window.confirm('Remove this company?')) return;
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar dark={dark} setDark={setDark} activePage={activePage} onNavigate={onNavigate} onLogout={onLogout} role={role} />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 flex flex-col gap-6">

        {/* Save status toast */}
        {saveStatus && (
          <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg transition-all
            ${saveStatus === 'saving'    ? 'bg-slate-700 text-white' : ''}
            ${saveStatus === 'db-ok'     ? 'bg-emerald-600 text-white' : ''}
            ${saveStatus === 'local-only'? 'bg-amber-500 text-white' : ''}
            ${saveStatus === 'error'     ? 'bg-rose-600 text-white' : ''}
          `}>
            {saveStatus === 'saving'     && <><span className="animate-spin">⟳</span> Saving to database…</>}
            {saveStatus === 'db-ok'      && <>✓ Saved to TimeWatch database</>}
            {saveStatus === 'local-only' && <>⚠ DB unreachable — saved locally only</>}
            {saveStatus === 'error'      && <>✕ Save failed</>}
          </div>
        )}

        <div>
          <h2 className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-white">Configuration</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Manage user registration and parking slot settings here.
          </p>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300 mb-1">Registered Vehicles</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">{configStats.total}</p>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">Total vehicles in active registry</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300 mb-1">Status</p>
            <p className="text-sm font-semibold mt-1"><span className="font-bold text-emerald-600 dark:text-emerald-300">{configStats.active}</span> active</p>
            <p className="text-sm font-semibold"><span className="font-bold text-amber-600 dark:text-amber-300">{configStats.inactive}</span> inactive</p>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">Access compliance at a glance</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300 mb-1">Parking Allotment</p>
            <p className="text-sm font-semibold mt-1"><span className="font-bold text-sky-600 dark:text-sky-300">{configStats.withParking}</span> with slots</p>
            <p className="text-sm font-semibold"><span className="font-bold text-rose-600 dark:text-rose-300">{configStats.withoutParking}</span> pending slots</p>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">Shows unallocated vehicles to resolve</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300 mb-1">Vehicle Distribution</p>
            <p className="text-sm font-semibold mt-1"><span className="font-bold text-emerald-600 dark:text-emerald-300">{configStats.twoW}</span> two-wheelers</p>
            <p className="text-sm font-semibold"><span className="font-bold text-orange-600 dark:text-orange-300">{configStats.fourW}</span> four-wheelers</p>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">{configStats.custom} custom entries added locally</p>
          </div>
        </section>

        {/* ── Registry panel ──────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">

          {/* Header row */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Vehicle Registry Configuration</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setCompanyForm(createEmptyCompanyForm()); setCompanyModalOpen(true); }} className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-600">Company Registration</button>
              <button type="button" onClick={() => setCsvModal({ open: true, step: 'upload', preview: [], results: null, uploading: false, error: '' })} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                Upload CSV
              </button>
              <button type="button" onClick={openAddModal} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600">Add User</button>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 px-4 gap-1 pt-2">
            {[
              { key: 'vehicles',    label: `Vehicles (${vehicles.length})` },
              { key: 'companies',   label: `Companies (${allCompanies.length})` },
              { key: 'controllers', label: `Controllers (${controllersData?.total ?? 0})` },
              { key: 'cards',       label: `Cards (${cardsData?.total ?? 0})` },
              { key: 'access-groups', label: `Access Groups (${accessGroupsData?.total ?? 0})` },
              { key: 'events',        label: 'Events' },
              { key: 'monitor',       label: 'Bridge Monitor' },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${activeTab === key ? 'border-b-2 border-sky-500 text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── VEHICLES TAB ── */}
          {activeTab === 'vehicles' && (
            <>
              {/* Filters */}
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, card, vehicle number…" className="w-full md:w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                  <option value="">All Companies</option>
                  {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterVehicleType} onChange={(e) => setFilterVehicleType(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                  <option value="">All Types</option>
                  <option value="2W">Two-Wheeler</option>
                  <option value="4W">Four-Wheeler</option>
                  <option value="other">Other</option>
                </select>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                  <option value="">All Statuses</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
                {(filterCompany || filterVehicleType || filterStatus || search) && (
                  <button type="button" onClick={() => { setSearch(''); setFilterCompany(''); setFilterVehicleType(''); setFilterStatus(''); }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Clear</button>
                )}
                <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 shrink-0">{filteredVehicles.length} of {vehicles.length}</span>
              </div>

              {/* Card grid */}
              {filteredVehicles.length === 0 ? (
                <p className="text-center text-slate-400 py-16">No vehicles found.</p>
              ) : (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredVehicles.map((vehicle) => {
                    const name = vehicle.CarNumber || '-';
                    const vehicleNo = vehicle.PName || '-';
                    const company = getCompanyName(vehicle.Addr);
                    const vt = normalize(vehicle.vehicleType).toUpperCase();
                    const vtColor = vt.startsWith('2') ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : vt.startsWith('4') ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
                    return (
                      <div
                        key={vehicle.CardData}
                        onClick={() => setSelectedVehicle(vehicle)}
                        className="group relative rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-sky-300 dark:hover:border-sky-600 transition-all"
                      >
                        {/* Top: photo + name + status */}
                        <div className="flex items-center gap-3">
                          <PersonPhoto cardId={vehicle.CardData} name={name} size="lg" />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white truncate">{name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{vehicle.CardData}</p>
                          </div>
                          <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${authBadgeClass(vehicle.Authorization)}`}>
                            {vehicle.Authorization || 'Active'}
                          </span>
                        </div>

                        {/* Details */}
                        <div className="space-y-1.5 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 w-20 shrink-0">Vehicle No.</span>
                            <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{vehicleNo}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 w-20 shrink-0">Company</span>
                            <span className="text-slate-600 dark:text-slate-300 truncate text-xs">{company}</span>
                          </div>
                          {vehicle.BloodGroup && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400 w-20 shrink-0">Blood Group</span>
                              <span className="text-slate-600 dark:text-slate-300 text-xs">{vehicle.BloodGroup}</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom: vehicle type + edit */}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700">
                          {vehicle.vehicleType && vehicle.vehicleType !== '-' ? (
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${vtColor}`}>{vehicle.vehicleType}</span>
                          ) : (
                            <span className="text-xs text-slate-300 dark:text-slate-600">No type</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEditModal(vehicle); }}
                            className="rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1 text-xs font-semibold hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/40 dark:hover:text-sky-300 transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── CONTROLLERS TAB ── */}
          {activeTab === 'controllers' && (
            <ControllerTab
              controllers={controllersData?.data ?? []}
              loading={controllersLoading}
              search={controllerSearch}
              onSearchChange={setControllerSearch}
              liveStatus={liveStatus}
              onAdd={() => { setCtrlForm(createEmptyControllerForm()); setCtrlError(''); setCtrlModal({ open: true, mode: 'add', data: null }); }}
              onEdit={(c) => {
                setCtrlForm({
                  sn:            c.sn,
                  ipAddress:     c.ip_address    || '',
                  tcpPort:       String(c.tcp_port || 8000),
                  udpPort:       String(c.udp_port || 8101),
                  password:      '',
                  locationLabel: c.location_label || '',
                  doorCount:     String(c.door_count || 1),
                  doorLabels:    c.door_labels    || { 1: 'Door 1' },
                  notes:         c.notes          || '',
                });
                setCtrlError('');
                setCtrlModal({ open: true, mode: 'edit', data: c });
              }}
              onDelete={(c) => setDeleteDialog({ open: true, controller: c })}
            />
          )}

          {/* ── CARDS TAB ── */}
          {activeTab === 'cards' && (
            <CardsTab
              cards={cardsData?.data ?? []}
              total={cardsData?.total ?? 0}
              page={cardPage}
              totalPages={cardsData?.totalPages ?? 1}
              loading={cardsLoading}
              search={cardSearch}
              filterStatus={cardFilterStatus}
              filterVehicleType={cardFilterVehicleType}
              selectedIds={selectedCardIds}
              bulkWorking={bulkWorking}
              onSearchChange={v => { setCardSearch(v); setCardPage(1); }}
              onFilterStatusChange={v => { setCardFilterStatus(v); setCardPage(1); }}
              onFilterVehicleTypeChange={v => { setCardFilterVehicleType(v); setCardPage(1); }}
              onPageChange={setCardPage}
              onToggleSelect={id => setSelectedCardIds(prev => {
                const n = new Set(prev);
                n.has(id) ? n.delete(id) : n.add(id);
                return n;
              })}
              onSelectAll={ids => setSelectedCardIds(new Set(ids))}
              onClearSelection={() => setSelectedCardIds(new Set())}
              onAdd={() => {
                setCardForm(createEmptyCardForm());
                setCardError('');
                setCardModal({ open: true, mode: 'add', data: null });
              }}
              onEdit={c => {
                setCardForm({
                  cardNo:        c.card_no        || '',
                  personName:    c.person_name    || '',
                  personCode:    c.person_code    || '',
                  department:    c.department     || c.company_code || '',
                  vehicleNumber: c.vehicle_number || '',
                  vehicleType:   c.vehicle_type   || '',
                  vehicleBrand:  c.vehicle_brand  || '',
                  vehicleColor:  c.vehicle_color  || '',
                  cardType:      c.card_type      || 'Normal',
                  cardStatus:    c.card_status    || 'Active',
                  bloodGroup:    c.blood_group    || '',
                  accessGroupId: c.access_group_id|| '',
                  assignedUserId:c.assigned_user_id|| '',
                  validFrom:     c.valid_from ? c.valid_from.slice(0,10) : '',
                  validUntil:    c.valid_until ? c.valid_until.slice(0,10) : '',
                  notes:         c.notes          || '',
                  photoUrl:      c.photo_url      || '',
                  photoData:     '',
                });
                setCardError('');
                setCardPhotoMode('url');
                setCardModal({ open: true, mode: 'edit', data: c });
              }}
              onDelete={c => setCardDeleteDialog({ open: true, card: c })}
              onAssign={c => setCardAssignDialog({ open: true, card: c })}
              onBulkDeactivate={async () => {
                if (!selectedCardIds.size) return;
                if (!window.confirm(`Suspend ${selectedCardIds.size} card(s)?`)) return;
                setBulkWorking(true);
                try {
                  await bulkDeactivateCards([...selectedCardIds]);
                  setSelectedCardIds(new Set());
                  refetchCards();
                } catch (err) {
                  alert(err.message);
                } finally {
                  setBulkWorking(false);
                }
              }}
              pushStatusMap={pushStatusMap}
              pushingIds={pushingIds}
              syncAllWorking={syncAllWorking}
              syncAllResult={syncAllResult}
              pushNotice={pushNotice}
              onDismissPushNotice={() => setPushNotice(null)}
              onPushCard={async (c) => {
                setPushingIds(prev => new Set([...prev, c.id]));
                setSyncAllResult(null);
                try {
                  // Check if any controller is online before queuing
                  let anyOnline = false;
                  try {
                    const health = await fetchControllerHealth();
                    anyOnline = (health?.data ?? []).some(ct => ct.is_online);
                  } catch (_) { /* health check failure is non-fatal */ }

                  await pushCardToController(c.id);

                  // Update push status in map to give immediate feedback
                  setPushStatusMap(prev => {
                    const n = new Map(prev);
                    n.set(c.id, {
                      ...(prev.get(c.id) || {}),
                      push_status: anyOnline ? 'Pending' : 'Pending',
                      push_error: null,
                      _offlineQueued: !anyOnline,
                    });
                    return n;
                  });

                  if (!anyOnline) {
                    setPushNotice({ cardId: c.id, type: 'offline', msg: 'No controller is currently online. The card has been queued and will be pushed automatically when a controller connects.' });
                  } else {
                    setPushNotice({ cardId: c.id, type: 'queued', msg: 'Push job queued. The card will be written to the controller within 15 seconds.' });
                  }
                } catch (err) {
                  setPushNotice({ cardId: c.id, type: 'error', msg: err.message || 'Push failed.' });
                  setPushingIds(prev => { const n = new Set(prev); n.delete(c.id); return n; });
                  return;
                }
                // Keep the spinner for a moment then clear
                setTimeout(() => {
                  setPushingIds(prev => { const n = new Set(prev); n.delete(c.id); return n; });
                  refetchCards();
                }, 2000);
              }}
              onSyncAll={async () => {
                setSyncAllWorking(true);
                setSyncAllResult(null);
                try {
                  const result = await pushAllCards();
                  setSyncAllResult(result);
                  refetchCards();
                } catch (err) {
                  alert(err.message);
                } finally {
                  setSyncAllWorking(false);
                }
              }}
              removingIds={removingIds}
              onRemoveCard={c => setRemoveDialog({ open: true, card: c })}
            />
          )}

          {/* ── COMPANIES TAB ── */}
          {activeTab === 'companies' && (
            <>
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                <input type="text" value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="Search companies…" className="w-full md:w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{allCompanies.length} companies</span>
              </div>
              {allCompanies.filter(c => !companySearch || c.displayName.toLowerCase().includes(companySearch.toLowerCase())).length === 0 ? (
                <p className="text-center text-slate-400 py-16">No companies found.</p>
              ) : (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {allCompanies
                    .filter(c => !companySearch || c.displayName.toLowerCase().includes(companySearch.toLowerCase()))
                    .map((c, i) => {
                      const initial = c.displayName[0]?.toUpperCase() || '?';
                      const colors = ['bg-sky-500','bg-violet-500','bg-emerald-500','bg-orange-500','bg-rose-500','bg-indigo-500','bg-teal-500','bg-amber-500'];
                      const color = colors[i % colors.length];
                      return (
                        <div
                          key={c.displayName}
                          onClick={() => setSelectedCompany(c)}
                          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-sky-300 dark:hover:border-sky-600 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center text-white font-bold text-lg shrink-0`}>{initial}</div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-white truncate">{c.displayName}</p>
                              {c.fromRegistry && c.blockOrQuadrant && <p className="text-xs text-slate-400 truncate">{c.blockOrQuadrant}</p>}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700">
                            <span><span className="font-bold text-slate-700 dark:text-slate-200">{c.vehicleCount}</span> vehicle{c.vehicleCount !== 1 ? 's' : ''}</span>
                            {c.fromRegistry ? (
                              <span className="inline-flex rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 text-xs font-semibold">Registered</span>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 px-2 py-0.5 text-xs font-semibold">Auto-detected</span>
                            )}
                          </div>
                          {c.fromRegistry && c.parkingSlots && (
                            <p className="text-xs text-slate-400">Parking slots: {c.parkingSlots}</p>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}

          {/* ── ACCESS GROUPS TAB ── */}
          {activeTab === 'access-groups' && (
            <AccessGroupsTab
              groups={accessGroupsData?.data ?? []}
              controllers={controllersData?.data ?? []}
              onAdd={() => { setAgForm({ name: '', description: '' }); setAgError(''); setAgModal({ open: true, mode: 'add', data: null }); }}
              onEdit={g => { setAgForm({ name: g.name, description: g.description || '' }); setAgError(''); setAgModal({ open: true, mode: 'edit', data: g }); }}
              onDelete={async g => {
                if (!window.confirm(`Delete access group "${g.name}"? This will un-scope all cards assigned to it.`)) return;
                try { await deleteAccessGroup(g.id); refetchAccessGroups(); } catch (err) { alert(err.message); }
              }}
              onAssignControllers={async g => {
                const detail = await fetchAccessGroupById(g.id);
                const existing = (detail.data?.controllers || []).map(c => ({ controllerId: c.controller_id, doorNum: c.door_num }));
                setAgAssignModal({ open: true, group: g, assignments: existing });
              }}
            />
          )}

          {/* ── EVENTS TAB ── */}
          {activeTab === 'events' && (
            <div className="p-4">
              <EventsTab
                controllers={controllersData?.data || []}
              />
            </div>
          )}

          {/* ── BRIDGE MONITOR TAB ── */}
          {activeTab === 'monitor' && <BridgeMonitorTab />}
        </section>
      </main>

      {/* Add / Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">{modalMode === 'add' ? 'Add User' : 'Edit User'}</h3>
            </div>
            <form onSubmit={handleSaveVehicle} className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500">Card ID</label>
                  <input type="text" value={form.CardData} onChange={(e) => setForm((p) => ({ ...p, CardData: e.target.value }))} disabled={modalMode === 'edit'} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm disabled:opacity-70" required />
                  {modalMode === 'add' && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Scan a card to auto-fill
                      </span>
                      <button
                        type="button"
                        onClick={() => latestScannedCard && setForm((p) => ({ ...p, CardData: latestScannedCard }))}
                        disabled={!latestScannedCard}
                        className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
                      >
                        Use Last Scan
                      </button>
                      <span className="text-slate-400">{latestScannedCard ? `Last: ${latestScannedCard}` : 'No scan yet'}</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Vehicle No.</label>
                  <input type="text" value={form.PName} onChange={(e) => setForm((p) => ({ ...p, PName: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Name</label>
                  <input type="text" value={form.CarNumber} onChange={(e) => setForm((p) => ({ ...p, CarNumber: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Company</label>
                  <select
                    value={form.Addr}
                    onChange={(e) => setForm((p) => ({ ...p, Addr: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">-- Select Company --</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.companyName}>{c.companyName}</option>
                    ))}
                  </select>
                  {companies.length === 0 && (
                    <p className="mt-1 text-xs text-amber-500">No companies registered yet. Use "Company Registration" to add one.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Vehicle Type</label>
                  <select
                    value={form.vehicleType}
                    onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">-- Select Type --</option>
                    <option value="2-Wheeler">2-Wheeler</option>
                    <option value="4-Wheeler">4-Wheeler</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Blood Group</label>
                  <input type="text" value={form.BloodGroup} onChange={(e) => setForm((p) => ({ ...p, BloodGroup: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Status</label>
                  <select value={form.Authorization} onChange={(e) => setForm((p) => ({ ...p, Authorization: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Company Registration Modal */}
      {companyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">Company Registration</h3>
              <button type="button" onClick={() => setCompanyModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold leading-none">&times;</button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
              {/* Registration Form */}
              <form onSubmit={handleSaveCompany} className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">New Company</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-500">Company Name</label>
                    <input
                      type="text"
                      value={companyForm.companyName}
                      onChange={(e) => setCompanyForm((p) => ({ ...p, companyName: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500">No. of Parking Slots</label>
                    <input
                      type="number"
                      min="0"
                      value={companyForm.parkingSlots}
                      onChange={(e) => setCompanyForm((p) => ({ ...p, parkingSlots: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500">Block / Quadrant</label>
                    <input
                      type="text"
                      value={companyForm.blockOrQuadrant}
                      onChange={(e) => setCompanyForm((p) => ({ ...p, blockOrQuadrant: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500">Admin Name</label>
                    <input
                      type="text"
                      value={companyForm.adminName}
                      onChange={(e) => setCompanyForm((p) => ({ ...p, adminName: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500">Admin Email ID</label>
                    <input
                      type="email"
                      value={companyForm.adminEmail}
                      onChange={(e) => setCompanyForm((p) => ({ ...p, adminEmail: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500">Phone Number</label>
                    <input
                      type="tel"
                      value={companyForm.phoneNumber}
                      onChange={(e) => setCompanyForm((p) => ({ ...p, phoneNumber: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-600">Register Company</button>
                </div>
              </form>

              {/* Registered Companies List */}
              {companies.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">Registered Companies</p>
                  <div className="space-y-2">
                    {companies.map((c) => (
                      <div key={c.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white">{c.companyName}</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {c.blockOrQuadrant && <span>Block/Quadrant: {c.blockOrQuadrant}</span>}
                            {c.parkingSlots && <span>Parking Slots: {c.parkingSlots}</span>}
                            {c.adminName && <span>Admin: {c.adminName}</span>}
                            {c.adminEmail && <span>{c.adminEmail}</span>}
                            {c.phoneNumber && <span>{c.phoneNumber}</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCompany(c.id)}
                          className="rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-2.5 py-1 text-xs font-semibold shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {companies.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No companies registered yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Vehicle Detail Drawer ───────────────────────── */}
      {selectedVehicle && (
        <div className="fixed inset-0 z-50 flex" onClick={() => setSelectedVehicle(null)}>
          <div className="flex-1 bg-slate-950/50" />
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 h-full overflow-y-auto shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">Employee Details</h3>
              <button type="button" onClick={() => setSelectedVehicle(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none font-bold">&times;</button>
            </div>

            {/* Photo + name hero */}
            <div className="flex flex-col items-center gap-3 px-5 py-8 bg-gradient-to-b from-sky-50 dark:from-sky-950/30 to-transparent">
              <PersonPhoto cardId={selectedVehicle.CardData} name={selectedVehicle.CarNumber || selectedVehicle.PName} size="xl" />
              <div className="text-center">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{selectedVehicle.CarNumber || '-'}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5">Card: {selectedVehicle.CardData}</p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${authBadgeClass(selectedVehicle.Authorization)}`}>
                {selectedVehicle.Authorization || 'Active'}
              </span>
            </div>

            {/* Detail fields */}
            <div className="px-5 pb-6 flex flex-col gap-4">
              {[
                { label: 'Vehicle Number', value: selectedVehicle.PName },
                { label: 'Company', value: getCompanyName(selectedVehicle.Addr) },
                { label: 'Vehicle Type', value: selectedVehicle.vehicleType },
                { label: 'Blood Group', value: selectedVehicle.BloodGroup },
                { label: 'Card ID', value: selectedVehicle.CardData },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{value || '-'}</span>
                </div>
              ))}

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => { setSelectedVehicle(null); openEditModal(selectedVehicle); }}
                  className="w-full rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold py-2.5 text-sm transition-colors"
                >
                  Edit This Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Company Detail Modal ────────────────────────── */}
      {selectedCompany && (() => {
        const companyName = selectedCompany.displayName;
        const companyVehicles = vehicles.filter(v => getCompanyName(v.Addr) === companyName);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setSelectedCompany(null)}>
            <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {/* Modal header */}
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {companyName[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-lg leading-tight">{companyName}</h3>
                    <p className="text-xs text-slate-400">{companyVehicles.length} registered vehicle{companyVehicles.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedCompany(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none font-bold">&times;</button>
              </div>

              {/* Company meta */}
              {selectedCompany.fromRegistry && (
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {selectedCompany.blockOrQuadrant && <div><p className="text-xs text-slate-400">Block / Quadrant</p><p className="font-medium text-slate-700 dark:text-slate-200">{selectedCompany.blockOrQuadrant}</p></div>}
                  {selectedCompany.parkingSlots && <div><p className="text-xs text-slate-400">Parking Slots</p><p className="font-medium text-slate-700 dark:text-slate-200">{selectedCompany.parkingSlots}</p></div>}
                  {selectedCompany.adminName && <div><p className="text-xs text-slate-400">Admin</p><p className="font-medium text-slate-700 dark:text-slate-200">{selectedCompany.adminName}</p></div>}
                  {selectedCompany.adminEmail && <div><p className="text-xs text-slate-400">Email</p><p className="font-medium text-slate-700 dark:text-slate-200 text-xs break-all">{selectedCompany.adminEmail}</p></div>}
                  {selectedCompany.phoneNumber && <div><p className="text-xs text-slate-400">Phone</p><p className="font-medium text-slate-700 dark:text-slate-200">{selectedCompany.phoneNumber}</p></div>}
                </div>
              )}

              {/* Employees list */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Registered Employees</p>
                {companyVehicles.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-8">No vehicles linked to this company yet.</p>
                ) : (
                  <div className="space-y-2">
                    {companyVehicles.map((v) => (
                      <div
                        key={v.CardData}
                        className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 cursor-pointer hover:border-sky-300 dark:hover:border-sky-600 transition-colors"
                        onClick={() => { setSelectedCompany(null); setSelectedVehicle(v); }}
                      >
                        <PersonPhoto cardId={v.CardData} name={v.CarNumber || v.PName} size="md" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{v.CarNumber || '-'}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{v.PName || '-'} · Card {v.CardData}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {v.vehicleType && v.vehicleType !== '-' && (
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${normalize(v.vehicleType).toUpperCase().startsWith('2') ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'}`}>{v.vehicleType}</span>
                          )}
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${authBadgeClass(v.Authorization)}`}>{v.Authorization || 'Active'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Card Add / Edit Modal ───────────────────────────── */}
      {cardModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                {cardModal.mode === 'add' ? 'Add User' : 'Edit User'}
              </h3>
              <button onClick={() => setCardModal({ open: false, mode: 'add', data: null })} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4">
              {cardError && (
                <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{cardError}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Card ID *</label>
                  <input type="text" value={cardForm.cardNo}
                    onChange={e => setCardForm(p => ({ ...p, cardNo: e.target.value }))}
                    disabled={cardModal.mode === 'edit'}
                    placeholder="Scan a tag or type the Card ID"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm disabled:opacity-50 font-mono"
                  />
                  {cardModal.mode === 'add' && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Scan a card to auto-fill
                      </span>
                      <button type="button"
                        onClick={() => latestScannedCard && setCardForm(p => ({ ...p, cardNo: latestScannedCard }))}
                        disabled={!latestScannedCard}
                        className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50">
                        Use Last Scan
                      </button>
                      <span className="text-slate-400">{latestScannedCard ? `Last: ${latestScannedCard}` : 'No scan yet'}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Person Name</label>
                  <input type="text" value={cardForm.personName}
                    onChange={e => setCardForm(p => ({ ...p, personName: e.target.value }))}
                    placeholder="Full name"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Person Code</label>
                  <input type="text" value={cardForm.personCode}
                    onChange={e => setCardForm(p => ({ ...p, personCode: e.target.value }))}
                    placeholder="Employee / resident code"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Vehicle Number</label>
                  <input type="text" value={cardForm.vehicleNumber}
                    onChange={e => setCardForm(p => ({ ...p, vehicleNumber: e.target.value.toUpperCase() }))}
                    placeholder="e.g. MH12AB1234"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Vehicle Type</label>
                  <select value={cardForm.vehicleType} onChange={e => setCardForm(p => ({ ...p, vehicleType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="">— Select —</option>
                    <option value="2W">2-Wheeler</option>
                    <option value="4W">4-Wheeler</option>
                    <option value="LMV">LMV</option>
                    <option value="HMV">HMV</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Vehicle Brand</label>
                  <input type="text" value={cardForm.vehicleBrand}
                    onChange={e => setCardForm(p => ({ ...p, vehicleBrand: e.target.value }))}
                    placeholder="e.g. Honda, Maruti, Tata"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Vehicle Color</label>
                  <input type="text" value={cardForm.vehicleColor}
                    onChange={e => setCardForm(p => ({ ...p, vehicleColor: e.target.value }))}
                    placeholder="e.g. White, Black, Silver"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Card Type</label>
                  <select value={cardForm.cardType} onChange={e => setCardForm(p => ({ ...p, cardType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="Normal">Normal</option>
                    <option value="FirstCard">FirstCard</option>
                    <option value="AlwaysOpen">AlwaysOpen</option>
                    <option value="Patrol">Patrol</option>
                    <option value="AntiTheft">AntiTheft</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Status</label>
                  <select value={cardForm.cardStatus} onChange={e => setCardForm(p => ({ ...p, cardStatus: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Expired">Expired</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Company</label>
                  <select value={cardForm.department}
                    onChange={e => setCardForm(p => ({ ...p, department: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="">— Select Company —</option>
                    {companiesList.map(co => (
                      <option key={co.id} value={co.name}>{co.name}</option>
                    ))}
                  </select>
                  {companiesList.length === 0 && (
                    <p className="mt-1 text-xs text-amber-500">No companies yet — add via Company Registration.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Blood Group</label>
                  <select value={cardForm.bloodGroup}
                    onChange={e => setCardForm(p => ({ ...p, bloodGroup: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="">— Select —</option>
                    {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Assigned User</label>
                  <select value={cardForm.assignedUserId} onChange={e => setCardForm(p => ({ ...p, assignedUserId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    <option value="">— Unassigned —</option>
                    {(usersData?.data ?? []).map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Valid From</label>
                  <input type="date" value={cardForm.validFrom}
                    onChange={e => setCardForm(p => ({ ...p, validFrom: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Valid Until</label>
                  <input type="date" value={cardForm.validUntil}
                    onChange={e => setCardForm(p => ({ ...p, validUntil: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Notes</label>
                  <textarea rows={2} value={cardForm.notes}
                    onChange={e => setCardForm(p => ({ ...p, notes: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                {/* ── Photograph ─────────────────────────────────── */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Photograph</label>
                  {(() => {
                    const basePhotoUrl = cardModal.mode === 'edit' && cardModal.data?.card_no ? getPersonPhotoUrl(cardModal.data.card_no) : '';
                    const versionedPhotoUrl = basePhotoUrl ? `${basePhotoUrl}${basePhotoUrl.includes('?') ? '&' : '?'}v=${cardModal.data?.updated_at || ''}` : '';
                    const previewSrc = cardForm.photoData
                      || (cardForm.photoUrl.trim() ? cardForm.photoUrl.trim() : '')
                      || versionedPhotoUrl;
                    return (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col sm:flex-row gap-4">
                        {/* preview */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-2">
                          <div className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                            {previewSrc ? (
                              <img src={previewSrc} alt="Cardholder" className="w-full h-full object-cover"
                                onError={(e) => { e.currentTarget.style.display = 'none'; if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'flex'; }} />
                            ) : null}
                            <div className="w-full h-full flex-col items-center justify-center text-slate-300 dark:text-slate-600" style={{ display: previewSrc ? 'none' : 'flex' }}>
                              <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                            </div>
                          </div>
                          {(cardForm.photoData || cardForm.photoUrl) && (
                            <button type="button" onClick={clearCardPhoto} className="text-xs text-red-500 hover:text-red-600 font-semibold">Remove</button>
                          )}
                        </div>
                        {/* controls */}
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="inline-flex w-fit items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                            {[
                              { key: 'url', label: 'Image Link' },
                              { key: 'upload', label: 'Upload from Device' },
                            ].map((t) => (
                              <button key={t.key} type="button" onClick={() => setCardPhotoMode(t.key)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${cardPhotoMode === t.key
                                  ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                          {cardPhotoMode === 'url' ? (
                            <>
                              <input type="url" value={cardForm.photoUrl}
                                onChange={e => setCardForm(p => ({ ...p, photoUrl: e.target.value, photoData: '' }))}
                                placeholder="https://example.com/photo.jpg"
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                              <p className="text-xs text-slate-400">Paste a direct image link — it will be fetched and shown wherever this person appears.</p>
                            </>
                          ) : (
                            <>
                              <input ref={cardPhotoInputRef} type="file" accept="image/*" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleCardPhotoFile(f); }} />
                              <button type="button" onClick={() => cardPhotoInputRef.current?.click()} disabled={cardPhotoBusy}
                                className="w-fit inline-flex items-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                                {cardPhotoBusy ? 'Processing…' : 'Choose Image'}
                              </button>
                              <p className="text-xs text-slate-400">JPG, PNG, etc. The image is automatically resized before saving.</p>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button type="button" onClick={() => setCardModal({ open: false, mode: 'add', data: null })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" disabled={cardSaving}
                onClick={async () => {
                  setCardError('');
                  setCardSaving(true);
                  try {
                    const payload = {
                      cardNo:        cardForm.cardNo.trim(),
                      personName:    cardForm.personName.trim()    || null,
                      personCode:    cardForm.personCode.trim()    || null,
                      department:    cardForm.department           || null,
                      vehicleNumber: cardForm.vehicleNumber.trim() || null,
                      vehicleType:   cardForm.vehicleType          || null,
                      vehicleBrand:  cardForm.vehicleBrand.trim()  || null,
                      vehicleColor:  cardForm.vehicleColor.trim()  || null,
                      cardType:      cardForm.cardType,
                      cardStatus:    cardForm.cardStatus,
                      bloodGroup:    cardForm.bloodGroup           || null,
                      accessGroupId: cardForm.accessGroupId        || null,
                      assignedUserId:cardForm.assignedUserId       || null,
                      validFrom:     cardForm.validFrom            || null,
                      validUntil:    cardForm.validUntil           || null,
                      notes:         cardForm.notes.trim()         || null,
                      photoUrl:      cardForm.photoUrl.trim()      || null,
                      ...(cardForm.photoData ? { photoData: cardForm.photoData } : {}),
                    };
                    if (cardModal.mode === 'add') {
                      await createCard(payload);
                    } else {
                      const { cardNo, ...rest } = payload;
                      await updateCard(cardModal.data.id, rest);
                    }
                    setCardModal({ open: false, mode: 'add', data: null });
                    refetchCards();
                    queryClient.invalidateQueries({ queryKey: ['authorizedVehicles'] });
                  } catch (err) {
                    setCardError(err.message);
                  } finally {
                    setCardSaving(false);
                  }
                }}
                className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white">
                {cardSaving ? 'Saving…' : cardModal.mode === 'add' ? 'Add Card' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card Delete Confirmation ─────────────────────────── */}
      {cardDeleteDialog.open && cardDeleteDialog.card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-bold text-slate-900 dark:text-white">Delete Card</h3>
            </div>
            <div className="px-5 py-4 space-y-1">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Delete card <span className="font-mono font-semibold">{cardDeleteDialog.card.card_no}</span>
                {cardDeleteDialog.card.person_name ? ` (${cardDeleteDialog.card.person_name})` : ''}?
              </p>
              <p className="text-xs text-slate-400">Soft delete — the card will be marked as Deleted and hidden from Bridge lookups.</p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={() => setCardDeleteDialog({ open: false, card: null })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={async () => {
                  try {
                    await deleteCard(cardDeleteDialog.card.id);
                    setCardDeleteDialog({ open: false, card: null });
                    setSelectedCardIds(prev => { const n = new Set(prev); n.delete(cardDeleteDialog.card.id); return n; });
                    refetchCards();
                  } catch (err) { alert(err.message); }
                }}
                className="rounded-lg bg-red-500 hover:bg-red-600 px-4 py-2 text-sm font-semibold text-white">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Card from Controllers Dialog ─────────────────── */}
      {removeDialog.open && removeDialog.card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-rose-600 dark:text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">Remove Card from Controllers</h3>
                <p className="text-xs text-slate-400 mt-0.5">This will run DelCardMain() on all active controllers</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3">
                <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">Warning: This action cannot be undone</p>
                <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
                  Card <span className="font-mono font-bold">{removeDialog.card.card_no}</span>
                  {removeDialog.card.person_name ? ` (${removeDialog.card.person_name})` : ''} will be physically
                  deleted from all controller memory. The person will no longer be able to access any door
                  until the card is pushed again.
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">What happens next:</p>
                <p>1. A removal job is queued in the database</p>
                <p>2. The Bridge Service polls and runs DelCardMain() on each controller</p>
                <p>3. Card push status updates to "Removed" when complete</p>
                <p>4. You can re-push the card at any time to restore access</p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button
                onClick={() => setRemoveDialog({ open: false, card: null })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button
                onClick={async () => {
                  const card = removeDialog.card;
                  setRemoveDialog({ open: false, card: null });
                  setRemovingIds(prev => new Set([...prev, card.id]));
                  try {
                    await removeCardFromControllers(card.id);
                  } catch (err) {
                    alert(err.message);
                    setRemovingIds(prev => { const n = new Set(prev); n.delete(card.id); return n; });
                  }
                }}
                className="rounded-lg bg-rose-500 hover:bg-rose-600 px-4 py-2 text-sm font-semibold text-white">
                Remove from Controllers
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card Assign User Dialog ──────────────────────────── */}
      {cardAssignDialog.open && cardAssignDialog.card && (() => {
        let selectedUid = cardAssignDialog.card.assigned_user_id || '';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-slate-900 dark:text-white">Assign User</h3>
                <p className="text-xs text-slate-400 mt-0.5">Card: <span className="font-mono">{cardAssignDialog.card.card_no}</span></p>
              </div>
              <div className="px-5 py-4">
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Select User</label>
                <select defaultValue={selectedUid}
                  onChange={e => { selectedUid = e.target.value; }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                  <option value="">— Unassign —</option>
                  {(usersData?.data ?? []).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                <button onClick={() => setCardAssignDialog({ open: false, card: null })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button onClick={async () => {
                    try {
                      if (selectedUid) {
                        await assignCardUser(cardAssignDialog.card.id, selectedUid);
                      } else {
                        await unassignCardUser(cardAssignDialog.card.id);
                      }
                      setCardAssignDialog({ open: false, card: null });
                      refetchCards();
                    } catch (err) { alert(err.message); }
                  }}
                  className="rounded-lg bg-sky-500 hover:bg-sky-600 px-4 py-2 text-sm font-semibold text-white">
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Access Group Add / Edit Modal ───────────────────── */}
      {agModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                {agModal.mode === 'add' ? 'Create Access Group' : 'Edit Access Group'}
              </h3>
              <button onClick={() => setAgModal({ open: false, mode: 'add', data: null })} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {agError && <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{agError}</div>}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Group Name *</label>
                <input type="text" value={agForm.name}
                  onChange={e => setAgForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Main Gate Access, Business Hours"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Description</label>
                <textarea rows={3} value={agForm.description}
                  onChange={e => setAgForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Describe who belongs in this access group and what doors they can access"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                After creating, use "Assign Controllers" to define which controllers/doors this group can access.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={() => setAgModal({ open: false, mode: 'add', data: null })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button disabled={agSaving} onClick={async () => {
                  setAgError('');
                  if (!agForm.name.trim()) { setAgError('Group name is required'); return; }
                  setAgSaving(true);
                  try {
                    if (agModal.mode === 'add') {
                      await createAccessGroup({ name: agForm.name.trim(), description: agForm.description.trim() || null });
                    } else {
                      await updateAccessGroup(agModal.data.id, { name: agForm.name.trim(), description: agForm.description.trim() || null });
                    }
                    setAgModal({ open: false, mode: 'add', data: null });
                    refetchAccessGroups();
                  } catch (err) {
                    setAgError(err.message);
                  } finally {
                    setAgSaving(false);
                  }
                }}
                className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white">
                {agSaving ? 'Saving…' : agModal.mode === 'add' ? 'Create Group' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Access Group Controller Assignment Modal ─────────── */}
      {agAssignModal.open && agAssignModal.group && (() => {
        const allCtrl = controllersData?.data ?? [];
        const assignments = agAssignModal.assignments;

        const toggle = (controllerId, doorNum) => {
          const exists = assignments.find(a => a.controllerId === controllerId && a.doorNum === doorNum);
          setAgAssignModal(prev => ({
            ...prev,
            assignments: exists
              ? prev.assignments.filter(a => !(a.controllerId === controllerId && a.doorNum === doorNum))
              : [...prev.assignments, { controllerId, doorNum }],
          }));
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[85vh]">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg">Assign Controllers</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Group: <span className="font-semibold text-slate-600 dark:text-slate-300">{agAssignModal.group.name}</span></p>
                </div>
                <button onClick={() => setAgAssignModal({ open: false, group: null, assignments: [] })} className="text-slate-400 hover:text-slate-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>

              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-sky-50 dark:bg-sky-900/10">
                <p className="text-xs text-sky-700 dark:text-sky-300">
                  Select which controller doors members of this group can access.
                  Cards with this group will only be pushed to selected controllers.
                  If none selected, all controllers will be used.
                </p>
              </div>

              <div className="overflow-y-auto flex-1 px-5 py-4">
                {allCtrl.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No controllers configured yet.</p>
                ) : (
                  <div className="space-y-3">
                    {allCtrl.map(ctrl => {
                      const doorCount = ctrl.door_count || 1;
                      const doorLabels = ctrl.door_labels || {};
                      return (
                        <div key={ctrl.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`w-2 h-2 rounded-full ${ctrl.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{ctrl.location_label || ctrl.sn}</p>
                            <span className="ml-1 text-xs text-slate-400 font-mono">({ctrl.sn})</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {Array.from({ length: doorCount }, (_, i) => i + 1).map(doorNum => {
                              const label = doorLabels[doorNum] || `Door ${doorNum}`;
                              const checked = !!assignments.find(a => a.controllerId === ctrl.id && a.doorNum === doorNum);
                              return (
                                <button
                                  key={doorNum}
                                  type="button"
                                  onClick={() => toggle(ctrl.id, doorNum)}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${
                                    checked
                                      ? 'bg-sky-500 border-sky-500 text-white'
                                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-400 hover:text-sky-600'
                                  }`}
                                >
                                  {checked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  {assignments.length} door{assignments.length !== 1 ? 's' : ''} selected across {new Set(assignments.map(a => a.controllerId)).size} controller{new Set(assignments.map(a => a.controllerId)).size !== 1 ? 's' : ''}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setAgAssignModal({ open: false, group: null, assignments: [] })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                    Cancel
                  </button>
                  <button disabled={agAssignSaving} onClick={async () => {
                      setAgAssignSaving(true);
                      try {
                        await setAccessGroupControllers(agAssignModal.group.id, agAssignModal.assignments);
                        setAgAssignModal({ open: false, group: null, assignments: [] });
                        refetchAccessGroups();
                      } catch (err) {
                        alert(err.message);
                      } finally {
                        setAgAssignSaving(false);
                      }
                    }}
                    className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white">
                    {agAssignSaving ? 'Saving…' : 'Save Assignments'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Controller Add / Edit Modal ─────────────────────── */}
      {ctrlModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                {ctrlModal.mode === 'add' ? 'Add Controller' : 'Edit Controller'}
              </h3>
              <button onClick={() => setCtrlModal({ open: false, mode: 'add', data: null })} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {ctrlError && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{ctrlError}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Serial Number *</label>
                  <input
                    type="text"
                    value={ctrlForm.sn}
                    onChange={e => setCtrlForm(p => ({ ...p, sn: e.target.value }))}
                    disabled={ctrlModal.mode === 'edit'}
                    placeholder="e.g. 14070001"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">IP Address</label>
                  <input
                    type="text"
                    value={ctrlForm.ipAddress}
                    onChange={e => setCtrlForm(p => ({ ...p, ipAddress: e.target.value }))}
                    placeholder="192.168.1.100"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Location Label</label>
                  <input
                    type="text"
                    value={ctrlForm.locationLabel}
                    onChange={e => setCtrlForm(p => ({ ...p, locationLabel: e.target.value }))}
                    placeholder="e.g. Gate 1 Entry"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">TCP Port</label>
                  <input
                    type="number"
                    value={ctrlForm.tcpPort}
                    onChange={e => setCtrlForm(p => ({ ...p, tcpPort: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">UDP Port</label>
                  <input
                    type="number"
                    value={ctrlForm.udpPort}
                    onChange={e => setCtrlForm(p => ({ ...p, udpPort: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Door Count</label>
                  <select
                    value={ctrlForm.doorCount}
                    onChange={e => {
                      const n = parseInt(e.target.value);
                      const labels = {};
                      for (let i = 1; i <= n; i++) labels[i] = ctrlForm.doorLabels[i] || `Door ${i}`;
                      setCtrlForm(p => ({ ...p, doorCount: e.target.value, doorLabels: labels }));
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  >
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    {ctrlModal.mode === 'edit' ? 'New Password (leave blank to keep)' : 'Password'}
                  </label>
                  <input
                    type="password"
                    value={ctrlForm.password}
                    onChange={e => setCtrlForm(p => ({ ...p, password: e.target.value }))}
                    placeholder={ctrlModal.mode === 'edit' ? '••••••••' : 'Controller password'}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>

                {/* Door Labels */}
                {parseInt(ctrlForm.doorCount) > 0 && (
                  <div className="col-span-2">
                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Door Labels</label>
                    <div className="space-y-1">
                      {Array.from({ length: parseInt(ctrlForm.doorCount) }, (_, i) => i + 1).map(n => (
                        <div key={n} className="flex items-center gap-2">
                          <span className="text-xs text-slate-400 w-14 shrink-0">Door {n}</span>
                          <input
                            type="text"
                            value={ctrlForm.doorLabels[n] || ''}
                            onChange={e => setCtrlForm(p => ({ ...p, doorLabels: { ...p.doorLabels, [n]: e.target.value } }))}
                            placeholder={`Door ${n} label`}
                            className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={ctrlForm.notes}
                    onChange={e => setCtrlForm(p => ({ ...p, notes: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCtrlModal({ open: false, mode: 'add', data: null })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={ctrlSaving}
                onClick={async () => {
                  setCtrlError('');
                  setCtrlSaving(true);
                  try {
                    const payload = {
                      sn:            ctrlForm.sn.trim(),
                      ipAddress:     ctrlForm.ipAddress.trim(),
                      tcpPort:       parseInt(ctrlForm.tcpPort)  || 8000,
                      udpPort:       parseInt(ctrlForm.udpPort)  || 8101,
                      password:      ctrlForm.password || undefined,
                      locationLabel: ctrlForm.locationLabel.trim() || null,
                      doorCount:     parseInt(ctrlForm.doorCount) || 1,
                      doorLabels:    ctrlForm.doorLabels,
                      notes:         ctrlForm.notes.trim() || null,
                    };
                    if (ctrlModal.mode === 'add') {
                      await createController(payload);
                    } else {
                      const { sn, ...rest } = payload;
                      await updateController(ctrlModal.data.id, rest);
                    }
                    setCtrlModal({ open: false, mode: 'add', data: null });
                    refetchControllers();
                  } catch (err) {
                    setCtrlError(err.message);
                  } finally {
                    setCtrlSaving(false);
                  }
                }}
                className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white"
              >
                {ctrlSaving ? 'Saving…' : ctrlModal.mode === 'add' ? 'Add Controller' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Controller Delete Confirmation ──────────────────── */}
      {/* ── CSV Bulk Upload Modal ───────────────────────────── */}
      {csvModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[90vh]">

            {/* header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-lg">Bulk Upload Users via CSV</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {csvModal.step === 'upload'  && 'Upload a CSV file to add multiple users at once.'}
                  {csvModal.step === 'preview' && `${csvModal.preview.length} records found — review before importing.`}
                  {csvModal.step === 'results' && 'Import complete.'}
                </p>
              </div>
              <button onClick={() => setCsvModal(p => ({ ...p, open: false }))} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            {/* body */}
            <div className="flex-1 overflow-auto px-5 py-4 space-y-4">

              {/* ── Step 1: Upload ── */}
              {csvModal.step === 'upload' && (
                <>
                  {/* template download */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Step 1 — Download the template</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Fill in the template CSV and save it. Only <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">card_no</code> is required. All other columns are optional.</p>
                    <button type="button" onClick={downloadCsvTemplate}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      Download Template CSV
                    </button>

                    {/* column reference table */}
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {['Column','Example','Required?'].map(h => (
                              <th key={h} className="px-3 py-1.5 text-left font-semibold whitespace-nowrap border border-slate-300 dark:border-slate-600">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {[
                            ['card_no',       '1234567890',   'Yes'],
                            ['person_name',   'John Doe',     'No'],
                            ['person_code',   'EMP001',       'No'],
                            ['department',    'TechCorp',     'No'],
                            ['vehicle_number','TS09AB1234',   'No'],
                            ['vehicle_type',  '2W / 4W / LMV / HMV / Other', 'No'],
                            ['vehicle_brand', 'Honda',        'No'],
                            ['vehicle_color', 'White',        'No'],
                            ['blood_group',   'O+ / A- / B+ etc.', 'No'],
                            ['card_type',     'Normal (default)', 'No'],
                            ['valid_from',    '2025-01-01',   'No'],
                            ['valid_until',   '2026-12-31',   'No'],
                            ['notes',         'Permanent employee', 'No'],
                          ].map(([col, ex, req]) => (
                            <tr key={col} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-3 py-1.5 font-mono text-sky-700 dark:text-sky-300 border border-slate-200 dark:border-slate-700">{col}</td>
                              <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">{ex}</td>
                              <td className="px-3 py-1.5 border border-slate-200 dark:border-slate-700">
                                {req === 'Yes'
                                  ? <span className="text-rose-600 dark:text-rose-400 font-semibold">Yes</span>
                                  : <span className="text-slate-400">No</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* file drop zone */}
                  <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Step 2 — Upload your filled CSV</p>
                    <p className="text-xs text-slate-400 mb-3">Max 500 rows per upload</p>
                    <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 text-sm font-semibold">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                      Choose CSV File
                      <input type="file" accept=".csv" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ''; }} />
                    </label>
                  </div>

                  {csvModal.error && (
                    <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{csvModal.error}</div>
                  )}
                </>
              )}

              {/* ── Step 2: Preview ── */}
              {csvModal.step === 'preview' && (
                <>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                    Review the records below. Click <strong>Import Now</strong> to create them in the database.
                    Duplicate card IDs will be skipped automatically.
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        <tr>
                          {['#','Card ID','Name','Employee ID','Company','Vehicle No.','Type','Brand','Color','Card Type'].map(h => (
                            <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {csvModal.preview.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                            <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">{r.cardNo || <span className="text-red-500">MISSING</span>}</td>
                            <td className="px-3 py-2">{r.personName || '-'}</td>
                            <td className="px-3 py-2">{r.personCode || '-'}</td>
                            <td className="px-3 py-2">{r.department || '-'}</td>
                            <td className="px-3 py-2 font-mono">{r.vehicleNumber || '-'}</td>
                            <td className="px-3 py-2">{r.vehicleType || '-'}</td>
                            <td className="px-3 py-2">{r.vehicleBrand || '-'}</td>
                            <td className="px-3 py-2">{r.vehicleColor || '-'}</td>
                            <td className="px-3 py-2">{r.cardType || 'Normal'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvModal.error && (
                    <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{csvModal.error}</div>
                  )}
                </>
              )}

              {/* ── Step 3: Results ── */}
              {csvModal.step === 'results' && csvModal.results && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Created', value: csvModal.results.summary.created, cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' },
                      { label: 'Skipped (duplicate)', value: csvModal.results.summary.skipped, cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300' },
                      { label: 'Failed', value: csvModal.results.summary.failed, cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className={`rounded-xl border px-4 py-3 text-center ${cls}`}>
                        <p className="text-2xl font-bold">{value}</p>
                        <p className="text-xs font-semibold mt-1">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* per-row result list for errors/skips */}
                  {csvModal.results.results.filter(r => r.status !== 'created').length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase tracking-wide">
                          <tr>
                            {['Row', 'Card ID', 'Status', 'Reason'].map(h => (
                              <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {csvModal.results.results.filter(r => r.status !== 'created').map((r, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 text-slate-400">{r.row}</td>
                              <td className="px-3 py-2 font-mono">{r.cardNo || '-'}</td>
                              <td className="px-3 py-2">
                                <span className={`font-semibold ${r.status === 'skipped' ? 'text-amber-600' : 'text-red-600'}`}>{r.status}</span>
                              </td>
                              <td className="px-3 py-2 text-slate-500">{r.error || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
              <div>
                {csvModal.step === 'preview' && (
                  <button type="button" onClick={() => setCsvModal(p => ({ ...p, step: 'upload', preview: [], error: '' }))}
                    className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline underline-offset-2">
                    ← Back
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setCsvModal(p => ({ ...p, open: false }))}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                  {csvModal.step === 'results' ? 'Close' : 'Cancel'}
                </button>
                {csvModal.step === 'preview' && (
                  <button type="button" disabled={csvModal.uploading} onClick={submitBulkUpload}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white">
                    {csvModal.uploading ? 'Importing…' : `Import ${csvModal.preview.length} Records`}
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {deleteDialog.open && deleteDialog.controller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-bold text-slate-900 dark:text-white">Delete Controller</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Delete <span className="font-semibold">{deleteDialog.controller.location_label || deleteDialog.controller.sn}</span>?
              </p>
              <p className="text-xs text-slate-400 mt-1">This action is a soft delete. The controller will no longer be shown to the Bridge at startup.</p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button
                onClick={() => setDeleteDialog({ open: false, controller: null })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteController(deleteDialog.controller.id);
                    setDeleteDialog({ open: false, controller: null });
                    refetchControllers();
                  } catch (err) {
                    alert(err.message);
                  }
                }}
                className="rounded-lg bg-red-500 hover:bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   AccessGroupsTab — self-contained sub-component
   ───────────────────────────────────────────────────────────── */
function AccessGroupsTab({ groups, controllers, onAdd, onEdit, onDelete, onAssignControllers }) {
  const [search, setSearch] = useState('');
  const filtered = groups.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase()) || (g.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const groupColors = ['bg-sky-500','bg-violet-500','bg-emerald-500','bg-orange-500','bg-rose-500','bg-indigo-500','bg-teal-500','bg-amber-500'];

  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">{groups.length} group{groups.length !== 1 ? 's' : ''}</span>
        <button onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          New Group
        </button>
      </div>

      {/* Info banner */}
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2">
        <svg className="w-4 h-4 shrink-0 mt-0.5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span>Access groups define which controllers a card can be pushed to. Assign a group to a card in the Cards tab, then assign controllers to the group here. Cards without a group push to all controllers.</span>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          <p className="text-sm">{search ? 'No groups match your search.' : 'No access groups yet.'}</p>
          {!search && <button onClick={onAdd} className="text-xs text-sky-500 hover:underline">Create your first access group →</button>}
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((g, i) => {
            const color = groupColors[i % groupColors.length];
            const initial = g.name[0]?.toUpperCase() || '?';
            return (
              <div key={g.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center text-white font-bold text-lg shrink-0`}>{initial}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{g.name}</p>
                    {g.description && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{g.description}</p>}
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold shrink-0 ${g.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {g.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-slate-800 dark:text-white">{g.controller_count ?? 0}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Controller{g.controller_count !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-slate-800 dark:text-white">{g.card_count ?? 0}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Card{g.card_count !== 1 ? 's' : ''}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 pt-1 border-t border-slate-100 dark:border-slate-700">
                  <button onClick={() => onAssignControllers(g)}
                    className="flex-1 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 px-2 py-1.5 text-xs font-semibold hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors flex items-center justify-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
                    Assign Controllers
                  </button>
                  <button onClick={() => onEdit(g)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    Edit
                  </button>
                  <button onClick={() => onDelete(g)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   ControllerTab — self-contained sub-component
   ───────────────────────────────────────────────────────────── */
function ControllerHealthBadge({ sn, staticStatus, liveStatus }) {
  const live = liveStatus.get(sn);
  const isOnline  = live ? live.is_online  : staticStatus?.is_online;
  const heartbeat = live ? live.last_heartbeat_at : staticStatus?.last_heartbeat_at;

  let label = 'Unknown';
  let cls   = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';

  if (isOnline === true) {
    label = 'Online';
    cls   = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  } else if (isOnline === false) {
    label = 'Offline';
    cls   = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  }

  const ago = heartbeat
    ? (() => {
        const ms = Date.now() - new Date(heartbeat).getTime();
        if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
        if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
        return `${Math.floor(ms / 3600000)}h ago`;
      })()
    : null;

  return (
    <span className="flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : isOnline === false ? 'bg-red-500' : 'bg-slate-400'}`} />
        {label}
      </span>
      {ago && <span className="text-[10px] text-slate-400 dark:text-slate-500 pl-1">{ago}</span>}
    </span>
  );
}

function ControllerTab({ controllers, loading, search, onSearchChange, liveStatus, onAdd, onEdit, onDelete }) {
  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search serial, IP, location…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">{controllers.length} controller{controllers.length !== 1 ? 's' : ''}</span>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Controller
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading controllers…</div>
      ) : controllers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          <p className="text-sm">{search ? 'No controllers match your search.' : 'No controllers added yet.'}</p>
          {!search && <button onClick={onAdd} className="text-xs text-sky-500 hover:underline">Add your first controller →</button>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 z-10">
              <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 text-left whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Serial Number</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Location</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden md:table-cell">IP Address</th>
                <th className="px-3 py-3 text-center whitespace-nowrap hidden lg:table-cell">TCP</th>
                <th className="px-3 py-3 text-center whitespace-nowrap hidden lg:table-cell">UDP</th>
                <th className="px-3 py-3 text-center whitespace-nowrap hidden lg:table-cell">Doors</th>
                <th className="px-3 py-3 text-left whitespace-nowrap hidden xl:table-cell">Last Heartbeat</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {controllers.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <ControllerHealthBadge
                      sn={c.sn}
                      staticStatus={{ is_online: c.is_online, last_heartbeat_at: c.last_heartbeat_at }}
                      liveStatus={liveStatus}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{c.sn}</span>
                    {!c.is_active && (
                      <span className="ml-2 inline-flex rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{c.location_label || <span className="text-slate-400">—</span>}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{c.ip_address || '—'}</span>
                  </td>
                  <td className="px-3 py-3 text-center hidden lg:table-cell">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{c.tcp_port}</span>
                  </td>
                  <td className="px-3 py-3 text-center hidden lg:table-cell">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{c.udp_port}</span>
                  </td>
                  <td className="px-3 py-3 text-center hidden lg:table-cell">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">{c.door_count || 1}</span>
                  </td>
                  <td className="px-3 py-3 hidden xl:table-cell">
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {c.last_heartbeat_at
                        ? new Date(c.last_heartbeat_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
                        : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit(c)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(c)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
        <span>Status auto-updates via WebSocket. Full refresh every 30 s.</span>
        <span className="font-mono">{controllers.length} controller{controllers.length !== 1 ? 's' : ''}</span>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   CardsTab — self-contained sub-component
   ───────────────────────────────────────────────────────────── */
function CardStatusBadge({ status }) {
  const map = {
    Active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    Suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    Expired:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    Deleted:   'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] || map.Expired}`}>
      {status || 'Unknown'}
    </span>
  );
}

function VehicleTypeBadge({ type }) {
  if (!type) return <span className="text-slate-400 text-xs">—</span>;
  const is2w = type === '2W';
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${is2w ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'}`}>
      {type}
    </span>
  );
}

function PushStatusBadge({ status }) {
  if (!status || status === 'Pending') {
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-slate-400"/>Pending</span>;
  }
  if (status === 'Synced') {
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>Synced</span>;
  }
  if (status === 'Failed') {
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-500"/>Failed</span>;
  }
  if (status === 'PartialFail') {
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"/>Partial</span>;
  }
  if (status === 'Removed') {
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-slate-400"/>Removed</span>;
  }
  if (status === 'PendingRemoval') {
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"><span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"/>Removing…</span>;
  }
  return <span className="text-xs text-slate-400">{status}</span>;
}

function CardsTab({
  cards, total, page, totalPages, loading,
  search, filterStatus, filterVehicleType,
  selectedIds, bulkWorking,
  onSearchChange, onFilterStatusChange, onFilterVehicleTypeChange,
  onPageChange, onToggleSelect, onSelectAll, onClearSelection,
  onAdd, onEdit, onDelete, onAssign, onBulkDeactivate,
  pushStatusMap, pushingIds, syncAllWorking, syncAllResult,
  onPushCard, onSyncAll,
  removingIds, onRemoveCard,
  pushNotice, onDismissPushNotice,
}) {
  const allOnPageSelected = cards.length > 0 && cards.every(c => selectedIds.has(c.id));

  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-0 w-full sm:w-56">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" value={search} onChange={e => onSearchChange(e.target.value)}
            placeholder="Search name, card no, vehicle…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          />
        </div>

        {/* Status filter */}
        <select value={filterStatus} onChange={e => onFilterStatusChange(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Suspended">Suspended</option>
          <option value="Expired">Expired</option>
        </select>

        {/* Vehicle type filter */}
        <select value={filterVehicleType} onChange={e => onFilterVehicleTypeChange(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
          <option value="">All Types</option>
          <option value="2W">2-Wheeler</option>
          <option value="4W">4-Wheeler</option>
          <option value="LMV">LMV</option>
          <option value="HMV">HMV</option>
        </select>

        {/* Bulk deactivate */}
        {selectedIds.size > 0 && (
          <button onClick={onBulkDeactivate} disabled={bulkWorking}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-60 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"/></svg>
            Suspend {selectedIds.size} selected
          </button>
        )}

        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">{total} card{total !== 1 ? 's' : ''}</span>

        {/* Sync All */}
        <button onClick={onSyncAll} disabled={syncAllWorking}
          className="flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-60 transition-colors"
          title="Queue all Active cards for push to all controllers">
          {syncAllWorking ? (
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          )}
          Sync All
        </button>

        <button onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          Add Card
        </button>
      </div>

      {/* Sync All result toast */}
      {syncAllResult && (
        <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>Queued <strong>{syncAllResult.queued ?? 0}</strong> card{syncAllResult.queued !== 1 ? 's' : ''} across <strong>{syncAllResult.controllers ?? 0}</strong> controller{syncAllResult.controllers !== 1 ? 's' : ''}. Bridge will push via WriteCardMain().</span>
          <button onClick={() => {}} className="ml-auto text-emerald-500 hover:text-emerald-700 text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Push notice: inline result after pushing a single card */}
      {pushNotice && (
        <div className={`px-4 py-2 border-b flex items-start gap-2 text-sm
          ${pushNotice.type === 'offline'
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
            : pushNotice.type === 'error'
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              : 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300'
          }`}>
          {pushNotice.type === 'offline' ? (
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z"/></svg>
          ) : pushNotice.type === 'error' ? (
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          ) : (
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          )}
          <span className="flex-1">{pushNotice.msg}</span>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            {pushNotice.type === 'offline' && (
              <button
                onClick={() => { onDismissPushNotice(); onPushCard(cards.find(c => c.id === pushNotice.cardId) || { id: pushNotice.cardId }); }}
                className="text-xs font-semibold underline">
                Retry
              </button>
            )}
            <button onClick={onDismissPushNotice} className="text-xs underline opacity-60 hover:opacity-100">Dismiss</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading cards…</div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
          </svg>
          <p className="text-sm">{search || filterStatus || filterVehicleType ? 'No cards match your filters.' : 'No cards added yet.'}</p>
          {!search && !filterStatus && !filterVehicleType && (
            <button onClick={onAdd} className="text-xs text-sky-500 hover:underline">Add your first card →</button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 z-10">
              <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-3 py-3 text-center w-8">
                  <input type="checkbox" checked={allOnPageSelected}
                    onChange={e => e.target.checked ? onSelectAll(cards.map(c => c.id)) : onClearSelection()}
                    className="rounded border-slate-300 dark:border-slate-600 accent-sky-500"
                  />
                </th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Card No.</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Person Name</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden sm:table-cell">Company</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden md:table-cell">Vehicle</th>
                <th className="px-3 py-3 text-center whitespace-nowrap hidden md:table-cell">Type</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden lg:table-cell">Access Group</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden xl:table-cell">Assigned User</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden xl:table-cell">Valid Until</th>
                <th className="px-4 py-3 text-left whitespace-nowrap">Push Status</th>
                <th className="px-4 py-3 text-left whitespace-nowrap hidden 2xl:table-cell">Last Sync</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {cards.map(c => (
                <tr key={c.id}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${selectedIds.has(c.id) ? 'bg-sky-50 dark:bg-sky-900/10' : ''}`}>
                  <td className="px-3 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.has(c.id)}
                      onChange={() => onToggleSelect(c.id)}
                      className="rounded border-slate-300 dark:border-slate-600 accent-sky-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{c.card_no}</span>
                    {c.card_type && c.card_type !== 'Normal' && (
                      <span className="ml-1.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{c.card_type}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 dark:text-slate-100 truncate max-w-[140px]">{c.person_name || <span className="text-slate-400">—</span>}</div>
                    {c.person_code && <div className="text-[10px] text-slate-400">{c.person_code}</div>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{c.company_name || c.company_code || '—'}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{c.vehicle_number || '—'}</span>
                  </td>
                  <td className="px-3 py-3 text-center hidden md:table-cell">
                    <VehicleTypeBadge type={c.vehicle_type} />
                  </td>
                  <td className="px-4 py-3">
                    <CardStatusBadge status={c.card_status} />
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{c.access_group_name || '—'}</span>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {c.assigned_user_name
                      ? <div>
                          <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.assigned_user_name}</div>
                          <div className="text-[10px] text-slate-400">{c.assigned_user_email}</div>
                        </div>
                      : <span className="text-slate-400 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {c.valid_until
                      ? (() => {
                          const expired = new Date(c.valid_until) < new Date();
                          return <span className={`text-xs ${expired ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                            {new Date(c.valid_until).toLocaleDateString('en-IN')}
                          </span>;
                        })()
                      : <span className="text-slate-400 text-xs">—</span>
                    }
                  </td>
                  {/* Push Status */}
                  <td className="px-4 py-3">
                    {(() => {
                      const live = pushStatusMap.get(c.id);
                      const status = live?.push_status ?? c.push_status;
                      const isPushing = pushingIds.has(c.id);
                      if (isPushing) {
                        return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                          <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                          Pushing…
                        </span>;
                      }
                      return (
                        <div>
                          <PushStatusBadge status={status} />
                          {(live?.push_error ?? c.push_error) && (
                            <div className="text-[10px] text-red-500 mt-0.5 truncate max-w-[120px]" title={live?.push_error ?? c.push_error}>
                              {(live?.push_error ?? c.push_error).slice(0, 40)}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {/* Last Sync */}
                  <td className="px-4 py-3 hidden 2xl:table-cell">
                    {(() => {
                      const live = pushStatusMap.get(c.id);
                      const ts = live?.last_pushed_at ?? c.last_pushed_at;
                      if (!ts) return <span className="text-slate-400 text-xs">Never</span>;
                      const ms = Date.now() - new Date(ts).getTime();
                      let ago = '';
                      if (ms < 60000)      ago = `${Math.floor(ms/1000)}s ago`;
                      else if (ms < 3600000) ago = `${Math.floor(ms/60000)}m ago`;
                      else if (ms < 86400000) ago = `${Math.floor(ms/3600000)}h ago`;
                      else ago = new Date(ts).toLocaleDateString('en-IN');
                      return <span className="text-xs text-slate-500 dark:text-slate-400">{ago}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Push to controller — prominent label for unsynced cards */}
                      {(() => {
                        const livePs = pushStatusMap.get(c.id);
                        const ps = livePs?.push_status ?? c.push_status;
                        const notSynced = !ps || ps === 'Pending' || ps === 'Failed';
                        const isPushing = pushingIds.has(c.id);
                        return (
                          <button
                            onClick={() => onPushCard(c)}
                            disabled={isPushing || c.card_status === 'Deleted'}
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                              ${notSynced
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 ring-1 ring-emerald-300 dark:ring-emerald-700'
                                : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'}`}
                            title={notSynced ? 'This card has not been pushed to the controller yet — click to push' : 'Push card to controller'}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                            {notSynced && <span>Push</span>}
                          </button>
                        );
                      })()}
                      <button onClick={() => onAssign(c)}
                        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                        title="Assign user">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                      </button>
                      {/* Remove from controllers */}
                      {(() => {
                        const live = pushStatusMap.get(c.id);
                        const ps   = live?.push_status ?? c.push_status;
                        const isRemoving = removingIds?.has(c.id);
                        const canRemove  = ps === 'Synced' || ps === 'PartialFail';
                        if (isRemoving) {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-500 dark:text-rose-400 opacity-70">
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                            </span>
                          );
                        }
                        if (canRemove) {
                          return (
                            <button
                              onClick={() => onRemoveCard(c)}
                              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
                              title="Remove card from all controllers (DelCardMain)">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          );
                        }
                        return null;
                      })()}
                      <button onClick={() => onEdit(c)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => onDelete(c)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{total} total • page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}
              className="rounded-lg px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              ← Prev
            </button>
            <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
              className="rounded-lg px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Footer note */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3 text-xs text-slate-500 bg-sky-50/50 dark:bg-sky-900/10">
          <span className="font-semibold text-sky-700 dark:text-sky-300">{selectedIds.size} selected</span>
          <button onClick={onClearSelection} className="text-slate-400 hover:text-slate-600 underline">Clear</button>
        </div>
      )}
    </>
  );
}
