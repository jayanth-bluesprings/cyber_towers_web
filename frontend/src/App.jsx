import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard.jsx';

export default function App() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('darkMode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', dark);
  }, [dark]);

  return <Dashboard dark={dark} setDark={setDark} />;
}
