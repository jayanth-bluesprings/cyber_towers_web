import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import ReportPage from './pages/Reportpage.jsx';

export default function App() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('darkMode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [page, setPage] = useState('dashboard'); // 'dashboard' | 'report'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', dark);
  }, [dark]);

  return page === 'report'
    ? <ReportPage dark={dark} setDark={setDark} onNavigate={setPage} />
    : <Dashboard dark={dark} setDark={setDark} onNavigate={setPage} />;
}