import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVehicleCount, fetchVehicleOccupancy } from '../api/index.js';

const PERIODS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

function PeriodToggle({ value, onChange }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 gap-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`px-3 py-1 text-xs font-semibold rounded-md transition-all duration-150 ${value === p.key
            ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ title, value, icon, color, sub, breakdown, onClick }) {
  const bgColor = color.replace('border-', 'bg-').replace('-500', '-100');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`stat-card border-l-2 text-left ${color} ${onClick ? 'hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
            {title}
          </p>
          <p className="text-3xl font-display font-bold leading-none">
            {value !== null && value !== undefined
              ? value
              : <span className="text-slate-300 dark:text-slate-700 text-xl">—</span>}
          </p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          {breakdown && breakdown.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {breakdown.map((b) => (
                <span key={b.label} className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${b.chip}`}>
                  {b.label}
                  <span className="font-bold">{b.value ?? '—'}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg opacity-80 ${bgColor} dark:opacity-20`}>
          {icon}
        </div>
      </div>
    </button>
  );
}

const ClockIcon = (
  <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const BikeIcon = (
  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);
const CarIcon = (
  <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
  </svg>
);
const InsideIcon = (
  <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12l7-7 7 7M9 21V9h6v12" />
  </svg>
);
const OutsideIcon = (
  <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H3m0 0l4-4m-4 4l4 4M9 5h8a2 2 0 012 2v10a2 2 0 01-2 2H9" />
  </svg>
);

const PERIOD_SUB = {
  day: 'today',
  week: 'last 7 days',
  month: 'last 30 days',
};

function formatTime(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const normalized = raw.endsWith('Z') ? raw.slice(0, -1) : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function toLocalDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.endsWith('Z') ? raw.slice(0, -1) : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDuration(startValue, endValue = null) {
  const start = toLocalDate(startValue);
  if (!start) return '-';
  const end = endValue ? toLocalDate(endValue) : new Date();
  if (!end) return '-';
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function OccupancyModal({ status, records, onClose, isLoading }) {
  if (!status) return null;

  const title = status === 'inside' ? 'Vehicles Still Inside' : 'Vehicles Outside';
  const headers = status === 'inside'
    ? ['Card', 'Name', 'Type', 'Inside Since', 'Duration']
    : ['Card', 'Name', 'Type', 'Entry Time', 'Outside For'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-4">
          <div>
            <h3 className="font-display text-xl font-bold">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Latest vehicle status by tag
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="overflow-auto max-h-[calc(85vh-80px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950">
              <tr className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {headers.map((head) => (
                  <th key={head} className="px-4 py-3 text-left whitespace-nowrap">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: headers.length }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-4 py-10 text-center text-slate-400">
                    No vehicles found.
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={`${record.CardData}-${record.EntryTime}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs">{record.CardData}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{record.PName && record.PName !== '-' ? record.PName : '-'}</td>
                    <td className="px-4 py-3">{record.VehicleType}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatTime(record.EntryTime)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {status === 'inside'
                        ? formatDuration(record.EntryTime)
                        : formatDuration(record.ExitTime)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function StatsCards({ period, setPeriod }) {
  const [occupancyStatus, setOccupancyStatus] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['vehicleCount'],
    queryFn: fetchVehicleCount,
    refetchInterval: 1000,
  });

  const { data: occupancyData, isLoading: occupancySummaryLoading } = useQuery({
    queryKey: ['vehicleOccupancySummary'],
    queryFn: () => fetchVehicleOccupancy(),
    refetchInterval: 1000,
  });

  const { data: occupancyListData, isLoading: occupancyLoading } = useQuery({
    queryKey: ['vehicleOccupancyList', occupancyStatus],
    queryFn: () => fetchVehicleOccupancy(occupancyStatus),
    enabled: !!occupancyStatus,
    refetchInterval: occupancyStatus ? 1000 : false,
  });

  const rawStats = data?.data;
  const p = rawStats?.[period] ?? null;
  const occupancy = occupancyData?.data;
  const occupancyRecords = occupancyListData?.data?.records ?? [];

  const fmt = (v, loading = isLoading) => {
    if (loading) return null;
    if (v === null || v === undefined) return '0';
    return Number(v).toLocaleString();
  };

  const pct = (part, total) =>
    total ? `${Math.round(((part ?? 0) / total) * 100)}%` : '0%';

  const sub = PERIOD_SUB[period];

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-sm text-red-600 dark:text-red-400">
        <strong>Failed to load stats:</strong> {error?.message ?? 'Unknown error'}
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* Header row with toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Stats for</p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">

        {/* Total */}
        <StatCard
          title="Vehicles"
          value={fmt(p?.total)}
          color="border-sky-500"
          sub={`scanned ${sub}`}
          icon={ClockIcon}
          breakdown={[
            { label: 'In',  value: fmt(p?.entry), chip: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
            { label: 'Out', value: fmt(p?.exit),  chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
          ]}
        />

        {/* Entry / Exit split */}
        <div className="stat-card !p-0 overflow-hidden flex flex-row">
          <div className="flex-1 border-t-2 border-green-500 p-3 flex flex-col justify-between min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Entry</p>
            <p className="text-2xl font-display font-bold leading-none">{fmt(p?.entry)}</p>
            <p className="text-xs text-slate-400">in {sub}</p>
          </div>
          <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
          <div className="flex-1 border-t-2 border-red-500 p-3 flex flex-col justify-between min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Exit</p>
            <p className="text-2xl font-display font-bold leading-none">{fmt(p?.exit)}</p>
            <p className="text-xs text-slate-400">out {sub}</p>
          </div>
        </div>

        {/* 2-Wheelers */}
        <StatCard
          title="2-Wheelers"
          value={fmt(p?.twoWheeler)}
          color="border-emerald-500"
          sub={`bikes & scooters ${sub}`}
          icon={BikeIcon}
          breakdown={[
            { label: 'In', value: fmt(p?.twoWheelerEntry), chip: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
            { label: 'Out', value: fmt(p?.twoWheelerExit), chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
            ...(p?.total ? [{ label: 'of total', value: pct(p.twoWheeler, p.total), chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }] : []),
          ]}
        />

        {/* 4-Wheelers */}
        <StatCard
          title="4-Wheelers"
          value={fmt(p?.fourWheeler)}
          color="border-orange-500"
          sub={`cars & SUVs ${sub}`}
          icon={CarIcon}
          breakdown={[
            { label: 'In', value: fmt(p?.fourWheelerEntry), chip: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
            { label: 'Out', value: fmt(p?.fourWheelerExit), chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
            ...(p?.total ? [{ label: 'of total', value: pct(p.fourWheeler, p.total), chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }] : []),
          ]}
        />

        <StatCard
          title="Still Inside"
          value={fmt(occupancy?.insideCount, occupancySummaryLoading)}
          color="border-violet-500"
          sub="tap to view inside vehicles"
          icon={InsideIcon}
          onClick={() => setOccupancyStatus('inside')}
        />

        <StatCard
          title="Outside"
          value={fmt(occupancy?.outsideCount, occupancySummaryLoading)}
          color="border-cyan-500"
          sub="tap to view outside vehicles"
          icon={OutsideIcon}
          onClick={() => setOccupancyStatus('outside')}
        />

      </div>

      {/* Debug panel */}
      {import.meta.env.DEV && rawStats && (
        <details className="mt-2">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
            🔍 Raw API response (dev only)
          </summary>
          <pre className="mt-1 text-xs bg-slate-100 dark:bg-slate-800 rounded p-3 overflow-auto max-h-48 text-slate-600 dark:text-slate-300">
            {JSON.stringify(rawStats, null, 2)}
          </pre>
        </details>
      )}

      <OccupancyModal
        status={occupancyStatus}
        records={occupancyRecords}
        isLoading={occupancyLoading}
        onClose={() => setOccupancyStatus('')}
      />

    </div>
  );
}
