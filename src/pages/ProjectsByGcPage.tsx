import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildGcYearSummary,
  currentCalendarYear,
  filterGcYearGroups,
  formatContractUsd,
  formatSignedPercent,
  GC_JOB_PREVIEW_LIMIT,
  JOB_WORK_STATUS_LABEL,
  yoyChangePercent,
  yearsFromProjects,
  type GcYearGroup,
  type GcYearStatusFilter,
  type JobWorkStatus,
} from "../lib/gcYearSummary";
import { listDoneProjectIds } from "../lib/projectDone";
import { supabase } from "../lib/supabase";
import type { Project } from "../types/database";

const STATUS_FILTERS: { id: GcYearStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open only" },
  { id: "completed", label: "Completed" },
];

function StatusMixBar({ counts, qty }: { counts: Record<JobWorkStatus, number>; qty: number }) {
  const segments: { status: JobWorkStatus; n: number }[] = [
    { status: "not_started", n: counts.not_started },
    { status: "in_progress", n: counts.in_progress },
    { status: "complete", n: counts.complete },
  ];
  return (
    <div className="projects-by-gc-mix" title={`${counts.not_started} not started · ${counts.in_progress} in progress · ${counts.complete} complete`}>
      {qty === 0
        ? <span className="projects-by-gc-mix-empty" />
        : segments.map((seg) =>
            seg.n > 0 ? (
              <span
                key={seg.status}
                className={`projects-by-gc-mix-seg projects-by-gc-mix-seg--${seg.status}`}
                style={{ flexGrow: seg.n }}
              />
            ) : null,
          )}
    </div>
  );
}

function StatusPill({ status }: { status: JobWorkStatus }) {
  return <span className={`projects-by-gc-pill projects-by-gc-pill--${status}`}>{JOB_WORK_STATUS_LABEL[status]}</span>;
}

