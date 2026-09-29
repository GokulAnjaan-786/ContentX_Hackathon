/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  Database,
  FileCheck,
  FileText,
  Layers,
  LayoutDashboard,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  Workflow,
} from 'lucide-react';
import { AuthModal } from './components/AuthModal.tsx';
import { AuthPage, AuthRouteMode } from './components/AuthPage.tsx';
import { ClaimInspectorDrawer } from './components/ClaimInspectorDrawer.tsx';
import { OutputStudioView } from './components/OutputStudioView.tsx';
import { TransformWorkspace } from './components/TransformWorkspace.tsx';
import { VerificationAndProvenanceView } from './components/VerificationAndProvenanceView.tsx';
import {
  AnalyticsSummary,
  DocumentChunk,
  DomainType,
  FactCategory,
  FactImportance,
  FactRegistryItem,
  GeneratedOutputRecord,
  GenerationJob,
  OutputClaim,
  OutputFormatType,
  ProvenanceRecord,
  ProviderConfigStatus,
  SourceDocument,
  User,
} from './types/contentx.ts';

type NavTab =
  | 'dashboard'
  | 'transform'
  | 'fact_registry'
  | 'outputs'
  | 'verify'
  | 'provenance'
  | 'history'
  | 'analytics'
  | 'settings';

const TAB_TO_PATH: Record<NavTab, string> = {
  dashboard: '/dashboard',
  transform: '/transform',
  fact_registry: '/facts',
  outputs: '/outputs',
  verify: '/verify',
  provenance: '/provenance',
  history: '/history',
  analytics: '/analytics',
  settings: '/settings',
};

const PROTECTED_PATHS: Record<string, NavTab> = {
  '/dashboard': 'dashboard',
  '/transform': 'transform',
  '/facts': 'fact_registry',
  '/fact_registry': 'fact_registry',
  '/outputs': 'outputs',
  '/provenance': 'provenance',
  '/history': 'history',
  '/analytics': 'analytics',
  '/settings': 'settings',
};

const AUTH_STORAGE_KEY = 'contentx_auth_token';

