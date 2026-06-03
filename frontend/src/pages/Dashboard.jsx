import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar.jsx';
import StatsCards from '../components/StatsCards.jsx';
import VehicleChart from '../components/VehicleChart.jsx';
import LiveTable from '../components/LiveTable.jsx';
import { fetchTrigger24hAlert, fetchVehicleCount, fetchHealthEvents } from '../api/index.js';

export default function Dashboard({ dark, setDark, onNavigate, onLogout, activePage = 'dashboard' }) {
  const [wsStatus, setWsStatus] = useState('connecting');
  const [period, setPeriod] = useState('day');
  const [isAlerting, setIsAlerting] = useState(false);
  const [alertResultStatus, setAlertResultStatus] = useState(null); // null | 'ok' | 'alert' | 'error'
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthResults, setHealthResults] = useState(null);

  const handleAlertDownload = async () => {
    try {
      setIsAlerting(true);
      const res = await fetchTrigger24hAlert();
      const vehicles = res.data || [];
      if (vehicles.length === 0) {
        setAlertResultStatus('ok');
        alert('No vehicles found inside for more than 24 hours right now. An "All Clear" confirmation email has been sent to the admin.');
      } else {
        setAlertResultStatus('alert');
        const csvContent =
          'Card ID,Vehicle No.,Company Name,Entry Time,Duration (Hours)\n' +
          vehicles.map(v => `"${v.cardId}","${v.name || ''}","${v.flat || ''}","${v.entryTime}","${v.hours}"`).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `24h_Alerts_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        alert(`Downloaded records and sent the alert email to admin successfully.`);
      }
    } catch (err) {
      setAlertResultStatus('error');
      console.error(err);
      alert('Error triggering alert and download: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsAlerting(false);
    }
  };

  const runHealthCheck = async (openModal = false) => {
    if (openModal) setHealthOpen(true);
    setHealthChecking(true);
    setHealthResults(null);
    const start = Date.now();
    try {
      await fetchVehicleCount();
      const latency = Date.now() - start;
      let events = null;
      try {
        const evRes = await fetchHealthEvents();
        events = evRes.data || null;
      } catch {
        events = null;
      }
      setHealthResults({
        api: { ok: true, latency },
        ws: wsStatus,
        db: { ok: true },
        events,
      });
    } catch {
      setHealthResults({
        api: { ok: false, latency: Date.now() - start },
        ws: wsStatus,
        db: { ok: false },
        events: null,
      });
    } finally {
      setHealthChecking(false);
    }
  };

  // Silent health check on mount so button shows status immediately
  useEffect(() => { runHealthCheck(false); }, []);

  const handleHealthCheck = () => runHealthCheck(true);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar
        dark={dark}
        setDark={setDark}
        wsStatus={wsStatus}
        activePage={activePage}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-5 flex flex-col gap-5">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-xl tracking-tight">
              Access Overview
            </h2>
            <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
              Real-time vehicle access monitoring ·
            </p>
          </div>
          {(() => {
            const healthStatus = healthResults
              ? (!healthResults.api.ok || !healthResults.db.ok)
                ? 'error'
                : healthResults.ws !== 'connected'
                  ? 'warning'
                  : 'ok'
              : null;

            const alertBtnClass = isAlerting
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500'
              : alertResultStatus === 'ok'
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300'
                : (alertResultStatus === 'alert' || alertResultStatus === 'error')
                  ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300'
                  : 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300';

            const healthBtnClass = healthChecking
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500'
              : healthStatus === 'error'
                ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300'
                : healthStatus === 'warning'
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
                  : healthStatus === 'ok'
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-300';

            return (
              <div className="flex items-center gap-3">
                {/* Restricted Areas button (static) */}
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 bg-red-600 text-white cursor-default select-none shadow-sm"
                  tabIndex={-1}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Restricted
                </button>

                {/* 24h Alert button */}
                <button
                  onClick={handleAlertDownload}
                  disabled={isAlerting}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${alertBtnClass}`}
                >
                  {isAlerting ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  ) : alertResultStatus === 'ok' ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (alertResultStatus === 'alert' || alertResultStatus === 'error') ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                  {isAlerting ? 'Checking...' : '24h+ Alert / Download'}
                </button>

                {/* Health Check button */}
                <div className="relative">
                {healthResults?.events?.mismatch > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 z-10 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 shadow">
                    {healthResults.events.mismatch}
                  </span>
                )}
                <button
                  onClick={handleHealthCheck}
                  disabled={healthChecking}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${healthBtnClass}`}
                >
                  {healthChecking ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  ) : healthStatus === 'error' ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : healthStatus === 'warning' ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : healthStatus === 'ok' ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  )}
                  {healthChecking ? 'Checking...' : 'Health Check'}
                </button>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Stats */}
        <StatsCards period={period} setPeriod={setPeriod} />

        {/* Charts above live feed */}
        <VehicleChart period={period} />

        {/* Live table below */}
        <LiveTable onWsStatus={setWsStatus} />
      </main>

      {/* Health Check Modal */}
      {healthOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">System Health</h3>
              <button type="button" onClick={() => setHealthOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold leading-none">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {healthChecking ? (
                <div className="flex items-center gap-3 py-4 text-sm text-slate-500">
                  <div className="h-4 w-4 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
                  Running health checks...
                </div>
              ) : healthResults ? (
                <>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">API Server</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${healthResults.api.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${healthResults.api.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      {healthResults.api.ok ? `Online · ${healthResults.api.latency}ms` : 'Unreachable'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">WebSocket</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${healthResults.ws === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${healthResults.ws === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      {healthResults.ws === 'connected' ? 'Connected' : 'Connecting…'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Database</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${healthResults.db.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${healthResults.db.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      {healthResults.db.ok ? 'Reachable' : 'Error'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">RFID Reads (today)</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                      {healthResults.events !== null ? healthResults.events.rfidCount ?? '—' : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Traffic Light Events (today)</span>
                    {healthResults.events?.lightCount !== null && healthResults.events?.lightCount !== undefined ? (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        healthResults.events.mismatch > 0
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      }`}>
                        {healthResults.events.lightCount}
                        {healthResults.events.mismatch > 0 && (
                          <span className="ml-1 font-bold">· {healthResults.events.mismatch} missing</span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Not configured
                      </span>
                    )}
                  </div>
                </>
              ) : null}
            </div>
            <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-3 flex justify-end gap-2">
              <button type="button" onClick={() => runHealthCheck(true)} disabled={healthChecking} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">Recheck</button>
              <button type="button" onClick={() => setHealthOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-3 px-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between text-xs text-slate-400 dark:text-slate-600">
          <span className="font-mono">Vehicle Access Dashboard v1.0</span>
        </div>
      </footer>
    </div>
  );
}

