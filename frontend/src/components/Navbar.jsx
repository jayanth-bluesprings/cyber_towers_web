import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    key: 'live',
    label: 'Live Entry/Exit',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    key: 'report',
    label: 'Reports',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    key: 'config',
    label: 'Configuration',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10.325 4.317a1 1 0 011.35-.936l.656.26a1 1 0 00.95-.09l.609-.431a1 1 0 011.369.13l.73.842a1 1 0 00.9.33l.983-.137a1 1 0 011.09.874l.11.988a1 1 0 00.598.796l.91.39a1 1 0 01.53 1.268l-.36.926a1 1 0 00.12.95l.568.82a1 1 0 01-.212 1.36l-.804.59a1 1 0 00-.39.88l.058.995a1 1 0 01-.975 1.08l-.994.026a1 1 0 00-.833.47l-.52.85a1 1 0 01-1.315.405l-.9-.41a1 1 0 00-.95.09l-.8.59a1 1 0 01-1.4-.08l-.67-.74a1 1 0 00-.92-.3l-.98.18a1 1 0 01-1.13-.82l-.15-.98a1 1 0 00-.62-.77l-.92-.36a1 1 0 01-.57-1.25l.32-.94a1 1 0 00-.15-.94l-.6-.8a1 1 0 01.17-1.37l.78-.62a1 1 0 00.36-.89l-.1-.99a1 1 0 01.93-1.12l.99-.06a1 1 0 00.81-.5l.48-.88zM12 15a3 3 0 100-6 3 3 0 000 6z" />
      </svg>
    ),
  },
];

export default function Navbar({ dark, setDark, wsStatus, activePage, onNavigate, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-screen-2xl mx-auto px-4 h-[4.5rem] flex items-center justify-between gap-4">

        {/* Logo */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-16 h-16 rounded-xl shadow-sm flex-shrink-0 overflow-hidden">
            <img src="/logo.png" className="w-full h-full object-cover" alt="Logo" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-base leading-tight truncate">
              Vehicle Access Management
            </h1>
            <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight hidden sm:block">
              Security Dashboard
            </p>
          </div>
        </div>

        {/* Center: Nav links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive
                    ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Right: Cyber Towers → Theme → Logout */}
        <div className="flex items-center gap-2">

          {/* Cyber Towers + Date + time (IST) */}
          <div className="hidden lg:flex items-center gap-3 px-4 py-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800">
            <div className="flex flex-col items-end">
              <span className="text-base font-extrabold text-sky-700 dark:text-sky-300 leading-tight tracking-wide">
                CyberTowers, Hyderabad
              </span>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono leading-tight font-semibold">
                {now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}
                {' · '}
                {now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })} IST
              </div>
            </div>
          </div>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(!dark)}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:border-slate-600 transition-colors"
            aria-label="Toggle dark mode"
          >
            {dark ? (
              <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-slate-700" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H9m4 8H7a2 2 0 01-2-2V6a2 2 0 012-2h6" />
              </svg>
              Logout
            </button>
          )}

          {/* Mobile nav toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Menu"
          >
            <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { onNavigate(item.key); setMobileOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                    ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
          {onLogout && (
            <button
              type="button"
              onClick={() => { onLogout(); setMobileOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H9m4 8H7a2 2 0 01-2-2V6a2 2 0 012-2h6" />
              </svg>
              Logout
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
