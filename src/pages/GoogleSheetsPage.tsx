import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DateInput } from "../components/DateInput";
import { useAuth } from "../contexts/AuthContext";
import { patchUserSettings } from "../lib/budgetLibrary";
import {
  PAINT_VENDOR_OPTIONS,
  parseGoogleSheetsProjectFields,
  type GoogleSheetsProjectFields,
} from "../lib/googleSheetsConfig";
import {
  buildSheetJobInfo,
  buildSheetsClipboardRow,
  copyToPaintTracker,
  jobFullAddressOneLine,
  testManpowerUserName,
  updateManpowerSchedule,
  updatePaintTrackerFlags,
} from "../lib/googleSheetsSync";
import { parseProjectDataBlob } from "../lib/jobInfo";
import { loadPaintUserSettings } from "../lib/paintUserSettings";
import { supabase } from "../lib/supabase";
import type { ProjectForm } from "../types/database";
import type { Json } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

export function GoogleSheetsPage() {
  const { user } = useAuth();
  const { project, projectId } = useOutletContext<Ctx>();
  const [fields, setFields] = useState<GoogleSheetsProjectFields>(() =>
    parseGoogleSheetsProjectFields(null),
  );
  const [googleUrls, setGoogleUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void (async () => {
      try {
        const settings = await loadPaintUserSettings(user.id);
        setGoogleUrls(settings.google_urls);
        const { data } = await supabase.from("projects").select("data").eq("id", projectId).single();
        const blob = parseProjectDataBlob(data?.data);
        const saved = parseGoogleSheetsProjectFields(blob.google_sheets);
        setFields({
          ...saved,
          user_name: saved.user_name || settings.user_name || "",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Google Sheets data");
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id, projectId]);

  function patchFields(patch: Partial<GoogleSheetsProjectFields>) {
    setFields((f) => ({ ...f, ...patch }));
  }

  async function persistFields(next: GoogleSheetsProjectFields): Promise<boolean> {
    const { data: row, error: loadErr } = await supabase
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    if (loadErr) {
      setError(loadErr.message);
      return false;
    }
    const base = parseProjectDataBlob(row?.data);
    const { error: err } = await supabase
      .from("projects")
      .update({ data: { ...base, google_sheets: next } as Json })
      .eq("id", projectId);
    if (err) {
      setError(err.message);
      return false;
    }
    return true;
  }

  async function onSaveUserName() {
    if (!user?.id) return;
    const err = await patchUserSettings(user.id, { user_name: fields.user_name.trim() });
    if (err) setError(err);
    else setStatus(`User name "${fields.user_name.trim()}" saved to settings.`);
  }

  function onUpdateFields() {
    const next: GoogleSheetsProjectFields = {
      ...fields,
      sheet_job_info: buildSheetJobInfo(project.job_number, project.job_name),
      sheet_start_date: project.jobInfo.start_date,
      sheet_gc: project.contractor,
      sheet_location: jobFullAddressOneLine(project, project.jobInfo),
    };
    setFields(next);
    void persistFields(next);
    setStatus("Fields updated from Job Info.");
    setError(null);
  }

  async function onCopyClipboard() {
    try {
      const text = buildSheetsClipboardRow(
        fields.sheet_job_info,
        fields.sheet_start_date,
        fields.sheet_gc,
        fields.sheet_location,
      );
      await navigator.clipboard.writeText(text);
      setStatus("Row copied — paste into your Google Sheet.");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed");
    }
  }

  async function onUpdateManpower() {
    setBusy("manpower");
    setError(null);
    try {
      const msg = await updateManpowerSchedule(googleUrls.manpower_schedule, {
        jobNumber: project.job_number,
        jobName: project.job_name,
        startDate: fields.sheet_start_date,
        gcName: fields.sheet_gc,
        jobAddress: fields.sheet_location,
        submittedBy: fields.user_name,
      });
      setStatus(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manpower update failed");
    } finally {
      setBusy(null);
    }
  }

  async function onTestUserName() {
    setBusy("test");
    setError(null);
    try {
      const msg = await testManpowerUserName(googleUrls.manpower_schedule, fields.user_name);
      setStatus(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function onCopyToPaintTracker() {
    setBusy("paint");
    setError(null);
    try {
      const msg = await copyToPaintTracker(googleUrls.paint_tracker, {
        jobNumber: project.job_number,
        jobName: project.job_name,
        jobAddress: fields.sheet_location || jobFullAddressOneLine(project, project.jobInfo),
        gcName: fields.sheet_gc || project.contractor,
        gcSuper: project.jobInfo.gc_superintendent,
        startDate: fields.sheet_start_date || project.jobInfo.start_date,
        paintVendor: fields.paint_vendor,
        userName: fields.user_name,
      });
      setStatus(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Paint Tracker update failed");
    } finally {
      setBusy(null);
    }
  }

  async function onNightsChange(checked: boolean) {
    const next = { ...fields, nights: checked };
    setFields(next);
    await persistFields(next);
    const sheetsUrl = googleUrls.job_manager || googleUrls.paint_tracker;
    if (!sheetsUrl?.trim() || !project.job_number.trim()) return;
    const syncErr = await updatePaintTrackerFlags(sheetsUrl, project.job_number, {
      nightsWeekends: checked,
    });
    if (syncErr) setStatus(`Nights saved locally. Sheets sync: ${syncErr}`);
    else setStatus(checked ? "Nights enabled (Paint Tracker column N)." : "Nights cleared.");
  }

  if (loading) return <p className="muted">Loading Google Sheets…</p>;

  return (
    <div className="stack google-sheets-page">
      <div>
        <h2>Google Sheets</h2>
        <p className="muted small">
          Push job data to your manpower schedule and Paint Tracker — same workflow as desktop JobFlow
          tab 2. Configure Web App URLs in{" "}
          <a href="/settings">Settings → Google Apps Script URLs</a>.
        </p>
      </div>

      {(error || status) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? status}</div>
      )}

      <div className="card stack">
        <div className="grid-2">
          <label>
            Job number – job name
            <input
              value={fields.sheet_job_info}
              onChange={(e) => patchFields({ sheet_job_info: e.target.value })}
            />
          </label>
          <label>
            Estimate start date
            <DateInput
              value={fields.sheet_start_date}
              onChange={(v) => patchFields({ sheet_start_date: v })}
            />
          </label>
          <label>
            GC
            <input value={fields.sheet_gc} onChange={(e) => patchFields({ sheet_gc: e.target.value })} />
          </label>
          <label>
            Location
            <input
              value={fields.sheet_location}
              onChange={(e) => patchFields({ sheet_location: e.target.value })}
            />
          </label>
          <label>
            Paint vendor
            <select
              value={fields.paint_vendor}
              onChange={(e) =>
                patchFields({ paint_vendor: e.target.value as GoogleSheetsProjectFields["paint_vendor"] })
              }
            >
              {PAINT_VENDOR_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            User name
            <div className="row-gap wrap">
              <input
                value={fields.user_name}
                onChange={(e) => patchFields({ user_name: e.target.value })}
                placeholder="Ortega"
              />
              <button type="button" className="btn btn-secondary" onClick={() => void onSaveUserName()}>
                Save name
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy === "test"}
                onClick={() => void onTestUserName()}
              >
                {busy === "test" ? "Testing…" : "Test user name"}
              </button>
            </div>
          </label>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={fields.nights}
            onChange={(e) => void onNightsChange(e.target.checked)}
          />
          Nights (column N in Paint Tracker)
        </label>
      </div>

      <div className="row-gap wrap">
        <button type="button" className="btn btn-secondary" onClick={onUpdateFields}>
          1. Update fields
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy === "manpower"}
          onClick={() => void onUpdateManpower()}
        >
          {busy === "manpower" ? "Updating…" : "2. Update manpower"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy === "paint"}
          onClick={() => void onCopyToPaintTracker()}
        >
          {busy === "paint" ? "Copying…" : "3. Copy to Paint Tracker"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void onCopyClipboard()}>
          Copy to clipboard
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void persistFields(fields).then((ok) => ok && setStatus("Google Sheets fields saved."))}
        >
          Save fields
        </button>
      </div>
    </div>
  );
}
