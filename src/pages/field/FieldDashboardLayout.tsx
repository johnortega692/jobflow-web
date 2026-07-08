import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { DesktopNavTabs } from "../../components/field/DesktopNavTabs";
import { FieldAvatarMenu } from "../../components/field/FieldAvatarMenu";
import { MobileTabBar } from "../../components/field/MobileTabBar";
import {
  buildFieldPaintRow,
  buildFieldWcRows,
  loadAllProjectsForField,
  loadFieldViewCompanyName,
  type FieldPaintRow,
  type FieldWcItemRow,
} from "../../lib/fieldTrackerProject";
import { resolveDisplayCompanyName } from "../../lib/displayCompanyName";
import {
  applyFieldViewHandoffFromHash,
  clearFieldViewSession,
  clearFieldViewHandoffFromUrl,
  clearLegacyFieldViewHandoffHash,
  hasFieldViewHandoffHash,
  loadFieldViewSession,
  loginFieldViewWithPin,
  logoutFieldView,
  type FieldViewSession,
} from "../../lib/fieldViewAuth";
import {
  readFieldDarkMode,
  readFieldMobileView,
  writeFieldDarkMode,
  writeFieldMobileView,
} from "../../lib/fieldViewPrefs";
import { FIELD_COMPACT_MAX_WIDTH, useMediaQuery } from "../../lib/useMediaQuery";
import type { ProjectForm } from "../../types/database";
import { openManpowerCalHandoff } from "../../lib/manpowerCalUrl";
import "../../field-dashboard.css";

type FieldDashboardContextValue = {
  projects: ProjectForm[];
  paintRows: FieldPaintRow[];
  wcRows: FieldWcItemRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  toast: (msg: string) => void;
  mobileView: boolean;
  setMobileView: (value: boolean) => void;
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
};

const FieldDashboardContext = createContext<FieldDashboardContextValue | null>(null);

export function useFieldDashboard() {
  const ctx = useContext(FieldDashboardContext);
  if (!ctx) throw new Error("useFieldDashboard must be used within FieldDashboardLayout");
  return ctx;
}

