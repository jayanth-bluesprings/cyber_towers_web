import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import { fetchAuthorizedVehicles } from '../api/index.js';

function normalize(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text === '-' || text === '0') return '';
  return text;
}

function typeLabel(value) {
  if (value === '2W') return '2W';
  if (value === '4W') return '4W';
  return 'Unknown';
}

function typeBadgeClass(value) {
  if (value === '2W') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  }

  if (value === '4W') {
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
  }

  return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

export default function AuthorizedVehiclesPage({ dark, setDark, onNavigate, onLogout, activePage = 'authorized' }) {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['authorizedVehicles'],
    queryFn: fetchAuthorizedVehicles,
  });

  const vehicles = data?.data ?? [];

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return vehicles;
    }

    return vehicles.filter((vehicle) =>
      [
        vehicle.CardData,
        vehicle.PName,
        vehicle.CarNumber,
        vehicle.flatNumber || vehicle.Addr,
        vehicle.vehicleType,
      ]
        .map((value) => normalize(value).toLowerCase())
        .some((value) => value.includes(term))
    );
  }, [search, vehicles]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar
        dark={dark}
        setDark={setDark}
        activePage={activePage}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-white">
              Authorized Vehicles
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Latest authorized vehicle records from the access database
            </p>
          </div>

          <div className="w-full sm:w-80">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search card, name, vehicle no., flat, type"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Total</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {isLoading ? '...' : vehicles.length.toLocaleString()}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">2W</p>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-300">
              {isLoading ? '...' : vehicles.filter((vehicle) => vehicle.vehicleType === '2W').length.toLocaleString()}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">4W</p>
            <p className="text-3xl font-bold text-orange-600 dark:text-orange-300">
              {isLoading ? '...' : vehicles.filter((vehicle) => vehicle.vehicleType === '4W').length.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {isLoading ? 'Loading vehicles...' : `${filteredVehicles.length.toLocaleString()} vehicles`}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
                  {['Card ID', 'Name', 'Vehicle Number', 'Flat', 'Type'].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, rowIndex) => (
                    <tr key={rowIndex}>
                      {Array.from({ length: 5 }).map((_, colIndex) => (
                        <td key={colIndex} className="px-4 py-3">
                          <div className="h-4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-red-500 dark:text-red-400">
                      Unable to load authorized vehicles.
                    </td>
                  </tr>
                ) : filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                      No authorized vehicles match the current search.
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.CardData} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {normalize(vehicle.CardData) || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {normalize(vehicle.PName) || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {normalize(vehicle.CarNumber) || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {normalize(vehicle.flatNumber || vehicle.Addr) || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${typeBadgeClass(vehicle.vehicleType)}`}>
                          {typeLabel(vehicle.vehicleType)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
