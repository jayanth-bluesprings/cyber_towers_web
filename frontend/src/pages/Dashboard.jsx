import { useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import StatsCards from '../components/StatsCards.jsx';
import VehicleChart from '../components/VehicleChart.jsx';
import LiveTable from '../components/LiveTable.jsx';

export default function Dashboard({ dark, setDark, onNavigate }) {
  const [wsStatus, setWsStatus] = useState('connecting');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar
        dark={dark}
        setDark={setDark}
        wsStatus={wsStatus}
        activePage="dashboard"      // ← add this
        onNavigate={onNavigate}     // ← add this
      />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 flex flex-col gap-5">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-xl tracking-tight">
              Access Overview
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Real-time vehicle access monitoring · TimeWatch database
            </p>
          </div>
          <div className="text-xs font-mono text-slate-400 dark:text-slate-500 hidden sm:block">
            Auto-refresh · 3s WebSocket
          </div>
        </div>

        {/* Stats */}
        <StatsCards />

        {/* Charts */}
        <VehicleChart />

        {/* Live Table */}
        <LiveTable onWsStatus={setWsStatus} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-3 px-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between text-xs text-slate-400 dark:text-slate-600">
          <span className="font-mono">Vehicle Access Dashboard v1.0</span>
          <span>Read-only · TimeWatch DB</span>
        </div>
      </footer>
    </div>
  );
}
