import { useQuery } from '@tanstack/react-query';
import { fetchVehicleCount } from '../api/index.js';

function StatCard({ title, value, icon, color, sub }) {
  return (
    <div className={`stat-card border-l-2 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
            {title}
          </p>
          <p className="text-3xl font-display font-bold leading-none">
            {value ?? <span className="text-slate-300 dark:text-slate-700 text-xl">—</span>}
          </p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 flex items-center justify-center rounded-lg opacity-80 ${color.replace('border-', 'bg-').replace('-500', '-100')} dark:opacity-20`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function StatsCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['vehicleCount'],
    queryFn: fetchVehicleCount,
    refetchInterval: 30000,
  });

  const stats = data?.data;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <StatCard
        title="Today"
        value={isLoading ? null : stats?.day?.toLocaleString()}
        color="border-sky-500"
        sub="vehicles scanned"
        icon={
          <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
      <StatCard
        title="This Week"
        value={isLoading ? null : stats?.week?.toLocaleString()}
        color="border-violet-500"
        sub="last 7 days"
        icon={
          <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        }
      />
      <StatCard
        title="This Month"
        value={isLoading ? null : stats?.month?.toLocaleString()}
        color="border-teal-500"
        sub="last 30 days"
        icon={
          <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        }
      />
      <StatCard
        title="2-Wheelers"
        value={isLoading ? null : stats?.twoWheeler?.toLocaleString()}
        color="border-emerald-500"
        sub="bikes & scooters"
        icon={
          <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        }
      />
      <StatCard
        title="4-Wheelers"
        value={isLoading ? null : stats?.fourWheeler?.toLocaleString()}
        color="border-orange-500"
        sub="cars & SUVs"
        icon={
          <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
          </svg>
        }
      />
    </div>
  );
}