function getStoredAuthToken(): string | null {
  try {
    return (
      localStorage.getItem(AUTH_STORAGE_KEY) ||
      sessionStorage.getItem(AUTH_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

function saveStoredAuthToken(token: string, rememberMe: boolean): void {
  try {
    if (rememberMe) {
      localStorage.setItem(AUTH_STORAGE_KEY, token);
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<NavTab>('dashboard');
  const [includeDemo, setIncludeDemo] = useState<boolean>(true);

  // Mandatory Authentication & Session State
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() =>
    getStoredAuthToken()
  );
  const [authRouteMode, setAuthRouteMode] = useState<AuthRouteMode>('login');
  const [publicVerifyMode, setPublicVerifyMode] = useState<boolean>(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);

  // Core Data State
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [activeDocChunks, setActiveDocChunks] = useState<DocumentChunk[]>([]);
  const [activeDocFacts, setActiveDocFacts] = useState<FactRegistryItem[]>([]);
  const [allFacts, setAllFacts] = useState<
    Array<FactRegistryItem & { document_name?: string; is_demo?: boolean }>
  >([]);
  const [outputs, setOutputs] = useState<GeneratedOutputRecord[]>([]);
  const [provenanceList, setProvenanceList] = useState<ProvenanceRecord[]>([]);
  const [historyJobs, setHistoryJobs] = useState<GenerationJob[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [providerStatus, setProviderStatus] =
    useState<ProviderConfigStatus | null>(null);
  const [domainPacks, setDomainPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fact Registry Filters
  const [factSearch, setFactSearch] = useState('');
  const [factDomainFilter, setFactDomainFilter] = useState<string>('all');
  const [factTypeFilter, setFactTypeFilter] = useState<string>('all');
  const [factImportanceFilter, setFactImportanceFilter] =
    useState<string>('all');
  const [factCertaintyFilter, setFactCertaintyFilter] = useState<string>('all');
  const [factOutputFilter, setFactOutputFilter] = useState<string>('all');

  const activeFactFilterCount = [
    factSearch.trim() !== '',
    factDomainFilter !== 'all',
    factTypeFilter !== 'all',
    factImportanceFilter !== 'all',
    factCertaintyFilter !== 'all',
    factOutputFilter !== 'all',
  ].filter(Boolean).length;

  const handleResetFactFilters = () => {
    setFactSearch('');
    setFactDomainFilter('all');
    setFactTypeFilter('all');
    setFactImportanceFilter('all');
    setFactCertaintyFilter('all');
    setFactOutputFilter('all');
  };

  // Claim & Fact Traceability Drawer State
  const [inspectedClaim, setInspectedClaim] = useState<OutputClaim | null>(
    null
  );
  const [inspectedFact, setInspectedFact] = useState<FactRegistryItem | null>(
    null
  );
  const [inspectedDoc, setInspectedDoc] = useState<SourceDocument | null>(null);

  // Verification Lookup Target
  const [targetVerificationId, setTargetVerificationId] = useState<string>('');

  // Settings form state
  const [cfgExecMode, setCfgExecMode] = useState<'sequential' | 'parallel'>(
    'sequential'
  );
  const [cfgChunkTarget, setCfgChunkTarget] = useState<number>(600);
  const [cfgChunkOverlap, setCfgChunkOverlap] = useState<number>(50);
  const [cfgModelName, setCfgModelName] = useState<string>('qwen2.5:7b');
  const [cfgSavedBanner, setCfgSavedBanner] = useState<string | null>(null);

  const setActiveTab = (tab: NavTab) => {
    setActiveTabState(tab);
    const targetPath =
      tab === 'verify' && targetVerificationId
        ? `/verify/${encodeURIComponent(targetVerificationId)}`
        : TAB_TO_PATH[tab] || '/dashboard';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  };

  const authHeaders = (tokenOverride?: string | null): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const effectiveToken =
      tokenOverride !== undefined ? tokenOverride : authToken;
    if (effectiveToken) h['Authorization'] = `Bearer ${effectiveToken}`;
    return h;
  };

  const handleLogout = async (notice?: string) => {
    const tokenToRevoke = authToken || getStoredAuthToken();
    if (tokenToRevoke) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenToRevoke}`,
          },
        });
      } catch {
        // Proceed with client session cleanup even if network call fails
      }
    }
    clearStoredAuthToken();
    setCurrentUser(null);
    setAuthToken(null);
    setAuthModalOpen(false);
    setPublicVerifyMode(false);
    setAuthRouteMode('login');
    setSessionNotice(notice || null);
    setDocuments([]);
    setAllFacts([]);
    setOutputs([]);
    setProvenanceList([]);
    setHistoryJobs([]);
    setAuditLogs([]);
    if (window.location.pathname !== '/login') {
      window.history.replaceState({}, '', '/login');
    }
  };

  const handleAuthenticated = (
    user: User,
    token: string,
    rememberMe = true
  ) => {
    saveStoredAuthToken(token, rememberMe);
    setCurrentUser(user);
    setAuthToken(token);
    setSessionNotice(null);
    setPublicVerifyMode(false);
    setActiveTabState('dashboard');
    if (window.location.pathname !== '/dashboard') {
      window.history.pushState({}, '', '/dashboard');
    }
  };

  const fetchAllPlatformData = async (
    demoFlag = includeDemo,
    tokenOverride?: string | null
  ) => {
    const effectiveToken =
      tokenOverride !== undefined ? tokenOverride : authToken;
    if (!effectiveToken) {
      setLoading(false);
      return;
    }
    try {
      const q = `?includeDemo=${demoFlag}`;
      const headers = authHeaders(effectiveToken);
      const [
        meRes,
        docsRes,
        factsRes,
        outputsRes,
        provRes,
        histRes,
        anaRes,
        provStatRes,
        domRes,
      ] = await Promise.all([
        fetch('/api/auth/me', { headers }),
        fetch(`/api/documents${q}`, { headers }),
        fetch(`/api/facts${q}`, { headers }),
        fetch(`/api/outputs${q}`, { headers }),
        fetch(`/api/provenance${q}`, { headers }),
        fetch(`/api/history${q}`, { headers }),
        fetch(`/api/analytics${q}`, { headers }),
        fetch('/api/provider-status', { headers }),
        fetch('/api/domains', { headers }),
      ]);

      if (meRes.status === 401) {
        const errData = await meRes.json().catch(() => ({}));
        await handleLogout(
          errData.code === 'SESSION_EXPIRED'
            ? 'Your session has expired. Please sign in again.'
            : 'Authentication required. Please sign in to access ContentX.'
        );
        return;
      }

      const [
        meData,
        docsData,
        factsData,
        outputsData,
        provData,
        histData,
        anaData,
        provStatData,
        domData,
      ] = await Promise.all([
        meRes.json(),
        docsRes.json(),
        factsRes.json(),
        outputsRes.json(),
        provRes.json(),
        histRes.json(),
        anaRes.json(),
        provStatRes.json(),
        domRes.json(),
      ]);

      if (meData.user) {
        setCurrentUser(meData.user);
      }

      const docList: SourceDocument[] = docsData.documents || [];
      setDocuments(docList);
      setAllFacts(factsData.facts || []);
      setOutputs(outputsData.outputs || []);
      setProvenanceList(provData.provenance || []);
      setHistoryJobs(histData.jobs || []);
      setAuditLogs(histData.audit_logs || []);
      setAnalytics(anaData);
      setProviderStatus(provStatData);
      setDomainPacks(domData.domains || []);

      if (provStatData) {
        setCfgExecMode(provStatData.execution_mode || 'sequential');
        setCfgChunkTarget(provStatData.chunk_target_words || 600);
        setCfgChunkOverlap(provStatData.chunk_overlap_words || 50);
        setCfgModelName(provStatData.ollama_generation_model || 'qwen2.5:7b');
      }

      const targetDocId =
        selectedDocId && docList.some((d) => d.document_id === selectedDocId)
          ? selectedDocId
          : docList[0]?.document_id || '';

      if (targetDocId) {
        setSelectedDocId(targetDocId);
        await fetchSingleDocumentDetails(targetDocId, effectiveToken);
      } else {
        setSelectedDocId('');
        setActiveDocChunks([]);
        setActiveDocFacts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchSingleDocumentDetails = async (
    docId: string,
    tokenOverride?: string | null
  ) => {
    if (!docId || docId === 'all') return;
    const res = await fetch(`/api/documents/${docId}`, {
      headers: authHeaders(tokenOverride),
    });
    if (res.ok) {
      const data = await res.json();
      setActiveDocChunks(data.chunks || []);
      setActiveDocFacts(data.facts || []);
    }
  };

  // Initial route & session verification on application load
  useEffect(() => {
    const verifyInitialSessionAndRoute = async () => {
      const pathname = window.location.pathname || '/';
      const storedToken = getStoredAuthToken();

      // Check if user opened a public verification link (/verify or /verify/:id)
      if (pathname === '/verify' || pathname.startsWith('/verify/')) {
        const verId = pathname.startsWith('/verify/')
          ? decodeURIComponent(pathname.slice('/verify/'.length))
          : 'VER-DEMO-CYB-01';
        if (verId) {
          setTargetVerificationId(verId);
        }
      }

      if (!storedToken) {
        setCurrentUser(null);
        setAuthToken(null);
        setAuthChecked(true);
        setLoading(false);

        if (pathname === '/register') {
          setAuthRouteMode('register');
        } else if (pathname === '/forgot-password') {
          setAuthRouteMode('forgot-password');
        } else if (pathname === '/verify' || pathname.startsWith('/verify/')) {
          setPublicVerifyMode(true);
        } else {
          setAuthRouteMode('login');
          if (PROTECTED_PATHS[pathname]) {
            setSessionNotice(
              'Authentication required. Please sign in to access ContentX.'
            );
          }
          if (pathname !== '/login') {
            window.history.replaceState({}, '', '/login');
          }
        }
        return;
      }

      // Validate stored token with backend
      try {
        const res = await fetch('/api/auth/me', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${storedToken}`,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.authenticated || !data.user) {
          clearStoredAuthToken();
          setCurrentUser(null);
          setAuthToken(null);
          setAuthChecked(true);
          setLoading(false);
          setAuthRouteMode('login');
          setSessionNotice(
            data.code === 'SESSION_EXPIRED'
              ? 'Your session has expired. Please sign in again.'
              : 'Please sign in to access ContentX.'
          );
          if (pathname !== '/login') {
            window.history.replaceState({}, '', '/login');
          }
          return;
        }

        setCurrentUser(data.user);
        setAuthToken(storedToken);
        setAuthChecked(true);

        if (PROTECTED_PATHS[pathname]) {
          setActiveTabState(PROTECTED_PATHS[pathname]);
        } else if (pathname === '/verify' || pathname.startsWith('/verify/')) {
          setActiveTabState('verify');
        } else {
          setActiveTabState('dashboard');
          window.history.replaceState({}, '', '/dashboard');
        }
      } catch {
        clearStoredAuthToken();
        setCurrentUser(null);
        setAuthToken(null);
        setAuthChecked(true);
        setLoading(false);
        if (window.location.pathname !== '/login') {
          window.history.replaceState({}, '', '/login');
        }
      }
    };

    verifyInitialSessionAndRoute();

    const handlePopState = () => {
      const path = window.location.pathname || '/';
      if (path === '/verify' || path.startsWith('/verify/')) {
        const vid = path.startsWith('/verify/')
          ? decodeURIComponent(path.slice('/verify/'.length))
          : '';
        if (vid) setTargetVerificationId(vid);
        if (getStoredAuthToken()) {
          setActiveTabState('verify');
        } else {
          setPublicVerifyMode(true);
        }
        return;
      }
      if (!getStoredAuthToken()) {
        setPublicVerifyMode(false);
        if (path === '/register') setAuthRouteMode('register');
        else if (path === '/forgot-password')
          setAuthRouteMode('forgot-password');
        else {
          setAuthRouteMode('login');
          if (PROTECTED_PATHS[path]) {
            setSessionNotice(
              'Authentication required. Please sign in to access ContentX.'
            );
            window.history.replaceState({}, '', '/login');
          }
        }
        return;
      }
      if (PROTECTED_PATHS[path]) {
        setActiveTabState(PROTECTED_PATHS[path]);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (authChecked && authToken && currentUser) {
      fetchAllPlatformData(includeDemo, authToken);
    }
  }, [authChecked, includeDemo, authToken]);

  const handleSelectDoc = async (docId: string) => {
    setSelectedDocId(docId);
    if (docId && docId !== 'all') {
      await fetchSingleDocumentDetails(docId);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      await fetchAllPlatformData(includeDemo);
    }
  };

  const handleInspectFactById = (factId: string, docId: string) => {
    const found =
      allFacts.find((f) => f.fact_id === factId && f.document_id === docId) ||
      allFacts.find((f) => f.fact_id === factId) ||
      activeDocFacts.find((f) => f.fact_id === factId) ||
      null;
    const doc = documents.find((d) => d.document_id === docId) || null;
    setInspectedClaim(null);
    setInspectedFact(found);
    setInspectedDoc(doc);
  };

  const handleSaveProviderSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setCfgSavedBanner(null);
    const res = await fetch('/api/settings/provider', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        execution_mode: cfgExecMode,
        chunk_target_words: cfgChunkTarget,
        chunk_overlap_words: cfgChunkOverlap,
        ollama_generation_model: cfgModelName,
      }),
    });
    if (res.ok) {
      setCfgSavedBanner(
        'Configuration updated and logged in RBAC audit trail.'
      );
      await fetchAllPlatformData(includeDemo);
    }
  };

  const selectedDoc =
    documents.find((d) => d.document_id === selectedDocId) ||
    documents[0] ||
    null;

  const outputsForSelectedDoc = outputs.filter(
    (o) => o.document_id === (selectedDoc?.document_id || '')
  );

  // Filter Fact Registry items
  const filteredRegistryFacts = allFacts.filter((f) => {
    if (
      factDomainFilter !== 'all' &&
      f.domain.toLowerCase() !== factDomainFilter.toLowerCase()
    ) {
      return false;
    }
    if (factTypeFilter !== 'all' && f.fact_type !== factTypeFilter) {
      return false;
    }
    if (
      factImportanceFilter !== 'all' &&
      f.importance !== factImportanceFilter
    ) {
      return false;
    }
    if (factCertaintyFilter !== 'all' && f.certainty !== factCertaintyFilter) {
      return false;
    }
    if (
      factOutputFilter !== 'all' &&
      !f.used_by_outputs.includes(factOutputFilter as OutputFormatType)
    ) {
      return false;
    }
    if (factSearch.trim()) {
      const q = factSearch.toLowerCase();
      return (
        f.fact_id.toLowerCase().includes(q) ||
        f.statement.toLowerCase().includes(q) ||
        f.entities.some((e) => e.toLowerCase().includes(q)) ||
        f.technical_identifiers.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transform', label: 'Transform', icon: Workflow },
    { id: 'fact_registry', label: 'Fact Registry', icon: Database },
    { id: 'outputs', label: 'Outputs', icon: Layers },
    { id: 'verify', label: 'Verify', icon: ShieldCheck },
    { id: 'provenance', label: 'Provenance', icon: FileCheck },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  // ============================================================
  // MANDATORY AUTHENTICATION ENTRY POINT & PUBLIC /VERIFY/:ID GUARD
  // ============================================================
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white font-mono text-xs">
        Verifying ContentX session...
      </div>
    );
  }

  if (!currentUser || !authToken) {
    if (publicVerifyMode) {
      return (
        <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3.5">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                ContentX
              </span>
              <span className="text-xs font-mono text-slate-500">
                Public Provenance & Integrity Verification Portal
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPublicVerifyMode(false);
                setAuthRouteMode('login');
                window.history.pushState({}, '', '/login');
              }}
              className="bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              Sign In to ContentX
            </button>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-6xl">
              <VerificationAndProvenanceView
                mode="verify"
                provenanceList={[]}
                initialVerificationId={
                  targetVerificationId || 'VER-DEMO-CYB-01'
                }
                userRole="Viewer"
                authToken={null}
                onSelectVerificationId={(vid) => {
                  setTargetVerificationId(vid);
                  window.history.pushState(
                    {},
                    '',
                    `/verify/${encodeURIComponent(vid)}`
                  );
                }}
                onRefreshProvenance={() => {}}
              />
            </div>
          </main>
        </div>
      );
    }

    return (
      <AuthPage
        mode={authRouteMode}
        sessionNotice={sessionNotice}
        onChangeMode={(nextMode) => {
          setAuthRouteMode(nextMode);
          const nextPath =
            nextMode === 'login'
              ? '/login'
              : nextMode === 'register'
              ? '/register'
              : '/forgot-password';
          if (window.location.pathname !== nextPath) {
            window.history.pushState({}, '', nextPath);
          }
        }}
        onAuthenticated={handleAuthenticated}
        onOpenPublicVerification={() => {
          const defaultVerifyId = targetVerificationId || 'VER-DEMO-CYB-01';
          setTargetVerificationId(defaultVerifyId);
          setPublicVerifyMode(true);
          window.history.pushState(
            {},
            '',
            `/verify/${encodeURIComponent(defaultVerifyId)}`
          );
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* TOP BAR CONTRACT: Strictly 3 Zones (Brand Wordmark, 5 Nav Links, 2 Primary Actions) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3.5">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dashboard');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap"
        >
          ContentX
        </a>

        {/* Zone 2: 5 Clean Text Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600'
                : ''
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('transform')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap ${
              activeTab === 'transform'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600'
                : ''
            }`}
          >
            Transform
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('fact_registry')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap ${
              activeTab === 'fact_registry'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600'
                : ''
            }`}
          >
            Fact Registry
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('outputs')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap ${
              activeTab === 'outputs'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600'
                : ''
            }`}
          >
            Output Studio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('verify')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap ${
              activeTab === 'verify'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600'
                : ''
            }`}
          >
            Verify
          </button>
        </nav>

        {/* Zone 3: Primary Actions (Upload Source + RBAC Account + Logout) */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('transform')}
            className="bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Upload Source
          </button>
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap font-mono"
            title="Inspect session or switch RBAC role"
          >
            {currentUser.name} · {currentUser.role}
          </button>
          <button
            type="button"
            onClick={() => handleLogout()}
            className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-colors whitespace-nowrap"
            title="Sign out of ContentX"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Container: Left Sidebar + Viewport */}
      <div className="flex flex-1">
        {/* Desktop Sidebar Navigation (248px width) */}
        <aside className="hidden lg:flex w-62 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4">
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-semibold text-slate-400">
              Platform Navigation
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Safe Demo Mode Control & Principle Callout */}
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">
                  Demo Dataset Mode
                </span>
                <input
                  type="checkbox"
                  checked={includeDemo}
                  onChange={(e) => setIncludeDemo(e.target.checked)}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Sample documents are explicitly labeled{' '}
                <span className="font-mono font-semibold text-amber-700">
                  DEMO DATA
                </span>{' '}
                and isolated from user uploads.
              </p>
            </div>

            <div className="px-1 text-[11px] leading-relaxed text-slate-500">
              <div className="font-semibold text-slate-800">
                One Source. Every Format. Verified at Every Step.
              </div>
              <div className="mt-0.5">
                "Change the complexity of the message, not the truth behind it."
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* ============================================================ */}
            {/* VIEW 1: DASHBOARD (Section 35) */}
            {/* ============================================================ */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {/* Hero / Principle Banner */}
                <div className="flex flex-col gap-4 border border-slate-200 bg-white p-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="text-xs font-mono text-blue-700 font-semibold">
                      DOMAIN-AWARE CONTENT TRANSFORMATION, RAG, VERIFICATION &
                      PROVENANCE
                    </div>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                      One Source. Every Format. Verified at Every Step.
                    </h1>
                    <p className="mt-1.5 text-sm text-slate-600">
                      Transform one trusted source document into seven verified
                      formats while preserving the canonical Fact Registry,
                      source page traceability, uncertainty, and negation.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('transform')}
                      className="inline-flex items-center gap-2 bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
                    >
                      <Plus className="h-4 w-4" />
                      <span>UPLOAD SOURCE DOCUMENT</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('verify')}
                      className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                    >
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <span>Public Verification Portal</span>
                    </button>
                  </div>
                </div>

                {/* 5 Key Metrics Bar (Section 35) */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  <div className="border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Documents Processed
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {analytics?.documents_processed ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      SHA-256 Fingerprinted
                    </div>
                  </div>

                  <div className="border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Facts Extracted
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {analytics?.facts_extracted ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      Canonical Fact Registry
                    </div>
                  </div>

                  <div className="border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Outputs Generated
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {analytics?.outputs_generated ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      Sequential Execution
                    </div>
                  </div>

                  <div className="border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Validation Rate
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                      {analytics?.average_validation_score ?? 0}%
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      15-Point Schema & Fact Gate
                    </div>
                  </div>

                  <div className="border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Verified Outputs
                    </div>
                    <div className="mt-1.5 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                      {analytics?.verified_outputs ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      Provenance Attested
                    </div>
                  </div>
                </div>

                {/* Controlled Pipeline Flow Strip */}
                <div className="border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-600">
                    <span className="font-semibold text-slate-900">
                      CONTROLLED PIPELINE:
                    </span>
                    <span>SOURCE</span>
                    <span>→</span>
                    <span>UNDERSTANDING</span>
                    <span>→</span>
                    <span className="font-semibold text-blue-700">
                      FACT REGISTRY
                    </span>
                    <span>→</span>
                    <span>DOMAIN INTELLIGENCE</span>
                    <span>→</span>
                    <span>TRUTH COMPRESSION</span>
                    <span>→</span>
                    <span>7 OUTPUTS</span>
                    <span>→</span>
                    <span>15-POINT VALIDATION</span>
                    <span>→</span>
                    <span className="font-semibold text-emerald-700">
                      PROVENANCE & VERIFICATION
                    </span>
                  </div>
                </div>

                {/* Recent Documents Table (Section 35) */}
                <div className="border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Ingested Source Documents
                      </h2>
                      <p className="text-xs text-slate-500">
                        Click a document to inspect its Understanding, Fact
                        Registry, or launch multi-format Transformation.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDemo}
                        onChange={(e) => setIncludeDemo(e.target.checked)}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      <span>Show Labeled DEMO DATA</span>
                    </label>
                  </div>

                  {loading ? (
                    <div className="p-8 text-center text-xs text-slate-500 font-mono">
                      Loading verified source registry...
                    </div>
                  ) : documents.length === 0 ? (
                    <div className="p-10 text-center space-y-3">
                      <div className="text-sm font-semibold text-slate-900">
                        No user-uploaded documents yet
                      </div>
                      <p className="text-xs text-slate-500">
                        Upload a PDF, DOCX, or TXT source document or enable Demo
                        Dataset Mode to inspect sample advisories.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('transform')}
                        className="bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        UPLOAD SOURCE DOCUMENT
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                            <th className="py-3 px-4">Document</th>
                            <th className="py-3 px-4">Domain</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4 text-right">Facts</th>
                            <th className="py-3 px-4 text-right">Outputs</th>
                            <th className="py-3 px-4">Created</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                          {documents.map((doc) => (
                            <tr
                              key={doc.document_id}
                              className="hover:bg-slate-50 transition-colors"
                            >
                              <td className="py-3.5 px-4">
                                <div className="font-semibold text-slate-900">
                                  {doc.filename}
                                  {doc.is_demo && (
                                    <span className="ml-2 font-mono text-[11px] font-semibold text-amber-700">
                                      DEMO DATA
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                                  SHA-256: {doc.sha256_fingerprint.slice(0, 16)}
                                  ... · {doc.pages}p · {doc.word_count} words
                                </div>
                              </td>
                              <td className="py-3.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                                {doc.detected_domain}
                              </td>
                              <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                                <span className="font-semibold text-emerald-700">
                                  {doc.processing_status.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                                {doc.facts_count}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono font-semibold text-blue-700 tabular-nums">
                                {doc.outputs_count}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                                {doc.upload_date.slice(0, 10)}
                              </td>
                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleSelectDoc(doc.document_id);
                                      setActiveTab('transform');
                                    }}
                                    className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                                  >
                                    Transform
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleSelectDoc(doc.document_id);
                                      setActiveTab('outputs');
                                    }}
                                    className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                                  >
                                    Outputs
                                  </button>
                                  {(currentUser?.role === 'Admin' ||
                                    currentUser?.role === 'Editor') && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleDeleteDocument(doc.document_id)
                                      }
                                      className="p-1 text-slate-400 hover:text-red-600"
                                      title="Delete Document"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 2: TRANSFORM WORKSPACE (Sections 36 & 37) */}
            {/* ============================================================ */}
            {activeTab === 'transform' && (
              <TransformWorkspace
                documents={documents}
                selectedDoc={selectedDoc}
                chunks={activeDocChunks}
                facts={activeDocFacts}
                outputsForDoc={outputsForSelectedDoc}
                userRole={currentUser?.role || 'Viewer'}
                authToken={authToken}
                onSelectDoc={handleSelectDoc}
                onDocumentUploaded={async (newDoc) => {
                  await fetchAllPlatformData(includeDemo);
                  await handleSelectDoc(newDoc.document_id);
                }}
                onGenerationCompleted={async (_newOutputs, docId) => {
                  await fetchAllPlatformData(includeDemo);
                  await handleSelectDoc(docId);
                }}
                onInspectFact={(fact) => {
                  setInspectedClaim(null);
                  setInspectedFact(fact);
                  setInspectedDoc(selectedDoc);
                }}
                onOpenOutputStudio={() => setActiveTab('outputs')}
                onOpenVerify={(vid) => {
                  setTargetVerificationId(vid);
                  setActiveTab('verify');
                }}
              />
            )}

            {/* ============================================================ */}
            {/* VIEW 3: FACT REGISTRY UI (Section 8 & 38) */}
            {/* ============================================================ */}
            {activeTab === 'fact_registry' && (
              <div className="space-y-6">
                <div className="border border-slate-200 bg-white p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h1 className="text-xl font-semibold text-slate-900">
                        Canonical Fact Registry
                      </h1>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Single source of truth across all transformations. Click
                        any fact row to inspect its source chunk, page number,
                        and verbatim supporting text.
                      </p>
                    </div>
                    <div className="font-mono text-xs text-slate-600 tabular-nums">
                      Showing {filteredRegistryFacts.length} of {allFacts.length}{' '}
                      Extracted Facts
                    </div>
                  </div>

                  {/* Search & Filters Bar (Domain, Category/Type, Importance, Certainty) + Clear/Reset Button */}
                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    <div className="relative min-w-[220px] flex-1">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={factSearch}
                        onChange={(e) => setFactSearch(e.target.value)}
                        placeholder="Search Fact ID, statement, CVE, entity..."
                        className="w-full border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    <select
                      value={factDomainFilter}
                      onChange={(e) => setFactDomainFilter(e.target.value)}
                      aria-label="Filter by Domain"
                      className="border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="all">All Domains</option>
                      <option value="Cybersecurity">Cybersecurity</option>
                      <option value="Blockchain">Blockchain</option>
                      <option value="Business">Business</option>
                      <option value="Research">Research</option>
                      <option value="Policy">Policy</option>
                      <option value="Education">Education</option>
                      <option value="General">General</option>
                    </select>

                    <select
                      value={factTypeFilter}
                      onChange={(e) => setFactTypeFilter(e.target.value)}
                      aria-label="Filter by Category"
                      className="border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="all">All Categories</option>
                      <option value="technical_identifier">
                        technical_identifier
                      </option>
                      <option value="metric">metric</option>
                      <option value="event">event</option>
                      <option value="finding">finding</option>
                      <option value="uncertainty">uncertainty</option>
                      <option value="negation">negation</option>
                      <option value="mitigation">mitigation</option>
                      <option value="concept">concept</option>
                    </select>

                    <select
                      value={factImportanceFilter}
                      onChange={(e) => setFactImportanceFilter(e.target.value)}
                      aria-label="Filter by Importance"
                      className="border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="all">All Importance</option>
                      <option value="critical">critical</option>
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>

                    <select
                      value={factCertaintyFilter}
                      onChange={(e) => setFactCertaintyFilter(e.target.value)}
                      aria-label="Filter by Certainty"
                      className="border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="all">All Certainty</option>
                      <option value="confirmed">confirmed</option>
                      <option value="possible">possible</option>
                      <option value="suspected">suspected</option>
                      <option value="negated">negated</option>
                      <option value="conditional">conditional</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleResetFactFilters}
                      disabled={activeFactFilterCount === 0}
                      title="Clear all active category, importance, domain, certainty, and search filters"
                      className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        activeFactFilterCount > 0
                          ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                          : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>
                        Clear Filters
                        {activeFactFilterCount > 0
                          ? ` (${activeFactFilterCount})`
                          : ''}
                      </span>
                    </button>
                  </div>

                  {/* Output Usage Filter Row */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs">
                    <span className="text-slate-500 mr-1">
                      Filter by Output Usage:
                    </span>
                    {[
                      'all',
                      'linkedin',
                      'twitter',
                      'executive_summary',
                      'advisory',
                      'presentation',
                      'infographic',
                      'video_package',
                    ].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setFactOutputFilter(fmt)}
                        className={`px-2.5 py-1 font-mono text-xs transition-colors whitespace-nowrap ${
                          factOutputFilter === fmt
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {fmt === 'all' ? 'All Outputs' : fmt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fact Registry Table (Section 38) */}
                <div className="border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Fact ID</th>
                        <th className="py-3 px-4">Statement</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Importance</th>
                        <th className="py-3 px-4">Certainty</th>
                        <th className="py-3 px-4">Source Page</th>
                        <th className="py-3 px-4">Used By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {filteredRegistryFacts.map((fact) => {
                        const doc =
                          documents.find(
                            (d) => d.document_id === fact.document_id
                          ) || null;
                        return (
                          <tr
                            key={`${fact.document_id}:${fact.fact_id}`}
                            onClick={() => {
                              setInspectedClaim(null);
                              setInspectedFact(fact);
                              setInspectedDoc(doc);
                            }}
                            className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                          >
                            <td className="py-3 px-4 font-mono font-semibold text-blue-700 tabular-nums whitespace-nowrap">
                              {fact.fact_id}
                              {fact.is_demo && (
                                <div className="text-[10px] text-amber-700">
                                  DEMO
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-900 max-w-xl">
                              <div>{fact.statement}</div>
                              <div className="mt-1 font-mono text-[11px] text-slate-500">
                                {fact.document_name} · Domain: {fact.domain}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                              {fact.fact_type}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-800 whitespace-nowrap">
                              {fact.importance}
                            </td>
                            <td className="py-3 px-4 font-mono whitespace-nowrap">
                              <span
                                className={
                                  fact.certainty === 'confirmed'
                                    ? 'text-emerald-700 font-semibold'
                                    : fact.certainty === 'negated'
                                    ? 'text-blue-700 font-semibold'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {fact.certainty}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                              Page {fact.source_page} ({fact.source_chunk_id})
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600">
                              {fact.used_by_outputs.length > 0
                                ? fact.used_by_outputs.join(' · ')
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 4: OUTPUT STUDIO & CLAIM INSPECTOR (Sections 39, 40, 41) */}
            {/* ============================================================ */}
            {activeTab === 'outputs' && (
              <OutputStudioView
                outputs={outputs}
                documents={documents}
                factsByDoc={{}}
                selectedDocId={selectedDocId || 'all'}
                authToken={authToken}
                onSelectDocId={(id) => setSelectedDocId(id)}
                onInspectClaim={(claim, doc) => {
                  const foundFact =
                    allFacts.find(
                      (f) =>
                        f.fact_id === claim.fact_id &&
                        (!doc || f.document_id === doc.document_id)
                    ) || null;
                  setInspectedClaim(claim);
                  setInspectedFact(foundFact);
                  setInspectedDoc(doc);
                }}
                onInspectFactId={handleInspectFactById}
                onOpenVerify={(vid) => {
                  setTargetVerificationId(vid);
                  setActiveTab('verify');
                }}
                onOutputUpdated={() => fetchAllPlatformData(includeDemo)}
              />
            )}

            {/* ============================================================ */}
            {/* VIEW 5 & 6: PUBLIC VERIFICATION & PROVENANCE (Sections 32 & 33) */}
            {/* ============================================================ */}
            {(activeTab === 'verify' || activeTab === 'provenance') && (
              <VerificationAndProvenanceView
                mode={activeTab}
                provenanceList={provenanceList}
                initialVerificationId={targetVerificationId}
                userRole={currentUser?.role || 'Viewer'}
                authToken={authToken}
                onSelectVerificationId={(vid) => {
                  setTargetVerificationId(vid);
                  setActiveTab('verify');
                }}
                onRefreshProvenance={() => fetchAllPlatformData(includeDemo)}
              />
            )}

            {/* ============================================================ */}
            {/* VIEW 7: GENERATION HISTORY & AUDIT TRAIL (Section 42) */}
            {/* ============================================================ */}
            {activeTab === 'history' && (
              <div className="space-y-6">
                <div className="border border-slate-200 bg-white p-5">
                  <h1 className="text-xl font-semibold text-slate-900">
                    Generation History & RBAC Security Audit Trail
                  </h1>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Complete chronological log of transformation jobs, execution
                    modes, validation outcomes, and reopenable output packages.
                  </p>
                </div>

                <div className="border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Document</th>
                        <th className="py-3 px-4">Generation Job</th>
                        <th className="py-3 px-4">Outputs</th>
                        <th className="py-3 px-4">Model & Mode</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Validation</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {historyJobs.map((job) => (
                        <tr key={job.job_id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {job.document_name}
                            {job.is_demo && (
                              <span className="ml-2 font-mono text-[11px] text-amber-700">
                                DEMO DATA
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                            {job.job_id} · {job.audience}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-700">
                            {job.completed_formats.join(', ')}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                            {job.model} ({job.execution_mode})
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                            {job.created_at.slice(0, 19).replace('T', ' ')}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-emerald-700 whitespace-nowrap">
                            PASSED ({job.completed_formats.length}/
                            {job.selected_formats.length})
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {job.status.toUpperCase()}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectDoc(job.document_id);
                                setActiveTab('outputs');
                              }}
                              className="border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              Reopen Results
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* RBAC Security Audit Log */}
                <div className="border border-slate-200 bg-white p-5">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Immutable Security & RBAC Audit Log
                  </h2>
                  <div className="mt-3 divide-y divide-slate-100 font-mono text-xs">
                    {auditLogs.map((log) => (
                      <div
                        key={log.log_id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div className="text-slate-800">
                          <span className="font-semibold text-blue-700">
                            [{log.action}]
                          </span>{' '}
                          {log.details}
                        </div>
                        <div className="text-slate-500 tabular-nums">
                          {log.user_email} ({log.user_role}) ·{' '}
                          {log.timestamp.slice(0, 19).replace('T', ' ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 8: ANALYTICS (Section 43) */}
            {/* ============================================================ */}
            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-white p-5">
                  <div>
                    <h1 className="text-xl font-semibold text-slate-900">
                      Verification & Grounding Telemetry Analytics
                    </h1>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Computed strictly from real processed documents and
                      validation runs. Never fabricates telemetry.
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeDemo}
                      onChange={(e) => setIncludeDemo(e.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span>Include Labeled DEMO DATA in Metrics</span>
                  </label>
                </div>

                {!analytics || !analytics.has_data ? (
                  <div className="border border-slate-200 bg-white p-12 text-center">
                    <div className="font-mono text-sm font-semibold text-slate-800">
                      No data available
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Upload a source document or enable "Include Labeled DEMO
                      DATA" to view computed platform analytics.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                      <div className="border border-slate-200 bg-white p-4">
                        <div className="text-xs text-slate-500">
                          Documents Processed
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                          {analytics.documents_processed}
                        </div>
                      </div>
                      <div className="border border-slate-200 bg-white p-4">
                        <div className="text-xs text-slate-500">
                          Outputs Generated
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                          {analytics.outputs_generated}
                        </div>
                      </div>
                      <div className="border border-slate-200 bg-white p-4">
                        <div className="text-xs text-slate-500">
                          Avg Validation Score
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                          {analytics.average_validation_score}%
                        </div>
                      </div>
                      <div className="border border-slate-200 bg-white p-4">
                        <div className="text-xs text-slate-500">
                          Source Grounding Rate
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                          {analytics.grounding_rate}%
                        </div>
                      </div>
                      <div className="border border-slate-200 bg-white p-4">
                        <div className="text-xs text-slate-500">
                          Failed Outputs
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                          {analytics.failed_outputs}
                        </div>
                      </div>
                      <div className="border border-slate-200 bg-white p-4">
                        <div className="text-xs text-slate-500">
                          Avg Generation Latency
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                          {analytics.average_latency_ms} ms
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                      {/* Domain Distribution */}
                      <div className="border border-slate-200 bg-white p-5">
                        <h2 className="text-sm font-semibold text-slate-900">
                          Domain Distribution
                        </h2>
                        <div className="mt-4 space-y-3">
                          {Object.entries(analytics.domain_distribution).map(
                            ([dom, count]) => (
                              <div key={dom} className="space-y-1">
                                <div className="flex justify-between text-xs font-mono tabular-nums">
                                  <span className="font-medium text-slate-800">
                                    {dom}
                                  </span>
                                  <span className="text-slate-600">
                                    {count} document(s)
                                  </span>
                                </div>
                                <div className="h-2 w-full bg-slate-100">
                                  <div
                                    className="h-2 bg-slate-900"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        Math.round(
                                          (count /
                                            Math.max(
                                              1,
                                              analytics.documents_processed
                                            )) *
                                            100
                                        )
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Output Format Distribution */}
                      <div className="border border-slate-200 bg-white p-5">
                        <h2 className="text-sm font-semibold text-slate-900">
                          Output Format Distribution
                        </h2>
                        <div className="mt-4 space-y-3">
                          {Object.entries(analytics.output_distribution).map(
                            ([fmt, count]) => (
                              <div key={fmt} className="space-y-1">
                                <div className="flex justify-between text-xs font-mono tabular-nums">
                                  <span className="font-medium text-slate-800">
                                    {fmt}
                                  </span>
                                  <span className="text-slate-600">
                                    {count} output(s)
                                  </span>
                                </div>
                                <div className="h-2 w-full bg-slate-100">
                                  <div
                                    className="h-2 bg-blue-600"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        Math.round(
                                          (count /
                                            Math.max(
                                              1,
                                              analytics.outputs_generated
                                            )) *
                                            100
                                        )
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 9: SETTINGS, PROVIDER ABSTRACTION & DOMAIN PACKS (Sections 29, 30, 54, 55, 59) */}
            {/* ============================================================ */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <div className="border border-slate-200 bg-white p-5">
                  <h1 className="text-xl font-semibold text-slate-900">
                    Platform Configuration, AI Provider Abstraction & Domain
                    Packs
                  </h1>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Configure Local Ollama (`qwen2.5:7b`), BGE-M3 1024-dim
                    embeddings, sliding-window chunking, and sequential
                    execution guardrails. OpenRouter is strictly disabled.
                  </p>
                </div>

                {cfgSavedBanner && (
                  <div className="border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 font-mono">
                    {cfgSavedBanner}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* Provider Configuration Form */}
                  <form
                    onSubmit={handleSaveProviderSettings}
                    className="border border-slate-200 bg-white p-6 lg:col-span-7 space-y-4"
                  >
                    <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-2.5">
                      AI Provider & RAG Execution Settings
                    </h2>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
                      <div>
                        <label className="block font-medium text-slate-700">
                          Default Local Generation Model
                        </label>
                        <input
                          type="text"
                          value={cfgModelName}
                          onChange={(e) => setCfgModelName(e.target.value)}
                          className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900"
                        />
                        <span className="text-[11px] text-slate-500 font-mono">
                          Default: qwen2.5:7b (num_ctx=16384, temp=0.1)
                        </span>
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700">
                          OLLAMA_GENERATION_EXECUTION_MODE
                        </label>
                        <select
                          value={cfgExecMode}
                          onChange={(e) =>
                            setCfgExecMode(
                              e.target.value as 'sequential' | 'parallel'
                            )
                          }
                          className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900"
                        >
                          <option value="sequential">
                            sequential (Default Proven Local Strategy)
                          </option>
                          <option value="parallel">
                            parallel (High-Concurrency Cloud Only)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700">
                          Sliding-Window Target Chunk Size (Words)
                        </label>
                        <input
                          type="number"
                          value={cfgChunkTarget}
                          onChange={(e) =>
                            setCfgChunkTarget(Number(e.target.value))
                          }
                          className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-slate-700">
                          Sliding-Window Chunk Overlap (Words)
                        </label>
                        <input
                          type="number"
                          value={cfgChunkOverlap}
                          onChange={(e) =>
                            setCfgChunkOverlap(Number(e.target.value))
                          }
                          className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs space-y-1.5 tabular-nums">
                      <div>
                        Embedding Model:{' '}
                        <strong>
                          {providerStatus?.ollama_embedding_model ||
                            'bge-m3:latest'}
                        </strong>{' '}
                        (Dimension: 1024 · Cosine Similarity)
                      </div>
                      <div>
                        Local Ollama Endpoint ({providerStatus?.ollama_url}):{' '}
                        <span
                          className={
                            providerStatus?.ollama_connected
                              ? 'text-emerald-700 font-semibold'
                              : 'text-amber-700 font-semibold'
                          }
                        >
                          {providerStatus?.ollama_connected
                            ? 'CONNECTED'
                            : 'Provider not configured locally — Using Grounded Fact-Registry Compiler'}
                        </span>
                      </div>
                      <div>
                        OpenRouter Integration:{' '}
                        <strong className="text-emerald-700">
                          DISABLED BY POLICY (Zero Paid External Routing)
                        </strong>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={currentUser?.role !== 'Admin'}
                        className="bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Save Runtime Configuration
                      </button>
                    </div>
                  </form>

                  {/* Modular Capabilities Status Matrix (Sections 5, 54, 55) */}
                  <div className="border border-slate-200 bg-white p-6 lg:col-span-5 space-y-4">
                    <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-2.5">
                      System Capability & Modular Extension Status
                    </h2>
                    <div className="divide-y divide-slate-100 text-xs font-mono">
                      <div className="flex justify-between py-2">
                        <span>PDF / DOCX / TXT Ingestion</span>
                        <span className="text-emerald-700 font-semibold">
                          Supported (Active)
                        </span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span>BGE-M3 1024-d + Selective RAG</span>
                        <span className="text-emerald-700 font-semibold">
                          Supported (Active)
                        </span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span>7 Formats + 15-Point Validation</span>
                        <span className="text-emerald-700 font-semibold">
                          Supported (Active)
                        </span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span>SHA-256 Provenance & /verify/{'{id}'}</span>
                        <span className="text-emerald-700 font-semibold">
                          Supported (Active)
                        </span>
                      </div>
                      <div className="flex justify-between py-2 text-slate-500">
                        <span>Images / Scanned PDFs / Audio / Video</span>
                        <span>Coming Soon (Extensible)</span>
                      </div>
                      <div className="flex justify-between py-2 text-slate-500">
                        <span>L1/L2 Blockchain Hash Anchoring</span>
                        <span>Provider Not Configured (Modular)</span>
                      </div>
                      <div className="flex justify-between py-2 text-slate-500">
                        <span>Direct MP4 Video / Image Rendering</span>
                        <span>Provider Not Configured (Modular)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pluggable Domain Packs Registry (Section 13) */}
                <div className="border border-slate-200 bg-white p-6">
                  <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
                    Pluggable Domain Intelligence Packs
                  </h2>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {domainPacks.map((pack) => (
                      <div
                        key={pack.id}
                        className="border border-slate-200 bg-slate-50/50 p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-900">
                            {pack.name}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-700 font-semibold">
                            {pack.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 font-mono">
                          {pack.entities.join(' · ')}
                        </div>
                        <div className="border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                          {pack.guardrail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation (<= 15% Viewport Height Cap) */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex lg:hidden items-center justify-around border-t border-slate-200 bg-white py-2 px-2">
        {navItems.slice(0, 6).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                isActive ? 'text-blue-600 font-semibold' : 'text-slate-600'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Claim & Fact Traceability Drawer */}
      <ClaimInspectorDrawer
        selectedClaim={inspectedClaim}
        selectedFact={inspectedFact}
        sourceDocument={inspectedDoc}
        onClose={() => {
          setInspectedClaim(null);
          setInspectedFact(null);
        }}
      />

      {/* Auth & RBAC Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentUser={currentUser}
        onAuthenticated={(user, token) => {
          handleAuthenticated(user, token, true);
        }}
        onLogout={() => {
          handleLogout();
        }}
      />
    </div>
  );
}