function JobRows({
  group,
  showAll,
  onShowAll,
}: {
  group: GcYearGroup;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const visible = showAll ? group.jobs : group.jobs.slice(0, GC_JOB_PREVIEW_LIMIT);
  const hidden = group.jobs.length - visible.length;
  return (
    <>
      {visible.map((job) => (
        <tr key={job.lineId} className="projects-by-gc-job-row">
          <td>
            <Link to={`/projects/${job.id}`} className="projects-by-gc-job-link">
              <span className="projects-by-gc-job-num">{job.jobNumber}</span>
              <span className="projects-by-gc-job-name">{job.jobName}</span>
            </Link>
          </td>
          <td />
          <td />
          <td className="projects-by-gc-job-status">
            <StatusPill status={job.status} />
          </td>
                          <td className={`num${job.status === "complete" ? " projects-by-gc-amt--done" : ""}`}>
                            {formatContractUsd(job.contractAmount)}
                          </td>
        </tr>
      ))}
      {hidden > 0 ? (
        <tr className="projects-by-gc-more-row">
          <td colSpan={5}>
            <button type="button" className="projects-by-gc-more" onClick={onShowAll}>
              + {hidden} more job{hidden === 1 ? "" : "s"}…
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ProjectsByGcPage() {
  const [year, setYear] = useState(() => currentCalendarYear());
  const [statusFilter, setStatusFilter] = useState<GcYearStatusFilter>("all");
  const [gcQuery, setGcQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllJobs, setShowAllJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    void Promise.all([
      supabase
        .from("projects")
        .select("id, job_number, job_name, contractor, architect, owner, job_address2, created_at, data"),
      listDoneProjectIds(),
    ])
      .then(([projRes, doneRes]) => {
        if (projRes.error) {
          setError(projRes.error.message);
          setProjects([]);
          return;
        }
        if (doneRes.error) {
          setError(doneRes.error);
          setProjects([]);
          return;
        }
        setProjects((projRes.data ?? []) as Project[]);
        setDoneIds(new Set(doneRes.ids));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load projects"))
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => yearsFromProjects(projects), [projects]);
  const summary = useMemo(() => buildGcYearSummary(projects, year, doneIds), [projects, year, doneIds]);
  const groups = useMemo(
    () => filterGcYearGroups(summary.groups, statusFilter, gcQuery),
    [summary.groups, statusFilter, gcQuery],
  );
  const yoy = yoyChangePercent(summary.totalAmount, summary.priorYearAmount);
  const tableTotals = useMemo(
    () => ({
      amount: groups.reduce((sum, g) => sum + g.contractAmount, 0),
      qty: groups.reduce((sum, g) => sum + g.qty, 0),
      open: groups.reduce((sum, g) => sum + g.openAmount, 0),
    }),
    [groups],
  );

  useEffect(() => {
    setShowAllJobs(new Set());
    setExpanded(new Set());
  }, [year, statusFilter, gcQuery]);

  function toggleGc(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="page projects-by-gc-page">
      <p className="breadcrumb">
        <Link to="/projects">Projects</Link>
        <span className="muted"> / </span>
        <span>Projects by GC</span>
      </p>

      <div>
        <h1>Projects by GC</h1>
        <p className="muted">
          Backlog and delivered work by general contractor. Expand a GC to see its jobs; open dollars
          are work still in play.
        </p>
      </div>

      <div className="projects-by-gc-toolbar">
        <label className="projects-by-gc-year">
          <span className="sr-only">Year</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <div className="projects-list-sort" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`projects-list-sort-btn${statusFilter === item.id ? " projects-list-sort-btn--active" : ""}`}
              onClick={() => setStatusFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="projects-by-gc-filter"
          value={gcQuery}
          onChange={(e) => setGcQuery(e.target.value)}
          placeholder="Filter GC…"
          aria-label="Filter general contractors"
        />
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading yearly totals…</p>
      ) : (
        <>
          <div className="projects-by-gc-stats">
            <div className="projects-by-gc-stat">
              <div className="projects-by-gc-stat-label">Open backlog</div>
              <div className="projects-by-gc-stat-value projects-by-gc-stat-value--open">
                {formatContractUsd(summary.openAmount)}
              </div>
              <div className="muted small">
                {summary.openQty} job{summary.openQty === 1 ? "" : "s"} live
              </div>
            </div>
            <div className="projects-by-gc-stat">
              <div className="projects-by-gc-stat-label">Completed</div>
              <div className="projects-by-gc-stat-value projects-by-gc-stat-value--done">
                {formatContractUsd(summary.completedAmount)}
              </div>
              <div className="muted small">
                {summary.completedQty} job{summary.completedQty === 1 ? "" : "s"} done
              </div>
            </div>
            <div className="projects-by-gc-stat">
              <div className="projects-by-gc-stat-label">Total contract</div>
              <div className="projects-by-gc-stat-value">{formatContractUsd(summary.totalAmount)}</div>
              <div className={`small${yoy != null && yoy > 0 ? " projects-by-gc-yoy--up" : yoy != null && yoy < 0 ? " projects-by-gc-yoy--down" : " muted"}`}>
                {yoy == null ? `No ${year - 1} baseline` : `${formatSignedPercent(yoy)} vs ${year - 1}`}
              </div>
            </div>
            <div className="projects-by-gc-stat">
              <div className="projects-by-gc-stat-label">General contractors</div>
              <div className="projects-by-gc-stat-value">{summary.groups.length}</div>
              <div className="muted small">
                {summary.featuredGcShare
                  ? `${summary.featuredGcShare.name} = ${summary.featuredGcShare.percent}%`
                  : "No GCs this year"}
              </div>
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="muted">No projects match this view for {year}.</p>
          ) : (
            <div className="projects-by-gc-table-wrap">
              <table className="projects-by-gc-table">
                <thead>
                  <tr>
                    <th>GC / status</th>
                    <th className="num">Contract</th>
                    <th className="num">Jobs</th>
                    <th>Status mix</th>
                    <th className="num">Open $</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const isOpen = expanded.has(group.key);
                    return (
                      <Fragment key={group.key}>
                        <tr
                          className={`projects-by-gc-gc-row${isOpen ? " projects-by-gc-gc-row--open" : ""}`}
                          tabIndex={0}
                          aria-expanded={isOpen}
                          onClick={() => toggleGc(group.key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleGc(group.key);
                            }
                          }}
                        >
                          <td>
                            <span className="projects-by-gc-caret" aria-hidden="true">
                              {isOpen ? "▾" : "▸"}
                            </span>
                            {group.gc}
                          </td>
                          <td className="num">{formatContractUsd(group.contractAmount)}</td>
                          <td className="num">{group.qty}</td>
                          <td>
                            <StatusMixBar counts={group.statusCounts} qty={group.qty} />
                          </td>
                          <td className={`num${group.openAmount > 0 ? " projects-by-gc-amt--open" : " muted"}`}>
                            {formatContractUsd(group.openAmount)}
                          </td>
                        </tr>
                        {isOpen ? (
                          <JobRows
                            group={group}
                            showAll={showAllJobs.has(group.key)}
                            onShowAll={() =>
                              setShowAllJobs((prev) => {
                                const next = new Set(prev);
                                next.add(group.key);
                                return next;
                              })
                            }
                          />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total · {groups.length} GC{groups.length === 1 ? "" : "s"}</th>
                    <th className="num projects-by-gc-amt--done">{formatContractUsd(tableTotals.amount)}</th>
                    <th className="num">{tableTotals.qty}</th>
                    <th />
                    <th className="num projects-by-gc-amt--open">{formatContractUsd(tableTotals.open)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="projects-by-gc-legend" aria-hidden="true">
            <span>
              <i className="projects-by-gc-legend-dot projects-by-gc-mix-seg--not_started" />
              Not started
            </span>
            <span>
              <i className="projects-by-gc-legend-dot projects-by-gc-mix-seg--in_progress" />
              In progress
            </span>
            <span>
              <i className="projects-by-gc-legend-dot projects-by-gc-mix-seg--complete" />
              Complete
            </span>
          </div>

          {summary.duplicateWarnings.map((names) => (
            <div key={names.join("|")} className="banner banner-warn">
              Heads up: {names.map((n) => `“${n}”`).join(" and ")} are almost certainly the same GC keyed
              two ways — their open $ and totals are split across two rows here. Worth merging the GC
              field before these numbers drive decisions.
            </div>
          ))}
        </>
      )}
    </div>
  );
}
