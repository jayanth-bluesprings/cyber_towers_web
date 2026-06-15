import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import { fetchAuthorizedVehicles, getPersonPhotoUrl, updatePerson, WS_URL } from '../api/index.js';
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
  const queryClient = useQueryClient();
  const scanWsRef = useRef(null);
  const scanReconnectRef = useRef(null);

  const { data } = useQuery({
    queryKey: ['authorizedVehicles'],
    queryFn: fetchAuthorizedVehicles,
  });

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
            const rows = Array.isArray(payload?.data) ? payload.data : [];
            if (payload?.type !== 'new_scans' || rows.length === 0) return;

            const nextCard = normalize(rows[0]?.CardData);
            if (!nextCard) return;
            setLatestScannedCard(nextCard);
          } catch (_err) {
            // Ignore malformed scan payloads.
          }
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
    setModalMode('add');
    setEditingCardId('');
    setForm(createEmptyForm());
    setModalOpen(true);
  }

  function openEditModal(vehicle) {
    const key = cardKey(vehicle.CardData);
    setModalMode('edit');
    setEditingCardId(key);
    setForm({
      CardData: normalize(vehicle.CardData),
      PName: normalize(vehicle.PName),
      CarNumber: normalize(vehicle.CarNumber),
      Addr: normalize(vehicle.Addr),
      vehicleType: normalize(vehicle.vehicleType),
      BloodGroup: normalize(vehicle.BloodGroup),
      Authorization: normalize(vehicle.Authorization) || 'Active',
      ParkingSpace: parkingByCardId.get(key) || '',
    });
    setModalOpen(true);
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

  function handleSaveCompany(event) {
    event.preventDefault();
    if (!companyForm.companyName.trim()) {
      alert('Company Name is required.');
      return;
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
              <button type="button" onClick={openAddModal} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600">Add User</button>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 px-4 gap-1 pt-2">
            {[{ key: 'vehicles', label: `Vehicles (${vehicles.length})` }, { key: 'companies', label: `Companies (${allCompanies.length})` }].map(({ key, label }) => (
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
    </div>
  );
}
