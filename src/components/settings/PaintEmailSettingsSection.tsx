import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { patchOrgSettings, patchUserSettings } from "../../lib/budgetLibrary";
import { buildEmailSignatureHtml, SIGNATURE_FONT_SIZE_OPTIONS, SIGNATURE_LINE_COUNT } from "../../lib/emailSignature";
import { uploadEmailSignatureLogo } from "../../lib/letterheadSettings";
import type { SignatureLineStyle } from "../../lib/emailSignature";
import { applyProfilePaintDefaults, resolvePaintNotificationFromProfile } from "../../lib/paintProfileDefaults";
import {
  loadPaintUserSettings,
  type PaintUserSettings,
  type SuperEmail,
} from "../../lib/paintUserSettings";
import type { PaintVendor } from "../../lib/paintVendorEmail";
import { useSettingsDirtyTracker } from "../../lib/useSettingsDirtyTracker";
import { profileFromSettings } from "../../lib/userProfile";
import {
  loadProjectsForFollowUpReminders,
  sendFollowUpReminder,
  type FollowUpReminderKind,
} from "../../lib/trackerFollowUpReminders";
import {
  loadProjectsForWeeklyDigest,
  sendWeeklyTrackerDigest,
  type WeeklyDigestKind,
} from "../../lib/trackerWeeklyDigest";
import type { LetterheadSettings } from "../../types/letterheadSettings";
import {
  DEFAULT_TRACKER_EMAIL_SCHEDULE,
  TRACKER_CRON_UTC_SCHEDULE,
  type TrackerEmailSchedule,
} from "../../lib/trackerEmailSchedule";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";
import { MailtoSetupHelp } from "./MailtoSetupHelp";

function emptyVendor(): PaintVendor {
  return { name: "", brand: "PPG", vendor_email: "", store_email: "" };
}

function emptySuper(): SuperEmail {
  return { name: "", email: "" };
}

function WeeklyDigestSection({
  data,
  letterhead,
  brandingCompanyName,
}: {
  data: PaintUserSettings;
  letterhead: LetterheadSettings;
  brandingCompanyName: string;
}) {
  const [digestSending, setDigestSending] = useState<WeeklyDigestKind | null>(null);
  const [digestMessage, setDigestMessage] = useState<string | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);

  const gasUrl = (data.google_urls.paint_tracker ?? "").trim();
  const notify = resolvePaintNotificationFromProfile(profileFromSettings(letterhead), data);
  const primaryEmail = notify.notification_primary_email.trim();
  const companyName = brandingCompanyName.trim() || letterhead.company_name.trim() || "JobFlow";

  async function sendDigest(kind: WeeklyDigestKind) {
    setDigestSending(kind);
    setDigestMessage(null);
    setDigestError(null);

    if (!gasUrl) {
      setDigestError("Set Dashboard Web App URL in Settings → Google Sheets.");
      setDigestSending(null);
      return;
    }
    if (!primaryEmail) {
      setDigestError("Set primary notification email above.");
      setDigestSending(null);
      return;
    }

    try {
      const { projects, error } = await loadProjectsForWeeklyDigest();
      if (error) throw new Error(error);
      await sendWeeklyTrackerDigest({
        kind,
        projects,
        primaryEmail,
        primaryName: notify.notification_primary_name,
        superEmails: data.super_emails,
        companyName,
        companyAddress: letterhead.company_address,
        fromName: `${companyName} Dashboard`.trim(),
        gasUrl,
        logoUrl: letterhead.logo_url,
      });
      setDigestMessage(
        kind === "combined"
          ? "Combined weekly submittal digest sent."
          : "Wallcovering weekly digest sent.",
      );
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : "Could not send digest.");
    } finally {
      setDigestSending(null);
    }
  }

  return (
    <section className="stack">
      <h2>Weekly digests</h2>
      <p className="muted small">
        Build a status email from all jobs in JobFlow and send now via Gmail. Same recipients as tracker
        notifications (primary To, supers CC, plus foreman emails from job setup).
      </p>
      {(digestError || digestMessage) && (
        <div className={`banner ${digestError ? "banner-error" : "banner-ok"}`}>
          {digestError ?? digestMessage}
        </div>
      )}
      <div className="row-gap wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={digestSending !== null}
          onClick={() => void sendDigest("combined")}
        >
          {digestSending === "combined" ? "Sending…" : "Send combined paint + WC digest"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={digestSending !== null}
          onClick={() => void sendDigest("wallcovering")}
        >
          {digestSending === "wallcovering" ? "Sending…" : "Send wallcovering digest only"}
        </button>
      </div>
    </section>
  );
}

