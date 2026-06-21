import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { DateInput } from "../../components/DateInput";
import {
  paintJobSmsText,
  saveProjectStartDate,
  type FieldPaintRow,
} from "../../lib/fieldTrackerProject";
import { paintPillClass, paintStatusLabel, type PaintFieldStatus } from "../../lib/fieldTrackerStatus";
import {
  FieldEmptyPanel,
  FieldLoadingPanel,
  FieldStatusPill,
  FieldToolbar,
  useDebouncedValue,
  useFieldDashboard,
} from "./FieldDashboardLayout";

const STATUS_OPTIONS: { value: PaintFieldStatus; label: string }[] = [
  { value: "Not Started", label: "Not Started" },
  { value: "Match Existing", label: "Match Existing" },
  { value: "Submittal Ordered", label: "Submittal Ordered" },
  { value: "Submitted for Approval", label: "Sent for Approval" },
  { value: "Needs Revision", label: "Needs Revision" },
  { value: "Approved", label: "Approved" },
  { value: "No Paint", label: "No Paint" },
];

function rowClass(status: PaintFieldStatus): string {
  if (status === "No Paint") return "row-no-paint";
  if (status === "Needs Revision") return "row-revision";
  return "";
}

function PaintStartDateCell({
  row,
  onSaved,
}: {
  row: FieldPaintRow;
  onSaved: () => void;
}) {
  const { toast } = useFieldDashboard();
  const [value, setValue] = useState(row.startDate);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const err = await saveProjectStartDate(row.projectId, value);
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    toast(`Start date updated for ${row.jobNumber}`);
    onSaved();
  }

  return (
    <div className="date-container">
      <DateInput value={value} onChange={setValue} className="date-input" />
      <button type="button" className="update-btn" disabled={busy} onClick={() => void save()}>
        {busy ? "…" : "✓"}
      </button>
    </div>
  );
}

function CopyActions({ row }: { row: FieldPaintRow }) {
  const { toast } = useFieldDashboard();
  const text = paintJobSmsText(row);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard!");
    } catch {
      toast("Copy failed");
    }
  }

  return (
    <div className="date-container">
      <button type="button" className="update-btn" onClick={() => void copy()}>
        📋 Copy
      </button>
    </div>
  );
}

export function FieldPaintDashboardPage() {
  const { user } = useAuth();
  const { paintRows, loading, reload, mobileView } = useFieldDashboard();
  const [search, setSearch] = useState("");
  const [pm, setPm] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const pmOptions = useMemo(
    () => [...new Set(paintRows.map((r) => r.pm).filter(Boolean))].sort(),
    [paintRows],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return paintRows.filter((row) => {
      const text = [row.jobNumber, row.jobName, row.jobAddress, row.gcName, row.gcSuper].join(" ").toLowerCase();
      if (q && !text.includes(q)) return false;
      if (pm && row.pm !== pm) return false;
      if (status && row.status !== status) return false;
      return true;
    });
  }, [paintRows, debouncedSearch, pm, status]);

  function toggleCard(projectId: string) {
    setExpanded((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }

  function toggleExpandAll() {
    const next = !allExpanded;
    setAllExpanded(next);
    const patch: Record<string, boolean> = {};
    filtered.forEach((row) => {
      patch[row.projectId] = next;
    });
    setExpanded(patch);
  }

  if (loading) return <FieldLoadingPanel message="Loading paint data…" />;

  return (
    <>
      <FieldToolbar
        search={search}
        onSearchChange={setSearch}
        pm={pm}
        onPmChange={setPm}
        status={status}
        onStatusChange={setStatus}
        pmOptions={pmOptions}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search jobs, GC, address…"
      />

      {filtered.length === 0 ? (
        <FieldEmptyPanel />
      ) : mobileView ? (
        <div className="field-mobile-list">
          <div className="groups-toolbar">
            <button type="button" className="expand-all-btn" onClick={toggleExpandAll}>
              {allExpanded ? "Collapse All" : "Expand All"}
            </button>
            <span className="groups-count">
              {filtered.length} job{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          {filtered.map((row) => {
            const open = expanded[row.projectId] ?? false;
            const statusClass = rowClass(row.status);
            return (
              <div
                key={row.projectId}
                className={`job-group field-mobile-card-wrap${statusClass ? ` ${statusClass}` : ""}`}
              >
                <div
                  className={`group-header field-mobile-card-header${open ? " open" : ""}`}
                  onClick={() => toggleCard(row.projectId)}
                  onKeyDown={(e) => e.key === "Enter" && toggleCard(row.projectId)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                >
                  <div className={`gh-chevron${open ? " open" : ""}`}>▶</div>
                  <div className="field-mobile-card-summary">
                    {user ? (
                      <Link
                        className="job-link field-mobile-job"
                        to={`/projects/${row.projectId}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.jobNumber}
                      </Link>
                    ) : (
                      <span className="field-mobile-job">{row.jobNumber}</span>
                    )}
                    <div className="field-mobile-title">
                      {row.jobName}
                      {row.nightsWeekends && <span className="badge-nw">Night/Weekend</span>}
                    </div>
                    <div className="field-mobile-sub">{row.gcName || "—"}</div>
                  </div>
                  <FieldStatusPill
                    label={paintStatusLabel(row.status)}
                    className={paintPillClass(row.status)}
                  />
                </div>
                {open && (
                  <div className="group-detail open field-mobile-card-body">
                    <dl className="field-mobile-dl">
                      <div>
                        <dt>Address</dt>
                        <dd>{row.jobAddress || "—"}</dd>
                      </div>
                      <div>
                        <dt>GC</dt>
                        <dd>{row.gcName || "—"}</dd>
                      </div>
                      <div>
                        <dt>Super</dt>
                        <dd>{row.gcSuper || "—"}</dd>
                      </div>
                      <div>
                        <dt>Paint</dt>
                        <dd>{row.paintVendor || "—"}</dd>
                      </div>
                      <div>
                        <dt>Division</dt>
                        <dd>{row.division || "—"}</dd>
                      </div>
                      <div>
                        <dt>PM</dt>
                        <dd>{row.pm || "—"}</dd>
                      </div>
                    </dl>
                    <div className="field-mobile-actions">
                      <CopyActions row={row} />
                      <PaintStartDateCell row={row} onSaved={() => void reload()} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-view">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job #</th>
                <th>Job Name</th>
                <th>Address</th>
                <th>GC</th>
                <th>Super</th>
                <th>Copy</th>
                <th>Start Date</th>
                <th>Paint</th>
                <th>Status</th>
                <th>Division</th>
                <th>PM</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.projectId} className={rowClass(row.status)}>
                  <td>
                    {user ? (
                      <Link className="job-link" to={`/projects/${row.projectId}`}>
                        {row.jobNumber}
                      </Link>
                    ) : (
                      row.jobNumber
                    )}
                  </td>
                  <td>
                    {row.jobName}
                    {row.nightsWeekends && <span className="badge-nw">Night/Weekend</span>}
                  </td>
                  <td>{row.jobAddress}</td>
                  <td>{row.gcName}</td>
                  <td>{row.gcSuper}</td>
                  <td>
                    <CopyActions row={row} />
                  </td>
                  <td>
                    <PaintStartDateCell row={row} onSaved={() => void reload()} />
                  </td>
                  <td>{row.paintVendor}</td>
                  <td>
                    <FieldStatusPill
                      label={paintStatusLabel(row.status)}
                      className={paintPillClass(row.status)}
                    />
                  </td>
                  <td>{row.division}</td>
                  <td>{row.pm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
