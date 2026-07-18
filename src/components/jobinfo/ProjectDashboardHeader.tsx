import { useState } from "react";
import { Link } from "react-router-dom";
import { GcContactLine } from "./GcContactLine";
import { DashboardTablerIcon } from "./DashboardTablerIcon";
import {
  frpJobLabel,
  hasDistinctFrpContract,
  hasDistinctTrackContract,
  hasDistinctWcContract,
  icbiSuperEmail,
  icbiSuperintendent,
  trackJobLabel,
  wcTrackerJobLabel,
} from "../../lib/jobInfo";
import { paintTrackerActiveFlags } from "../../lib/projectDashboardSnapshot";
import { SubmittalPipelineStepper } from "./SubmittalPipelineStepper";
import type { PaintTrackerState } from "../../types/fieldTracker";
import type { ProjectForm } from "../../types/database";

type ContactSlot = {
  key: string;
  role: string;
  icon: "user" | "hard-hat" | "shield-check";
  name: string;
  phone: string;
  email: string;
};

type Props = {
  project: ProjectForm;
  projectId: string;
  attentionCount: number;
  paintTracker: PaintTrackerState;
  onOpenJobSetup: () => void;
  onOpenTrackerEdit: () => void;
};

function displayName(name: string): string {
  const t = name.trim();
  return t.toUpperCase() === "TBD" ? "" : t;
}

export function ProjectDashboardHeader({
  project,
  projectId,
  attentionCount,
  paintTracker,
  onOpenJobSetup,
  onOpenTrackerEdit,
}: Props) {
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const j = project.jobInfo;

  const contacts = (
    [
      {
        key: "gc-pm",
        role: "GC PM",
        icon: "user",
        name: displayName(j.gc_pm),
        phone: j.gc_pm_phone.trim(),
        email: j.gc_pm_email.trim(),
      },
      {
        key: "gc-super",
        role: "GC Super",
        icon: "hard-hat",
        name: displayName(j.gc_superintendent),
        phone: j.gc_super_phone.trim(),
        email: j.gc_super_email.trim(),
      },
      {
        key: "icbi-super",
        role: "ICBI Super",
        icon: "shield-check",
        name: icbiSuperintendent(j),
        phone: "",
        email: icbiSuperEmail(j),
      },
    ] satisfies ContactSlot[]
  ).filter((c) => c.name || c.phone || c.email);

  const trackerFlags = paintTrackerActiveFlags(paintTracker);

  return (
    <header className="card job-dashboard-header job-dashboard-header--snapshot">
      <div className="job-dashboard-header-main">
        <p className="job-dashboard-kicker muted small">
          {project.job_number || "—"}
          {project.contractor ? ` · ${project.contractor}` : ""}
        </p>
        <h2 className="job-dashboard-heading job-dashboard-heading--large">{project.job_name || "Untitled project"}</h2>

        <div className="job-dashboard-pills" role="list">
          {attentionCount > 0 && (
            <span className="job-dashboard-pill job-dashboard-pill--attention" role="listitem">
              {attentionCount} {attentionCount === 1 ? "item needs" : "items need"} attention
            </span>
          )}
          {paintTracker.paintVendor && (
            <span className="job-dashboard-pill job-dashboard-pill--vendor" role="listitem">
              {paintTracker.paintVendor}
            </span>
          )}
          {paintTracker.creativeTeam.trim() && (
            <span className="job-dashboard-pill job-dashboard-pill--team" role="listitem">
              {paintTracker.creativeTeam.trim()}
            </span>
          )}
          {j.public_works && (
            <span className="job-dashboard-pill job-dashboard-pill--public-works" role="listitem">
              Public works
            </span>
          )}
          {trackerFlags.map((flag) => (
            <span key={flag} className="job-dashboard-pill job-dashboard-pill--flag" role="listitem">
              {flag}
            </span>
          ))}
        </div>

        <div className="job-dashboard-header-divider" />

        <div className="job-dashboard-contacts-compact">
          {contacts.map((c) => (
            <div key={c.key} className="job-dashboard-contact-chip-wrap">
              <button
                type="button"
                className="job-dashboard-contact-chip"
                onClick={() => setExpandedContact((k) => (k === c.key ? null : c.key))}
              >
                <DashboardTablerIcon name={c.icon} size={14} />
                <span className="job-dashboard-contact-chip-role">{c.role}</span>
                <span className="job-dashboard-contact-chip-name">{c.name || "—"}</span>
              </button>
              {expandedContact === c.key && (c.phone || c.email) && (
                <div className="job-dashboard-contact-popover">
                  {c.phone && (
                    <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="job-dashboard-contact-link">
                      {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="job-dashboard-contact-link">
                      {c.email}
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="link-btn job-dashboard-all-contacts"
            onClick={() => setShowAllContacts((v) => !v)}
          >
            {showAllContacts ? "Hide contacts" : "All contacts"}
          </button>
        </div>

        {showAllContacts && (
          <div className="job-dashboard-contacts-full">
            {hasDistinctWcContract(project) && (
              <p className="muted small job-dashboard-wc-contract">
                Wallcovering contract: {wcTrackerJobLabel(project)}
              </p>
            )}
            {hasDistinctFrpContract(project) && (
              <p className="muted small job-dashboard-wc-contract">FRP contract: {frpJobLabel(project)}</p>
            )}
            {hasDistinctTrackContract(project) && (
              <p className="muted small job-dashboard-wc-contract">Track contract: {trackJobLabel(project)}</p>
            )}
            <GcContactLine label="GC PM" name={j.gc_pm} phone={j.gc_pm_phone} email={j.gc_pm_email} />
            <GcContactLine
              label="GC Super"
              name={j.gc_superintendent}
              phone={j.gc_super_phone}
              email={j.gc_super_email}
            />
            {(icbiSuperintendent(j) || icbiSuperEmail(j)) && (
              <GcContactLine label="ICBI Super" name={icbiSuperintendent(j)} phone="" email={icbiSuperEmail(j)} />
            )}
            {(j.icbi_foreman.trim() || j.icbi_foreman_email.trim()) && (
              <GcContactLine label="Foreman" name={j.icbi_foreman} phone="" email={j.icbi_foreman_email} />
            )}
          </div>
        )}

        <div className="job-dashboard-header-divider" />

        <SubmittalPipelineStepper tracker={paintTracker} />
      </div>

      <div className="row-gap wrap job-dashboard-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenJobSetup}>
          Job setup
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenTrackerEdit}>
          Edit tracker
        </button>
        <Link to={`/projects/${projectId}/submittals/paint`} className="btn btn-ghost btn-sm">
          Paint
        </Link>
      </div>
    </header>
  );
}
