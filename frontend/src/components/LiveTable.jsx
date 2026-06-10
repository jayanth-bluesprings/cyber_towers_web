import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLive, fetchSearch, WS_URL } from '../api/index.js';
import { loadStoredEntryExitRecords, saveStoredEntryExitRecords } from '../utils/entryExitStorage.js';
import { loadLocalAccessApprovals, saveLocalAccessApprovals } from '../utils/localAccessApprovalsStorage.js';
import { loadParkingAllocations } from '../utils/parkingStorage.js';

function formatTime(scanTime) {
  if (!scanTime) return '-';
  try {
    const raw = String(scanTime).trim();
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

function VehicleBadge({ type }) {
  const label = String(type || '').trim();
  if (!label) return <span className="badge-unknown font-bold">?</span>;
  return <span className="badge-unknown font-bold">{label}</span>;
}

function getGateInfo(equptName, portNum) {
  // Direction: PortNum 1 = entry, 2 = exit
  const port = parseInt(portNum, 10);
  const dir = port === 2 ? 'exit' : port === 1 ? 'entry' : 'unknown';

  // Physical gate: device 14070001 = Gate 1, device 24074151 = Gate 2
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

function csvEscape(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportCSV(records, localApprovals = {}, parkingByCardId = new Map()) {
  const headers = ['Gate', 'Card ID', 'Vehicle Type', 'Company Name', 'Car Number', 'Parking Slot', 'Authorization', 'Scan Time'];
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

const FRONTEND_DEDUP_SECONDS = 60; // 60 s window: collapses rapid burst reads from exit scanner
const PAGE_SIZE = 20;

function mergeRecords(existing, incoming, maxLen = 5000) {
  const byId = new Map(existing.map((r) => [r.CardRecordID, r]));
  for (const r of incoming) byId.set(r.CardRecordID, r);

  const sorted = Array.from(byId.values()).sort((a, b) => b.CardRecordID - a.CardRecordID);

  const seen = new Map();
  const deduped = [];
  for (const r of sorted) {
    const s = String(r.ScanTime || '');
    const ts = s.endsWith('Z') || s.includes('+') ? s : s + '+05:30';
    const scanMs = r.ScanTime ? new Date(ts).getTime() : 0;
    const bucket = Math.floor(scanMs / 1000 / FRONTEND_DEDUP_SECONDS);
    const key = `${(r.CardData || '').toUpperCase()}|${bucket}|${r.PortNum ?? ''}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.push(r);
    }
  }

  return deduped.slice(0, maxLen);
}

export default function LiveTable({ onWsStatus }) {
  const [records, setRecords] = useState(() => loadStoredEntryExitRecords());
  const [localApprovals, setLocalApprovals] = useState(() => loadLocalAccessApprovals());
  const [parkingAllocations, setParkingAllocations] = useState(() => loadParkingAllocations());
  const [searchRecords, setSearchRecords] = useState([]);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [newIds, setNewIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [gateTab, setGateTab] = useState('all'); // 'all' | 'gate1' | 'gate2'
  const [allowModal, setAllowModal] = useState({ open: false, record: null, remark: '', vehicleNo: '' });
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: liveData, isLoading } = useQuery({
    queryKey: ['liveRecords'],
    queryFn: fetchLive,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    enabled: !debouncedSearch,
  });

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['searchRecords', debouncedSearch],
    queryFn: () => fetchSearch(debouncedSearch),
    enabled: !!debouncedSearch,
  });

  useEffect(() => {
    if (!debouncedSearch && liveData?.data && !initialLoaded) {
      setRecords((prev) => mergeRecords(prev, liveData.data));
      setInitialLoaded(true);
    }
  }, [liveData, debouncedSearch, initialLoaded]);

  useEffect(() => {
    if (debouncedSearch && searchData?.data) {
      setSearchRecords(mergeRecords([], searchData.data));
    }
    if (!debouncedSearch) {
      setSearchRecords([]);
    }
  }, [searchData, debouncedSearch]);

  useEffect(() => {
    saveStoredEntryExitRecords(records);
  }, [records]);

  useEffect(() => {
    saveLocalAccessApprovals(localApprovals);
  }, [localApprovals]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    const onStorage = (event) => {
      if (!event.key || event.key === 'vehicleAccess.parkingAllocations.v1') {
        setParkingAllocations(loadParkingAllocations());
      }
      if (!event.key || event.key === 'vehicleAccess.localApprovals.v1') {
        setLocalApprovals(loadLocalAccessApprovals());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const parkingByCardId = useMemo(() => {
    const map = new Map();
    for (const item of parkingAllocations) {
      const key = String(item?.cardId || '').trim().toUpperCase();
      if (!key) continue;
      map.set(key, String(item?.slot || item?.parkingSpace || '').trim() || '-');
    }
    return map;
  }, [parkingAllocations]);

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

  const sourceRecords = debouncedSearch ? searchRecords : records;
  const activeRecords = gateTab === 'gate1'
    ? sourceRecords.filter((r) => getGateInfo(r.EquptName, r.PortNum).gateNum === 1)
    : gateTab === 'gate2'
      ? sourceRecords.filter((r) => getGateInfo(r.EquptName, r.PortNum).gateNum === 2)
      : sourceRecords;

  const connectWs = useCallback(() => {
    if (!WS_URL) { onWsStatus?.('connected'); return; }
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    onWsStatus?.('connecting');
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        onWsStatus?.('connected');
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
              setNewIds((prev) => {
                const next = new Set(prev);
                ids.forEach((id) => next.delete(id));
                return next;
              });
            }, 3000);
          }
        } catch { }
      };

      ws.onerror = () => onWsStatus?.('error');
      ws.onclose = () => {
        onWsStatus?.('disconnected');
        reconnectTimer.current = setTimeout(connectWs, 5000);
      };
    } catch {
      onWsStatus?.('error');
      reconnectTimer.current = setTimeout(connectWs, 5000);
    }
  }, [onWsStatus, debouncedSearch]);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connectWs]);

  useEffect(() => {
    setPage((current) => {
      const total = Math.max(1, Math.ceil(activeRecords.length / PAGE_SIZE) || 1);
      return Math.min(current, total);
    });
  }, [activeRecords.length]);

  const displayRecords = activeRecords;
  const totalPages = Math.max(1, Math.ceil(displayRecords.length / PAGE_SIZE) || 1);
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = displayRecords.slice(startIndex, startIndex + PAGE_SIZE);
  const loading = isLoading || searchLoading;

  const emptyMessage = debouncedSearch
      ? 'No results found'
      : 'No records available';

  return (
    <div className="card flex flex-col" style={{ minHeight: '480px' }}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-display font-semibold text-base flex items-center gap-2 text-slate-900 dark:text-white">
              Live Entry / Exit
              <span className="flex items-center gap-1 text-xs font-mono font-normal text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full live-dot" />
                LIVE
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Showing {pageRecords.length} of {displayRecords.length} unique scans
              <span className="ml-1 text-slate-400">( {PAGE_SIZE} per page)</span>
            </p>
            <div className="flex items-center gap-1 mt-3 p-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 w-fit">
              {[
                { key: 'all', label: 'All Gates' },
                { key: 'gate1', label: 'Gate 1' },
                { key: 'gate2', label: 'Gate 2' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setGateTab(tab.key); setPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    gateTab === tab.key
                      ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Card ID, name, flat..."
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-sky-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none placeholder-slate-400 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <button
            onClick={() => exportCSV(displayRecords, localApprovals, parkingByCardId)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap text-slate-600 dark:text-slate-300 pointer-events-auto"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            CSV
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-10">
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
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded" style={{ width: `${45 + Math.random() * 40}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : displayRecords.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-3 opacity-50">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              pageRecords.map((record) => {
                const isNew = newIds.has(record.CardRecordID);
                const gate = getGateInfo(record.EquptName, record.PortNum);
                const key = getApprovalKey(record);
                const approval = localApprovals[key];
                // Raw auth: always shows "Unauthorized" regardless of local approval
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

      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Next
          </button>
        </div>
      </div>

      {allowModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" style={{ zIndex: 9999 }}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden relative">
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
    </div>
  );
}
