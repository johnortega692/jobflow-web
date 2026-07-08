import { useCallback, useEffect, useMemo, useState } from "react";
import { monthLabel } from "../../lib/fieldCalendarEvents";
import {
  aggregateJobsByProject,
  formatManWeeks,
  formatPlannedHours,
  monthWeekRange,
  type CompanyWorkloadWeek,
  workloadBand,
  workloadBandLabel,
  workloadWeekMap,
} from "../../lib/companyManpowerWorkload";
import { CompanyWorkloadBarChart } from "./CompanyWorkloadBarChart";
import { useFieldCompactLayout } from "../../lib/useMediaQuery";

function shiftMonth(viewMonth: Date, delta: number): Date {
  return new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
}

type Props = {
  fetchWeeks: (fromWeek: string, toWeek: string) => Promise<CompanyWorkloadWeek[]>;
  fetchActiveCrew: () => Promise<number>;
  loadingMessage?: string;
  mobileView?: boolean;
};

export function CompanyWorkloadCalendar({
  fetchWeeks,
  fetchActiveCrew,
  loadingMessage = "Loading workload…",
  mobileView = false,
}: Props) {
  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [weeks, setWeeks] = useState<CompanyWorkloadWeek[]>([]);
  const [crewCapacity, setCrewCapacity] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);

  const range = useMemo(() => monthWeekRange(viewMonth), [viewMonth]);
  const weekMap = useMemo(() => workloadWeekMap(weeks), [weeks]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCrewCapacity(undefined);
    try {
      const [data, crewCount] = await Promise.all([
        fetchWeeks(range.from, range.to),
        fetchActiveCrew().catch(() => 0),
      ]);
      setWeeks(data);
      setCrewCapacity(crewCount > 0 ? crewCount : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load workload.");
      setWeeks([]);
      setCrewCapacity(null);
    } finally {
      setLoading(false);
    }
  }, [fetchActiveCrew, fetchWeeks, range.from, range.to]);

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
      </div>

      <p className="field-workload-summary muted small">
        Read-only rollup from JobFlow manpower plans.{" "}
        {monthStats.totalHours > 0
          ? `${formatPlannedHours(monthStats.totalHours)} planned this month`
          : "No planned hours this month"}
        {monthStats.lightWeeks > 0 ? ` · ${monthStats.lightWeeks} light week${monthStats.lightWeeks === 1 ? "" : "s"}` : ""}
        {monthStats.heavyWeeks > 0 ? ` · ${monthStats.heavyWeeks} heavy week${monthStats.heavyWeeks === 1 ? "" : "s"}` : ""}
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <div className={`field-cal-body${compactLayout ? " field-cal-body--mobile" : ""}`}>
        <CompanyWorkloadBarChart
          weeks={weeks}
          viewMonth={viewMonth}
          crewCapacity={crewCapacity}
          selectedWeekStart={selectedWeekStart}
          onSelectWeek={setSelectedWeekStart}
          mobileView={compactLayout}
        />

        <aside className={`field-cal-detail${selectedWeekStart ? " field-cal-detail--open" : ""}`}>
          <div className="field-cal-detail-head">
            <h3>
              {selectedWeekStart
                ? `Week of ${new Date(`${selectedWeekStart}T12:00:00`).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : "Select a week"}
            </h3>
            {selectedWeekStart && (
              <button type="button" className="field-cal-detail-close" onClick={() => setSelectedWeekStart(null)}>
                ✕
              </button>
            )}
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
                <ul className="field-cal-detail-list">
                  {selectedProjects.map((project) => (
                    <li key={project.projectId || project.jobNumber} className="field-cal-detail-item">
                      <div className="field-cal-detail-title">
                        #{project.jobNumber} · {project.jobName}
                      </div>
                      <div className="field-cal-detail-sub">
                        {formatPlannedHours(project.totalHours)}
                        {project.phases.length
                          ? ` · ${project.phases.map((p) => `${p.phaseName} ${Math.round(p.hours)}h`).join(", ")}`
                          : ""}
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
        </aside>
      </div>
    </div>
  );
}