function FollowUpRemindersSection({
  data,
  letterhead,
  brandingCompanyName,
}: {
  data: PaintUserSettings;
  letterhead: LetterheadSettings;
  brandingCompanyName: string;
}) {
  const [sending, setSending] = useState<FollowUpReminderKind | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const gasUrl = (data.google_urls.paint_tracker ?? "").trim();
  const notify = resolvePaintNotificationFromProfile(profileFromSettings(letterhead), data);
  const primaryEmail = notify.notification_primary_email.trim();
  const companyName = brandingCompanyName.trim() || letterhead.company_name.trim() || "JobFlow";

  async function sendReminder(kind: FollowUpReminderKind) {
    setSending(kind);
    setStatus(null);
    setStatusError(null);

    if (!gasUrl) {
      setStatusError("Set Dashboard Web App URL in Settings → Google Sheets.");
      setSending(null);
      return;
    }
    if (!primaryEmail) {
      setStatusError("Set primary notification email above.");
      setSending(null);
      return;
    }

    try {
      const { projects, error } = await loadProjectsForFollowUpReminders();
      if (error) throw new Error(error);
      await sendFollowUpReminder({
        kind,
        projects,
        primaryEmail,
        primaryName: notify.notification_primary_name,
        superEmails: data.super_emails,
        companyName,
        companyAddress: letterhead.company_address,
        fromName: `${companyName} Dashboard`.trim(),
        gasUrl,
        logoUrl: letterhead.logo_url,
      });
      const labels: Record<FollowUpReminderKind, string> = {
        paint: "Paint follow-up reminder",
        wallcovering: "Wallcovering follow-up reminder",
        installs: "Upcoming installations reminder",
      };
      setStatus(`${labels[kind]} sent.`);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Could not send reminder.");
    } finally {
      setSending(null);
    }
  }

  return (
    <section className="stack">
      <h2>Follow-up &amp; install reminders</h2>
      <p className="muted small">
        Daily-style reminders from follow-up dates on paint tracker and wallcovering lines, plus upcoming
        install dates (next 14 days). Sends only when there is something due or upcoming.
      </p>
      {(statusError || status) && (
        <div className={`banner ${statusError ? "banner-error" : "banner-ok"}`}>
          {statusError ?? status}
        </div>
      )}
      <div className="row-gap wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={sending !== null}
          onClick={() => void sendReminder("paint")}
        >
          {sending === "paint" ? "Sending…" : "Send paint follow-up reminder"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={sending !== null}
          onClick={() => void sendReminder("wallcovering")}
        >
          {sending === "wallcovering" ? "Sending…" : "Send wallcovering follow-up reminder"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={sending !== null}
          onClick={() => void sendReminder("installs")}
        >
          {sending === "installs" ? "Sending…" : "Send upcoming install reminder"}
        </button>
      </div>
    </section>
  );
}

function ScheduledEmailSection({
  schedule,
  onChange,
}: {
  schedule: TrackerEmailSchedule;
  onChange: (next: TrackerEmailSchedule) => void;
}) {
  function patchSchedule(patch: Partial<TrackerEmailSchedule>) {
    onChange({ ...schedule, ...patch });
  }

  function patchDaily(patch: Partial<TrackerEmailSchedule["daily"]>) {
    onChange({ ...schedule, daily: { ...schedule.daily, ...patch } });
  }

  function patchWeekly(patch: Partial<TrackerEmailSchedule["weekly"]>) {
    onChange({ ...schedule, weekly: { ...schedule.weekly, ...patch } });
  }

  return (
    <section className="stack">
      <h2>Scheduled emails (automatic)</h2>
      <p className="muted small">
        Replaces Google Apps Script time-driven triggers. When enabled, Vercel runs the same emails as the
        manual buttons above on a fixed UTC schedule. Requires{" "}
        <strong>SUPABASE_SERVICE_ROLE_KEY</strong> and <strong>CRON_SECRET</strong> on Vercel (see DEPLOY.md).
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => patchSchedule({ enabled: e.target.checked })}
        />
        Enable automatic tracker emails for my account
      </label>
      <label>
        Timezone for &quot;due today&quot; follow-ups
        <input
          value={schedule.timezone}
          onChange={(e) => patchSchedule({ timezone: e.target.value })}
          placeholder={DEFAULT_TRACKER_EMAIL_SCHEDULE.timezone}
        />
      </label>

      <div className="stack">
        <h3 className="paint-col-head">Daily follow-ups</h3>
        <p className="muted small">{TRACKER_CRON_UTC_SCHEDULE.daily}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.daily.enabled}
            onChange={(e) => patchDaily({ enabled: e.target.checked })}
          />
          Send daily follow-up / install reminders
        </label>
        <div className="row-gap wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.paint_followup}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ paint_followup: e.target.checked })}
            />
            Paint follow-ups
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.wallcovering_followup}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ wallcovering_followup: e.target.checked })}
            />
            Wallcovering follow-ups
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.daily.installs}
              disabled={!schedule.daily.enabled}
              onChange={(e) => patchDaily({ installs: e.target.checked })}
            />
            Upcoming installs (14 days)
          </label>
        </div>
      </div>

      <div className="stack">
        <h3 className="paint-col-head">Weekly digest (Fridays)</h3>
        <p className="muted small">{TRACKER_CRON_UTC_SCHEDULE.weekly}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.weekly.enabled}
            onChange={(e) => patchWeekly({ enabled: e.target.checked })}
          />
          Send weekly submittal digests
        </label>
        <div className="row-gap wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.weekly.combined_digest}
              disabled={!schedule.weekly.enabled}
              onChange={(e) => patchWeekly({ combined_digest: e.target.checked })}
            />
            Combined paint + wallcovering digest
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={schedule.weekly.wallcovering_digest}
              disabled={!schedule.weekly.enabled}
              onChange={(e) => patchWeekly({ wallcovering_digest: e.target.checked })}
            />
            Wallcovering digest only
          </label>
        </div>
      </div>
    </section>
  );
}

