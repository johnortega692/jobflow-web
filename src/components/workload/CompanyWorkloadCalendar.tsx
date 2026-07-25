import { useCallback, useEffect, useMemo, useState } from "react";
import { monthLabel } from "../../lib/fieldCalendarEvents";
import {
  aggregateJobsByProject,
  formatManWeeks,
  formatPlannedHours,
  monthWeekRange,
  type CompanyWorkloadActiveProject,
  type CompanyWorkloadWeek,
  workloadBand,
  workloadBandLabel,
  workloadWeekMap,
} from "../../lib/companyManpowerWorkload";
import { CompanyWorkloadBarChart } from "./CompanyWorkloadBarChart";
import { useFieldCompactLayout } from "../../lib/useMediaQuery";
import { FieldMoonIcon, FieldSunIcon } from "../field/FieldViewIcons";
import { readWorkloadDarkMode, writeWorkloadDarkMode } from "../../lib/fieldViewPrefs";

function shiftMonth(viewMonth: Date, delta: number): Date {
  return new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
}

type Props = {
  fetchWeeks: (fromWeek: string, toWeek: string) => Promise<CompanyWorkloadWeek[]>;
  fetchActiveCrew: () => Promise<number>;
  fetchActiveProjects: () => Promise<CompanyWorkloadActiveProject[]>;
  loadingMessage?: string;
  mobileView?: boolean;
  /** Controlled dark mode (e.g. Field layout). When omitted, calendar owns a local preference. */
  darkMode?: boolean;
  onDarkModeChange?: (value: boolean) => void;
  /** Show sun/moon toggle in the toolbar. Default true. */
  showThemeToggle?: boolean;
};

