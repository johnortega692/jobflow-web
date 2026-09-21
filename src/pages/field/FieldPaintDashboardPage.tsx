import { useMemo, useState } from "react";
import { DateInput } from "../../components/DateInput";
import { vcardFileName, vcardHref } from "../../lib/contactCard";
import {
  paintJobSmsText,
  saveProjectStartDate,
  type FieldPaintRow,
} from "../../lib/fieldTrackerProject";
import {
  paintMobileReadiness,
  paintMobileStatusLabel,
  paintPillClass,
  paintStatusLabel,
  paintSubmittalCardState,
  type PaintFieldStatus,
  type SubmittalCardState,
} from "../../lib/fieldTrackerStatus";
import {
  paintMobilizeCardState,
  siteReadyColumnPillClass,
  siteReadyColumnStatuses,
  type MobilizeCardState,
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

type PaintDashboardRow = FieldPaintRow & {
  siteReady: SiteReadyColumnStatus[];
  mobilize: MobilizeCardState;
};

function GcSuperCell({
  row,
  linkPhone = false,
  inline = false,
}: {
  row: FieldPaintRow;
  linkPhone?: boolean;
  inline?: boolean;
}) {
  if (!row.gcSuperName && !row.gcSuperPhone) return <>—</>;
  const phoneHref = row.gcSuperPhone ? `tel:${row.gcSuperPhone.replace(/[^\d+]/g, "")}` : "";
  const phone = row.gcSuperPhone ? (
    linkPhone ? (
      <a href={phoneHref} className="field-gc-super-phone field-gc-super-phone-link">
        {row.gcSuperPhone}
      </a>
    ) : (
      <span className="field-gc-super-phone">{row.gcSuperPhone}</span>
    )
  ) : null;
  const contactName = row.gcSuperName.trim() || "GC Super";
  const name = row.gcSuperName ? (
    linkPhone ? (
      <a
        className="field-gc-super-vcard"
        href={vcardHref({
          name: contactName,
          phone: row.gcSuperPhone,
          org: row.gcName,
          note: [row.jobNumber, row.jobName].filter(Boolean).join(" "),
        })}
        download={vcardFileName(contactName)}
        aria-label={`Add ${contactName} to contacts`}
        title="Add to contacts"
      >
        {row.gcSuperName}
      </a>
    ) : (
      <span>{row.gcSuperName}</span>
    )
  ) : null;
  return (
    <span className={`field-gc-super-cell${inline ? " field-gc-super-cell--inline" : ""}`}>
      {name}
      {inline && name && phone ? <span className="field-gc-super-sep"> · </span> : null}
      {phone}
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
        Copy
      </button>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.4 11.3 3.2 8.1l1.1-1.1 2.1 2.1 5.3-5.3 1.1 1.1z"
      />
    </svg>
  );
}

function WarningGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 1.6 14.7 13.4c.3.5-.1 1.1-.7 1.1H2c-.6 0-1-.6-.7-1.1L8 1.6Zm0 4.2c-.4 0-.7.3-.7.7v3.1c0 .4.3.7.7.7s.7-.3.7-.7V6.5c0-.4-.3-.7-.7-.7Zm0 6.3c.4 0 .7-.3.7-.7S8.4 10.7 8 10.7s-.7.3-.7.7.3.7.7.7Z"
      />
    </svg>
  );
}

const STARTUP_MOBILE_LABELS: Record<string, string> = {
  contract: "Executed contract",
  coi: "Certificate of insurance (COI)",
};

function skipSubmittalCaption(status: PaintFieldStatus): string {
  return status === "Match Existing" ? "Matching existing paint" : "Not required for this job";
}

