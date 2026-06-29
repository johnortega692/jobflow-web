import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { UserHeaderIdentity } from "../../components/UserHeaderIdentity";
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
  readFieldDarkMode,
  readFieldMobileView,
  writeFieldDarkMode,
  writeFieldMobileView,
} from "../../lib/fieldViewPrefs";
import type { ProjectForm } from "../../types/database";
import { manpowerCalUrl } from "../../lib/manpowerCalUrl";
import {
  FieldDesktopIcon,
  FieldMobileIcon,
  FieldMoonIcon,
  FieldSunIcon,
} from "../../components/field/FieldViewIcons";
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

function FieldViewToggles({
  mobileView,
  setMobileView,
  darkMode,
  setDarkMode,
  className = "nav-button nav-button-toggle nav-button-icon",
}: {
  mobileView: boolean;
  setMobileView: (value: boolean) => void;
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  className?: string;
}) {
  return (
    <>
      <button
        type="button"
        className={`${className}${mobileView ? " active" : ""}`}
        onClick={() => setMobileView(!mobileView)}
        title={mobileView ? "Switch to desktop layout" : "Switch to mobile layout"}
        aria-label={mobileView ? "Switch to desktop layout" : "Switch to mobile layout"}
        aria-pressed={mobileView}
      >
        {mobileView ? <FieldDesktopIcon /> : <FieldMobileIcon />}
      </button>
      <button
        type="button"
        className={`${className}${darkMode ? " active" : ""}`}
        onClick={() => setDarkMode(!darkMode)}
        title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        aria-pressed={darkMode}
      >
        {darkMode ? <FieldSunIcon /> : <FieldMoonIcon />}
      </button>
    </>
  );
}

export function FieldDashboardLayout() {
  const { user, signOut } = useAuth();
  const { branding, profile } = useLetterhead();
  const location = useLocation();
  const [projects, setProjects] = useState<ProjectForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [publicCompanyName, setPublicCompanyName] = useState("");
  const [mobileView, setMobileViewState] = useState(readFieldMobileView);
  const [darkMode, setDarkModeState] = useState(readFieldDarkMode);

  const setMobileView = useCallback((value: boolean) => {
    setMobileViewState(value);
    writeFieldMobileView(value);
  }, []);

  const setDarkMode = useCallback((value: boolean) => {
    setDarkModeState(value);
    writeFieldDarkMode(value);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadAllProjectsForField();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setProjects([]);
      return;
    }
    setProjects(result.projects);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (user) return;
    void loadFieldViewCompanyName().then(setPublicCompanyName);
  }, [user]);

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
      : "Wallcovering Dashboard";

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
        className={`field-dashboard${darkMode ? " field-dashboard--dark" : ""}${mobileView ? " field-dashboard--mobile" : ""}`}
      >
        <div className={`field-toast${toastMsg ? " show" : ""}`}>{toastMsg ?? ""}</div>

        <div className="header">
          <div className="title-block">
            <div className="company-name">{companyName}</div>
            <div className="title">
              <span>{pageTitle}</span>
            </div>
          </div>
          <div className="header-right">
            {user ? (
              <div className="field-header-account">
                <Link to="/projects" className="field-header-link">
                  Office
                </Link>
                <UserHeaderIdentity profile={profile} email={user.email} className="field-header-user" />
                <button type="button" className="field-header-signout" onClick={() => signOut()}>
                  Sign out
                </button>
              </div>
            ) : null}
            <div className="nav-buttons">
            <NavLink
              to="/field/wallcovering"
              className={({ isActive }) => `nav-button${isActive ? " active" : ""}`}
            >
              Wallcovering
            </NavLink>
            <a
              href={manpowerCalUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-button nav-button-external"
            >
              Manpower
            </a>
            <NavLink
              to="/field/paint"
              className={({ isActive }) => `nav-button${isActive ? " active" : ""}`}
            >
              Paint
            </NavLink>
            <NavLink
              to="/field/calendar"
              className={({ isActive }) => `nav-button${isActive ? " active" : ""}`}
            >
              Calendar
            </NavLink>
            <FieldViewToggles
              mobileView={mobileView}
              setMobileView={setMobileView}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
            />
            </div>
          </div>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <Outlet />

        {mobileView && (
          <div className="field-bottom-nav-wrap">
            <nav className="field-bottom-nav" aria-label="Field view sections">
              <NavLink
                to="/field/wallcovering"
                className={({ isActive }) => `field-bottom-nav-link${isActive ? " active" : ""}`}
              >
                Wallcovering
              </NavLink>
              <NavLink
                to="/field/paint"
                className={({ isActive }) => `field-bottom-nav-link${isActive ? " active" : ""}`}
              >
                Paint
              </NavLink>
              <NavLink
                to="/field/calendar"
                className={({ isActive }) => `field-bottom-nav-link${isActive ? " active" : ""}`}
              >
                Calendar
              </NavLink>
              <a
                href={manpowerCalUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="field-bottom-nav-link field-bottom-nav-link-external"
              >
                Manpower
              </a>
            </nav>
            <div className="field-bottom-nav-utils">
              <FieldViewToggles
                mobileView={mobileView}
                setMobileView={setMobileView}
                darkMode={darkMode}
                setDarkMode={setDarkMode}
                className="field-bottom-nav-toggle field-bottom-nav-toggle-icon"
              />
            </div>
          </div>
        )}
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