export function PaintEmailSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const { user } = useAuth();
  const { settings: letterhead } = useLetterhead();
  const [data, setData] = useState<PaintUserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signatureLogoUploading, setSignatureLogoUploading] = useState(false);
  const signatureLogoFileRef = useRef<HTMLInputElement>(null);
  const trackData = data;
  const ready = !loading && data !== null && Boolean(user?.id);
  const { markSaved, readBaseline, getIsDirty } = useSettingsDirtyTracker(trackData, ready, onDirtyChange);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    const profile = profileFromSettings(letterhead);
    void loadPaintUserSettings(user.id)
      .then((loaded) => setData(applyProfilePaintDefaults(loaded, profile)))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load paint settings"))
      .finally(() => setLoading(false));
  }, [user?.id, letterhead.signer_name, letterhead.signer_title, letterhead.signer_phone, letterhead.signer_email]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !data) return false;
    setSaving(true);
    setMessage(null);
    setError(null);

    if (readOnly) {
      const err = await patchUserSettings(user.id, {
        signature: data.signature,
        compose_email_method: data.compose_email_method,
      });
      setSaving(false);
      if (err) {
        setError(err);
        return false;
      }
      markSaved();
      setMessage("Email signature saved.");
      return true;
    }

    const errOrg = await patchOrgSettings(user.id, {
      vendors: data.vendors.filter((v) => v.vendor_email.trim()),
      super_emails: data.super_emails.filter((s) => s.email.trim()),
      notification_primary_email: data.notification_primary_email.trim(),
      notification_primary_name: data.notification_primary_name.trim(),
      default_brushout_qty: data.default_brushout_qty,
      tracker_email_schedule: data.tracker_email_schedule,
    });
    if (errOrg) {
      setSaving(false);
      setError(errOrg);
      return false;
    }
    const errSig = await patchUserSettings(user.id, {
      signature: data.signature,
      compose_email_method: data.compose_email_method,
    });
    setSaving(false);
    if (errSig) {
      setError(errSig);
      return false;
    }
    markSaved();
    setMessage("Paint & email settings saved.");
    return true;
  }, [data, markSaved, readOnly, user?.id]);

  useEffect(() => {
    if (!ready || !onBindActions) return;
    onBindActions({
      save: persist,
      discard: () => {
        const snapshot = readBaseline();
        if (snapshot) setData(snapshot);
      },
      getIsDirty,
    });
  }, [ready, onBindActions, persist, readBaseline, getIsDirty]);

  if (loading) return <p className="muted">Loading paint &amp; email settings…</p>;
  if (!data || !user?.id) return null;

  const profile = profileFromSettings(letterhead);
  const signaturePreview = buildEmailSignatureHtml(data.signature, letterhead.logo_url);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  function setVendor(i: number, patch: Partial<PaintVendor>) {
    setData((d) => {
      if (!d) return d;
      const vendors = [...d.vendors];
      vendors[i] = { ...vendors[i]!, ...patch };
      return { ...d, vendors };
    });
  }

  function setSuper(i: number, patch: Partial<SuperEmail>) {
    setData((d) => {
      if (!d) return d;
      const super_emails = [...d.super_emails];
      super_emails[i] = { ...super_emails[i]!, ...patch };
      return { ...d, super_emails };
    });
  }

  function setSignatureLine(i: number, value: string) {
    setData((d) => {
      if (!d) return d;
      const lines = [...d.signature.lines];
      lines[i] = value;
      return { ...d, signature: { ...d.signature, lines } };
    });
  }

  function setLineStyle(i: number, patch: Partial<SignatureLineStyle>) {
    setData((d) => {
      if (!d) return d;
      const line_styles = [...d.signature.line_styles];
      line_styles[i] = { ...line_styles[i], ...patch };
      return { ...d, signature: { ...d.signature, line_styles } };
    });
  }

  async function onSignatureLogoFile(file: File | null) {
    if (!file || !user?.id) return;
    setSignatureLogoUploading(true);
    setMessage(null);
    setError(null);
    try {
      const url = await uploadEmailSignatureLogo(user.id, file);
      setData((d) =>
        d ? { ...d, signature: { ...d.signature, signature_logo_url: url } } : d,
      );
      setMessage("Email signature logo uploaded. Click Save to keep it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setSignatureLogoUploading(false);
      if (signatureLogoFileRef.current) signatureLogoFileRef.current.value = "";
    }
  }

  return (
    <form className="stack paint-email-settings" onSubmit={(e) => void onSave(e)}>
      {readOnly && <SharedSettingsNotice />}
      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <section className="stack">
        <h2>Compose email</h2>
        <p className="muted small">
          How <strong>Email vendor</strong>, transmittal relay, and sample-order emails open on your computer.
          Saved to your account.
        </p>
        <label>
          Open compose with
          <select
            className="paint-field-select"
            value={data.compose_email_method}
            onChange={(e) =>
              setData((d) =>
                d
                  ? { ...d, compose_email_method: e.target.value === "mailto" ? "mailto" : "gmail" }
                  : d,
              )
            }
          >
            <option value="gmail">Gmail (new browser tab)</option>
            <option value="mailto">Windows default mail app (MAILTO)</option>
          </select>
        </label>
        <MailtoSetupHelp method={data.compose_email_method} />
      </section>

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
      <section className="stack">
        <h2>Paint vendors</h2>
        <p className="muted small">
          Used when you click <strong>Email vendor</strong> on paint submittals, transmittals, and brush-out
          requests. Uses your <strong>Compose email</strong> choice above. Saved to your account (overrides the
          default vendors.json list).
        </p>
        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Brand</th>
                <th>Vendor email</th>
                <th>Store email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v, i) => (
                <tr key={`vendor-${i}`}>
                  <td>
                    <input value={v.name} onChange={(e) => setVendor(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input value={v.brand} onChange={(e) => setVendor(i, { brand: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={v.vendor_email}
                      onChange={(e) => setVendor(i, { vendor_email: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={v.store_email ?? ""}
                      onChange={(e) => setVendor(i, { store_email: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setData((d) =>
                          d ? { ...d, vendors: d.vendors.filter((_, j) => j !== i) } : d,
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setData((d) => (d ? { ...d, vendors: [...d.vendors, emptyVendor()] } : d))}
        >
          Add vendor
        </button>
      </section>

      <section className="stack">
        <h2>Paint tracker notifications</h2>
        <p className="muted small">
          When you save <strong>Approved</strong>, <strong>Revision</strong>, or <strong>Match existing</strong> on
          a job&apos;s paint tracker, JobFlow sends a notification email via Gmail (Dashboard web app). Supers below
          are CC&apos;d. Primary To and PM name default from your Profile when left blank.
        </p>
        <div className="grid-2">
          <label>
            Primary notification email (To)
            <input
              type="email"
              value={data.notification_primary_email}
              onChange={(e) =>
                setData((d) => (d ? { ...d, notification_primary_email: e.target.value } : d))
              }
              placeholder={profile.email || "PM / office inbox"}
            />
          </label>
          <label>
            PM name (subject line)
            <input
              value={data.notification_primary_name}
              onChange={(e) =>
                setData((d) => (d ? { ...d, notification_primary_name: e.target.value } : d))
              }
              placeholder={profile.name || "Project manager name"}
            />
          </label>
        </div>
      </section>
      </fieldset>

      <WeeklyDigestSection
        data={data}
        letterhead={letterhead}
        brandingCompanyName={letterhead.company_name}
      />

      <FollowUpRemindersSection
        data={data}
        letterhead={letterhead}
        brandingCompanyName={letterhead.company_name}
      />

      <fieldset disabled={readOnly} className="stack settings-shared-fieldset">
      <ScheduledEmailSection
        schedule={data.tracker_email_schedule}
        onChange={(tracker_email_schedule) =>
          setData((d) => (d ? { ...d, tracker_email_schedule } : d))
        }
      />

      <section className="stack">
        <h2>Super email list (CC)</h2>
        <p className="muted small">
          CC on vendor emails and paint tracker notifications. Job superintendent names are auto-selected
          when emailing vendors. Per-project foreman emails (Job setup → ICBI) are always CC&apos;d for that
          job.
        </p>
        <div className="paint-settings-table-wrap">
          <table className="paint-settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.super_emails.map((s, i) => (
                <tr key={`super-${i}`}>
                  <td>
                    <input value={s.name} onChange={(e) => setSuper(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={s.email}
                      onChange={(e) => setSuper(i, { email: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setData((d) =>
                          d
                            ? { ...d, super_emails: d.super_emails.filter((_, j) => j !== i) }
                            : d,
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            setData((d) => (d ? { ...d, super_emails: [...d.super_emails, emptySuper()] } : d))
          }
        >
          Add super email
        </button>
      </section>

      <section className="stack">
        <h2>Brush-out defaults</h2>
        <label className="paint-qty-label">
          Default brush-out quantity (regular requests)
          <input
            type="number"
            min={1}
            max={99}
            value={data.default_brushout_qty}
            onChange={(e) =>
              setData((d) =>
                d ? { ...d, default_brushout_qty: Math.max(1, Number(e.target.value) || 1) } : d,
              )
            }
          />
        </label>
      </section>
      </fieldset>

      <section className="stack paint-email-signature-personal">
        <h2>HTML email signature</h2>
        <p className="muted small">
          Your personal signature — appended to vendor brush-out and paint emails you send. Upload a logo sized
          for email (recommended width matches <strong>Logo max width</strong> below). When empty, the company
          letterhead logo is used. Lines 1–3 default to Profile full name, job title, and phone when blank.
          For custom HTML, replace <code>cid:logo_image</code> or leave it — JobFlow substitutes your email
          logo automatically.
        </p>

        <section className="stack">
          <p className="paint-col-head">Email signature logo</p>
          {(data.signature.signature_logo_url || letterhead.logo_url) && (
            <div className="logo-preview">
              <img
                src={data.signature.signature_logo_url || letterhead.logo_url}
                alt="Email signature logo preview"
              />
            </div>
          )}
          <p className="muted small">
            {data.signature.signature_logo_url
              ? "Using your uploaded email logo."
              : letterhead.logo_url
                ? "No email logo uploaded — preview shows letterhead logo as fallback."
                : "Upload a PNG sized for email (e.g. 220px wide) for reliable Gmail paste."}
          </p>
          <div className="row-gap wrap">
            <input
              ref={signatureLogoFileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onSignatureLogoFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={signatureLogoUploading}
              onClick={() => signatureLogoFileRef.current?.click()}
            >
              {signatureLogoUploading ? "Uploading…" : "Upload email logo"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!data.signature.signature_logo_url}
              onClick={() =>
                setData((d) =>
                  d ? { ...d, signature: { ...d.signature, signature_logo_url: "" } } : d,
                )
              }
            >
              Remove email logo
            </button>
          </div>
          <label>
            Or email logo URL
            <input
              value={data.signature.signature_logo_url}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? { ...d, signature: { ...d.signature, signature_logo_url: e.target.value } }
                    : d,
                )
              }
              placeholder="https://… or leave blank for letterhead logo"
            />
          </label>
        </section>

        <label className="check">
          <input
            type="checkbox"
            checked={data.signature.use_custom_html}
            onChange={(e) =>
              setData((d) =>
                d
                  ? {
                      ...d,
                      signature: { ...d.signature, use_custom_html: e.target.checked },
                    }
                  : d,
              )
            }
          />
          Use custom HTML signature (matches desktop app)
        </label>

        <div className="grid-2">
          <label>
            Logo max width (px)
            <input
              type="number"
              min={80}
              max={600}
              value={data.signature.logo_max_width_px}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? {
                        ...d,
                        signature: {
                          ...d.signature,
                          logo_max_width_px: Math.max(80, Math.min(600, Number(e.target.value) || 220)),
                        },
                      }
                    : d,
                )
              }
            />
          </label>
          <label>
            Logo after line #
            <input
              type="number"
              min={0}
              max={SIGNATURE_LINE_COUNT}
              value={data.signature.logo_position}
              disabled={data.signature.use_custom_html}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? {
                        ...d,
                        signature: {
                          ...d.signature,
                          logo_position: Math.max(
                            0,
                            Math.min(SIGNATURE_LINE_COUNT, Number(e.target.value) || 0),
                          ),
                        },
                      }
                    : d,
                )
              }
            />
          </label>
          <label>
            Default font
            <select
              value={data.signature.font_family}
              disabled={data.signature.use_custom_html}
              onChange={(e) =>
                setData((d) =>
                  d ? { ...d, signature: { ...d.signature, font_family: e.target.value } } : d,
                )
              }
            >
              <option value="Calibri, Arial, sans-serif">Calibri</option>
              <option value="Arial, Helvetica, sans-serif">Arial</option>
              <option value="Times New Roman, Times, serif">Times New Roman</option>
            </select>
          </label>
          <label>
            Default size (pt)
            <input
              type="number"
              min={8}
              max={14}
              value={data.signature.font_size_pt}
              disabled={data.signature.use_custom_html}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? {
                        ...d,
                        signature: {
                          ...d.signature,
                          font_size_pt: Math.max(8, Math.min(14, Number(e.target.value) || 11)),
                        },
                      }
                    : d,
                )
              }
            />
          </label>
        </div>

        {data.signature.use_custom_html ? (
          <label>
            Custom HTML
            <textarea
              className="paint-signature-html"
              rows={12}
              value={data.signature.html_body}
              onChange={(e) =>
                setData((d) =>
                  d
                    ? { ...d, signature: { ...d.signature, html_body: e.target.value } }
                    : d,
                )
              }
            />
          </label>
        ) : (
          <div className="stack paint-signature-lines">
            <p className="muted small">
              Line 1 = full name, line 2 = job title, line 3 = phone (from Profile when empty). Bold /
              Italic / Size overrides per line (size 0 = default {data.signature.font_size_pt} pt).
            </p>
            <div className="paint-settings-table-wrap">
              <table className="paint-settings-table paint-signature-style-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Line text</th>
                    <th>Bold</th>
                    <th>Italic</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signature.lines.map((line, i) => {
                    const style = data.signature.line_styles[i] ?? {};
                    return (
                      <tr key={`sig-line-${i}`}>
                        <td>{i + 1}</td>
                        <td>
                          <input value={line} onChange={(e) => setSignatureLine(i, e.target.value)} />
                        </td>
                        <td className="paint-sig-style-cell">
                          <input
                            type="checkbox"
                            checked={Boolean(style.bold)}
                            onChange={(e) => setLineStyle(i, { bold: e.target.checked })}
                          />
                        </td>
                        <td className="paint-sig-style-cell">
                          <input
                            type="checkbox"
                            checked={Boolean(style.italic)}
                            onChange={(e) => setLineStyle(i, { italic: e.target.checked })}
                          />
                        </td>
                        <td>
                          <select
                            value={style.font_size_pt ?? 0}
                            onChange={(e) =>
                              setLineStyle(i, { font_size_pt: Number(e.target.value) })
                            }
                          >
                            {SIGNATURE_FONT_SIZE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="paint-email-preview-box">
          <p className="paint-col-head">Signature preview</p>
          <div
            className="paint-email-html-preview"
            dangerouslySetInnerHTML={{ __html: signaturePreview }}
          />
        </div>
      </section>

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : readOnly ? "Save email signature" : "Save paint & email settings"}
      </button>
    </form>
  );
}
