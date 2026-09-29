import React, { useState } from 'react';
import { Lock, Shield, UserCheck, X } from 'lucide-react';
import { User, UserRole } from '../types/contentx.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onAuthenticated: (user: User, token: string) => void;
  onLogout: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthenticated,
  onLogout,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('admin@contentx.io');
  const [password, setPassword] = useState('ContentX#2026');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [role, setRole] = useState<UserRole>('Editor');
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleQuickLogin = async (presetEmail: string, presetPass: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: presetEmail, password: presetPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      onAuthenticated(data.user, data.token);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRecoveryMessage(null);
    setLoading(true);

    try {
      if (mode === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        setRecoveryMessage(data.message);
        setLoading(false);
        return;
      }

      const endpoint =
        mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { email, password }
          : { email, password, name, organization, role };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      onAuthenticated(data.user, data.token);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              ContentX Identity & RBAC Access
            </h2>
            <p className="text-xs text-slate-500">
              Role-Based Access Control · JWT Session Verification
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {currentUser && (
          <div className="mt-4 border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-900">
                  {currentUser.name}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {currentUser.email} · Role: {currentUser.role}
                </div>
              </div>
              <button
                onClick={onLogout}
                className="border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        {/* Mode Segmented Control */}
        <div className="mt-4 flex items-center gap-1 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'register'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Register Account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('forgot');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'forgot'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Reset Password
          </button>
        </div>

        {error && (
          <div className="mt-4 border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {recoveryMessage && (
          <div className="mt-4 border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            {recoveryMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dr. Sophia Chen"
                  className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Organization
                  </label>
                  <input
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="SecOps Lab"
                    className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Assigned Role
                  </label>
                  <div className="mt-1 w-full border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 flex items-center justify-between">
                    <span>Viewer (Default Least Privilege)</span>
                    <span className="font-mono text-[10px] text-slate-500">Enforced</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {mode !== 'forgot' && (
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            {loading
              ? 'Authenticating...'
              : mode === 'login'
              ? 'Authenticate Session'
              : mode === 'register'
              ? 'Create Verified Account'
              : 'Send Password Reset Token'}
          </button>
        </form>

        {/* Quick RBAC Role Switcher for Development Evaluation Only */}
        {import.meta.env.DEV && (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-medium text-slate-700">
              Instant RBAC Role Evaluation Accounts (Development Mode)
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  handleQuickLogin('admin@contentx.io', 'ContentX#2026')
                }
                className="flex items-center justify-center gap-1.5 border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 hover:border-slate-400 hover:bg-white whitespace-nowrap"
              >
                <Shield className="h-3.5 w-3.5 text-blue-600" />
                <span>Admin</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleQuickLogin('editor@contentx.io', 'Editor#2026')
                }
                className="flex items-center justify-center gap-1.5 border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 hover:border-slate-400 hover:bg-white whitespace-nowrap"
              >
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Editor</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleQuickLogin('viewer@contentx.io', 'Viewer#2026')
                }
                className="flex items-center justify-center gap-1.5 border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 hover:border-slate-400 hover:bg-white whitespace-nowrap"
              >
                <Lock className="h-3.5 w-3.5 text-slate-500" />
                <span>Viewer</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