function PaintMobileJobStatus({
  submittal,
  mobilize,
  revisionNotes,
}: {
  submittal: SubmittalCardState;
  mobilize: MobilizeCardState;
  revisionNotes: string;
}) {
  const readiness = paintMobileReadiness(submittal, mobilize);
  const [submittalOpen, setSubmittalOpen] = useState(false);
  const [startupOpen, setStartupOpen] = useState(false);
  const note = revisionNotes.trim();

  return (
    <div className="field-ready">
      <div className={`field-ready-banner field-ready-banner--${readiness.ready ? "ready" : "blocked"}`}>
        <span className="field-ready-banner-icon" aria-hidden="true">
          {readiness.ready ? <CheckGlyph /> : <WarningGlyph />}
        </span>
        <div className="field-ready-banner-copy">
          <div className="field-ready-banner-title">{readiness.title}</div>
          {readiness.detail ? <div className="field-ready-banner-detail">{readiness.detail}</div> : null}
        </div>
      </div>

      {submittal.showSteps ? (
        <section className={`field-ready-section${submittalOpen ? " open" : ""}`}>
          <button
            type="button"
            className="field-ready-section-toggle"
            aria-expanded={submittalOpen}
            onClick={() => setSubmittalOpen((open) => !open)}
          >
            <span className="field-ready-section-title">Submittal</span>
            <FieldStatusPill
              label={paintMobileStatusLabel(submittal.status)}
              className={paintPillClass(submittal.status)}
            />
            <span className={`field-ready-chevron${submittalOpen ? " open" : ""}`} aria-hidden="true">
              ▾
            </span>
          </button>
          {submittalOpen ? (
            <div className="field-ready-section-body">
              <ul className="field-ready-steps">
                {submittal.mobileSteps.map((step) => (
                  <li
                    key={step.id}
                    className={`field-ready-step${step.done ? " field-ready-step--done" : ""}`}
                  >
                    <span className="field-ready-step-dot" aria-hidden="true" />
                    <span>{step.label}</span>
                  </li>
                ))}
              </ul>
              {note ? (
                <p className="field-ready-note">
                  <span className="field-ready-note-label">Revision note</span>
                  {` — ${note}`}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <div className="field-ready-section field-ready-section--static">
          <div className="field-ready-section-toggle" role="group">
            <span className="field-ready-section-title">Submittal</span>
            <span className="field-ready-section-muted">{skipSubmittalCaption(submittal.status)}</span>
          </div>
        </div>
      )}

      <section className={`field-ready-section${startupOpen ? " open" : ""}`}>
        <button
          type="button"
          className="field-ready-section-toggle"
          aria-expanded={startupOpen}
          onClick={() => setStartupOpen((open) => !open)}
        >
          <span className="field-ready-section-title">Startup requirements</span>
          <span className={`field-ready-count${mobilize.ready ? " field-ready-count--done" : ""}`}>
            {mobilize.done} of {mobilize.total}
          </span>
          <span className={`field-ready-chevron${startupOpen ? " open" : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>
        {startupOpen ? (
          <div className="field-ready-section-body">
            <ul className="field-ready-checks">
              {mobilize.items.map((item) => (
                <li
                  key={item.id}
                  className={`field-ready-check${item.done ? " field-ready-check--done" : ""}`}
                  title={item.detail}
                >
                  <span className="field-ready-check-mark" aria-hidden="true">
                    {item.done ? <CheckGlyph /> : null}
                  </span>
                  <span>{STARTUP_MOBILE_LABELS[item.id] ?? item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SubmittalStatusCard({ state }: { state: SubmittalCardState }) {
  return (
    <div className={`submittal-card submittal-card--${state.tone}`}>
      <div className="submittal-card-head">
        <div className="submittal-card-title">Submittal</div>
        <div className="submittal-card-progress">{state.statusLabel}</div>
      </div>
      <p className="submittal-card-desc">{state.description}</p>
      {state.showSteps ? (
        <ol className="submittal-card-list">
          {state.steps.map((step, index) => {
            const kind = step.current ? "current" : step.done ? "done" : "future";
            return (
              <li key={step.id} className={`submittal-card-item submittal-card-item--${kind}`}>
                <span className="submittal-card-index" aria-hidden="true">
                  {step.done && !step.current ? <CheckGlyph /> : index + 1}
                </span>
                <span className="submittal-card-label">{step.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function MobilizeStatusCard({ state }: { state: MobilizeCardState }) {
  const tone = state.ready ? "ready" : state.done === 0 ? "pending" : "partial";
  return (
    <div className={`mobilize-card mobilize-card--${tone}`}>
      <div className="mobilize-card-head">
        <div className="mobilize-card-title">Startup Requirements</div>
      </div>
      <ul className="mobilize-card-list">
        {state.items.map((item) => (
          <li
            key={item.id}
            className={`mobilize-card-item${item.done ? " mobilize-card-item--done" : ""}`}
            title={item.detail}
          >
            <span className="mobilize-card-check" aria-hidden="true">
              {item.done ? <CheckGlyph /> : null}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="mobilize-card-footer">
        <span className="mobilize-card-footer-icon" aria-hidden="true">
          {state.ready ? <CheckGlyph /> : null}
        </span>
        {state.ready ? "Ready to Mobilize" : "Not Ready to Mobilize"}
      </div>
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
        mobilize: paintMobilizeCardState(project),
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
            return (
              <div
                key={row.projectId}
                className={`job-group field-mobile-card-wrap${open ? " open" : ""}`}
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
                    <span className="field-mobile-job">{row.jobNumber}</span>
                    <div className="field-mobile-title">
                      {row.jobName}
                      {row.nightsWeekends && <span className="badge-nw">Night/Weekend</span>}
                    </div>
                    <div className="field-mobile-sub">{row.gcName || "—"}</div>
                  </div>
                  <FieldStatusPill
                    label={paintMobileStatusLabel(row.status)}
                    className={`${paintPillClass(row.status)}${
                      row.status === "Not Needed" || row.status === "Needs Revision"
                        ? " pill-mobile-outline"
                        : ""
                    }`}
                  />
                </div>
                {open && (
                  <div className="group-detail open field-mobile-card-body">
                    <PaintMobileJobStatus
                      submittal={paintSubmittalCardState(row.tracker)}
                      mobilize={row.mobilize}
                      revisionNotes={row.revisionNotes}
                    />
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
                          <GcSuperCell row={row} linkPhone={mobileView} inline />
                        </dd>
                      </div>
                      <div>
                        <dt>Paint</dt>
                        <dd>{row.paintVendor || "—"}</dd>
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
            return (
              <div
                key={row.projectId}
                className={`job-group${open ? " open" : ""}`}
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
                  <span className="gh-job-num">{row.jobNumber}</span>
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
                    <div className="paint-detail-label">Mobilize</div>
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
                      <div className="paint-detail-address">
                        <div className="paint-detail-label">Address</div>
                        <div>{row.jobAddress || "—"}</div>
                      </div>
                      <div className="paint-detail-gcsuper">
                        <div className="paint-detail-label">GC Super</div>
                        <GcSuperCell row={row} />
                      </div>
                      <div className="paint-detail-paint">
                        <div className="paint-detail-label">Paint</div>
                        <div>{row.paintVendor || "—"}</div>
                      </div>
                      <div className="paint-group-detail-card">
                        <SubmittalStatusCard state={paintSubmittalCardState(row.tracker)} />
                        <MobilizeStatusCard state={row.mobilize} />
                      </div>
                      <div className="paint-detail-division">
                        <div className="paint-detail-label">Division</div>
                        <div>{row.division || "—"}</div>
                      </div>
                      <div className="paint-detail-start">
                        <div className="paint-detail-label">Start date</div>
                        <PaintStartDateCell row={row} onSaved={() => void reload()} />
                      </div>
                      <div className="paint-detail-copy">
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
