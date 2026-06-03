import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import { fetchAuthorizedVehicles, WS_URL } from '../api/index.js';
import { loadParkingAllocations, saveParkingAllocations } from '../utils/parkingStorage.js';
import { loadRegisteredVehiclesState, saveRegisteredVehiclesState } from '../utils/registeredVehiclesStorage.js';
import { DUMMY_COMPANIES } from '../data/dummyData.js';

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
    const existing = Array.isArray(parsed) ? parsed : [];
    // Always guarantee all 10 dummy companies are present
    const dummyIds = new Set(DUMMY_COMPANIES.map((c) => c.id));
    const userAdded = existing.filter((c) => !dummyIds.has(c.id));
    return [...DUMMY_COMPANIES, ...userAdded];
  } catch {
    return DUMMY_COMPANIES;
  }
}

function saveCompanies(list) {
  try {
    // Always persist dummy companies + user-added ones
    const dummyIds = new Set(DUMMY_COMPANIES.map((c) => c.id));
    const userAdded = list.filter((c) => !dummyIds.has(c.id));
    localStorage.setItem('registeredCompanies', JSON.stringify([...DUMMY_COMPANIES, ...userAdded]));
  } catch {
    // ignore
  }
}

export default function ConfigPage({ dark, setDark, onNavigate, onLogout, activePage = 'config' }) {
  const [registryState, setRegistryState] = useState(() => loadRegisteredVehiclesState());
  const [parkingAllocations, setParkingAllocations] = useState(() => loadParkingAllocations());
  const [companies, setCompanies] = useState(() => loadCompanies());
  const [search, setSearch] = useState('');
  const [latestScannedCard, setLatestScannedCard] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [editingCardId, setEditingCardId] = useState('');
  const [form, setForm] = useState(createEmptyForm());
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState(createEmptyCompanyForm());
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
    const term = search.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((vehicle) =>
      [
        vehicle.CardData,
        vehicle.PName,
        vehicle.CarNumber,
        vehicle.Addr,
        vehicle.vehicleType,
        vehicle.BloodGroup,
        vehicle.Authorization,
        parkingByCardId.get(cardKey(vehicle.CardData)) || '',
      ]
        .map((value) => normalize(value).toLowerCase())
        .some((value) => value.includes(term))
    );
  }, [search, vehicles, parkingByCardId]);

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

  function handleSaveVehicle(event) {
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

    const targetKey = editingCardId || nextCardId;
    const isCustom = (registryState.customVehicles || []).some((row) => cardKey(row.CardData) === targetKey);
    const ok = upsertParkingForCard(payload, form.ParkingSpace);
    if (!ok) return;

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

    closeModal();
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
      <Navbar dark={dark} setDark={setDark} activePage={activePage} onNavigate={onNavigate} onLogout={onLogout} />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 flex flex-col gap-6">
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

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Vehicle Registry Configuration</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setCompanyForm(createEmptyCompanyForm()); setCompanyModalOpen(true); }}
                className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-600"
              >
                Company Registration
              </button>
              <button type="button" onClick={openAddModal} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600">
                Add User
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vehicles, parking slot, status"
              className="w-full md:w-96 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
                  {['Card ID', 'Vehicle No.', 'Company', 'Vehicle Type', 'Blood Group', 'Status', 'Parking Quota', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredVehicles.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No vehicles found.</td></tr>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.CardData} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-xs">{vehicle.CardData}</td>
                      <td className="px-4 py-3">{vehicle.PName || '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">{getCompanyName(vehicle.Addr)}</td>
                      <td className="px-4 py-3">{vehicle.vehicleType || '-'}</td>
                      <td className="px-4 py-3">{vehicle.BloodGroup || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${authBadgeClass(vehicle.Authorization)}`}>
                          {vehicle.Authorization || 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const slot = getSlotLabel(parkingByCardId.get(cardKey(vehicle.CardData)));
                          return slot ? (
                            <span className="inline-flex rounded-md px-2 py-1 text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                              {slot}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">No Slot</span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => openEditModal(vehicle)} className="rounded-md bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 px-2.5 py-1 text-xs font-semibold">Edit</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}
