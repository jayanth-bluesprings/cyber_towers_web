import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { fetchVehicleStats, fetchVehicleTypeCount } from '../api/index.js';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
);

export default function VehicleChart({ period }) {
  const [filters, setFilters] = useState({
    entry: false,
    exit: false,
    '2w': false,
    '4w': false,
  });

  const { data: statsData } = useQuery({
    queryKey: ['vehicleStats', period],
    queryFn: () => fetchVehicleStats(period),
    refetchInterval: 1000,
  });

  const { data: typeData } = useQuery({
    queryKey: ['vehicleTypeCount'],
    queryFn: fetchVehicleTypeCount,
    refetchInterval: 1000,
  });

  const stats = statsData?.data || [];
  const types = typeData?.data || {};

  const selectedTypes = ['2w', '4w'].filter((key) => filters[key]);
  const selectedDirections = ['entry', 'exit'].filter((key) => filters[key]);
  const showAll = selectedTypes.length === 0 && selectedDirections.length === 0;

  function sumValues(bucket, typeKey, directionKey) {
    if (typeKey === '2w' && directionKey === 'entry') return bucket.TwoWheelerEntry || 0;
    if (typeKey === '2w' && directionKey === 'exit') return bucket.TwoWheelerExit || 0;
    if (typeKey === '4w' && directionKey === 'entry') return bucket.FourWheelerEntry || 0;
    if (typeKey === '4w' && directionKey === 'exit') return bucket.FourWheelerExit || 0;
    if (!typeKey && directionKey === 'entry') return bucket.Entry || 0;
    if (!typeKey && directionKey === 'exit') return bucket.Exit || 0;
    return 0;
  }

  function buildDatasets() {
    if (showAll) {
      return [
        {
          label: 'Entry',
          data: stats.map((bucket) => bucket.Entry || 0),
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderRadius: 4,
          stack: 'stack',
        },
        {
          label: 'Exit',
          data: stats.map((bucket) => bucket.Exit || 0),
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderRadius: 4,
          stack: 'stack',
        },
      ];
    }

    const typesToUse = selectedTypes.length > 0 ? selectedTypes : [null];
    const directionsToUse = selectedDirections.length > 0 ? selectedDirections : ['entry', 'exit'];
    const palette = {
      'entry-all': 'rgba(34, 197, 94, 0.8)',
      'exit-all': 'rgba(239, 68, 68, 0.8)',
      'entry-2w': 'rgba(16, 185, 129, 0.8)',
      'exit-2w': 'rgba(245, 158, 11, 0.8)',
      'entry-4w': 'rgba(14, 165, 233, 0.8)',
      'exit-4w': 'rgba(244, 63, 94, 0.8)',
    };

    const datasets = [];
    for (const typeKey of typesToUse) {
      for (const directionKey of directionsToUse) {
        const key = `${directionKey}-${typeKey || 'all'}`;
        const labelParts = [];
        if (typeKey) labelParts.push(typeKey.toUpperCase());
        labelParts.push(directionKey === 'entry' ? 'Entry' : 'Exit');
        datasets.push({
          label: labelParts.join(' '),
          data: stats.map((bucket) => sumValues(bucket, typeKey, directionKey)),
          backgroundColor: palette[key],
          borderRadius: 4,
          stack: 'stack',
        });
      }
    }

    return datasets;
  }

  function getSubtitle() {
    const periodLabel = period === 'day'
      ? 'Today by hour'
      : period === 'week'
        ? 'Last 7 days'
        : 'Last 30 days';

    if (showAll) return `${periodLabel}, all entry and exit scans`;

    const typeLabel = selectedTypes.length > 0 ? selectedTypes.map((key) => key.toUpperCase()).join(' + ') : 'All';
    const directionLabel = selectedDirections.length > 0
      ? selectedDirections.map((key) => (key === 'entry' ? 'Entry' : 'Exit')).join(' + ')
      : 'Entry + Exit';
    return `${periodLabel}, ${typeLabel} ${directionLabel}`;
  }

  function handleFilterClick(key) {
    setFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  const barData = {
    labels: stats.map((bucket) => (
      period === 'day'
        ? `${String(bucket.Hour).padStart(2, '0')}:00`
        : new Date(`${bucket.Day}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    )),
    datasets: buildDatasets(),
  };

  const doughnutData = {
    labels: ['2-Wheelers', '4-Wheelers', 'Other'],
    datasets: [
      {
        data: [types.twoWheeler || 0, types.fourWheeler || 0, Math.max(0, (types.total || 0) - (types.twoWheeler || 0) - (types.fourWheeler || 0))],
        backgroundColor: ['rgba(52, 211, 153, 0.85)', 'rgba(56, 189, 248, 0.85)', 'rgba(148, 163, 184, 0.6)'],
        borderColor: ['rgba(52, 211, 153, 1)', 'rgba(56, 189, 248, 1)', 'rgba(148, 163, 184, 1)'],
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Rajdhani', size: 12 } } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 } } },
      y: { stacked: true, grid: { color: 'rgba(148, 163, 184, 0.15)' }, ticks: { font: { family: 'JetBrains Mono', size: 10 } } },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Rajdhani', size: 12 } } },
    },
    cutout: '68%',
  };

  const filterButtons = [
    { label: 'Entry', value: 'entry' },
    { label: 'Exit', value: 'exit' },
    { label: '2W', value: '2w' },
    { label: '4W', value: '4w' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="card p-4 lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold text-base">Movement Graph</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{getSubtitle()}</p>
          </div>
          <div className="flex gap-1 flex-wrap justify-end">
            {filterButtons.map((item) => (
              <button
                key={item.value}
                onClick={() => handleFilterClick(item.value)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                  filters[item.value]
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-52">
          {stats.length > 0 ? (
            <Bar data={barData} options={barOptions} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data available</div>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-4">
          <h3 className="font-display font-semibold text-base">Vehicle Distribution</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">By remark type</p>
        </div>
        <div className="h-52">
          {(types.twoWheeler || types.fourWheeler || types.total) ? (
            <Doughnut data={doughnutData} options={doughnutOptions} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data available</div>
          )}
        </div>
      </div>
    </div>
  );
}
