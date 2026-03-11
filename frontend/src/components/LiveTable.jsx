import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLive, fetchSearch, WS_URL } from '../api/index.js';

function formatTime(scanTime) {
  if (!scanTime) return '—';
  try {
    const s = String(scanTime);
    // Bare DB timestamp has no tz — treat as IST
    const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + '+05:30');
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Calcutta',
    });
  } catch {
    return scanTime;
  }
}

function VehicleBadge({ type }) {
  if (type === '2W') return <span className="badge-2w">2W</span>;
  if (type === '4W') return <span className="badge-4w">4W</span>;
  return <span className="badge-unknown">?</span>;
}

function isIllegal(record) {
  return !record.PName && !record.vehicleType?.match(/^[24]W$/);
}

function exportCSV(records) {
  const headers = ['CardRecordID', 'CardData', 'VehicleType', 'FlatNumber', 'PName', 'PCode', 'DeptName', 'EquptName', 'ScanTime'];
  const rows = records.map((r) => [
    r.CardRecordID, r.CardData, r.vehicleType, r.flatNumber || r.PCode,
    r.PName, r.PCode, r.DeptName, r.EquptName, formatTime(r.ScanTime),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v ?? ''}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vehicle-access-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Merge + deduplicate:
//   1. By CardRecordID (exact database duplicate)
//   2. By CardData within a 30-second bucket (same physical card scanned multiple
//      times on one pass — e.g. reader fires twice). Keep only the latest scan
//      per card per 30-second window.
const FRONTEND_DEDUP_SECONDS = 30;

function mergeRecords(existing, incoming, maxLen = 200) {
  // Step 1: merge by CardRecordID
  const byId = new Map(existing.map((r) => [r.CardRecordID, r]));
  for (const r of incoming) byId.set(r.CardRecordID, r);

  // Step 2: deduplicate by CardData + 30-second time bucket
  const sorted = Array.from(byId.values())
    .sort((a, b) => b.CardRecordID - a.CardRecordID); // newest first

  const seen = new Map(); // key: "CardData|bucket"
  const deduped = [];
  for (const r of sorted) {
    const s = String(r.ScanTime || '');
    const ts = s.endsWith('Z') || s.includes('+') ? s : s + '+05:30';
    const scanMs = r.ScanTime ? new Date(ts).getTime() : 0;
    const bucket = Math.floor(scanMs / 1000 / FRONTEND_DEDUP_SECONDS);
    const key = `${(r.CardData || '').toUpperCase()}|${bucket}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.push(r);
    }
    // else: duplicate scan in same window — silently dropped
  }

  return deduped.slice(0, maxLen);
}

export default function LiveTable({ onWsStatus }) {
  const [records, setRecords] = useState([]);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [newIds, setNewIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Initial load — runs ONCE to seed the table, then WS takes over.
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

  // Seed records once on initial fetch
  useEffect(() => {
    if (!debouncedSearch && liveData?.data && !initialLoaded) {
      setRecords(liveData.data);
      setInitialLoaded(true);
    }
  }, [liveData, debouncedSearch, initialLoaded]);

  // Search results replace table temporarily
  useEffect(() => {
    if (debouncedSearch && searchData?.data) {
      setRecords(searchData.data);
    }
  }, [searchData, debouncedSearch]);

  // WebSocket
  const connectWs = useCallback(() => {
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

            if (!debouncedSearch) {
              setRecords((prev) => mergeRecords(prev, incoming));
            }

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

  const displayRecords = records;
  const loading = isLoading || searchLoading;

  return (
    <div className="card flex flex-col" style={{ minHeight: '480px' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-display font-semibold text-base flex items-center gap-2">
              Live Entry / Exit
              <span className="flex items-center gap-1 text-xs font-mono font-normal text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full live-dot" />
                LIVE
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {displayRecords.length} unique scans shown
              <span className="ml-1 text-slate-400">(dupes filtered)</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Search */}
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

          {/* Export */}
          <button
            onClick={() => exportCSV(displayRecords)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/80 backdrop-blur-sm">
            <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3 text-left whitespace-nowrap">Card ID</th>
              <th className="px-3 py-3 text-center whitespace-nowrap">Type</th>
              <th className="px-3 py-3 text-left whitespace-nowrap hidden md:table-cell">Flat No.</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">Name</th>
              <th className="px-3 py-3 text-left whitespace-nowrap hidden lg:table-cell">Department</th>
              <th className="px-3 py-3 text-left whitespace-nowrap hidden xl:table-cell">Gate</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">Scan Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded" style={{ width: `${50 + Math.random() * 40}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : displayRecords.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <span className="text-sm">{debouncedSearch ? 'No results found' : 'No records available'}</span>
                  </div>
                </td>
              </tr>
            ) : (
              displayRecords.map((record) => {
                const illegal = isIllegal(record);
                const isNew = newIds.has(record.CardRecordID);
                return (
                  <tr
                    key={record.CardRecordID}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${isNew ? 'table-row-new' : ''} ${illegal ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {record.CardData || '—'}
                      </span>
                      {illegal && (
                        <span className="ml-2 badge-illegal">ILLEGAL</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <VehicleBadge type={record.vehicleType} />
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {record.flatNumber || record.PCode || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[120px] block">
                        {record.PName || <span className="text-slate-400 italic">Unknown</span>}
                      </span>
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className="text-slate-600 dark:text-slate-400 text-xs truncate max-w-[120px] block">
                        {record.DeptName || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 hidden xl:table-cell">
                      <span className="text-xs text-slate-600 dark:text-slate-400 truncate block max-w-[100px]">
                        {record.EquptName || '—'}
                      </span>
                    </td>
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
    </div>
  );
}