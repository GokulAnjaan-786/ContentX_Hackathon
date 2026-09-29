import React, { useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Lock,
  Shield,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { User, UserRole } from '../types/contentx.ts';

export type AuthRouteMode = 'login' | 'register' | 'forgot-password';

interface AuthPageProps {
  mode: AuthRouteMode;
  sessionNotice?: string | null;
  onChangeMode: (mode: AuthRouteMode) => void;
  onAuthenticated: (user: User, token: string, rememberMe: boolean) => void;
  onOpenPublicVerification: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  mode,
  sessionNotice,
  onChangeMode,
  onAuthenticated,
  onOpenPublicVerification,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [role, setRole] = useState<UserRole>('Editor');
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (nextMode: AuthRouteMode) => {
    setError(null);
    setRecoveryMessage(null);
    onChangeMode(nextMode);
  };

  const fillCredentials = (presetEmail: string, presetPassword: string) => {
    setError(null);
    setRecoveryMessage(null);
    if (mode !== 'login') {
      onChangeMode('login');
    }
    setEmail(presetEmail);
    setPassword(presetPassword);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRecoveryMessage(null);

    if (mode === 'forgot-password') {
      if (!email.trim()) {
        setError('Please enter your email address to reset your password.');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Password reset request failed.');
        }
        setRecoveryMessage(data.message);
      } catch (err: any) {
        setError(err.message || 'Unable to process request.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'login') {
      if (!email.trim() || !password) {
        setError('Please enter both your email address and password.');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
            rememberMe,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error || 'Invalid email or password. Please try again.'
          );
        }
        onAuthenticated(data.user, data.token, rememberMe);
      } catch (err: any) {
        setError(err.message || 'Authentication failed.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Register mode
    if (!name.trim() || !email.trim() || !password) {
      setError('Full name, email address, and password are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          organization: organization.trim() || 'Enterprise Verification Team',
          role,
          email: email.trim(),
          password,
          rememberMe,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Account registration failed.');
      }
      onAuthenticated(data.user, data.token, rememberMe);
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 text-slate-900">
      {/* LEFT SIDE: ContentX Branding, Tagline, Product Statement & Trust Highlights */}
      <div className="flex flex-col justify-between bg-slate-950 text-white p-8 sm:p-12 lg:w-1/2 xl:w-7/12 border-b lg:border-b-0 lg:border-r border-slate-800">
        <div>
          {/* Top Brand Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center bg-blue-600 font-mono text-sm font-bold text-white">
                CX
              </div>
              <span className="text-xl font-bold tracking-tight text-white">
                ContentX
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenPublicVerification}
              className="inline-flex items-center gap-2 border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Public Verification Portal (/verify/:id)</span>
            </button>
          </div>

          {/* Core Brand Positioning */}
          <div className="mt-12 lg:mt-20 max-w-xl">
            <div className="font-mono text-xs font-semibold tracking-wider text-blue-400">
              ONE SOURCE. EVERY FORMAT. VERIFIED AT EVERY STEP.
            </div>
            <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
              Transform trusted information into powerful content without
              changing the truth behind it.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
              Change the complexity of the message, not the truth behind it.
              Every generated executive brief, advisory, presentation, and
              social narrative is strictly anchored to your canonical Fact
              Registry and verified with SHA-256 provenance.
            </p>

            {/* 4 Required Feature Highlights */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="flex items-center gap-3 border border-slate-800 bg-slate-900/70 px-4 py-3">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm font-medium text-slate-100">
                  Source-grounded AI
                </span>
              </div>
              <div className="flex items-center gap-3 border border-slate-800 bg-slate-900/70 px-4 py-3">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm font-medium text-slate-100">
                  Fact-level traceability
                </span>
              </div>
              <div className="flex items-center gap-3 border border-slate-800 bg-slate-900/70 px-4 py-3">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm font-medium text-slate-100">
                  Multi-format content
                </span>
              </div>
              <div className="flex items-center gap-3 border border-slate-800 bg-slate-900/70 px-4 py-3">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm font-medium text-slate-100">
                  Verified provenance
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Reference Credentials & Security Notice */}
        <div className="mt-12 pt-6 border-t border-slate-800/80 space-y-4">
          {import.meta.env.DEV && (
            <div className="border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-200">
                  RBAC Evaluation Credentials (Development Mode Only)
                </div>
                <span className="font-mono text-[11px] text-slate-400">
                  Mandatory Authentication Active
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    fillCredentials('admin@contentx.io', 'ContentX#2026')
                  }
                  className="flex flex-col items-start border border-slate-800 bg-slate-950/80 p-2.5 text-left hover:border-blue-500 transition-colors"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <Shield className="h-3.5 w-3.5 text-blue-400" />
                    <span>Admin Role</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">
                    admin@contentx.io
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    Pass: ContentX#2026
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    fillCredentials('editor@contentx.io', 'Editor#2026')
                  }
                  className="flex flex-col items-start border border-slate-800 bg-slate-950/80 p-2.5 text-left hover:border-emerald-500 transition-colors"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Editor Role</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">
                    editor@contentx.io
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    Pass: Editor#2026
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    fillCredentials('viewer@contentx.io', 'Viewer#2026')
                  }
                  className="flex flex-col items-start border border-slate-800 bg-slate-950/80 p-2.5 text-left hover:border-slate-500 transition-colors"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                    <span>Viewer Role</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">
                    viewer@contentx.io
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    Pass: Viewer#2026
                  </div>
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>
              ContentX · One Source. Every Format. Verified at Every Step.
            </span>
            <span className="font-mono">
              SHA-256 Session & Provenance Attestation
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: Sign In / Create Account / Forgot Password Card */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-12 lg:w-1/2 xl:w-5/12">
        <div className="w-full max-w-md border border-slate-200 bg-white p-8 shadow-xs">
          {/* Brand Header inside Card */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center bg-slate-900 font-mono text-xs font-bold text-white">
                CX
              </div>
              <span className="text-base font-bold tracking-tight text-slate-900">
                ContentX
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              {mode === 'login'
                ? '/login'
                : mode === 'register'
                ? '/register'
                : '/forgot-password'}
            </span>
          </div>

          {/* Heading */}
          <div className="mt-6">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {mode === 'login'
                ? 'Welcome back'
                : mode === 'register'
                ? 'Create your account'
                : 'Reset your password'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {mode === 'login'
                ? 'Sign in with your verified ContentX credentials to access the workspace.'
                : mode === 'register'
                ? 'Register a new role-based ContentX account for source transformation and verification.'
                : 'Enter your account email address to receive a password reset link.'}
            </p>
          </div>

          {/* Session Notice (e.g. Expired Session or Protected Route Redirect) */}
          {sessionNotice && !error && (
            <div className="mt-4 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {sessionNotice}
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="mt-4 border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
            >
              {error}
            </div>
          )}

          {/* Recovery Confirmation Banner */}
          {recoveryMessage && (
            <div className="mt-4 border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              {recoveryMessage}
            </div>
          )}

          {/* Main Authentication Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {mode === 'register' && (
              <>
                <div>
                  <label
                    htmlFor="auth-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr. Sophia Chen"
                    className="mt-1.5 w-full border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="auth-org"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Organization
                    </label>
                    <input
                      id="auth-org"
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="SecOps Lab"
                      className="mt-1.5 w-full border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Assigned Role
                    </label>
                    <div className="mt-1.5 w-full border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs text-slate-700 font-medium flex items-center justify-between">
                      <span>Viewer (Least Privilege Default)</span>
                      <span className="font-mono text-[10px] text-slate-500">Enforced</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-semibold text-slate-700"
              >
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.com"
                className="mt-1.5 w-full border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            {mode !== 'forgot-password' && (
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                  >
                    {showPassword ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" />
                        <span>Hide Password</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" />
                        <span>Show Password</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="mt-1.5 w-full border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            )}

            {mode !== 'forgot-password' && (
              <div className="flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  <span>Remember Me</span>
                </label>

                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot-password')}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading
                ? 'Verifying credentials...'
                : mode === 'login'
                ? 'Sign In'
                : mode === 'register'
                ? 'Create Account'
                : 'Send Reset Instructions'}
            </button>
          </form>

          {/* Footer Switching Links */}
          <div className="mt-6 border-t border-slate-200 pt-5 text-center text-xs text-slate-600">
            {mode === 'login' && (
              <div>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  Create account
                </button>
              </div>
            )}

            {mode === 'register' && (
              <div>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  Sign In
                </button>
              </div>
            )}

            {mode === 'forgot-password' && (
              <div>
                Remembered your password?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  Back to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
