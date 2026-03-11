import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';

const API = '/api';

async function fetchSummary() {
    const res = await fetch(`${API}/report/summary`);
    return res.json();
}

async function fetchRecords(params) {
    const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
    ).toString();
    const res = await fetch(`${API}/report/records?${qs}`);
    return res.json();
}

function buildDownloadUrl(filters) {
    const params = { ...filters, download: '1', page: undefined, limit: undefined };
    const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
    ).toString();
    return `${API}/report/records?${qs}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtIST(iso) {
    if (!iso) return '—';
    const s = String(iso);
    const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + '+05:30');
    return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: 'Asia/Calcutta',
    });
}

function fmt(v) {
    return v != null ? Number(v).toLocaleString() : '—';
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }) {
    const colors = {
        sky: 'border-sky-500     bg-sky-50     text-sky-700     dark:bg-sky-900/20     dark:text-sky-300',
        emerald: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
        orange: 'border-orange-500  bg-orange-50  text-orange-700  dark:bg-orange-900/20  dark:text-orange-300',
        green: 'border-green-500   bg-green-50   text-green-700   dark:bg-green-900/20   dark:text-green-300',
        red: 'border-red-500     bg-red-50     text-red-700     dark:bg-red-900/20     dark:text-red-300',
        violet: 'border-violet-500  bg-violet-50  text-violet-700  dark:bg-violet-900/20  dark:text-violet-300',
        amber: 'border-amber-500   bg-amber-50   text-amber-700   dark:bg-amber-900/20   dark:text-amber-300',
    };
    return (
        <div className={`rounded-xl border-l-4 p-4 ${colors[accent]}`}>
            <p className="text-xs font-semibold uppercase tracking-widest opacity-60 mb-1">{label}</p>
            <p className="text-3xl font-bold leading-none">{value ?? '—'}</p>
            {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
        </div>
    );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
    if (status === 'Still Inside') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Still Inside
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Exited
        </span>
    );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onChange }) {
    if (totalPages <= 1) return null;
    const pages = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return (
        <div className="flex items-center gap-1">
            <button onClick={() => onChange(page - 1)} disabled={page === 1}
                className="px-2 py-1 rounded text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
            {start > 1 && <span className="px-1 text-slate-400 text-sm">…</span>}
            {pages.map(p => (
                <button key={p} onClick={() => onChange(p)}
                    className={`w-8 h-8 rounded text-sm font-medium transition-colors ${p === page ? 'bg-sky-500 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                    {p}
                </button>
            ))}
            {end < totalPages && <span className="px-1 text-slate-400 text-sm">…</span>}
            <button onClick={() => onChange(page + 1)} disabled={page === totalPages}
                className="px-2 py-1 rounded text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">›</button>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = { from: '', to: '', type: '', search: '', status: '' };

