import { useState, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import ReportPage from './pages/Reportpage.jsx';
import LiveEntryExitPage from './pages/LiveEntryExitPage.jsx';
import ConfigPage from './pages/ConfigPage.jsx';
import TagRegistrationPage from './pages/TagRegistrationPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

const AUTH_STORAGE_KEY = 'vehicleAccessAuth';
const AUTH_ROLE_KEY   = 'vehicleAccessRole';

// Role definitions — username → { password, role, displayName }
const USERS = {
  security:   { password: 'Guard@2024',  role: 'security',   displayName: 'Security Guard' },
  supervisor: { password: 'Super@2024',  role: 'supervisor', displayName: 'Supervisor' },
  admin:      { password: 'Admin@2024',  role: 'admin',      displayName: 'Administrator' },
};

// Which pages each role can access
const ROLE_ACCESS = {
  security:   ['dashboard', 'live', 'tags'],
  supervisor: ['dashboard', 'live', 'report', 'tags'],
  admin:      ['dashboard', 'live', 'report', 'config', 'tags'],
};

export function canAccess(role, page) {
  return (ROLE_ACCESS[role] || []).includes(page);
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('darkMode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true');
  const [role, setRole] = useState(() => sessionStorage.getItem(AUTH_ROLE_KEY) || 'security');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', dark);
  }, [dark]);

  function navigateByPage(pageKey) {
    const nextPath = pageKey === 'report'
      ? '/report'
      : pageKey === 'config'
        ? '/config'
      : pageKey === 'tags'
        ? '/register-tag'
      : pageKey === 'live'
        ? '/live'
        : '/';
    navigate(nextPath);
  }

  const activePage = location.pathname === '/report'
    ? 'report'
    : location.pathname === '/config'
      ? 'config'
    : location.pathname === '/register-tag'
      ? 'tags'
    : location.pathname === '/live'
      ? 'live'
      : 'dashboard';

  function handleLogin(username, password) {
    const user = USERS[username.trim().toLowerCase()];
    if (!user || user.password !== password) return false;

    sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
    sessionStorage.setItem(AUTH_ROLE_KEY, user.role);
    setIsAuthenticated(true);
    setRole(user.role);
    navigate('/');
    return true;
  }

  function handleLogout() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_ROLE_KEY);
    setIsAuthenticated(false);
    setRole('security');
    navigate('/login');
  }

  if (!isAuthenticated && location.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }

  if (isAuthenticated && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  const sharedProps = { dark, setDark, onNavigate: navigateByPage, onLogout: handleLogout, activePage, role };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage dark={dark} setDark={setDark} onLogin={handleLogin} />} />
      <Route path="/" element={<Dashboard {...sharedProps} />} />
      <Route
        path="/report"
        element={canAccess(role, 'report') ? <ReportPage {...sharedProps} /> : <Navigate to="/" replace />}
      />
      <Route path="/authorized" element={<Navigate to="/config" replace />} />
      <Route
        path="/register-tag"
        element={canAccess(role, 'tags') ? <TagRegistrationPage {...sharedProps} /> : <Navigate to="/" replace />}
      />
      <Route path="/live" element={<LiveEntryExitPage {...sharedProps} />} />
      <Route
        path="/config"
        element={canAccess(role, 'config') ? <ConfigPage {...sharedProps} /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
    </Routes>
  );
}
