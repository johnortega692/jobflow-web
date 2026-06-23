import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DateInput } from "../DateInput";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  reloadProject,
  resolvePaintTracker,
  savePaintTrackerState,
} from "../../lib/fieldTrackerProject";
import { PAINT_VENDOR_OPTIONS } from "../../lib/googleSheetsConfig";
import { loadPaintUserSettings } from "../../lib/paintUserSettings";
import { resolvePaintNotificationFromProfile } from "../../lib/paintProfileDefaults";
import {
  detectPaintTrackerNotificationKinds,
  sendPaintTrackerNotifications,
  type PaintTrackerNotificationKind,
} from "../../lib/trackerNotificationEmail";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import type { PaintTrackerState } from "../../types/fieldTracker";
import type { PaintVendorLabel } from "../../lib/googleSheetsConfig";
import type { ProjectForm, Json } from "../../types/database";

type Props = {
  project: ProjectForm;
  projectId: string;
  onOpenJobSetup?: () => void;
  onProjectUpdate?: (project: ProjectForm) => void;
  /** Parent renders Save in the panel header (Job Tracker). */
  onSaveControlChange?: (control: { save: () => void; saving: boolean; visible: boolean } | null) => void;
};

function StatusPill({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`job-status-pill${on ? " job-status-pill--on" : ""}`}>{label}</span>
  );
}

function TrackerCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="checkbox-row paint-tracker-flag">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function notificationStatusLabel(sent: PaintTrackerNotificationKind[]): string {
  if (!sent.length) return "Paint tracker saved.";
  const labels: Record<PaintTrackerNotificationKind, string> = {
    approval: "Approval",
    revision: "Revision",
    match_existing: "Match existing",
  };
  if (sent.length === 1) return `${labels[sent[0]!]} notification sent.`;
  return `Notifications sent: ${sent.map((k) => labels[k]).join(", ")}.`;
}