export default function ReportPage({ dark, setDark, onNavigate }) {
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [applied, setApplied] = useState(DEFAULT_FILTERS);
    const [page, setPage] = useState(1);
    const limit = 50;

    const { data: summaryData, isLoading: summaryLoading } = useQuery({
        queryKey: ['reportSummary'],
        queryFn: fetchSummary,
    });

    const { data: recordsData, isLoading: recordsLoading } = useQuery({
        queryKey: ['reportRecords', applied, page, limit],
        queryFn: () => fetchRecords({ ...applied, page, limit }),
        keepPreviousData: true,
    });

    const summary = summaryData?.data;
    const records = recordsData?.data;

    const applyFilters = useCallback(() => { setApplied({ ...filters }); setPage(1); }, [filters]);
    const resetFilters = useCallback(() => { setFilters(DEFAULT_FILTERS); setApplied(DEFAULT_FILTERS); setPage(1); }, []);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <Navbar dark={dark} setDark={setDark} activePage="report" onNavigate={onNavigate} />

            <div className="max-w-screen-2xl mx-auto space-y-6 p-4 sm:p-6">

                {/* ── Page header ── */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Vehicle Report</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Entry / exit sessions · CSV export</p>
                    </div>
                    <a href={buildDownloadUrl(applied)} download
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors shadow-sm">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download CSV
                    </a>
                </div>

                {/* ── Summary cards ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <SummaryCard label="Total Vehicles" value={summaryLoading ? '…' : fmt(summary?.totalVehicles)} accent="sky" sub="in database" />
                    <SummaryCard label="2-Wheelers" value={summaryLoading ? '…' : fmt(summary?.twoWheeler)} accent="emerald" sub="bikes & scooters" />
                    <SummaryCard label="4-Wheelers" value={summaryLoading ? '…' : fmt(summary?.fourWheeler)} accent="orange" sub="cars & SUVs" />
                    <SummaryCard label="Still Inside" value={summaryLoading ? '…' : fmt(summary?.stillInside)} accent="amber" sub="currently inside" />
                </div>

                {/* ── Filters ── */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Filter Sessions</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-500">From</label>
                            <input type="date" value={filters.from}
                                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                                className="input-field text-sm" />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-500">To</label>
                            <input type="date" value={filters.to}
                                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
                                className="input-field text-sm" />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-500">Vehicle Type</label>
                            <select value={filters.type}
                                onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
                                className="input-field text-sm">
                                <option value="">All Types</option>
                                <option value="2">2-Wheeler</option>
                                <option value="4">4-Wheeler</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-500">Status</label>
                            <select value={filters.status}
                                onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                                className="input-field text-sm">
                                <option value="">All</option>
                                <option value="inside">Still Inside</option>
                                <option value="exited">Exited</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-500">Card / ID</label>
                            <input type="text" placeholder="Search…" value={filters.search}
                                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                                className="input-field text-sm" />
                        </div>

                        <div className="flex flex-col gap-1 justify-end">
                            <div className="flex gap-2">
                                <button onClick={applyFilters}
                                    className="flex-1 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors">
                                    Apply
                                </button>
                                <button onClick={resetFilters}
                                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                                    Reset
                                </button>
                            </div>
                        </div>

                    </div>
                </div>

                {/* ── Table ── */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">

                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {recordsLoading ? 'Loading…' : `${fmt(records?.total)} sessions`}
                        </p>
                        <div className="flex items-center gap-3">
                            {records && <p className="text-xs text-slate-400">Page {records.page} of {records.totalPages}</p>}
                            <Pagination page={page} totalPages={records?.totalPages ?? 1} onChange={setPage} />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                                    {['Card', 'Type', 'Entry Time', 'Entry Gate', 'Exit Time', 'Exit Gate', 'Status'].map(h => (
                                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {recordsLoading ? (
                                    Array.from({ length: 8 }).map((_, i) => (
                                        <tr key={i}>
                                            {Array.from({ length: 7 }).map((_, j) => (
                                                <td key={j} className="px-4 py-3">
                                                    <div className="h-4 rounded bg-slate-100 dark:bg-slate-700 animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} />
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                ) : records?.records?.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">
                                            No sessions found for the selected filters.
                                        </td>
                                    </tr>
                                ) : (
                                    records?.records?.map((row, i) => (
                                        <tr key={`${row.CardData}-${row.EntryTime}-${i}`}
                                            className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30 ${row.Status === 'Still Inside' ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}>

                                            <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                                {row.CardData}
                                            </td>

                                            <td className="px-4 py-3">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${row.VehicleType === '2-Wheeler'
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                        : row.VehicleType === '4-Wheeler'
                                                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                                                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                                    }`}>
                                                    {row.VehicleType}
                                                </span>
                                            </td>

                                            <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                {fmtIST(row.EntryTime)}
                                            </td>

                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                {row.EntryGate || '—'}
                                            </td>

                                            <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                {row.ExitTime ? fmtIST(row.ExitTime) : (
                                                    <span className="text-amber-500 dark:text-amber-400 font-medium">Still Inside</span>
                                                )}
                                            </td>

                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                {row.ExitTime ? (row.ExitGate || '—') : '—'}
                                            </td>

                                            <td className="px-4 py-3">
                                                <StatusBadge status={row.Status} />
                                            </td>

                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {records && records.totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700">
                            <p className="text-xs text-slate-400">
                                Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, records.total)} of {fmt(records.total)}
                            </p>
                            <Pagination page={page} totalPages={records.totalPages} onChange={setPage} />
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}