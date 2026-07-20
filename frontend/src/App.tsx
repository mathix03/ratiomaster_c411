import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UIProvider } from './context/UIContext';
import Spoofer from './pages/Spoofer';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import Account from './pages/Account';
import Guide from './pages/Guide';
import { LogOut, Activity, LayoutDashboard, User, BookOpen } from 'lucide-react';
import './App.css';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const Navigation = () => {
  const { isAuthenticated, isAdmin, logout } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) return null;

  return (
    <nav className="app-nav">
      <div className="nav-inner">
        <div className="nav-links">
          <Link
            to="/"
            className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
          >
            <Activity size={16} />
            Spoofer
          </Link>
          <Link
            to="/account"
            className={`nav-link ${location.pathname === '/account' ? 'active' : ''}`}
          >
            <User size={16} />
            My Account
          </Link>
          <Link
            to="/guide"
            className={`nav-link ${location.pathname === '/guide' ? 'active' : ''}`}
          >
            <BookOpen size={16} />
            Guide
          </Link>
          {isAdmin && (
            <>
              <Link
                to="/admin"
                className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
              >
                <LayoutDashboard size={16} />
                Dashboard
              </Link>
            </>
          )}
        </div>
        <button
          onClick={() => {
            logout();
            window.location.href = '/login';
          }}
          className="nav-logout"
        >
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </nav>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <UIProvider>
        <Router>
          <div className="app-shell">
            <Navigation />
            <main className="app-main">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={
                  <ProtectedRoute>
                    <Spoofer />
                  </ProtectedRoute>
                } />
                <Route path="/account" element={
                  <ProtectedRoute>
                    <Account />
                  </ProtectedRoute>
                } />
                <Route path="/guide" element={
                  <ProtectedRoute>
                    <Guide />
                  </ProtectedRoute>
                } />
                <Route path="/admin" element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                } />
              </Routes>
            </main>
          </div>
        </Router>
      </UIProvider>
    </AuthProvider>
  );
}
