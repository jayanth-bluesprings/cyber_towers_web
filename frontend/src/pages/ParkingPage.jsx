import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import { fetchAuthorizedVehicles } from '../api/index.js';
import { loadParkingAllocations, saveParkingAllocations } from '../utils/parkingStorage.js';

function normalize(value) {
  if (value == null) return '';
  return String(value).trim();
}

function vehicleLabel(vehicle) {
  const card = normalize(vehicle.CardData) || '-';
  const vehicleNo = normalize(vehicle.PName) || '-';
  const company = normalize(vehicle.flatNumber || vehicle.Addr) || '-';
  return `${card} | ${vehicleNo} | ${company}`;
}

export default function ParkingPage({ dark, setDark, onNavigate, onLogout, activePage = 'parking' }) {
  const BIKE_CAPACITY = 1000;
  const CAR_CAPACITY = 500;
  const [allocations, setAllocations] = useState(() => loadParkingAllocations());
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [parkingSpace, setParkingSpace] = useState('');
  const [remark, setRemark] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['authorizedVehicles'],
    queryFn: fetchAuthorizedVehicles,
  });

  const vehicles = data?.data ?? [];

  useEffect(() => {
    saveParkingAllocations(allocations);
  }, [allocations]);

  const filteredVehicles = useMemo(() => {
    const term = normalize(vehicleSearch).toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter((vehicle) => {
      const fields = [
        vehicle.CardData,
        vehicle.PName,
        vehicle.flatNumber || vehicle.Addr,
        vehicle.CarNumber,
      ].map((value) => normalize(value).toLowerCase());
      return fields.some((value) => value.includes(term));
    });
  }, [vehicles, vehicleSearch]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => normalize(vehicle.CardData) === selectedCardId),
    [vehicles, selectedCardId]
  );

  const typeByCardId = useMemo(() => {
    const map = new Map();
    for (const vehicle of vehicles) {
      const cardId = normalize(vehicle.CardData).toUpperCase();
      if (!cardId) continue;
      const type = normalize(vehicle.vehicleType).toUpperCase();
      map.set(cardId, type);
    }
    return map;
  }, [vehicles]);

  const parkingStats = useMemo(() => {
    let allotted2W = 0;
    let allotted4W = 0;

    for (const item of allocations) {
      const cardId = normalize(item.cardId).toUpperCase();
      const directType = normalize(item.vehicleType).toUpperCase();
      const inferredType = directType || typeByCardId.get(cardId) || '';
      if (inferredType.startsWith('2')) allotted2W += 1;
      else if (inferredType.startsWith('4')) allotted4W += 1;
    }

    const bikeVacancy = Math.max(0, BIKE_CAPACITY - allotted2W);
    const carVacancy = Math.max(0, CAR_CAPACITY - allotted4W);

    return {
      allotted2W,
      allotted4W,
      bikeVacancy,
      carVacancy,
    };
  }, [allocations, typeByCardId]);

  function resetForm() {
    setSelectedCardId('');
    setParkingSpace('');
    setRemark('');
  }

  function handleAllot(event) {
    event.preventDefault();
    if (!selectedVehicle) return;

    const slot = normalize(parkingSpace).toUpperCase();
    if (!slot) return;

    const cardId = normalize(selectedVehicle.CardData);
    const existingBySlot = allocations.find(
      (item) => normalize(item.parkingSpace).toUpperCase() === slot && normalize(item.cardId) !== cardId
    );
    if (existingBySlot) {
      alert(`Parking space ${slot} is already allotted to card ${existingBySlot.cardId}.`);
      return;
    }

    const next = allocations.filter(
      (item) => normalize(item.cardId) !== cardId
    );

    next.unshift({
      cardId,
      vehicleNo: normalize(selectedVehicle.PName) || '-',
      companyName: normalize(selectedVehicle.flatNumber || selectedVehicle.Addr) || '-',
      vehicleType: normalize(selectedVehicle.vehicleType) || '-',
      parkingSpace: slot,
      remark: normalize(remark),
      allottedAt: new Date().toISOString(),
    });

    setAllocations(next);
    resetForm();
  }

  function removeAllocation(cardId) {
    setAllocations((prev) => prev.filter((item) => normalize(item.cardId) !== normalize(cardId)));
  }

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
        <div>
          <h2 className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-white">
            Parking Allotment
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Allot parking space to vehicles and keep it saved in local storage.
          </p>
        </div>

        <form onSubmit={handleAllot} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="text-xs font-bold text-slate-500">Search Vehicle</label>
              <input
                type="text"
                value={vehicleSearch}
                onChange={(e) => setVehicleSearch(e.target.value)}
                placeholder="Card ID, Vehicle No., Company"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500">Parking Space</label>
              <input
                type="text"
                value={parkingSpace}
                onChange={(e) => setParkingSpace(e.target.value)}
                placeholder="P1-A12"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm uppercase"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500">Remark</label>
              <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Reserved / Visitor"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">Select Vehicle</label>
            <select
              value={selectedCardId}
              onChange={(e) => setSelectedCardId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              required
            >
              <option value="">Choose vehicle</option>
              {filteredVehicles.map((vehicle) => (
                <option key={vehicle.CardData} value={normalize(vehicle.CardData)}>
                  {vehicleLabel(vehicle)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isLoading || isError}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Allot Parking
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Reset
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">2W Allotted</p>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-300">
              {parkingStats.allotted2W.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">2W Vacancy</p>
            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-200">
              {parkingStats.bikeVacancy.toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 mt-1">Capacity: {BIKE_CAPACITY}</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">4W Allotted</p>
            <p className="text-3xl font-bold text-orange-600 dark:text-orange-300">
              {parkingStats.allotted4W.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">4W Vacancy</p>
            <p className="text-3xl font-bold text-orange-700 dark:text-orange-200">
              {parkingStats.carVacancy.toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 mt-1">Capacity: {CAR_CAPACITY}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Current Allotments ({allocations.length})
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
                  {['Card ID', 'Vehicle Number', 'Company Name', 'Parking Space', 'Remark', 'Allotted At', 'Action'].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allocations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      No parking spaces allotted yet.
                    </td>
                  </tr>
                ) : (
                  allocations.map((item) => (
                    <tr key={item.cardId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">{item.cardId}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">{item.vehicleNo || '-'}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">{item.companyName || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex rounded-md px-2 py-1 text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                          {item.parkingSpace || 'No Slot Assigned'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{item.remark || '-'}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {item.allottedAt ? new Date(item.allottedAt).toLocaleString('en-IN') : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => removeAllocation(item.cardId)}
                          className="rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-2.5 py-1 text-xs font-semibold"
                        >
                          Remove
                        </button>
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
