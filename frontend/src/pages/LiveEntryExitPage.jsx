import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import { fetchLive, fetchSearch, WS_URL } from '../api/index.js';
import { loadStoredEntryExitRecords, saveStoredEntryExitRecords } from '../utils/entryExitStorage.js';
import { loadLocalAccessApprovals, saveLocalAccessApprovals } from '../utils/localAccessApprovalsStorage.js';
import { loadParkingAllocations } from '../utils/parkingStorage.js';

/* ─── helpers ─────────────────────────────────────────────── */
function formatTime(scanTime) {
  if (!scanTime) return '-';
  try {
    const raw = String(scanTime).trim();
    // All ScanTime values use "IST wall-clock as fake UTC" convention (matching the
    // TimeWatch DB). Strip the Z so JavaScript does not reinterpret the value as true
    // UTC, then append +05:30 to parse the wall-clock value as IST explicitly.
    // Using timeZone: 'Asia/Kolkata' ensures correct display on any browser timezone.
    const noZ = raw.endsWith('Z') ? raw.slice(0, -1) : raw;
    const d = new Date(noZ + '+05:30');
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(scanTime);
  }
}

function getGateInfo(equptName, portNum) {
  // Direction: PortNum 1 = entry, 2 = exit
  const port = parseInt(portNum, 10);
  const dir = port === 2 ? 'exit' : port === 1 ? 'entry' : 'unknown';

  // Physical gate: determined by device ID in EquptName
  // Device 14070001 = Gate 1,  Device 24074151 = Gate 2
  const name = String(equptName || '').trim();
  const gateNum = name.includes('24074151') ? 2 : 1;
  const label = `Gate ${gateNum}`;

  const icon = dir === 'entry' ? '↑' : dir === 'exit' ? '↓' : '?';
  const className =
    dir === 'entry'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
      : dir === 'exit'
        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';

  return { label, dir, icon, className, gateNum };
}

