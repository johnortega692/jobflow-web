import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateInput } from "../DateInput";
import { addDaysToTodayDisplay } from "../../lib/dateInputUtils";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  reloadProject,
  resolvePaintTracker,
  savePaintTrackerState,
} from "../../lib/fieldTrackerProject";
import { PAINT_VENDOR_OPTIONS } from "../../lib/googleSheetsConfig";
import { resolveProjectPaintNotificationRecipients } from "../../lib/jobInfo";
import { loadPaintUserSettings } from "../../lib/paintUserSettings";
import {
  detectPaintTrackerNotificationKinds,
  sendPaintTrackerNotifications,
  type PaintTrackerNotificationKind,
} from "../../lib/trackerNotificationEmail";
import {
  applyPaintTrackerRevisionPatch,
  validatePaintTrackerRevisionSave,
} from "../../lib/paintTrackerRevision";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import type { PaintTrackerState } from "../../types/fieldTracker";
import type { PaintVendorLabel } from "../../lib/googleSheetsConfig";
import type { ProjectForm, Json } from "../../types/database";

type Props = {
  project: ProjectForm;
  projectId: string;
  onOpenJobSetup?: () => void;
  onProjectUpdate?: (project: ProjectForm) => void;
  showStatusPills?: boolean;
};

const AUTO_SAVE_MS = 700;

function StatusPill({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`job-status-pill${on ? " job-status-pill--on" : ""}`}>{label}</span>
  );
}

function TrackerCheckbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox-row paint-tracker-flag">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function notificationStatusLabel(sent: PaintTrackerNotificationKind[]): string {
  if (!sent.length) return "Saved.";
  const labels: Record<PaintTrackerNotificationKind, string> = {
    approval: "Approval",
    revision: "Revision",
    match_existing: "Match existing",
  };
  if (sent.length === 1) return `${labels[sent[0]!]} notification sent.`;
  return `Notifications sent: ${sent.map((k) => labels[k]).join(", ")}.`;
}

function trackerSnapshot(tracker: PaintTrackerState): string {
  return JSON.stringify(tracker);
}

