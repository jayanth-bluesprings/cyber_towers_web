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

export default function VehicleChart() {
  const [range, setRange] = useState('30'); // days to show

  const { data: statsData } = useQuery({
    queryKey: ['vehicleStats'],
    queryFn: fetchVehicleStats,
    refetchInterval: 60000,
  });

  const { data: typeData } = useQuery({
    queryKey: ['vehicleTypeCount'],
    queryFn: fetchVehicleTypeCount,
    refetchInterval: 60000,
  });

  const stats = statsData?.data || [];
  const types = typeData?.data || {};

  const sliced = stats.slice(-parseInt(range));

  const barData = {
    labels: sliced.map((d) => {
      const date = new Date(d.Day);
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }),
    datasets: [
      {
        label: '2W',
        data: sliced.map((d) => d.TwoWheeler || 0),
        backgroundColor: 'rgba(52, 211, 153, 0.8)',
        borderRadius: 4,
        stack: 'stack',
      },
      {
        label: '4W',
        data: sliced.map((d) => d.FourWheeler || 0),
        backgroundColor: 'rgba(56, 189, 248, 0.8)',
        borderRadius: 4,
        stack: 'stack',
      },
    ],
  };

  const doughnutData = {
    labels: ['2-Wheelers', '4-Wheelers', 'Other'],
    datasets: [
      {
        data: [types.TwoWheeler || 0, types.FourWheeler || 0, types.Other || 0],
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

  const ranges = [
    { label: '7D', value: '7' },
    { label: '14D', value: '14' },
    { label: '30D', value: '30' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Bar chart */}
      <div className="card p-4 lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold text-base">Daily Vehicle Entries</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Stacked by type</p>
          </div>
          <div className="flex gap-1">
            {ranges.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                  range === r.value
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-52">
          {sliced.length > 0 ? (
            <Bar data={barData} options={barOptions} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data available</div>
          )}
        </div>
      </div>

      {/* Doughnut chart */}
      <div className="card p-4">
        <div className="mb-4">
          <h3 className="font-display font-semibold text-base">Vehicle Distribution</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Last 30 days</p>
        </div>
        <div className="h-52">
          {(types.TwoWheeler || types.FourWheeler || types.Other) ? (
            <Doughnut data={doughnutData} options={doughnutOptions} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data available</div>
          )}
        </div>
      </div>
    </div>
  );
}
