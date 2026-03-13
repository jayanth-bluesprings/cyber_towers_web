import { useState, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import ReportPage from './pages/Reportpage.jsx';
import AuthorizedVehiclesPage from './pages/AuthorizedVehiclesPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

const AUTH_STORAGE_KEY = 'vehicleAccessAuth';
const HARDCODED_USERNAME = 'admin';
const HARDCODED_PASSWORD = 'admin123';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('darkMode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', dark);
  }, [dark]);

  function navigateByPage(pageKey) {
    const nextPath = pageKey === 'report'
      ? '/report'
      : pageKey === 'authorized'
        ? '/authorized'
        : '/';
    navigate(nextPath);
  }

  const activePage = location.pathname === '/report'
    ? 'report'
    : location.pathname === '/authorized'
      ? 'authorized'
      : 'dashboard';

  function handleLogin(username, password) {
    const ok = username === HARDCODED_USERNAME && password === HARDCODED_PASSWORD;
    if (!ok) return false;

    sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
    setIsAuthenticated(true);
    navigate('/');
    return true;
  }

  function handleLogout() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setIsAuthenticated(false);
    navigate('/login');
  }

  if (!isAuthenticated && location.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }

  if (isAuthenticated && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage dark={dark} setDark={setDark} onLogin={handleLogin} />} />
      <Route
        path="/"
        element={
          <Dashboard
            dark={dark}
            setDark={setDark}
            onNavigate={navigateByPage}
            onLogout={handleLogout}
            activePage={activePage}
          />
        }
      />
      <Route
        path="/report"
        element={
          <ReportPage
            dark={dark}
            setDark={setDark}
            onNavigate={navigateByPage}
            onLogout={handleLogout}
            activePage={activePage}
          />
        }
      />
      <Route
        path="/authorized"
        element={
          <AuthorizedVehiclesPage
            dark={dark}
            setDark={setDark}
            onNavigate={navigateByPage}
            onLogout={handleLogout}
            activePage={activePage}
          />
        }
      />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
    </Routes>
  );
}
