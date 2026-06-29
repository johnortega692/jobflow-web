import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { DateInput } from "../../components/DateInput";
import { saveWcInstallDate, type FieldWcItemRow } from "../../lib/fieldTrackerProject";
import { wcDotClass, wcPillClass, wcStatusLabel, type WcFieldStatus } from "../../lib/fieldTrackerStatus";
import {
  FieldEmptyPanel,
  FieldLoadingPanel,
  FieldStatusPill,
  FieldToolbar,
  useDebouncedValue,
  useFieldDashboard,
} from "./FieldDashboardLayout";

const STATUS_OPTIONS: { value: WcFieldStatus; label: string }[] = [
  { value: "Not Started", label: "Not Started" },
  { value: "Submittal Ordered", label: "Submittal Ordered" },
  { value: "Submitted for Approval", label: "Sent for Approval" },
  { value: "Needs Revision", label: "Needs Revision" },
  { value: "Approved", label: "Approved" },
  { value: "Material Ordered", label: "Material Ordered" },
  { value: "Delivered", label: "Delivered" },
];

type JobGroup = {
  jobNumber: string;
  jobName: string;
  gcName: string;
  pm: string;
  projectId: string;
  items: FieldWcItemRow[];
};

function InstallDateCell({
  row,
  onSaved,
}: {
  row: FieldWcItemRow;
  onSaved: () => void;
}) {
  const { toast } = useFieldDashboard();
  const [value, setValue] = useState(row.installDate);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const err = await saveWcInstallDate(row.projectId, row.lineId, value);
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    toast(`Install date updated for ${row.label || row.wallcoveringName}`);
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

export function FieldWallcoveringDashboardPage() {
  const { user } = useAuth();
  const { wcRows, loading, reload, mobileView } = useFieldDashboard();
  const [search, setSearch] = useState("");
  const [pm, setPm] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; cap: string } | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const pmOptions = useMemo(
    () => [...new Set(wcRows.map((r) => r.pm).filter(Boolean))].sort(),
    [wcRows],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return wcRows.filter((row) => {
      const text = [row.jobNumber, row.jobName, row.gcName, row.wallcoveringName, row.label]
        .join(" ")
        .toLowerCase();
      if (q && !text.includes(q)) return false;
      if (pm && row.pm !== pm) return false;
      if (status && row.status !== status) return false;
      return true;
    });
  }, [wcRows, debouncedSearch, pm, status]);

  const groups = useMemo(() => {
    const map = new Map<string, JobGroup>();
    for (const row of filtered) {
      const key = row.jobNumber;
      if (!map.has(key)) {
        map.set(key, {
          jobNumber: row.jobNumber,
          jobName: row.jobName,
          gcName: row.gcName,
          pm: row.pm,
          projectId: row.projectId,
          items: [],
        });
      }
      map.get(key)!.items.push(row);
    }
    return [...map.values()].sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
  }, [filtered]);

  function toggleGroup(jobNumber: string) {
    setExpanded((prev) => ({ ...prev, [jobNumber]: !prev[jobNumber] }));
  }

  function toggleExpandAll() {
    const next = !allExpanded;
    setAllExpanded(next);
    const patch: Record<string, boolean> = {};
    groups.forEach((g) => {
      patch[g.jobNumber] = next;
    });
    setExpanded(patch);
  }

  function statusCounts(items: FieldWcItemRow[]) {
    const counts: Partial<Record<WcFieldStatus, number>> = {};
    for (const item of items) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }
    return counts;
  }

  if (loading) return <FieldLoadingPanel message="Loading wallcovering data…" />;

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
        searchPlaceholder="Search jobs, GC, material…"
      />

      <div className="warning-banner">
        ⚠️ = Items need extra materials to complete installation (Panels flag).
      </div>

      {groups.length === 0 ? (
        <FieldEmptyPanel />
      ) : (
        <div className="table-view">
          <div className="groups-toolbar">
            <button type="button" className="expand-all-btn" onClick={toggleExpandAll}>
              {allExpanded ? "Collapse All" : "Expand All"}
            </button>
            <span className="groups-count">
              {groups.length} jobs · {filtered.length} items
            </span>
          </div>

          {groups.map((group) => {
            const open = expanded[group.jobNumber] ?? false;
            const counts = statusCounts(group.items);
            const allDelivered =
              group.items.length > 0 && group.items.every((i) => i.status === "Delivered");

            return (
              <div key={group.jobNumber} className="job-group">
                <div
                  className={`group-header${open ? " open" : ""}`}
                  onClick={() => toggleGroup(group.jobNumber)}
                  onKeyDown={(e) => e.key === "Enter" && toggleGroup(group.jobNumber)}
                  role="button"
                  tabIndex={0}
                >
                  <div className={`gh-chevron${open ? " open" : ""}`}>▶</div>
                  {user ? (
                    <Link
                      className="gh-job-num job-link"
                      to={`/projects/${group.projectId}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {group.jobNumber}
                    </Link>
                  ) : (
                    <span className="gh-job-num">{group.jobNumber}</span>
                  )}
                  <div>
                    <div className="gh-name">{group.jobName}</div>
                    <div className="gh-gc">{group.gcName}</div>
                  </div>
                  <div className="gh-dots">
                    {group.items.map((item) => (
                      <span
                        key={item.lineId}
                        className={`dot ${wcDotClass(item.status)}`}
                        title={`${item.label}: ${wcStatusLabel(item.status)}`}
                      />
                    ))}
                  </div>
                  <div className="gh-chips">
                    {allDelivered ? (
                      <FieldStatusPill label="✓ All delivered" className="pill-delivered" />
                    ) : (
                      Object.entries(counts).map(([s, c]) => (
                        <FieldStatusPill
                          key={s}
                          label={`${c} ${wcStatusLabel(s as WcFieldStatus)}`}
                          className={wcPillClass(s as WcFieldStatus)}
                        />
                      ))
                    )}
                  </div>
                  <span className="gh-count">
                    {group.items.length} item{group.items.length === 1 ? "" : "s"}
                  </span>
                  <span className="gh-pm">{group.pm}</span>
                </div>

                {open && (
                  <div className="group-detail open">
                    {mobileView ? (
                      <div className="field-mobile-list field-mobile-list--nested">
                        {group.items.map((item) => (
                          <article key={item.lineId} className="field-mobile-card field-mobile-card--item">
                            <div className="field-mobile-card-head">
                              <div>
                                <div className="field-mobile-title">{item.label || "—"}</div>
                                <div className="field-mobile-sub">
                                  {item.wallcoveringName}
                                  {item.panels && " ⚠️"}
                                </div>
                              </div>
                              <FieldStatusPill
                                label={wcStatusLabel(item.status)}
                                className={wcPillClass(item.status)}
                              />
                            </div>
                            <div className="field-mobile-actions">
                              <InstallDateCell row={item} onSaved={() => void reload()} />
                            </div>
                            {item.imageUrl ? (
                              <img
                                className="img-thumb field-mobile-thumb"
                                src={item.imageUrl}
                                alt={item.label}
                                onClick={() =>
                                  setLightbox({
                                    url: item.imageUrl,
                                    cap: `${item.label} – ${item.wallcoveringName}`,
                                  })
                                }
                              />
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                    <table className="inner-table">
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th>Wallcovering</th>
                          <th>Status</th>
                          <th>Revision notes</th>
                          <th>Install Date</th>
                          <th>Image</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => (
                          <tr key={item.lineId}>
                            <td>{item.label}</td>
                            <td>
                              {item.wallcoveringName}
                              {item.panels && " ⚠️"}
                            </td>
                            <td>
                              <FieldStatusPill
                                label={wcStatusLabel(item.status)}
                                className={wcPillClass(item.status)}
                              />
                            </td>
                            <td className="field-revision-notes-cell">{item.revisionNotes || "—"}</td>
                            <td>
                              <InstallDateCell row={item} onSaved={() => void reload()} />
                            </td>
                            <td>
                              {item.imageUrl ? (
                                <img
                                  className="img-thumb"
                                  src={item.imageUrl}
                                  alt={item.label}
                                  onClick={() =>
                                    setLightbox({
                                      url: item.imageUrl,
                                      cap: `${item.label} – ${item.wallcoveringName}`,
                                    })
                                  }
                                />
                              ) : (
                                <span className="muted small">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`field-lightbox${lightbox ? " open" : ""}`}
        onClick={() => setLightbox(null)}
        onKeyDown={(e) => e.key === "Escape" && setLightbox(null)}
        role="presentation"
      >
        {lightbox && (
          <>
            <img src={lightbox.url} alt={lightbox.cap} onClick={(e) => e.stopPropagation()} />
            <div className="field-lightbox-cap">{lightbox.cap}</div>
          </>
        )}
      </div>
    </>
  );
}