function getAuthStatus(pcode, isLocallyAllowed = false) {
  if (isLocallyAllowed) {
    return {
      label: 'Allowed',
      isAuthorized: true,
      className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800',
    };
  }

  const value = String(pcode ?? '').trim();
  const authorized = value !== '' && value !== '-';
  return authorized
    ? { label: 'Authorized', isAuthorized: true, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' }
    : { label: 'Unauthorized', isAuthorized: false, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800' };
}

function getApprovalKey(record) {
  return String(record?.CardData || '').trim().toUpperCase();
}

function getDisplayVehicleNo(record, approval) {
  return String(
    approval?.vehicleNo ||
    record?.PName ||
    record?.CarNumber ||
    ''
  ).trim() || '-';
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

function getCompanyName(flatCode) {
  if (!flatCode || flatCode === '-') return '-';
  const prefix = String(flatCode).split('-')[0].toUpperCase();
  return COMPANY_NAME_MAP[prefix] || flatCode;
}

// "Microsoft India PS-1/22" → "1/22"
function getSlotLabel(parkingSpace) {
  if (!parkingSpace || parkingSpace === '-') return null;
  const match = String(parkingSpace).match(/PS-(\d+\/\d+)/);
  return match ? match[1] : null;
}

const DEDUP_SECONDS = 60; // 60 s window: collapses rapid burst reads from exit scanner

function mergeRecords(existing, incoming, maxLen = 5000) {
  const byId = new Map(existing.map((r) => [r.CardRecordID, r]));
  for (const r of incoming) byId.set(r.CardRecordID, r);
  const sorted = Array.from(byId.values()).sort((a, b) => b.CardRecordID - a.CardRecordID);
  const seen = new Map();
  const deduped = [];
  for (const r of sorted) {
    const s = String(r.ScanTime || '');
    const ts = s.endsWith('Z') || s.includes('+') ? s : s + '+05:30';
    const bucket = Math.floor(new Date(ts).getTime() / 1000 / DEDUP_SECONDS);
    const key = `${(r.CardData || '').toUpperCase()}|${bucket}|${r.PortNum ?? ''}`;
    if (!seen.has(key)) { seen.set(key, true); deduped.push(r); }
  }
  return deduped.slice(0, maxLen);
}

function csvEscape(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCSV(records, localApprovals = {}, parkingByCardId = new Map()) {
  const headers = ['Gate', 'Card ID', 'Vehicle Type', 'Flat/Code', 'Car Number', 'Parking Slot', 'Authorization', 'Scan Time'];
  const rows = records.map((r) => {
    const gate = getGateInfo(r.EquptName, r.PortNum);
    const key = getApprovalKey(r);
    const auth = getAuthStatus(r.PCode);
    const parkingSlot = parkingByCardId.get(getApprovalKey(r)) || '-';
    const vehicleNo = getDisplayVehicleNo(r, localApprovals[key]);
    return [
      gate.label,
      r.CardData || '',
      r.vehicleType || r.VehicleType || '',
      r.flatNumber || r.PCode || '',
      vehicleNo,
      parkingSlot,
      auth.label,
      formatTime(r.ScanTime),
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-entry-exit-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── small sub-components ───────────────────────────────── */
function StatPill({ label, value, colorClass, icon }) {
  return (
    <div className={`flex items-center gap-4 rounded-2xl px-6 py-4 border shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 ${colorClass}`}>
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm">
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest mt-1.5 opacity-80">{label}</span>
      </div>
    </div>
  );
}

function VehicleBadge({ type }) {
  const label = String(type || '').trim();
  if (!label) return <span className="badge-unknown font-bold">?</span>;
  return <span className="badge-unknown font-bold">{label}</span>;
}

/* ─── main page ─────────────────────────────────────────── */
export default function LiveEntryExitPage({ dark, setDark, onNavigate, onLogout, activePage = 'live' }) {
  const [records, setRecords] = useState(() => loadStoredEntryExitRecords());
  const [localApprovals, setLocalApprovals] = useState(() => loadLocalAccessApprovals());
  const [parkingAllocations, setParkingAllocations] = useState(() => loadParkingAllocations());
  const [dateRangeRecords, setDateRangeRecords] = useState([]);
  const [searchRecords, setSearchRecords] = useState([]);
  const [newIds, setNewIds] = useState(new Set());
  const [wsStatus, setWsStatus] = useState('connecting');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dirFilter, setDirFilter] = useState('all'); // 'all' | 'entry' | 'exit'
  const [dayToggle, setDayToggle] = useState('all'); // 'all' | 'today'
  const [authFilter, setAuthFilter] = useState('all'); // 'all' | 'authorized' | 'unauthorized'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [gateTab, setGateTab] = useState('all'); // 'all' | 'gate1' | 'gate2'
  const [allowModal, setAllowModal] = useState({ open: false, record: null, remark: '', vehicleNo: '' });
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  /* debounce search */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  /* initial REST load */
  const { data: liveData, isLoading, refetch: refetchLive } = useQuery({
    queryKey: ['liveRecords', startDate, endDate],
    queryFn: () => fetchLive({ startDate, endDate }),
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    enabled: !debouncedSearch,
  });

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['searchRecords', debouncedSearch, startDate, endDate],
    queryFn: () => fetchSearch(debouncedSearch, { startDate, endDate }),
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    enabled: !!debouncedSearch,
  });

  useEffect(() => {
    refetchLive();
  }, []);

  useEffect(() => {
    if (debouncedSearch || !liveData?.data) return;

    if (startDate || endDate) {
      setDateRangeRecords(mergeRecords([], liveData.data));
    } else {
      setDateRangeRecords([]);
      setRecords((prev) => mergeRecords(prev, liveData.data));
    }
  }, [liveData, debouncedSearch, startDate, endDate]);

  useEffect(() => {
    if (!debouncedSearch) {
      setSearchRecords([]);
      return;
    }
    if (searchData?.data) {
      setSearchRecords(mergeRecords([], searchData.data));
    }
  }, [searchData, debouncedSearch]);

  useEffect(() => {
    if (startDate || endDate) setDayToggle('all');
    if (!startDate && !endDate) setDateRangeRecords([]);
  }, [startDate, endDate]);

  useEffect(() => {
    saveStoredEntryExitRecords(records);
  }, [records]);

  useEffect(() => {
    saveLocalAccessApprovals(localApprovals);
  }, [localApprovals]);

  useEffect(() => {
    const onStorage = () => setParkingAllocations(loadParkingAllocations());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function openAllowModal(record) {
    const key = getApprovalKey(record);
    const existing = localApprovals[key];
    setAllowModal({
      open: true,
      record,
      remark: existing?.remark || '',
      vehicleNo: existing?.vehicleNo || '',
    });
  }

  function closeAllowModal() {
    setAllowModal({ open: false, record: null, remark: '', vehicleNo: '' });
  }

  function saveAllowRemark() {
    const record = allowModal.record;
    const remark = String(allowModal.remark || '').trim();
    const vehicleNo = String(allowModal.vehicleNo || '').trim();
    if (!record || !remark || !vehicleNo) return;

    const key = getApprovalKey(record);
    if (!key) return;
    setLocalApprovals((prev) => ({
      ...prev,
      [key]: {
        cardId: record.CardData || '',
        vehicleNo,
        companyName: record.flatNumber || record.PCode || '',
        remark,
        allowedAt: new Date().toISOString(),
      },
    }));
    closeAllowModal();
  }

  /* WebSocket live push */
  const connectWs = useCallback(() => {
    if (!WS_URL) { setWsStatus('connected'); return; }
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setWsStatus('connecting');
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsStatus('connected');
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_scans' && Array.isArray(msg.data) && msg.data.length > 0) {
            const incoming = msg.data;
            const ids = new Set(incoming.map((r) => r.CardRecordID));
            setRecords((prev) => mergeRecords(prev, incoming));
            setNewIds((prev) => new Set([...prev, ...ids]));
            setTimeout(() => {
              setNewIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
            }, 4000);
          }
          // WF7 parking update — real-time slot count from Temporal workflow
          if (msg.type === 'parkingUpdate' && msg.data) {
            const d = msg.data;
            console.log(`[WF7] ${d.type} — ${d.companyName || d.companyCode}: ${d.occupiedSlots}/${d.totalSlots} slots`);
          }
          // Gate command — open/deny/LED from Temporal workflow
          if (msg.type === 'gateCommand' && msg.data) {
            const d = msg.data;
            console.log(`[Gate] ${d.command} → ${d.gate} | "${d.message}"`);
          }
        } catch { /**/ }
      };
      ws.onerror = () => setWsStatus('error');
      ws.onclose = () => {
        setWsStatus('disconnected');
        reconnectTimer.current = setTimeout(connectWs, 5000);
      };
    } catch {
      setWsStatus('error');
      reconnectTimer.current = setTimeout(connectWs, 5000);
    }
  }, [debouncedSearch, startDate, endDate]);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connectWs]);

  /* derived */
  const sourceRecords = debouncedSearch
    ? searchRecords
    : (startDate || endDate)
      ? dateRangeRecords
      : records;

  // Gate tab filters by physical gate (device), not direction
  const baseActiveRecords = gateTab === 'gate1'
    ? sourceRecords.filter((r) => getGateInfo(r.EquptName, r.PortNum).gateNum === 1)
    : gateTab === 'gate2'
      ? sourceRecords.filter((r) => getGateInfo(r.EquptName, r.PortNum).gateNum === 2)
      : sourceRecords;
  const activeRecords = baseActiveRecords.filter((r) => {
    if (dayToggle === 'today') {
      if (!r.ScanTime) return false;
      const d = new Date(r.ScanTime);
      const t = new Date();
      if (d.getDate() !== t.getDate() || d.getMonth() !== t.getMonth() || d.getFullYear() !== t.getFullYear()) return false;
    }
    
    if (authFilter !== 'all') {
      const key = getApprovalKey(r);
      const isAuth = getAuthStatus(r.PCode, Boolean(localApprovals[key])).isAuthorized;
      if (authFilter === 'authorized' && !isAuth) return false;
      if (authFilter === 'unauthorized' && isAuth) return false;
    }
    return true;
  });
  
  const loading = isLoading || searchLoading;

  const filtered = activeRecords.filter((r) => {
    if (dirFilter === 'entry') return getGateInfo(r.EquptName, r.PortNum).dir === 'entry';
    if (dirFilter === 'exit') return getGateInfo(r.EquptName, r.PortNum).dir === 'exit';
    return true;
  });

  // Counts always from the fully-filtered set so pills match the table
  const entryCount = filtered.filter((r) => getGateInfo(r.EquptName, r.PortNum).dir === 'entry').length;
  const exitCount  = filtered.filter((r) => getGateInfo(r.EquptName, r.PortNum).dir === 'exit').length;

  const parkingByCardId = useMemo(() => {
    const map = new Map();
    for (const item of parkingAllocations) {
      const key = String(item?.cardId || '').trim().toUpperCase();
      if (!key) continue;
      map.set(key, String(item?.parkingSpace || '').trim() || '-');
    }
    return map;
  }, [parkingAllocations]);

  const emptyMessage = debouncedSearch
    ? 'No results found'
    : 'Waiting for scans…';

  const wsColor = wsStatus === 'connected' ? 'bg-emerald-500' : wsStatus === 'connecting' ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar
        dark={dark}
        setDark={setDark}
        wsStatus={wsStatus}
        activePage={activePage}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 flex flex-col gap-5">

        {/* ── Page header ────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              Live Entry / Exit
              <span className="flex items-center gap-1.5 text-xs font-mono font-normal px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                <span className={`w-1.5 h-1.5 rounded-full ${wsColor} live-dot`} />
                {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting…' : 'Offline'}
              </span>
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Real-time vehicle scan feed · Showing latest {filtered.length} scans</span>
              <span className="inline-block md:hidden">|</span>
              <span className="text-xs font-mono opacity-60">Last update: {new Date().toLocaleTimeString('en-IN', { hour12: false })}</span>
            </p>
          </div>

          {/* stat pills */}
          <div className="flex gap-3 flex-wrap">
            <StatPill
              label="Total Scans"
              value={filtered.length}
              icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
              colorClass="border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <StatPill
              label="Entries"
              value={entryCount}
              icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>}
              colorClass="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
            />
            <StatPill
              label="Exits"
              value={exitCount}
              icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" /></svg>}
              colorClass="border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400"
            />
          </div>
        </div>

        {/* ── Table card ─────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex flex-col" style={{ minHeight: '520px' }}>

          {/* card toolbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">

            {/* gate + direction filters */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                {[
                  { key: 'all', label: 'All Scans' },
                  { key: 'today', label: 'Today' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                       setDayToggle(tab.key);
                       if (tab.key === 'today') {
                          setStartDate('');
                          setEndDate('');
                       }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      dayToggle === tab.key
                        ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'gate1', label: 'Gate 1' },
                  { key: 'gate2', label: 'Gate 2' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setGateTab(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      gateTab === tab.key
                        ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'entry', label: '↑ Entry' },
                  { key: 'exit', label: '↓ Exit' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDirFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      dirFilter === tab.key
                        ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'authorized', label: 'Authorized' },
                  { key: 'unauthorized', label: 'Unauthorized' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setAuthFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      authFilter === tab.key
                        ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* search + csv */}
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">From</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
                />
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">To</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
                />
                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(''); setEndDate(''); }}
                    className="text-[11px] text-sky-600 dark:text-sky-400 underline underline-offset-2"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="relative flex-1 sm:w-64">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Card ID, name, flat…"
                  className="w-full pl-8 pr-8 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-sky-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none placeholder-slate-400 transition-all"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              <button
                onClick={() => exportCSV(filtered, localApprovals, parkingByCardId)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap text-slate-600 dark:text-slate-300"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                CSV
              </button>
            </div>
          </div>

          {/* table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 z-10">
                <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Gate</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Card ID</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Vehicle Type</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap hidden md:table-cell">Company Name</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Car No.</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Parking Slot</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Authorization</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Action</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Scan Time</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-3.5 rounded bg-slate-100 dark:bg-slate-800" style={{ width: `${45 + Math.random() * 40}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-20 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-50">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <span className="text-sm">{emptyMessage}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((record) => {
                    const isNew = newIds.has(record.CardRecordID);
                    const gate = getGateInfo(record.EquptName, record.PortNum);
                    const key = getApprovalKey(record);
                    const approval = localApprovals[key];
                    // Raw auth: always shows "Unauthorized" for unregistered cards regardless of local approval
                    const auth = getAuthStatus(record.PCode);
                    const isLocallyAllowed = Boolean(approval?.remark);
                    return (
                      <tr
                        key={record.CardRecordID}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${isNew ? 'table-row-new' : ''}`}
                      >
                        {/* Gate */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold border ${gate.className}`}>
                            <span className="text-base leading-none">{gate.icon}</span>
                            {gate.label}
                          </span>
                        </td>

                        {/* Card ID */}
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                            {record.CardData || '-'}
                          </span>
                        </td>

                        {/* Type */}
                        <td className="px-3 py-3 text-center">
                          <VehicleBadge type={record.vehicleType} />
                        </td>

                        {/* Company Name */}
                        <td className="px-3 py-3 hidden md:table-cell">
                          <span className="text-xs text-slate-700 dark:text-slate-300">
                            {getCompanyName(record.flatNumber || record.PCode)}
                          </span>
                        </td>

                        {/* Car No. */}
                        <td className="px-3 py-3">
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {getDisplayVehicleNo(record, approval)}
                          </span>
                        </td>

                        {/* Parking Slot */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          {(() => {
                            const slot = getSlotLabel(parkingByCardId.get(getApprovalKey(record)));
                            return slot ? (
                              <span className="inline-flex rounded-md px-2 py-1 text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                {slot}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-500">No Slot</span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          <span className="relative group inline-flex">
                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold cursor-default ${auth.className}`}>
                              {auth.label}
                            </span>
                            {record.CarNumber && (
                              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-50">
                                <span className="whitespace-nowrap rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-[11px] font-semibold px-2.5 py-1.5 shadow-xl">
                                  {record.CarNumber}
                                </span>
                                <span className="border-4 border-transparent border-t-slate-800 dark:border-t-slate-700" />
                              </span>
                            )}
                          </span>
                        </td>

                        <td className="px-3 py-3">
                          {!auth.isAuthorized && gate.dir === 'entry' && !isLocallyAllowed ? (
                            /* Unauthorized entry — not yet approved: show Allow button */
                            <button
                              type="button"
                              onClick={() => openAllowModal(record)}
                              className="rounded-md bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800 px-2.5 py-1 text-xs font-semibold hover:bg-sky-200 dark:hover:bg-sky-900/60"
                            >
                              Allow
                            </button>
                          ) : !auth.isAuthorized && gate.dir === 'exit' && isLocallyAllowed ? (
                            /* Unauthorized exit — was approved on entry: show the reason */
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                ✓ Allowed
                              </span>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[160px] truncate leading-tight" title={approval.remark}>
                                {approval.remark}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>

                        {/* Scan time */}
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formatTime(record.ScanTime)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* card footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span className="font-mono">{filtered.length} scan{filtered.length !== 1 ? 's' : ''} shown</span>
            <span>Auto-refreshed via WebSocket</span>
          </div>
        </div>

      </main>

      {allowModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">Allow Vehicle Access</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Add vehicle number and remark for this temporary access.
              </p>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <p><span className="font-semibold">Card ID:</span> {allowModal.record?.CardData || '-'}</p>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vehicle No.</label>
                <input
                  type="text"
                  value={allowModal.vehicleNo}
                  onChange={(e) => setAllowModal((prev) => ({ ...prev, vehicleNo: e.target.value }))}
                  placeholder="Example: TS08UF8728"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Remark</label>
                <textarea
                  rows={4}
                  value={allowModal.remark}
                  onChange={(e) => setAllowModal((prev) => ({ ...prev, remark: e.target.value }))}
                  placeholder="Example: Temporary visitor approved by security supervisor."
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeAllowModal}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAllowRemark}
                disabled={!String(allowModal.remark || '').trim() || !String(allowModal.vehicleNo || '').trim()}
                className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Save & Allow
              </button>
            </div>
          </div>
        </div>
      )}


      <footer className="border-t border-slate-200 dark:border-slate-800 py-3 px-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between text-xs text-slate-400 dark:text-slate-600">
          <span className="font-mono">Vehicle Access Dashboard v1.0</span>
          <span>Cyber Towers</span>
        </div>
      </footer>
    </div>
  );
}