export function PaintTrackerStatusSection({
  project,
  projectId,
  onOpenJobSetup,
  onProjectUpdate,
  showStatusPills = true,
}: Props) {
  const { user } = useAuth();
  const { settings: letterhead, branding, profile } = useLetterhead();
  const [tracker, setTracker] = useState<PaintTrackerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gasUrl, setGasUrl] = useState("");
  const [sendRevisionEmailChecked, setSendRevisionEmailChecked] = useState(false);

  const lastSavedRef = useRef<PaintTrackerState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const trackerRef = useRef<PaintTrackerState | null>(null);
  const revisionNotesRef = useRef<HTMLTextAreaElement | null>(null);

  const jobNumber = project.job_number.trim();

  const resolvedTracker = useMemo(() => {
    const trade = parseProjectTradeData(project.data as Json);
    return resolvePaintTracker(trade);
  }, [project.data]);

  useEffect(() => {
    setTracker(resolvedTracker);
    lastSavedRef.current = resolvedTracker;
    trackerRef.current = resolvedTracker;
    setLoading(false);
  }, [resolvedTracker]);

  useEffect(() => {
    trackerRef.current = tracker;
  }, [tracker]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then((s) => {
      setGasUrl((s.google_urls.paint_tracker ?? "").trim());
    });
  }, [user?.id]);

  const persistTracker = useCallback(
    async (next: PaintTrackerState) => {
      setSaving(true);
      setError(null);
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

  const flushSave = useCallback(async () => {
    const current = trackerRef.current;
    if (!current) return;
    const prev = lastSavedRef.current ?? resolvedTracker;
    if (trackerSnapshot(prev) === trackerSnapshot(current)) return;

    const revisionError = validatePaintTrackerRevisionSave(current, prev);
    if (revisionError) {
      setError(revisionError);
      revisionNotesRef.current?.focus();
      return;
    }

    const kinds = detectPaintTrackerNotificationKinds(prev, current);
    const ok = await persistTracker(current);
    if (!ok) return;

    lastSavedRef.current = current;

    if (!kinds.length) {
      setStatus("Saved.");
      return;
    }

    if (!gasUrl) {
      setStatus("Saved. Set Dashboard Web App URL in Settings to send notification emails.");
      return;
    }

    const notify = resolveProjectPaintNotificationRecipients(project, profile);
    if (!notify) {
      setStatus("Saved. Set PM email in Job setup → ICBI Info (or email on your Profile) to send notifications.");
      return;
    }

    try {
      const sent = await sendPaintTrackerNotifications({
        kinds,
        project,
        tracker: current,
        primaryEmail: notify.primaryEmail,
        primaryName: notify.primaryName,
        cc: notify.cc,
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
    resolvedTracker,
    persistTracker,
    gasUrl,
    project,
    branding.companyName,
    branding.logoUrl,
    letterhead.company_name,
    letterhead.company_address,
    letterhead.logo_url,
    profile,
  ]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, AUTO_SAVE_MS);
  }, [flushSave]);

  const sendRevisionEmailNotification = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const current = trackerRef.current;
    if (!current?.revisionNotes.trim()) {
      setError("Enter revision notes before sending the notification email.");
      setSendRevisionEmailChecked(false);
      revisionNotesRef.current?.focus();
      return;
    }

    const prev = lastSavedRef.current ?? resolvedTracker;
    const next = { ...current, revision: true };
    setTracker(next);
    trackerRef.current = next;

    const revisionError = validatePaintTrackerRevisionSave(next, prev);
    if (revisionError) {
      setError(revisionError);
      setSendRevisionEmailChecked(false);
      return;
    }

    setError(null);
    const ok = await persistTracker(next);
    if (!ok) {
      setSendRevisionEmailChecked(false);
      return;
    }

    lastSavedRef.current = next;

    if (!gasUrl) {
      setStatus("Saved. Set Dashboard Web App URL in Settings to send notification emails.");
      setSendRevisionEmailChecked(false);
      return;
    }

    const notify = resolveProjectPaintNotificationRecipients(project, profile);
    if (!notify) {
      setStatus(
        "Saved. Set PM email in Job setup → ICBI Info (or email on your Profile) to send notifications.",
      );
      setSendRevisionEmailChecked(false);
      return;
    }

    try {
      const sent = await sendPaintTrackerNotifications({
        kinds: ["revision"],
        project,
        tracker: next,
        primaryEmail: notify.primaryEmail,
        primaryName: notify.primaryName,
        cc: notify.cc,
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
    } finally {
      setSendRevisionEmailChecked(false);
    }
  }, [
    resolvedTracker,
    persistTracker,
    gasUrl,
    project,
    branding.companyName,
    branding.logoUrl,
    letterhead.company_name,
    letterhead.company_address,
    letterhead.logo_url,
    profile,
  ]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  function patchTracker(patch: Partial<PaintTrackerState>) {
    const lastSaved = lastSavedRef.current ?? resolvedTracker;
    const hasRevisionPatch = "revisionNotes" in patch || "revision" in patch;

    if (hasRevisionPatch && trackerRef.current) {
      const { next, validationError, scheduleSave: shouldSave } = applyPaintTrackerRevisionPatch(
        trackerRef.current,
        patch,
        lastSaved,
      );
      setTracker(next);
      trackerRef.current = next;
      if (validationError) {
        setError(validationError);
        if ("revision" in patch && patch.revision) {
          revisionNotesRef.current?.focus();
        }
      } else {
        setError(null);
      }
      if (shouldSave) scheduleSave();
      return;
    }

    setTracker((t) => {
      if (!t) return t;
      const next = { ...t, ...patch };
      trackerRef.current = next;
      return next;
    });
    setError(null);
    scheduleSave();
  }

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
        {showStatusPills && (
          <div className="job-status-pills" aria-label="Tracker status">
            <StatusPill label="Submittal ordered" on={tracker.submittalOrdered} />
            <StatusPill label="Submitted" on={tracker.submittedForApproval} />
            <StatusPill label="Approved" on={tracker.approved} />
            <StatusPill label="Revision" on={tracker.revision} />
            <StatusPill label="Nights" on={tracker.nightsWeekends} />
            <StatusPill label="Match existing" on={tracker.matchExisting} />
          </div>
        )}

        <div className="grid-2">
          <label>
            Paint vendor
            <select
              value={tracker.paintVendor}
              disabled={saving}
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
            Team
            <input
              value={tracker.creativeTeam}
              disabled={saving}
              onChange={(e) => patchTracker({ creativeTeam: e.target.value })}
            />
          </label>
          <label className="grid-span-2">
            Revision notes
            <textarea
              ref={revisionNotesRef}
              rows={3}
              value={tracker.revisionNotes}
              disabled={saving}
              placeholder="Describe what needs revision — required before sending notification"
              onChange={(e) => patchTracker({ revisionNotes: e.target.value })}
            />
          </label>
        </div>

        <div className="paint-tracker-flags">
          <TrackerCheckbox
            label="Send revision notification email"
            checked={sendRevisionEmailChecked}
            disabled={saving || !tracker.revisionNotes.trim()}
            onChange={(v) => {
              setSendRevisionEmailChecked(v);
              if (v) void sendRevisionEmailNotification();
            }}
          />
        </div>

        <div className="paint-tracker-flags">
          <TrackerCheckbox
            label="Match existing"
            checked={tracker.matchExisting}
            disabled={saving}
            onChange={(v) => patchTracker({ matchExisting: v })}
          />
          <TrackerCheckbox
            label="Nights / weekends"
            checked={tracker.nightsWeekends}
            disabled={saving}
            onChange={(v) => patchTracker({ nightsWeekends: v })}
          />
          <TrackerCheckbox label="No paint" checked={tracker.noPaint} disabled={saving} onChange={(v) => patchTracker({ noPaint: v })} />
        </div>

        <p className="muted small paint-tracker-subsection">Submittal status</p>
        <div className="paint-tracker-flags">
          <TrackerCheckbox
            label="Submittal ordered"
            checked={tracker.submittalOrdered}
            disabled={saving}
            onChange={(v) => patchTracker({ submittalOrdered: v })}
          />
          <TrackerCheckbox
            label="Submitted for approval"
            checked={tracker.submittedForApproval}
            disabled={saving}
            onChange={(v) =>
              patchTracker(
                v
                  ? { submittedForApproval: true, followUp: addDaysToTodayDisplay(14) }
                  : { submittedForApproval: false },
              )
            }
          />
          <TrackerCheckbox
            label="Revision"
            checked={tracker.revision}
            disabled={saving}
            onChange={(v) => patchTracker({ revision: v })}
          />
          <TrackerCheckbox
            label="Approved"
            checked={tracker.approved}
            disabled={saving}
            onChange={(v) => patchTracker({ approved: v })}
          />
        </div>

        <p className="muted small">
          Enter revision notes first, then check <strong>Send revision notification email</strong> when ready.
          Checking <strong>Revision</strong> marks the job for Field View without sending email. Other changes save
          automatically.
          {saving ? " Saving…" : status ? ` ${status}` : ""}
        </p>
      </>
    );
  }

  return (
    <div className="stack paint-tracker-section paint-tracker-section--dashboard">
      {error && <div className="banner banner-error">{error}</div>}
      {body}
    </div>
  );
}