export function PaintTrackerStatusSection({
  project,
  projectId,
  onOpenJobSetup,
  onProjectUpdate,
  onSaveControlChange,
}: Props) {
  const { user } = useAuth();
  const { settings: letterhead, branding, profile } = useLetterhead();
  const [tracker, setTracker] = useState<PaintTrackerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gasUrl, setGasUrl] = useState("");
  const [notificationPrimaryEmail, setNotificationPrimaryEmail] = useState("");
  const [notificationPrimaryName, setNotificationPrimaryName] = useState("");
  const [superEmails, setSuperEmails] = useState<{ name: string; email: string }[]>([]);

  const lastSavedRef = useRef<PaintTrackerState | null>(null);

  const jobNumber = project.job_number.trim();

  const resolvedTracker = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return resolvePaintTracker(trade);
  }, [project.data]);

  useEffect(() => {
    setTracker(resolvedTracker);
    lastSavedRef.current = resolvedTracker;
    setLoading(false);
  }, [resolvedTracker]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then((s) => {
      setGasUrl((s.google_urls.paint_tracker ?? "").trim());
      const resolved = resolvePaintNotificationFromProfile(profile, s);
      setNotificationPrimaryEmail(resolved.notification_primary_email);
      setNotificationPrimaryName(resolved.notification_primary_name);
      setSuperEmails(s.super_emails);
    });
  }, [user?.id, profile.name, profile.email]);

  const persistTracker = useCallback(
    async (next: PaintTrackerState) => {
      setSaving(true);
      setError(null);
      setStatus(null);
      const cloudErr = await savePaintTrackerState(projectId, next);
      setSaving(false);
      if (cloudErr) {
        setError(cloudErr);
        return false;
      }
      setTracker(next);
      const updated = await reloadProject(projectId);
      if (updated) onProjectUpdate?.(updated);
      return true;
    },
    [onProjectUpdate, projectId],
  );

  function patchTracker(patch: Partial<PaintTrackerState>) {
    setTracker((t) => (t ? { ...t, ...patch } : t));
  }

  const onSave = useCallback(async () => {
    if (!tracker) return;
    const prev = lastSavedRef.current ?? resolvedTracker;
    const kinds = detectPaintTrackerNotificationKinds(prev, tracker);
    const ok = await persistTracker(tracker);
    if (!ok) return;

    lastSavedRef.current = tracker;

    if (!kinds.length) {
      setStatus("Paint tracker saved.");
      return;
    }

    if (!gasUrl) {
      setStatus("Paint tracker saved. Set Dashboard Web App URL in Settings to send notification emails.");
      return;
    }

    if (!notificationPrimaryEmail.trim()) {
      setStatus(
        "Paint tracker saved. Set primary notification email in Settings → Profile or Paint & email to send notifications.",
      );
      return;
    }

    const notify = resolvePaintNotificationFromProfile(profile, {
      notification_primary_email: notificationPrimaryEmail,
      notification_primary_name: notificationPrimaryName,
    });

    try {
      const sent = await sendPaintTrackerNotifications({
        kinds,
        project,
        tracker,
        primaryEmail: notify.notification_primary_email,
        primaryName: notify.notification_primary_name,
        superEmails,
        companyName: branding.companyName || letterhead.company_name,
        companyAddress: letterhead.company_address,
        fromName: `${branding.companyName || letterhead.company_name || "JobFlow"} Dashboard`.trim(),
        gasUrl,
        logoUrl: letterhead.logo_url || branding.logoUrl,
      });
      setStatus(notificationStatusLabel(sent));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Email send failed.";
      setError(`Saved, but notification email failed: ${msg}`);
    }
  }, [
    tracker,
    resolvedTracker,
    persistTracker,
    gasUrl,
    notificationPrimaryEmail,
    notificationPrimaryName,
    superEmails,
    project,
    branding.companyName,
    branding.logoUrl,
    letterhead.company_name,
    letterhead.company_address,
    letterhead.logo_url,
    profile,
  ]);

  const canSave = Boolean(jobNumber && tracker && !loading);

  useEffect(() => {
    if (!onSaveControlChange) return;
    if (!canSave) {
      onSaveControlChange(null);
      return;
    }
    onSaveControlChange({
      save: () => void onSave(),
      saving,
      visible: true,
    });
  }, [canSave, onSave, onSaveControlChange, saving]);

  useEffect(() => {
    return () => onSaveControlChange?.(null);
  }, [onSaveControlChange]);

  let body: ReactNode;
  if (!jobNumber) {
    body = (
      <p className="muted small">
        Add a job number in{" "}
        {onOpenJobSetup ? (
          <button type="button" className="link-btn" onClick={onOpenJobSetup}>
            job setup
          </button>
        ) : (
          "job setup"
        )}{" "}
        to manage paint tracker status.
      </p>
    );
  } else if (loading || !tracker) {
    body = <p className="muted small">Loading paint tracker…</p>;
  } else {
    body = (
      <>
        <div className="job-status-pills" aria-label="Tracker status">
          <StatusPill label="Submittal ordered" on={tracker.submittalOrdered} />
          <StatusPill label="Submitted" on={tracker.submittedForApproval} />
          <StatusPill label="Approved" on={tracker.approved} />
          <StatusPill label="Revision" on={tracker.revision} />
          <StatusPill label="Nights" on={tracker.nightsWeekends} />
          <StatusPill label="FSI" on={tracker.fsi} />
          <StatusPill label="Match existing" on={tracker.matchExisting} />
        </div>

        <div className="grid-2">
          <label>
            Paint vendor
            <select
              value={tracker.paintVendor}
              onChange={(e) => patchTracker({ paintVendor: e.target.value as PaintVendorLabel })}
            >
              {PAINT_VENDOR_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Follow up
            <DateInput value={tracker.followUp} onChange={(v) => patchTracker({ followUp: v })} />
          </label>
          <label>
            Creative team
            <input
              value={tracker.creativeTeam}
              onChange={(e) => patchTracker({ creativeTeam: e.target.value })}
            />
          </label>
          <label className="grid-span-2">
            Revision notes
            <input
              value={tracker.revisionNotes}
              onChange={(e) => patchTracker({ revisionNotes: e.target.value })}
            />
          </label>
        </div>

        <div className="paint-tracker-flags">
          <TrackerCheckbox
            label="Match existing"
            checked={tracker.matchExisting}
            onChange={(v) => patchTracker({ matchExisting: v })}
          />
          <TrackerCheckbox
            label="Nights / weekends"
            checked={tracker.nightsWeekends}
            onChange={(v) => patchTracker({ nightsWeekends: v })}
          />
          <TrackerCheckbox label="FSI" checked={tracker.fsi} onChange={(v) => patchTracker({ fsi: v })} />
          <TrackerCheckbox label="No paint" checked={tracker.noPaint} onChange={(v) => patchTracker({ noPaint: v })} />
        </div>

        <p className="muted small paint-tracker-subsection">Brush outs status</p>
        <div className="paint-tracker-flags">
          <TrackerCheckbox
            label="Submitted for approval"
            checked={tracker.submittedForApproval}
            onChange={(v) => patchTracker({ submittedForApproval: v })}
          />
          <TrackerCheckbox
            label="Revision"
            checked={tracker.revision}
            onChange={(v) => patchTracker({ revision: v })}
          />
          <TrackerCheckbox
            label="Approved"
            checked={tracker.approved}
            onChange={(v) => patchTracker({ approved: v })}
          />
        </div>

        <p className="muted small">
          Submittal ordered: <strong>{tracker.submittalOrdered ? "Yes" : "No"}</strong> — toggle on the{" "}
          <Link to={`/projects/${projectId}/paint`}>Paint</Link> submittals tab or when you email the vendor.
        </p>
        <p className="muted small">
          Saving <strong>Approved</strong>, <strong>Revision</strong>, or <strong>Match existing</strong> sends a
          notification email via Gmail when Settings are configured.
        </p>
      </>
    );
  }

  return (
    <div className="stack paint-tracker-section paint-tracker-section--dashboard">
      {(error || status) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? status}</div>
      )}
      {body}
    </div>
  );
}
