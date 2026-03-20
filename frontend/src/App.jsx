import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { getMe, logout } from './slices/authSlice';
import { setSelectedSession, fetchSessions, clearCurrentReport } from './slices/sessionSlice';

// Components
import PrivateRoute from './components/PrivateRoute';
import AppLayout from './layouts/AppLayout';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import SessionViewPage from './pages/SessionViewPage';

const AppContent = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, isAuthenticated, token } = useSelector((state) => state.auth);
  const { sessions, selectedSessionId } = useSelector((state) => state.session);

  useEffect(() => {
    if (token) {
      dispatch(getMe());
      dispatch(fetchSessions());
    }
  }, [dispatch, token]);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const handleNewSession = () => {
    dispatch(setSelectedSession(null));
    dispatch(clearCurrentReport());   // clear stale report immediately
    navigate('/');
  };

  const handleSelectSession = (id) => {
    dispatch(setSelectedSession(id));
    dispatch(clearCurrentReport());   // clear stale report so old content doesn't flash
    navigate(`/session/${id}`);
  };

  if (isAuthenticated === undefined) return null; // Wait for auth check

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to="/" /> : <RegisterPage />} />
      
      <Route 
        path="/*" 
        element={
          <PrivateRoute>
            <AppLayout 
              user={user} 
              sessions={sessions} 
              selectedSession={selectedSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onLogout={handleLogout}
            >
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/session/:sessionId" element={<SessionViewPage />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </AppLayout>
          </PrivateRoute>
        } 
      />
    </Routes>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
};

export default App;
