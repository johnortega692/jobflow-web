import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLetterhead } from "../contexts/LetterheadContext";
import { listDoneProjectIds } from "../lib/projectDone";
import {
  buildPmMaterialsRows,
  filterPmMaterialsRows,
  formatPmFollowUp,
  losAngelesToday,
  sortPmMaterialsRows,
  type PmMaterialsFilter,
  type PmMaterialsRow,
  type PmMaterialsSort,
  type PmMaterialsSortDir,
} from "../lib/pmMaterialsBoard";
import { supabase } from "../lib/supabase";
import { normalizeProject, type Project } from "../types/database";

const FILTERS: { id: PmMaterialsFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-action", label: "Needs action" },
  { id: "this-week", label: "This week" },
];

function openRow(navigate: (path: string) => void, row: PmMaterialsRow) {
  navigate(row.href);
}

function Cell({ value }: { value: string }) {
  const text = value.trim();
  if (!text) return <span className="pm-materials-empty">—</span>;
  return <span title={text}>{text}</span>;
}

export function PmMaterialsPage() {
  const navigate = useNavigate();
  const { profile, loading: profileLoading } = useLetterhead();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReturnType<typeof buildPmMaterialsRows>>([]);
  const [filter, setFilter] = useState<PmMaterialsFilter>("all");
  const [sort, setSort] = useState<PmMaterialsSort>("follow-up");
  const [dir, setDir] = useState<PmMaterialsSortDir>("asc");
  const today = useMemo(() => losAngelesToday(), []);

  useEffect(() => {
    if (profileLoading) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [{ data, error: err }, doneRes] = await Promise.all([
        supabase.from("projects").select("*").order("updated_at", { ascending: false }),
        listDoneProjectIds(),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      if (doneRes.error) {
        setError(doneRes.error);
        return;
      }
      const done = new Set(doneRes.ids);
      const open = ((data ?? []) as Project[])
        .filter((row) => !done.has(row.id))
        .map((row) => normalizeProject(row));
      setRows(buildPmMaterialsRows(open, { name: profile.name, email: profile.email }));
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.email, profile.name, profileLoading]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      "needs-action": rows.filter((row) => row.needsAction).length,
      "this-week": rows.filter((row) => filterPmMaterialsRows([row], "this-week", today).length > 0).length,
    }),
    [rows, today],
  );

  const visible = useMemo(
    () => sortPmMaterialsRows(filterPmMaterialsRows(rows, filter, today), sort, dir),
    [rows, filter, today, sort, dir],
  );

  const pmName = profile.name.trim();

  return (
    <div className="page pm-materials-page">
      <p className="breadcrumb">
        <Link to="/projects">Projects</Link>
        <span className="muted"> / </span>
        <span>Materials</span>
      </p>
      <div>
        <h1>Materials</h1>
        <p className="muted">
          {pmName ? `Procurement materials for ${pmName}. ` : "Procurement materials. "}
          Paint special orders, wallcovering tracker lines, and FRP lines marked to order. Submittal status stays on the job.
        </p>
      </div>

      {error ? <div className="banner banner-error">{error}</div> : null}

      <div className="pm-materials-toolbar">
        <div className="projects-status-chips" role="group" aria-label="Filter materials">
          {FILTERS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`projects-status-chip${filter === chip.id ? " projects-status-chip--active" : ""}`}
              aria-pressed={filter === chip.id}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="projects-status-chip-count">{counts[chip.id]}</span>
            </button>
          ))}
        </div>
        <div className="pm-materials-sort">
          <label>
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as PmMaterialsSort)}
            >
              <option value="follow-up">Next follow-up</option>
              <option value="job">Job</option>
              <option value="needs-action">Needs action</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setDir((value) => (value === "asc" ? "desc" : "asc"))}>
            {dir === "asc" ? "Ascending" : "Descending"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading materials…</p>
      ) : !pmName && !profile.email.trim() ? (
        <div className="card empty-state">
          <p>Set your name in Settings so this list can match the PM on each job.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <p>No procurement materials on your open jobs.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card empty-state">
          <p>Nothing in this filter.</p>
        </div>
      ) : (
        <div className="card pm-materials-card">
          <div className="pm-materials-scroll">
            <table className="pm-materials-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Finish</th>
                  <th>Product</th>
                  <th>Lead (wks)</th>
                  <th>Approved</th>
                  <th>Ordered</th>
                  <th>Shipped</th>
                  <th>Received / Tracking</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th>Follow-up</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className="pm-materials-row"
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${row.finish} on ${row.jobNumber || row.jobName || "job"}`}
                    onClick={() => openRow(navigate, row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openRow(navigate, row);
                      }
                    }}
                  >
                    <td>
                      <div className="pm-materials-job-num">{row.jobNumber || "—"}</div>
                      <div className="pm-materials-job-name">{row.jobName || "Untitled job"}</div>
                    </td>
                    <td>{row.finish}</td>
                    <td>
                      <Cell value={row.product} />
                    </td>
                    <td>
                      <Cell value={row.leadTime} />
                    </td>
                    <td>
                      <Cell value={row.approvalReceived} />
                    </td>
                    <td>
                      <Cell value={row.dateOrdered} />
                    </td>
                    <td>
                      <Cell value={row.shipDate} />
                    </td>
                    <td className="pm-materials-tracking">
                      <Cell value={row.dateReceivedTracking} />
                    </td>
                    <td className="pm-materials-notes">
                      <Cell value={row.notes} />
                    </td>
                    <td>
                      <span className={`pm-materials-status pm-materials-status--${row.tone}`}>{row.status}</span>
                    </td>
                    <td>{row.followUp ? formatPmFollowUp(row.followUp) : "—"}</td>
                    <td>{row.kindLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
