import { useCallback, useMemo, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import { DUMMY_REPORT_SESSIONS } from '../data/dummyData.js';
import { loadLocalAccessApprovals } from '../utils/localAccessApprovalsStorage.js';

const DEFAULT_FILTERS = { from: '', to: '', type: '', search: '', status: '', authorization: '' };
const QUICK_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
];
const LIMIT = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getQuickRange(rangeKey) {
  const now = new Date();
  const end = formatInputDate(now);
  const start = new Date(now);
  if (rangeKey === 'week')  start.setDate(start.getDate() - 6);
  else if (rangeKey === 'month') start.setDate(start.getDate() - 29);
  return { from: formatInputDate(start), to: end };
}

function formatDateTime(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const normalized = raw.endsWith('Z') ? raw.slice(0, -1) : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function toDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.endsWith('Z') ? raw.slice(0, -1) : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDuration(entryTime, exitTime) {
  const start = toDate(entryTime);
  if (!start) return '-';
  const end = exitTime ? toDate(exitTime) : new Date();
  if (!end) return '-';
  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  const days  = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins  = totalMinutes % 60;
  const parts = [];
  if (days > 0)          parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function sanitize(value) {
  if (value == null) return '-';
  const text = String(value).trim();
  return text && text !== '-' ? text : '-';
}

function getAuthorizationBadge(pcode) {
  const value  = String(pcode ?? '').trim();
  const norm   = value.toLowerCase();
  const authorized = norm === 'authorized' ? true : norm === 'unauthorized' ? false : value !== '' && value !== '-';
  return authorized
    ? { label: 'Authorized',   className: 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' }
    : { label: 'Unauthorized', className: 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
}

// ─── Client-side filtering ────────────────────────────────────────────────────

function applyFilters(records, filters) {
  let out = records;

  if (filters.from) {
    out = out.filter(r => r.EntryTime && r.EntryTime >= filters.from);
  }
  if (filters.to) {
    out = out.filter(r => r.EntryTime && r.EntryTime <= filters.to + 'T23:59:59');
  }
  if (filters.type === '2') {
    out = out.filter(r => r.VehicleType === '2-Wheeler');
  } else if (filters.type === '4') {
    out = out.filter(r => r.VehicleType === '4-Wheeler');
  }
  if (filters.status === 'inside') {
    out = out.filter(r => r.Status === 'Still Inside');
  } else if (filters.status === 'exited') {
    out = out.filter(r => r.Status === 'Exited');
  }
  if (filters.authorization) {
    out = out.filter(r => r.Authorization === filters.authorization);
  }
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    out = out.filter(r =>
      String(r.CardData || '').toLowerCase().includes(q) ||
      String(r.PName    || '').toLowerCase().includes(q) ||
      String(r.Addr     || '').toLowerCase().includes(q) ||
      String(r.VehicleType || '').toLowerCase().includes(q)
    );
  }
  return out;
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function csvEsc(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function downloadCSV(records, localApprovals) {
  const headers = ['Card ID', 'Vehicle No.', 'Company Name', 'Authorization', 'Vehicle Type', 'Entry Time', 'Exit Time', 'Duration', 'Status', 'Action'];
  const rows = records.map(r => {
    const isUnauth = r.Authorization === 'Unauthorized';
    const approval = isUnauth ? (localApprovals[r.CardData] || localApprovals[String(r.CardData).toUpperCase()]) : null;
    const action = !isUnauth ? 'N/A' : (approval?.remark ? approval.remark : '—');
    return [
      r.CardData,
      r.PName,
      r.Addr,
      r.Authorization,
      r.VehicleType,
      formatDateTime(r.EntryTime),
      formatDateTime(r.ExitTime),
      formatDuration(r.EntryTime, r.ExitTime),
      r.Status,
      action,
    ];
  });
  const csv = [headers, ...rows].map(row => row.map(csvEsc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `vehicle-report-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function exportPdf(records, localApprovals) {
  const logoUrl = `${window.location.origin}/logo.png`;

  const rowsHtml = records.map(row => {
    const auth = getAuthorizationBadge(row.Authorization ?? row.PCode);
    const isUnauth = auth.label === 'Unauthorized';
    const approval = isUnauth ? (localApprovals[row.CardData] || localApprovals[String(row.CardData).toUpperCase()]) : null;
    const action = !isUnauth ? 'N/A' : (approval?.remark ? approval.remark : '—');
    return `<tr>
      <td>${sanitize(row.CardData)}</td>
      <td>${sanitize(row.PName)}</td>
      <td>${sanitize(row.Addr)}</td>
      <td>${auth.label}</td>
      <td>${sanitize(row.VehicleType)}</td>
      <td>${formatDateTime(row.EntryTime)}</td>
      <td>${formatDateTime(row.ExitTime)}</td>
      <td>${formatDuration(row.EntryTime, row.ExitTime)}</td>
      <td>${sanitize(row.Status)}</td>
      <td>${sanitize(action)}</td>
    </tr>`;
  }).join('');

  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) return;

  win.document.write(`<html><head><title>Vehicle Report</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
      .header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
      .header img { width: 72px; height: 72px; object-fit: contain; }
      h1 { margin: 0 0 4px; font-size: 24px; }
      p { margin: 0; color: #475569; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #e2e8f0; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
      tr:nth-child(even) td { background: #f8fafc; }
      @media print { body { padding: 12px; } }
    </style></head>
    <body>
      <div class="header">
        <img src="${logoUrl}" alt="Logo" />
        <div><h1>Vehicle Report</h1>
        <p>Generated ${new Date().toLocaleString('en-IN')} · ${records.length} sessions</p></div>
      </div>
      <table>
        <thead><tr>
          <th>Card ID</th><th>Vehicle No.</th><th>Company Name</th>
          <th>Authorization</th><th>Type</th><th>Entry Time</th>
          <th>Exit Time</th><th>Duration</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body></html>`);
  win.document.close();

  const img = win.document.querySelector('img');
  const doPrint = () => { win.focus(); win.print(); };
  if (img) {
    img.addEventListener('load',  doPrint, { once: true });
    img.addEventListener('error', doPrint, { once: true });
    if (img.complete) doPrint();
  } else {
    doPrint();
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const isInside = status === 'Still Inside';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
      isInside
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isInside ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      {status}
    </span>
  );
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const start = Math.max(1, page - 2);
  const end   = Math.min(totalPages, page + 2);
  const pages = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page === 1}
        className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30">‹</button>
      {pages.map(p => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={`h-8 w-8 rounded text-sm font-medium ${p === page ? 'bg-sky-500 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
          {p}
        </button>
      ))}
      <button type="button" onClick={() => onChange(page + 1)} disabled={page === totalPages}
        className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30">›</button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportPage({ dark, setDark, onNavigate, onLogout, activePage = 'report' }) {
  const [filters,       setFilters]       = useState(DEFAULT_FILTERS);
  const [page,          setPage]          = useState(1);
  const [quickRange,    setQuickRange]    = useState('');
  const [localApprovals] = useState(() => loadLocalAccessApprovals());

  const filteredAll = useMemo(() => applyFilters(DUMMY_REPORT_SESSIONS, filters), [filters]);

  const total      = filteredAll.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const pageRecords = filteredAll.slice((page - 1) * LIMIT, page * LIMIT);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setQuickRange('');
  }, []);

  const applyQuickRange = useCallback((rangeKey) => {
    const next = quickRange === rangeKey ? '' : rangeKey;
    if (!next) {
      setQuickRange('');
      setFilters(prev => ({ ...prev, from: '', to: '' }));
      setPage(1);
      return;
    }
    setQuickRange(next);
    setFilters(prev => ({ ...prev, ...getQuickRange(next) }));
    setPage(1);
  }, [quickRange]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navbar dark={dark} setDark={setDark} activePage={activePage} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Vehicle Report</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Vehicle sessions with export-ready details
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => downloadCSV(filteredAll, localApprovals)}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-600"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => exportPdf(filteredAll, localApprovals)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V4h12v5M6 18h12v2H6zm0-4h12v-4H6zm2-9h8" />
              </svg>
              Download PDF
            </button>
          </div>
        </div>

        {/* Filter panel */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Filter Report</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_RANGES.map(r => (
              <button key={r.key} type="button" onClick={() => applyQuickRange(r.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${quickRange === r.key
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}>{r.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-500">From</label>
              <input type="date" value={filters.from}
                onChange={e => { setQuickRange(''); setPage(1); setFilters(p => ({ ...p, from: e.target.value })); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-500">To</label>
              <input type="date" value={filters.to}
                onChange={e => { setQuickRange(''); setPage(1); setFilters(p => ({ ...p, to: e.target.value })); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-500">Type</label>
              <select value={filters.type}
                onChange={e => { setPage(1); setFilters(p => ({ ...p, type: e.target.value })); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <option value="">All Types</option>
                <option value="2">2-Wheeler</option>
                <option value="4">4-Wheeler</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-500">Status</label>
              <select value={filters.status}
                onChange={e => { setPage(1); setFilters(p => ({ ...p, status: e.target.value })); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <option value="">All Status</option>
                <option value="inside">Still Inside</option>
                <option value="exited">Exited</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-500">Authorization</label>
              <select value={filters.authorization}
                onChange={e => { setPage(1); setFilters(p => ({ ...p, authorization: e.target.value })); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <option value="">All Types</option>
                <option value="Authorized">Authorized</option>
                <option value="Unauthorized">Unauthorized</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-500">Search</label>
              <input type="text" value={filters.search}
                placeholder="Card, Vehicle No., Company"
                onChange={e => { setPage(1); setFilters(p => ({ ...p, search: e.target.value })); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
            </div>
          </div>
          <div className="mt-3">
            <button type="button" onClick={resetFilters}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              Reset
            </button>
          </div>
        </div>

        {/* Results table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {total.toLocaleString()} sessions
            </p>
            <div className="flex items-center gap-3">
              <p className="text-xs text-slate-400">Page {page} of {totalPages}</p>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/50">
                  {['Card ID', 'Vehicle No.', 'Company Name', 'Authorization', 'Vehicle Type', 'Entry Time', 'Exit Time', 'Duration', 'Status', 'Action'].map(h => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pageRecords.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                      No sessions found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  pageRecords.map((row, idx) => {
                    const auth = getAuthorizationBadge(row.Authorization ?? row.PCode);
                    const isUnauth = auth.label === 'Unauthorized';
                    const approval = isUnauth ? (localApprovals[row.CardData] || localApprovals[String(row.CardData).toUpperCase()]) : null;
                    return (
                      <tr key={`${row.CardData}-${row.EntryTime}-${idx}`}
                        className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-slate-800 dark:text-slate-200">{sanitize(row.CardData)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">{sanitize(row.PName)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">{sanitize(row.Addr)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={auth.className}>{auth.label}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            row.VehicleType === '2-Wheeler' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : row.VehicleType === '4-Wheeler' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          }`}>{sanitize(row.VehicleType)}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">{formatDateTime(row.EntryTime)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">{formatDateTime(row.ExitTime)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-200">{formatDuration(row.EntryTime, row.ExitTime)}</td>
                        <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={row.Status} /></td>
                        <td className="px-4 py-3">
                          {!isUnauth ? (
                            <span className="text-xs text-slate-400">N/A</span>
                          ) : approval?.remark ? (
                            <span className="text-xs text-slate-700 dark:text-slate-200" title={approval.remark}>
                              {approval.remark}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs text-slate-400">
                Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
              </p>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
