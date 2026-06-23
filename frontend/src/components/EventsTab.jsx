import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEvents, fetchEventStats, fetchControllers, WS_URL } from '../api/index.js';

export function EventsTab({ controllers = [] }) {
  // Filters
  const [eventSearch, setEventSearch] = useState('');
  const [eventFilterResult, setEventFilterResult] = useState(''); // Granted, Denied, Alarm, System
  const [eventFilterController, setEventFilterController] = useState('');
  const [eventPage, setEventPage] = useState(0);

  // Real-time events
  const [realtimeEvents, setRealtimeEvents] = useState([]);

  // API query
  const eventQuery = useQuery({
    queryKey: ['events', eventFilterResult, eventFilterController, eventPage],
    queryFn: async () => {
      const res = await fetchEvents({
        result: eventFilterResult,
        controller: eventFilterController,
        limit: 50,
        offset: eventPage * 50,
      });
      return res;
    },
    keepPreviousData: true,
    staleTime: 10000,
  });

  const statsQuery = useQuery({
    queryKey: ['eventStats'],
    queryFn: fetchEventStats,
    staleTime: 30000,
  });

  // Handle real-time events via the app WebSocket protocol ({ type: 'bridge_event', data: row }).
  // EventsTab opens its own connection so it works regardless of parent wiring.
  useEffect(() => {
    if (!WS_URL) return;
    let ws;
    let reconnectTimer;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload?.type === 'bridge_event' && payload?.data?.id) {
              setRealtimeEvents((prev) => {
                if (prev.some((e) => e.id === payload.data.id)) return prev;
                return [payload.data, ...prev.slice(0, 49)];
              });
            }
          } catch (_) { /* ignore non-JSON frames */ }
        };
        ws.onclose = () => { reconnectTimer = setTimeout(connect, 5000); };
      } catch (_) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  // Merge real-time and paginated events
  const displayEvents = eventPage === 0 && realtimeEvents.length > 0
    ? realtimeEvents
    : eventQuery.data?.events || [];

  const totalCount = eventQuery.data?.pagination?.total || 0;
  const pageCount = Math.ceil(totalCount / 50);

  // Filter events by card search
  const filteredEvents = displayEvents.filter((e) =>
    !eventSearch || e.card_no?.includes(eventSearch) || e.person_name?.includes(eventSearch)
  );

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      {statsQuery.data?.stats && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Events</p>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{statsQuery.data.stats.total_events}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Approved</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{statsQuery.data.stats.granted}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Denied</p>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300">{statsQuery.data.stats.denied}</p>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Alerts</p>
            <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{statsQuery.data.stats.alerts}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 flex-wrap bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
        <input
          type="text"
          placeholder="Search card # or name..."
          value={eventSearch}
          onChange={(e) => {
            setEventSearch(e.target.value);
            setEventPage(0);
          }}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
        />
        <select
          value={eventFilterResult}
          onChange={(e) => {
            setEventFilterResult(e.target.value);
            setEventPage(0);
          }}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Results</option>
          <option value="Granted">✓ Granted</option>
          <option value="Denied">✗ Denied</option>
          <option value="Alarm">⚠ Alarm</option>
          <option value="System">⚙ System</option>
        </select>
        <select
          value={eventFilterController}
          onChange={(e) => {
            setEventFilterController(e.target.value);
            setEventPage(0);
          }}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Controllers</option>
          {controllers.map((c) => (
            <option key={c.id} value={c.sn}>
              {c.location_label || c.sn}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-600 dark:text-gray-400 ml-auto flex items-center">
          Total: <strong className="ml-1">{totalCount}</strong> events
        </span>
      </div>

      {/* Events Table */}
      <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Time</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Card #</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Name</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Controller</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Door</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Direction</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Result</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">Alert</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan="8" className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {eventQuery.isLoading ? 'Loading events...' : 'No events found'}
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => (
                <tr
                  key={event.id}
                  className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    event.access_result === 'Denied' ? 'bg-red-50 dark:bg-red-900/20' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                    {new Date(event.event_date).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-800 dark:text-gray-200">
                    {event.card_no}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {event.person_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                    {event.location_label || event.controller_sn}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{event.door_num}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {event.direction === 'In' ? '→ In' : event.direction === 'Out' ? '← Out' : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-bold ${
                        event.access_result === 'Granted'
                          ? 'bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                          : event.access_result === 'Denied'
                          ? 'bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-yellow-200 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                      }`}
                    >
                      {event.access_result}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {event.is_alert && (
                      <span className="inline-flex items-center gap-1 bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                        ⚠ {event.alert_severity || 'Alert'}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <button
          onClick={() => setEventPage((p) => Math.max(0, p - 1))}
          disabled={eventPage === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded disabled:cursor-not-allowed"
        >
          ← Previous
        </button>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          Page {eventPage + 1} of {pageCount || 1}
        </span>
        <button
          onClick={() => setEventPage((p) => p + 1)}
          disabled={(eventPage + 1) * 50 >= totalCount}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default EventsTab;
