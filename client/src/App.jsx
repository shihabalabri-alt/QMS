import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, setToken, getToken } from './lib/api';
import { ToastHost } from './lib/ui';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ModuleList from './pages/ModuleList';
import ModuleDetail from './pages/ModuleDetail';
import ActionsPage from './pages/ActionsPage';
import CalendarPage from './pages/CalendarPage';
import NotificationsCenter from './pages/NotificationsCenter';
import ReportsPage from './pages/ReportsPage';
import ConnectionsMap from './pages/ConnectionsMap';
import Inbox from './pages/Inbox';
import SearchPage from './pages/SearchPage';
import ActivityFeed from './pages/ActivityFeed';
import CompetencyMatrix from './pages/CompetencyMatrix';
import AiConsole from './pages/AiConsole';
import AdminPage from './pages/AdminPage';
import VerifyEmail from './pages/VerifyEmail';
import SecurityPage from './pages/SecurityPage';
import ErrorBoundary from './components/ErrorBoundary';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function App() {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [metaModules, setMetaModules] = useState(null);
  const [rolesList, setRolesList] = useState([]);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!getToken()) { setBooting(false); return; }
    api.get('/auth/me').then(d => {
      setUser(d.user); setPermissions(d.permissions); setRolesList(d.roles);
      return api.get('/auth/meta').then(m => setMetaModules(m.modules));
    }).catch(() => setToken(null)).finally(() => setBooting(false));
  }, []);

  const login = useCallback(async (email, password, totp) => {
    const d = await api.post('/auth/login', { email, password, totp });
    setToken(d.token); setUser(d.user); setPermissions(d.permissions);
    const m = await api.get('/auth/meta');
    setMetaModules(m.modules);
    return d;
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); setPermissions(null); }, []);
  const refreshMeta = useCallback(async () => {
    const m = await api.get('/auth/meta'); setMetaModules(m.modules);
  }, []);

  if (booting) return <div className="spinner" style={{ marginTop: '40vh' }} />;

  return (
    <AuthCtx.Provider value={{ user, permissions, metaModules, rolesList, login, logout, refreshMeta }}>
      <BrowserRouter>
        <ToastHost />
        <ErrorBoundary>
          <Routes>
            <Route path="/verify-email/:token" element={<VerifyEmail />} />
          </Routes>
          {!user ? <Login /> : (
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/dashboard" element={<Navigate to="/" replace />} />
                <Route path="/actions" element={<ActionsPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/notifications" element={<NotificationsCenter />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/activity" element={<ActivityFeed />} />
                <Route path="/competency-matrix" element={<CompetencyMatrix />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/connections" element={<ConnectionsMap />} />
                <Route path="/ai" element={<AiConsole />} />
                <Route path="/admin/:tab?" element={<AdminPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/:module" element={<ModuleList />} />
                <Route path="/:module/:id" element={<ModuleDetail />} />
              </Route>
            </Routes>
          )}
        </ErrorBoundary>
      </BrowserRouter>
    </AuthCtx.Provider>
  );
}

export default App;
