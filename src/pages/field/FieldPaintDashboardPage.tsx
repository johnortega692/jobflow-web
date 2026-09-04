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
  siteReadyColumnPillClass,
  siteReadyColumnStatuses,
  type SiteReadyColumnStatus,
} from "../../lib/startupSiteReadyDigest";
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
  { value: "Not Needed", label: "Not Needed" },
];

type PaintDashboardRow = FieldPaintRow & { siteReady: SiteReadyColumnStatus[] };

function rowClass(status: PaintFieldStatus): string {
  if (status === "Not Needed") return "row-no-paint";
  if (status === "Needs Revision") return "row-revision";
  return "";
}

function GcSuperCell({ row, linkPhone = false }: { row: FieldPaintRow; linkPhone?: boolean }) {
  if (!row.gcSuperName && !row.gcSuperPhone) return <>—</>;
  const phoneHref = row.gcSuperPhone ? `tel:${row.gcSuperPhone.replace(/[^\d+]/g, "")}` : "";
  return (
    <span className="field-gc-super-cell">
      {row.gcSuperName ? <span>{row.gcSuperName}</span> : null}
      {row.gcSuperPhone ? (
        linkPhone ? (
          <a href={phoneHref} className="field-gc-super-phone field-gc-super-phone-link">
            {row.gcSuperPhone}
          </a>
        ) : (
          <span className="field-gc-super-phone">{row.gcSuperPhone}</span>
        )
      ) : null}
    </span>
  );
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

function SiteReadyPills({ statuses }: { statuses: SiteReadyColumnStatus[] }) {
  if (!statuses.length) return <>—</>;
  return (
    <span className="field-site-ready-cell">
      {statuses.map((status) => (
        <FieldStatusPill key={status} label={status} className={siteReadyColumnPillClass(status)} />
      ))}
    </span>
  );
}

export function FieldPaintDashboardPage() {
  const { user } = useAuth();
  const { paintRows, projects, loading, reload, mobileView } = useFieldDashboard();
  const [search, setSearch] = useState("");
  const [pm, setPm] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const rows = useMemo<PaintDashboardRow[]>(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    return paintRows.map((row) => {
      const project = byId.get(row.projectId);
      return {
        ...row,
        siteReady: project ? siteReadyColumnStatuses(project) : [],
      };
    });
  }, [paintRows, projects]);

  const pmOptions = useMemo(
    () => [...new Set(rows.map((r) => r.pm).filter(Boolean))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return rows.filter((row) => {
      const text = [row.jobNumber, row.jobName, row.jobAddress, row.gcName, row.gcSuperName, row.gcSuperPhone]
        .join(" ")
        .toLowerCase();
      if (q && !text.includes(q)) return false;
      if (pm && row.pm !== pm) return false;
      if (status && row.status !== status) return false;
      return true;
    });
  }, [rows, debouncedSearch, pm, status]);

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
                        <dt>GC Super</dt>
                        <dd>
                          <GcSuperCell row={row} linkPhone={mobileView} />
                        </dd>
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
                      <div>
                        <dt>Site Ready</dt>
                        <dd>
                          <SiteReadyPills statuses={row.siteReady} />
                        </dd>
                      </div>
                      {row.revisionNotes ? (
                        <div className="field-revision-notes">
                          <dt>Revision notes</dt>
                          <dd>{row.revisionNotes}</dd>
                        </div>
                      ) : null}
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
                className={`job-group${statusClass ? ` ${statusClass}` : ""}`}
              >
                <div
                  className={`group-header paint-group-header${open ? " open" : ""}`}
                  onClick={() => toggleCard(row.projectId)}
                  onKeyDown={(e) => e.key === "Enter" && toggleCard(row.projectId)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                >
                  <div className={`gh-chevron${open ? " open" : ""}`}>▶</div>
                  {user ? (
                    <Link
                      className="gh-job-num job-link"
                      to={`/projects/${row.projectId}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.jobNumber}
                    </Link>
                  ) : (
                    <span className="gh-job-num">{row.jobNumber}</span>
                  )}
                  <div>
                    <div className="gh-name">
                      {row.jobName}
                      {row.nightsWeekends && <span className="badge-nw">Night/Weekend</span>}
                    </div>
                    <div className="gh-gc">{row.gcName || "—"}</div>
                  </div>
                  <div className="paint-header-field">
                    <div className="paint-detail-label">Submittal</div>
                    <FieldStatusPill
                      label={paintStatusLabel(row.status)}
                      className={paintPillClass(row.status)}
                    />
                  </div>
                  <div className="paint-header-field">
                    <div className="paint-detail-label">Site Ready</div>
                    <SiteReadyPills statuses={row.siteReady} />
                  </div>
                  <div className="paint-header-field">
                    <div className="paint-detail-label">PM</div>
                    <span className="gh-pm">{row.pm || "—"}</span>
                  </div>
                </div>

                {open && (
                  <div className="group-detail open">
                    <div className="paint-group-detail">
                      <div>
                        <div className="paint-detail-label">Address</div>
                        <div>{row.jobAddress || "—"}</div>
                      </div>
                      <div>
                        <div className="paint-detail-label">GC Super</div>
                        <GcSuperCell row={row} />
                      </div>
                      <div>
                        <div className="paint-detail-label">Paint</div>
                        <div>{row.paintVendor || "—"}</div>
                      </div>
                      <div>
                        <div className="paint-detail-label">Division</div>
                        <div>{row.division || "—"}</div>
                      </div>
                      <div>
                        <div className="paint-detail-label">Start date</div>
                        <PaintStartDateCell row={row} onSaved={() => void reload()} />
                      </div>
                      <div>
                        <div className="paint-detail-label">Copy</div>
                        <CopyActions row={row} />
                      </div>
                      <div className="paint-group-detail-notes">
                        <div className="paint-detail-label">Revision notes</div>
                        <div>{row.revisionNotes || "—"}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
