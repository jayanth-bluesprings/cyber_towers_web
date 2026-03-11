import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVehicleCount } from '../api/index.js';

// ── Period toggle ─────────────────────────────────────────────────────────────

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

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ title, value, icon, color, sub, breakdown }) {
  const bgColor = color
    .replace('border-', 'bg-')
    .replace('-500', '-100');

  return (
    <div className={`stat-card border-l-2 ${color}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
            {title}
          </p>
          <p className="text-3xl font-display font-bold leading-none">
            {value !== null && value !== undefined
              ? value
              : <span className="text-slate-300 dark:text-slate-700 text-xl">—</span>
            }
          </p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          {breakdown && breakdown.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {breakdown.map((b) => (
                <span
                  key={b.label}
                  className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${b.chip}`}
                >
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
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

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

const PERIOD_SUB = {
  day: 'today',
  week: 'last 7 days',
  month: 'last 30 days',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsCards() {
  const [period, setPeriod] = useState('day');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['vehicleCount'],
    queryFn: fetchVehicleCount,
    refetchInterval: 30000,
  });

  // ── Debug: log raw API response to console ──
  if (data) {
    console.log('[StatsCards] raw API data:', data);
  }

  // Guard: handle both old flat shape and new nested shape gracefully
  const rawStats = data?.data;
  let p = null;

  if (rawStats) {
    if (rawStats[period] && typeof rawStats[period] === 'object') {
      // New nested shape: { day: { total, twoWheeler, ... }, week: {...}, month: {...} }
      p = rawStats[period];
    } else if (rawStats.day !== undefined && typeof rawStats.day !== 'object') {
      // Old flat shape: { day: 5, week: 20, month: 100, twoWheeler: 3, fourWheeler: 2 }
      // Map it to the selected period as best we can
      const total = period === 'day' ? rawStats.day : period === 'week' ? rawStats.week : rawStats.month;
      p = {
        total,
        twoWheeler: rawStats.twoWheeler ?? 0,
        fourWheeler: rawStats.fourWheeler ?? 0,
        entry: rawStats.todayEntry ?? 0,
        exit: rawStats.todayExit ?? 0,
      };
    }
  }

  const fmt = (v) => {
    if (isLoading) return null;
    if (v === null || v === undefined) return '0';
    return Number(v).toLocaleString();
  };

  const sub = PERIOD_SUB[period];

  // ── Error state ──
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
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">

        {/* Total vehicles */}
        <StatCard
          title="Vehicles"
          value={fmt(p?.total)}
          color="border-sky-500"
          sub={`scanned ${sub}`}
          icon={ClockIcon}
          breakdown={[
            {
              label: 'In',
              value: fmt(p?.entry),
              chip: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
            },
            {
              label: 'Out',
              value: fmt(p?.exit),
              chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
            },
          ]}
        />

        {/* Entry / Exit — single split card (left = entry, right = exit) */}
        <div className="stat-card !p-0 overflow-hidden flex flex-row">
          <div className="flex-1 border-t-2 border-green-500 p-3 flex flex-col justify-between min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Entry</p>
            <p className="text-2xl font-display font-bold leading-none">
              {fmt(p?.entry) ?? <span className="text-slate-300 dark:text-slate-700 text-xl">—</span>}
            </p>
            <p className="text-xs text-slate-400">in {sub}</p>
          </div>
          <div className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
          <div className="flex-1 border-t-2 border-red-500 p-3 flex flex-col justify-between min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Exit</p>
            <p className="text-2xl font-display font-bold leading-none">
              {fmt(p?.exit) ?? <span className="text-slate-300 dark:text-slate-700 text-xl">—</span>}
            </p>
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
          breakdown={
            p?.total
              ? [{
                label: 'of total',
                value: `${Math.round(((p.twoWheeler ?? 0) / p.total) * 100)}%`,
                chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
              }]
              : []
          }
        />

        {/* 4-Wheelers */}
        <StatCard
          title="4-Wheelers"
          value={fmt(p?.fourWheeler)}
          color="border-orange-500"
          sub={`cars & SUVs ${sub}`}
          icon={CarIcon}
          breakdown={
            p?.total
              ? [{
                label: 'of total',
                value: `${Math.round(((p.fourWheeler ?? 0) / p.total) * 100)}%`,
                chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
              }]
              : []
          }
        />

      </div>

      {/* Debug panel — remove after confirming data is correct */}
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

    </div>
  );
}