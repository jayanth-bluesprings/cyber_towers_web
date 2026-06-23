import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMonitoringOverview, fetchPushFailures, fetchSyncLogs, WS_URL } from '../api/index.js';

function timeAgo(ts) {
  if (!ts) return 'never';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN');
}

function MetricCard({ label, value, sub, tone = 'slate', icon }) {
  const tones = {
    slate:   'border-slate-200 dark:border-slate-700',
    emerald: 'border-emerald-200 dark:border-emerald-800',
    red:     'border-red-200 dark:border-red-800',
    amber:   'border-amber-200 dark:border-amber-800',
    sky:     'border-sky-200 dark:border-sky-800',
  };
  const valueTone = {
    slate:   'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red:     'text-red-600 dark:text-red-400',
    amber:   'text-amber-600 dark:text-amber-400',
    sky:     'text-sky-600 dark:text-sky-400',
  };
  return (
    <div className={`rounded-xl border ${tones[tone]} bg-white dark:bg-slate-900 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={`text-3xl font-bold mt-1 ${valueTone[tone]}`}>{value}</p>
      {sub && <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function HealthPill({ health }) {
  const map = {
    online:  { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500', label: 'Online' },
    offline: { cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500', label: 'Offline' },
    unknown: { cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400', label: 'Unknown' },
  };
  const m = map[health] || map.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${health === 'online' ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  );
}

export default function BridgeMonitorTab() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, forceTick] = useState(0); // re-render for relative times

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['monitoring-overview'],
    queryFn: fetchMonitoringOverview,
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 3000,
  });

  const { data: failuresData } = useQuery({
    queryKey: ['monitoring-push-failures'],
    queryFn: () => fetchPushFailures({ limit: 8 }),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: syncData } = useQuery({
    queryKey: ['monitoring-sync-logs'],
    queryFn: () => fetchSyncLogs({ limit: 12 }),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  // Refresh relative timestamps every 10s
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  // Live nudge: refetch overview whenever a relevant WS event arrives
  useEffect(() => {
    if (!WS_URL) return;
    let ws;
    try {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (event) => {
        try {
          const p = JSON.parse(event.data);
          if (['controller_status', 'card_push_result', 'card_remove_result', 'bridge_sync', 'bridge_alert'].includes(p?.type)) {
            refetch();
          }
        } catch (_) { /* ignore */ }
      };
    } catch (_) { /* ignore */ }
    return () => { if (ws) ws.close(); };
  }, [refetch]);

  const o = data?.data;
  const bridgeOnline = o?.bridge?.online;
  const failures = failuresData?.data ?? [];
  const syncLogs = syncData?.data ?? [];

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 ${bridgeOnline ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
            <span className={`w-3 h-3 rounded-full ${bridgeOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <div>
              <p className={`font-bold text-sm ${bridgeOnline ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                Bridge Service {bridgeOnline ? 'Online' : 'Offline'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {bridgeOnline ? 'Receiving heartbeats from controllers' : 'No recent controller heartbeats'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {dataUpdatedAt ? `Updated ${timeAgo(dataUpdatedAt)}` : ''}
          </span>
          <button
            onClick={() => setAutoRefresh(a => !a)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${autoRefresh ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-sky-500 animate-pulse' : 'bg-slate-400'}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button onClick={() => refetch()}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            Refresh
          </button>
        </div>
      </div>

      {isLoading && !o ? (
        <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading monitoring data…</div>
      ) : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard label="Controllers" value={o?.controllers?.total ?? 0}
              sub={`${o?.controllers?.online ?? 0} online · ${o?.controllers?.offline ?? 0} offline`}
              tone="sky" />
            <MetricCard label="Online" value={o?.controllers?.online ?? 0} tone="emerald"
              sub={o?.controllers?.unknown ? `${o.controllers.unknown} unknown` : 'all reporting'} />
            <MetricCard label="Push Queue" value={o?.pushQueue?.pending ?? 0} tone={o?.pushQueue?.pending ? 'amber' : 'slate'}
              sub={`${o?.pushQueue?.pendingPush ?? 0} push · ${o?.pushQueue?.pendingRemove ?? 0} remove`} />
            <MetricCard label="Push Failed 24h" value={o?.pushQueue?.failed24h ?? 0} tone={o?.pushQueue?.failed24h ? 'red' : 'slate'}
              sub={`${o?.pushQueue?.success24h ?? 0} succeeded`} />
            <MetricCard label="Events 1h" value={o?.events?.last1h ?? 0} tone="slate"
              sub={`${o?.events?.last24h ?? 0} in 24h`} />
            <MetricCard label="Open Alerts" value={o?.alerts?.unacknowledged ?? 0} tone={o?.alerts?.unacknowledged ? 'red' : 'slate'}
              sub={o?.alerts?.criticalOpen ? `${o.alerts.criticalOpen} critical` : 'none critical'} />
          </div>

          {/* Sync summary strip */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Historical Sync</span>
            <span className="text-slate-500 dark:text-slate-400">Running: <strong className="text-slate-700 dark:text-slate-200">{o?.sync?.running ?? 0}</strong></span>
            <span className="text-slate-500 dark:text-slate-400">Success 24h: <strong className="text-emerald-600 dark:text-emerald-400">{o?.sync?.success24h ?? 0}</strong></span>
            <span className="text-slate-500 dark:text-slate-400">Failed 24h: <strong className={o?.sync?.failed24h ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>{o?.sync?.failed24h ?? 0}</strong></span>
            <span className="text-slate-500 dark:text-slate-400">Records 24h: <strong className="text-slate-700 dark:text-slate-200">{o?.sync?.records24h ?? 0}</strong></span>
            <span className="ml-auto text-xs text-slate-400">Last success {timeAgo(o?.sync?.lastSuccessAt)}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Controller health table */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">Controller Health</p>
              </div>
              {(o?.controllers?.list ?? []).length === 0 ? (
                <p className="text-center text-slate-400 py-10 text-sm">No controllers configured.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Controller</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left hidden sm:table-cell">Heartbeat</th>
                        <th className="px-4 py-2.5 text-center">Failures</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {o.controllers.list.map(c => (
                        <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-800 dark:text-slate-100">{c.location_label || c.sn}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{c.sn}{c.ip_address ? ` · ${c.ip_address}` : ''}</div>
                          </td>
                          <td className="px-4 py-2.5"><HealthPill health={c.health} /></td>
                          <td className="px-4 py-2.5 hidden sm:table-cell text-xs text-slate-500 dark:text-slate-400">{timeAgo(c.last_heartbeat_at)}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`text-xs font-semibold ${c.consecutive_failures > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                              {c.consecutive_failures || 0}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent push failures */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">Recent Push/Remove Failures</p>
                <span className="text-xs text-slate-400">{failures.length}</span>
              </div>
              {failures.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <p className="text-sm">No recent failures</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-[320px] overflow-y-auto">
                  {failures.map(f => (
                    <div key={f.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{f.card_no}</span>
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${f.operation === 'remove' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'}`}>{f.operation}</span>
                        <span className="text-[10px] text-slate-400 ml-auto">{timeAgo(f.completed_at)}</span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {f.location_label || f.controller_sn} · {f.attempts} attempt{f.attempts !== 1 ? 's' : ''}
                      </div>
                      {f.error_message && (
                        <div className="text-[11px] text-red-500 mt-0.5 truncate" title={f.error_message}>{f.error_message}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent sync logs */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">Recent Sync Activity</p>
            </div>
            {syncLogs.length === 0 ? (
              <p className="text-center text-slate-400 py-10 text-sm">No sync activity recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Controller</th>
                      <th className="px-4 py-2.5 text-left">Type</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      <th className="px-4 py-2.5 text-center hidden sm:table-cell">Inserted</th>
                      <th className="px-4 py-2.5 text-center hidden md:table-cell">Duplicates</th>
                      <th className="px-4 py-2.5 text-left">Started</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {syncLogs.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{s.location_label || s.controller_sn}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{s.sync_type}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            s.status === 'Success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : s.status === 'Failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                            : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                          }`}>{s.status}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center hidden sm:table-cell text-xs text-slate-600 dark:text-slate-300">{s.inserted_count ?? 0}</td>
                        <td className="px-4 py-2.5 text-center hidden md:table-cell text-xs text-slate-400">{s.duplicate_count ?? 0}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{timeAgo(s.started_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