export function CompanyWorkloadCalendar({
  fetchWeeks,
  fetchActiveCrew,
  fetchActiveProjects,
  loadingMessage = "Loading workload…",
  mobileView = false,
  darkMode: darkModeProp,
  onDarkModeChange,
  showThemeToggle = true,
}: Props) {
  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [weeks, setWeeks] = useState<CompanyWorkloadWeek[]>([]);
  const [activeProjects, setActiveProjects] = useState<CompanyWorkloadActiveProject[]>([]);
  const [crewCapacity, setCrewCapacity] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);
  const [needsPlanningOpen, setNeedsPlanningOpen] = useState(true);
  const [localDarkMode, setLocalDarkMode] = useState(readWorkloadDarkMode);

  const darkMode = darkModeProp ?? localDarkMode;
  const setDarkMode = useCallback(
    (value: boolean) => {
      if (onDarkModeChange) {
        onDarkModeChange(value);
        return;
      }
      setLocalDarkMode(value);
      writeWorkloadDarkMode(value);
    },
    [onDarkModeChange],
  );

  const range = useMemo(() => monthWeekRange(viewMonth), [viewMonth]);
  const weekMap = useMemo(() => workloadWeekMap(weeks), [weeks]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCrewCapacity(undefined);
    try {
      const [data, crewCount, projects] = await Promise.all([
        fetchWeeks(range.from, range.to),
        fetchActiveCrew().catch(() => 0),
        fetchActiveProjects().catch(() => [] as CompanyWorkloadActiveProject[]),
      ]);
      setWeeks(data);
      setCrewCapacity(crewCount > 0 ? crewCount : null);
      setActiveProjects(projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load workload.");
      setWeeks([]);
      setCrewCapacity(null);
      setActiveProjects([]);
    } finally {
      setLoading(false);
    }
  }, [fetchActiveCrew, fetchActiveProjects, fetchWeeks, range.from, range.to]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const monthStats = useMemo(() => {
    let totalHours = 0;
    let lightWeeks = 0;
    let heavyWeeks = 0;

    for (const week of weeks) {
      totalHours += week.totalHours;
      const band = workloadBand(week.totalHours);
      if (band === "light") lightWeeks += 1;
      if (band === "heavy") heavyWeeks += 1;
    }

    return { totalHours, lightWeeks, heavyWeeks };
  }, [weeks]);

  const selectedWeek = selectedWeekStart ? weekMap.get(selectedWeekStart) ?? null : null;
  const selectedProjects = selectedWeek ? aggregateJobsByProject(selectedWeek.jobs) : [];
  const needsPlanning = activeProjects;

  const compactLayout = useFieldCompactLayout(mobileView);

  if (loading) {
    return <p className="field-cal-detail-empty">{loadingMessage}</p>;
  }

  return (
    <div className="field-cal field-workload-cal">
      <div className="field-cal-toolbar">
        <div className="field-cal-nav">
          <button type="button" className="field-cal-nav-btn" onClick={() => setViewMonth((m) => shiftMonth(m, -1))}>
            ‹
          </button>
          <h2 className="field-cal-month">{monthLabel(viewMonth)}</h2>
          <button type="button" className="field-cal-nav-btn" onClick={() => setViewMonth((m) => shiftMonth(m, 1))}>
            ›
          </button>
          <button
            type="button"
            className="field-cal-today-btn"
            onClick={() => {
              const now = new Date();
              setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedWeekStart(null);
            }}
          >
            Today
          </button>
        </div>
        {showThemeToggle ? (
          <button
            type="button"
            className="field-cal-today-btn field-workload-theme-btn"
            onClick={() => setDarkMode(!darkMode)}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            title={darkMode ? "Light mode" : "Dark mode"}
          >
            {darkMode ? <FieldSunIcon /> : <FieldMoonIcon />}
            <span>{darkMode ? "Light" : "Dark"}</span>
          </button>
        ) : null}
      </div>

      <p className="field-workload-summary muted small">
        Read-only rollup from JobFlow Labor Projections.{" "}
        {monthStats.totalHours > 0
          ? `${formatPlannedHours(monthStats.totalHours)} planned this month`
          : "No planned hours this month"}
        {monthStats.lightWeeks > 0 ? ` · ${monthStats.lightWeeks} light week${monthStats.lightWeeks === 1 ? "" : "s"}` : ""}
        {monthStats.heavyWeeks > 0 ? ` · ${monthStats.heavyWeeks} heavy week${monthStats.heavyWeeks === 1 ? "" : "s"}` : ""}
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <div className={`field-workload-stack${compactLayout ? " field-workload-stack--mobile" : ""}`}>
        <CompanyWorkloadBarChart
          weeks={weeks}
          viewMonth={viewMonth}
          crewCapacity={crewCapacity}
          selectedWeekStart={selectedWeekStart}
          onSelectWeek={setSelectedWeekStart}
          mobileView={compactLayout}
          darkMode={darkMode}
        />

        <section
          className={[
            "field-workload-panel field-workload-panel--focus",
            needsPlanning.length ? "field-workload-panel--warn" : "",
            needsPlanningOpen ? "field-workload-panel--open" : "field-workload-panel--collapsed",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <button
            type="button"
            className="field-workload-panel-toggle"
            aria-expanded={needsPlanningOpen}
            onClick={() => setNeedsPlanningOpen((open) => !open)}
          >
            <div className="field-workload-panel-head field-workload-panel-head--toggle">
              <h3>
                <span className="field-workload-panel-chevron" aria-hidden>
                  {needsPlanningOpen ? "▾" : "▸"}
                </span>
                Needs planning
                {needsPlanning.length > 0 ? (
                  <span className="field-workload-unplanned-count">{needsPlanning.length}</span>
                ) : null}
              </h3>
              <p className="field-workload-panel-hint">
                {needsPlanning.length
                  ? "Active projects with no planned hours"
                  : "All active projects have planned hours"}
              </p>
            </div>
          </button>
          {needsPlanningOpen ? (
            needsPlanning.length ? (
              <ul className="field-workload-chip-list">
                {needsPlanning.map((project) => (
                  <li
                    key={project.projectId || `${project.jobNumber}:${project.jobName}`}
                    className="field-workload-chip"
                  >
                    <span className="field-workload-chip-title">
                      #{project.jobNumber} · {project.jobName}
                    </span>
                    <span className="field-workload-chip-meta">0 hrs</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-cal-detail-empty">All active projects have planned hours.</p>
            )
          ) : null}
        </section>

        <section className="field-workload-panel field-workload-panel--week">
          <div className="field-workload-panel-head">
            <h3>
              {selectedWeekStart
                ? `Week of ${new Date(`${selectedWeekStart}T12:00:00`).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : "Week detail"}
            </h3>
            {selectedWeekStart ? (
              <button
                type="button"
                className="field-cal-detail-close"
                onClick={() => setSelectedWeekStart(null)}
                aria-label="Clear selected week"
              >
                ✕
              </button>
            ) : null}
          </div>

          {selectedWeek ? (
            <>
              <div className={`field-workload-band field-workload-band--${workloadBand(selectedWeek.totalHours)}`}>
                <strong>{workloadBandLabel(workloadBand(selectedWeek.totalHours))}</strong>
                <span>
                  {formatPlannedHours(selectedWeek.totalHours)} · ~{formatManWeeks(selectedWeek.totalHours)} people
                </span>
              </div>
              {selectedProjects.length ? (
                <ul className="field-workload-card-grid">
                  {selectedProjects.map((project) => (
                    <li key={project.projectId || project.jobNumber} className="field-cal-detail-item">
                      <div className="field-cal-detail-title">
                        #{project.jobNumber} · {project.jobName}
                      </div>
                      <div className="field-cal-detail-sub">
                        {formatPlannedHours(project.totalHours)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-cal-detail-empty">No planned hours this week.</p>
              )}
            </>
          ) : (
            <p className="field-cal-detail-empty">
              Hover or tap a bar to see planned hours for that week across all jobs.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