function FieldViewPinLogin({
  companyName,
  onLogin,
  darkMode,
  setDarkMode,
}: {
  companyName: string;
  onLogin: (session: FieldViewSession) => void;
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const clean = pin.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loginFieldViewWithPin(clean);
      setPin("");
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`field-dashboard${darkMode ? " field-dashboard--dark" : ""}`}>
      <div className="field-login-shell">
        <form className="field-login-card" onSubmit={(e) => void submit(e)}>
          <div className="company-name">{companyName}</div>
          <h1>Field View</h1>
          <p>Enter your Field Tools PIN to continue.</p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="field-login-input"
            autoFocus
          />
          {error && <div className="banner banner-error">{error}</div>}
          <button type="submit" className="nav-button active field-login-button" disabled={busy || !pin.trim()}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
          <button
            type="button"
            className="nav-button nav-button-toggle"
            onClick={() => setDarkMode(!darkMode)}
          >
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function FieldDashboardLayout() {
  const { user, signOut } = useAuth();
  const { branding, profile } = useLetterhead();
  const location = useLocation();
  const [fieldSession, setFieldSession] = useState<FieldViewSession | null>(() => {
    clearLegacyFieldViewHandoffHash();
    return hasFieldViewHandoffHash() ? null : loadFieldViewSession();
  });
  const [handoffBusy, setHandoffBusy] = useState(() => hasFieldViewHandoffHash());
  const [projects, setProjects] = useState<ProjectForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [publicCompanyName, setPublicCompanyName] = useState("");
  const [mobileViewPref, setMobileViewState] = useState(readFieldMobileView);
  const [darkMode, setDarkModeState] = useState(readFieldDarkMode);
  const narrowViewport = useMediaQuery(`(max-width: ${FIELD_COMPACT_MAX_WIDTH}px)`);
  const isMobileNav = useMediaQuery("(max-width: 767px)");
  const mobileView = mobileViewPref || narrowViewport;

  const setMobileView = useCallback((value: boolean) => {
    setMobileViewState(value);
    writeFieldMobileView(value);
  }, []);

  const setDarkMode = useCallback((value: boolean) => {
    setDarkModeState(value);
    writeFieldDarkMode(value);
  }, []);

  const reload = useCallback(async () => {
    if (!user && !fieldSession) {
      setLoading(false);
      setProjects([]);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await loadAllProjectsForField();
    setLoading(false);
    if (result.error) {
      if (!user && /SESSION|LOGIN|FIELD_VIEW/i.test(result.error)) {
        clearFieldViewSession();
        setFieldSession(null);
      }
      setError(result.error);
      setProjects([]);
      return;
    }
    setProjects(result.projects);
  }, [fieldSession, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (user || !fieldSession) return;
    void loadFieldViewCompanyName().then(setPublicCompanyName);
  }, [fieldSession, user]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const paintRows = useMemo(() => projects.map(buildFieldPaintRow), [projects]);
  const wcRows = useMemo(() => projects.flatMap((p) => buildFieldWcRows(p)), [projects]);

  const companyName = user
    ? resolveDisplayCompanyName(branding.companyName.trim() || "Ironwood Commercial Builders")
    : resolveDisplayCompanyName(publicCompanyName.trim() || "Ironwood Commercial Builders");
  const pageTitle = location.pathname.includes("/paint")
    ? "Paint Dashboard"
    : location.pathname.includes("/calendar")
      ? "Installation Calendar"
      : location.pathname.includes("/workload")
        ? "Company Workload"
        : "Wallcovering Dashboard";

  useEffect(() => {
    document.title = `${pageTitle} · Field View`;

    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.href = "/field-favicon.svg";

    return () => {
      document.title = "JobFlow";
      link!.href = "/favicon.svg";
    };
  }, [pageTitle]);

  useEffect(() => {
    if (!user) return;
    if (hasFieldViewHandoffHash() || handoffBusy) return;
    clearFieldViewSession();
    setFieldSession(null);
  }, [user, handoffBusy]);

  useEffect(() => {
    if (!fieldSession) return;
    clearFieldViewHandoffFromUrl();
  }, [fieldSession]);

  useEffect(() => {
    if (fieldSession || !handoffBusy) return;
    let cancelled = false;
    void applyFieldViewHandoffFromHash().then((session) => {
      if (cancelled) return;
      if (session) setFieldSession(session);
      setHandoffBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fieldSession, handoffBusy]);

  if (handoffBusy) {
    return (
      <div className={`field-dashboard${darkMode ? " field-dashboard--dark" : ""}`}>
        <div className="field-login-shell">
          <div className="field-login-card">
            <div className="company-name">{companyName}</div>
            <h1>Field View</h1>
            <p>Signing you in from Field Tools…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user && !fieldSession) {
    return (
      <FieldViewPinLogin
        companyName={companyName}
        onLogin={setFieldSession}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
      />
    );
  }

  function handleOpenManpower() {
    void openManpowerCalHandoff(fieldSession ?? loadFieldViewSession(), toast);
  }

  function handleSignOut() {
    if (user) {
      void signOut();
      return;
    }
    if (fieldSession) {
      void logoutFieldView(fieldSession).finally(() => setFieldSession(null));
    }
  }

  const avatarName = user
    ? profile.name.trim() || user.email?.trim() || "User"
    : fieldSession?.name.trim() || "Field user";
  const avatarRole = user ? profile.title.trim() : fieldSession?.role.trim() || "";

  return (
    <FieldDashboardContext.Provider
      value={{
        projects,
        paintRows,
        wcRows,
        loading,
        error,
        reload,
        toast,
        mobileView,
        setMobileView,
        darkMode,
        setDarkMode,
      }}
    >
      <div
        className={[
          "field-dashboard",
          darkMode ? "field-dashboard--dark" : "",
          mobileView ? "field-dashboard--mobile" : "",
          isMobileNav ? "field-dashboard--bottom-nav" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={`field-toast${toastMsg ? " show" : ""}`}>{toastMsg ?? ""}</div>

        <header className="header">
          <div className="title-block">
            {!isMobileNav ? <div className="company-name">{companyName}</div> : null}
            <div className="title">
              <span>{pageTitle}</span>
            </div>
          </div>
          {!isMobileNav ? <DesktopNavTabs onOpenManpower={handleOpenManpower} /> : null}
          <FieldAvatarMenu
            name={avatarName}
            role={avatarRole}
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            mobileView={mobileView}
            setMobileView={setMobileView}
            onSignOut={handleSignOut}
          />
        </header>

        {error && <div className="banner banner-error">{error}</div>}

        <Outlet />

        {isMobileNav ? <MobileTabBar onOpenManpower={handleOpenManpower} /> : null}
      </div>
    </FieldDashboardContext.Provider>
  );
}

export function FieldToolbar({
  search,
  onSearchChange,
  pm,
  onPmChange,
  status,
  onStatusChange,
  pmOptions,
  statusOptions,
  searchPlaceholder,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  pm: string;
  onPmChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  pmOptions: string[];
  statusOptions: { value: string; label: string }[];
  searchPlaceholder: string;
}) {
  return (
    <div className="toolbar">
      <div className="search-wrap">
        <input
          type="search"
          value={search}
          placeholder={searchPlaceholder}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button type="button" className="clear-btn" onClick={() => onSearchChange("")} aria-label="Clear">
            ✕
          </button>
        )}
      </div>
      <select className="filter-select" value={pm} onChange={(e) => onPmChange(e.target.value)}>
        <option value="">All PMs</option>
        {pmOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select className="filter-select" value={status} onChange={(e) => onStatusChange(e.target.value)}>
        <option value="">All Statuses</option>
        {statusOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FieldStatusPill({ label, className }: { label: string; className: string }) {
  return <span className={`pill ${className}`}>{label}</span>;
}

export function FieldLoadingPanel({ message }: { message: string }) {
  return (
    <div className="loading-panel">
      <div className="spinner" />
      {message}
    </div>
  );
}

export function FieldEmptyPanel() {
  return <div className="loading-panel">No results found.</div>;
}

export function useDebouncedValue<T>(value: T, ms = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
