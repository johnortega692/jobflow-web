import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { DateInput } from "../DateInput";
import { supabase } from "../../lib/supabase";
import { jobCityZipCountyLine, parseProjectDataBlob, syncLegacyFieldOrderFields } from "../../lib/jobInfo";
import { applyProposalImportPatch, importJobInfoFromProposalPdf } from "../../lib/proposalPdfImport";
import { commitProjectUpdate } from "../../lib/projectActivity";
import {
  parseStartupChecklist,
  startupChecklistForJobInfo,
} from "../../lib/projectStartupChecklist";
import { fieldAppsSyncReady, syncProjectTradeApps } from "../../lib/tradeAppsSync";
import { IcbiInfoSection } from "./IcbiInfoSection";
import { TradeAppsSyncSection } from "./TradeAppsSyncSection";
import type { ProjectForm } from "../../types/database";
import { JOB_COST_TYPES, JOB_TYPES, type JobInfoData } from "../../types/jobInfo";

type Props = {
  open: boolean;
  project: ProjectForm;
  projectId: string;
  onClose: () => void;
  onSaved: (project: ProjectForm) => void;
};

function patchJobInfo(info: JobInfoData, patch: Partial<JobInfoData>): JobInfoData {
  return { ...info, ...patch };
}

function JobSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="job-section card stack" open={defaultOpen}>
      <summary className="job-section-summary">
        <h3>{title}</h3>
      </summary>
      {children}
    </details>
  );
}

export function JobInfoSetupDrawer({ open, project: initial, projectId, onClose, onSaved }: Props) {
  const [project, setProject] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const proposalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setProject(initial);
  }, [open, initial, projectId]);

  function setJobInfo(patch: Partial<JobInfoData>) {
    setProject((p) => ({ ...p, jobInfo: patchJobInfo(p.jobInfo, patch) }));
  }

  async function onImportProposal(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportSuccess(null);
    try {
      const result = await importJobInfoFromProposalPdf(file);
      const next = applyProposalImportPatch(project, result);
      setProject({
        ...next,
        job_number: project.job_number,
        job_name: project.job_name,
      });
      const layout =
        result.source === "ironwood"
          ? "Ironwood paint bid proposal"
          : result.source === "po"
            ? "Ironwood purchase order"
            : "Project / Address / Scope markers";
      setImportSuccess(`Imported from ${file.name} (${layout}). Save when ready.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Proposal import failed");
    } finally {
      setImporting(false);
      if (proposalInputRef.current) proposalInputRef.current.value = "";
    }
  }

  async function saveProject(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSyncStatus(null);

    const { data: row, error: loadErr } = await supabase
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    if (loadErr) {
      setSaving(false);
      setError(loadErr.message);
      return;
    }

    const cityLine = jobCityZipCountyLine(project.jobInfo);
    const baseData = parseProjectDataBlob(row?.data);
    const jobInfo = syncLegacyFieldOrderFields(project.jobInfo);
    const startupChecklist = startupChecklistForJobInfo(
      parseStartupChecklist(baseData.startup_checklist),
      jobInfo,
    );
    const errMsg = await commitProjectUpdate({
      projectId,
      columns: {
        job_number: project.job_number,
        job_name: project.job_name,
        job_address: project.job_address,
        job_address2: cityLine || project.job_address2,
        contractor: project.contractor,
        architect: project.architect,
        owner: project.owner,
        data: { ...baseData, job_info: jobInfo, startup_checklist: startupChecklist },
      },
      activity: {
        action: "job_info_saved",
        summary: "Job setup saved",
      },
    });

    if (errMsg) {
      setSaving(false);
      setError(errMsg);
      return;
    }

    const next = { ...project, jobInfo, job_address2: cityLine || project.job_address2 };
    let savedProject = next;

    if (fieldAppsSyncReady(next)) {
      const sync = await syncProjectTradeApps(next, projectId);
      if (sync.messages.length) setSyncStatus(`Synced: ${sync.messages.join(" · ")}`);
      if (sync.errors.length) {
        setError(sync.errors.join(" "));
      } else if (sync.ok && !startupChecklist.field_request_app) {
        const syncedChecklist = { ...startupChecklist, field_request_app: true };
        const checklistErr = await commitProjectUpdate({
          projectId,
          mergeData: { startup_checklist: syncedChecklist },
          activity: {
            action: "job_info_saved",
            summary: "Field Tools & Manpower synced from job setup",
          },
        });
        if (checklistErr) {
          setError(checklistErr);
        } else {
          savedProject = {
            ...next,
            data: {
              ...baseData,
              job_info: jobInfo,
              startup_checklist: syncedChecklist,
            },
          };
        }
      }
    }

    setSaving(false);
    setProject(savedProject);
    onSaved(savedProject);
    setSavedAt(new Date().toLocaleTimeString());
  }

  const j = project.jobInfo;

  if (!open) return null;

  return (
    <div className="job-info-drawer-root" role="presentation">
      <button type="button" className="job-info-drawer-backdrop" aria-label="Close job setup" onClick={onClose} />
      <aside className="job-info-drawer-panel" aria-labelledby="job-info-drawer-title">
        <header className="job-info-drawer-header row-between wrap">
          <div>
            <h2 id="job-info-drawer-title">Job setup</h2>
            <p className="muted small">
              Fill once for templates, submittals, and exports. Reopen anytime to add missing fields.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {(error || importSuccess || syncStatus) && (
          <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>
            {error ?? syncStatus ?? importSuccess}
          </div>
        )}

        <form className="stack job-info-form job-info-drawer-body" onSubmit={saveProject}>
          <div className="row-gap wrap job-info-drawer-tools">
            {savedAt && <span className="muted small">Saved {savedAt}</span>}
            <input
              ref={proposalInputRef}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => void onImportProposal(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={importing || saving}
              onClick={() => proposalInputRef.current?.click()}
            >
              {importing ? "Reading PDF…" : "Import from proposal PDF"}
            </button>
          </div>

          <JobSection title="Job Info" defaultOpen>
            <p className="muted small">
              Job # and name are set when the project is created and cannot be changed here.
            </p>
            <div className="grid-2">
              <label>
                Job #
                <input className="readonly" value={project.job_number} readOnly aria-readonly />
              </label>
              <label>
                Date
                <DateInput value={j.job_date} onChange={(v) => setJobInfo({ job_date: v })} />
              </label>
              <label>
                Job name
                <input className="readonly" value={project.job_name} readOnly aria-readonly />
              </label>
              <label>
                Job address
                <input
                  value={project.job_address}
                  onChange={(e) => setProject({ ...project, job_address: e.target.value })}
                />
              </label>
              <label>
                City
                <input value={j.job_city} onChange={(e) => setJobInfo({ job_city: e.target.value })} />
              </label>
              <label>
                Zip
                <input value={j.job_zip} onChange={(e) => setJobInfo({ job_zip: e.target.value })} />
              </label>
              <label>
                County / State
                <input value={j.job_county} onChange={(e) => setJobInfo({ job_county: e.target.value })} />
              </label>
              <label>
                Paint contract amount
                <input value={j.contract_amount} onChange={(e) => setJobInfo({ contract_amount: e.target.value })} />
              </label>
              <label>
                Job type
                <select value={j.job_type} onChange={(e) => setJobInfo({ job_type: e.target.value })}>
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cost type
                <select value={j.job_cost_type} onChange={(e) => setJobInfo({ job_cost_type: e.target.value })}>
                  {JOB_COST_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Estimated start date
                <DateInput value={j.start_date} onChange={(v) => setJobInfo({ start_date: v })} />
              </label>
              <label>
                Estimated end date
                <DateInput value={j.end_date} onChange={(v) => setJobInfo({ end_date: v })} />
              </label>
            </div>
            <label className="checkbox-row job-info-wc-toggle">
              <input
                type="checkbox"
                checked={j.has_wallcovering}
                onChange={(e) => setJobInfo({ has_wallcovering: e.target.checked })}
              />
              This project includes wallcovering (separate contract / job #)
            </label>
            {j.has_wallcovering && (
              <div className="grid-2 job-info-wc-fields">
                <label>
                  Wallcovering job #
                  <input
                    value={j.wc_job_number}
                    placeholder={project.job_number || "Same as paint job #"}
                    onChange={(e) => setJobInfo({ wc_job_number: e.target.value })}
                  />
                </label>
                <label>
                  Wallcovering job name
                  <input
                    value={j.wc_job_name}
                    placeholder={project.job_name || "Same as paint job name"}
                    onChange={(e) => setJobInfo({ wc_job_name: e.target.value })}
                  />
                </label>
                <label>
                  Wallcovering contract amount
                  <input
                    value={j.wc_contract_amount}
                    placeholder={j.contract_amount || "Same as paint contract amount"}
                    onChange={(e) => setJobInfo({ wc_contract_amount: e.target.value })}
                  />
                </label>
              </div>
            )}
            <label className="checkbox-row job-info-wc-toggle">
              <input
                type="checkbox"
                checked={j.has_frp}
                onChange={(e) => setJobInfo({ has_frp: e.target.checked })}
              />
              This project includes FRP (separate contract / job #)
            </label>
            {j.has_frp && (
              <div className="grid-2 job-info-wc-fields">
                <label>
                  FRP job #
                  <input
                    value={j.frp_job_number}
                    placeholder={project.job_number || "Same as paint job #"}
                    onChange={(e) => setJobInfo({ frp_job_number: e.target.value })}
                  />
                </label>
                <label>
                  FRP job name
                  <input
                    value={j.frp_job_name}
                    placeholder={project.job_name || "Same as paint job name"}
                    onChange={(e) => setJobInfo({ frp_job_name: e.target.value })}
                  />
                </label>
                <label>
                  FRP contract amount
                  <input
                    value={j.frp_contract_amount}
                    placeholder={j.contract_amount || "Same as paint contract amount"}
                    onChange={(e) => setJobInfo({ frp_contract_amount: e.target.value })}
                  />
                </label>
              </div>
            )}
            <label className="checkbox-row job-info-wc-toggle">
              <input
                type="checkbox"
                checked={j.has_track}
                onChange={(e) => setJobInfo({ has_track: e.target.checked })}
              />
              This project includes FWP (separate contract / job #)
            </label>
            {j.has_track && (
              <div className="grid-2 job-info-wc-fields">
                <label>
                  Track job #
                  <input
                    value={j.track_job_number}
                    placeholder={project.job_number || "Same as paint job #"}
                    onChange={(e) => setJobInfo({ track_job_number: e.target.value })}
                  />
                </label>
                <label>
                  Track job name
                  <input
                    value={j.track_job_name}
                    placeholder={project.job_name || "Same as paint job name"}
                    onChange={(e) => setJobInfo({ track_job_name: e.target.value })}
                  />
                </label>
                <label>
                  Track contract amount
                  <input
                    value={j.track_contract_amount}
                    placeholder={j.contract_amount || "Same as paint contract amount"}
                    onChange={(e) => setJobInfo({ track_contract_amount: e.target.value })}
                  />
                </label>
              </div>
            )}
            <label>
              Scope of out work
              <input value={j.scope_of_out_work} onChange={(e) => setJobInfo({ scope_of_out_work: e.target.value })} />
            </label>
            <label>
              Description of project
              <input
                value={j.project_description}
                onChange={(e) => setJobInfo({ project_description: e.target.value })}
              />
            </label>
          </JobSection>

          <JobSection title="GC Info">
            <div className="grid-2">
              <label>
                GC name
                <input
                  value={project.contractor}
                  onChange={(e) => setProject({ ...project, contractor: e.target.value })}
                />
              </label>
              <label>
                GC job #
                <input value={j.gc_job_number} onChange={(e) => setJobInfo({ gc_job_number: e.target.value })} />
              </label>
              <label>
                Address
                <input value={j.gc_address} onChange={(e) => setJobInfo({ gc_address: e.target.value })} />
              </label>
              <label>
                Office phone
                <input value={j.gc_office_phone} onChange={(e) => setJobInfo({ gc_office_phone: e.target.value })} />
              </label>
              <label>
                Fax
                <input value={j.gc_fax} onChange={(e) => setJobInfo({ gc_fax: e.target.value })} />
              </label>
              <label>
                PM
                <input value={j.gc_pm} onChange={(e) => setJobInfo({ gc_pm: e.target.value })} />
              </label>
              <label>
                PM phone
                <input
                  type="tel"
                  value={j.gc_pm_phone}
                  onChange={(e) => setJobInfo({ gc_pm_phone: e.target.value })}
                />
              </label>
              <label>
                PM email
                <input
                  type="email"
                  value={j.gc_pm_email}
                  onChange={(e) => setJobInfo({ gc_pm_email: e.target.value })}
                />
              </label>
              <label>
                GC superintendent
                <input
                  value={j.gc_superintendent}
                  onChange={(e) => setJobInfo({ gc_superintendent: e.target.value })}
                />
              </label>
              <label>
                GC super phone
                <input
                  type="tel"
                  value={j.gc_super_phone}
                  onChange={(e) => setJobInfo({ gc_super_phone: e.target.value })}
                />
              </label>
              <label>
                GC super email
                <input
                  type="email"
                  value={j.gc_super_email}
                  onChange={(e) => setJobInfo({ gc_super_email: e.target.value })}
                />
              </label>
              <label>
                Estimator
                <input value={j.gc_estimator} onChange={(e) => setJobInfo({ gc_estimator: e.target.value })} />
              </label>
              <label>
                Project engineer
                <input value={j.gc_engineer} onChange={(e) => setJobInfo({ gc_engineer: e.target.value })} />
              </label>
            </div>
          </JobSection>

          <JobSection title="Architect Info">
            <div className="grid-2">
              <label>
                Architect
                <input
                  value={project.architect}
                  onChange={(e) => setProject({ ...project, architect: e.target.value })}
                />
              </label>
              <label>
                Drawings
                <input value={j.drawings} onChange={(e) => setJobInfo({ drawings: e.target.value })} />
              </label>
              <label>
                Address
                <input
                  value={j.architect_address}
                  onChange={(e) => setJobInfo({ architect_address: e.target.value })}
                />
              </label>
              <label>
                City, state, zip
                <input
                  value={j.architect_city_state_zip}
                  onChange={(e) => setJobInfo({ architect_city_state_zip: e.target.value })}
                />
              </label>
              <label>
                Contact
                <input value={j.architect_contact} onChange={(e) => setJobInfo({ architect_contact: e.target.value })} />
              </label>
              <label>
                Phone
                <input value={j.architect_phone} onChange={(e) => setJobInfo({ architect_phone: e.target.value })} />
              </label>
            </div>
          </JobSection>

          <JobSection title="Owner Info">
            <div className="grid-2">
              <label>
                Name
                <input value={project.owner} onChange={(e) => setProject({ ...project, owner: e.target.value })} />
              </label>
              <label>
                Contact
                <input value={j.owner_contact} onChange={(e) => setJobInfo({ owner_contact: e.target.value })} />
              </label>
              <label>
                Address
                <input value={j.owner_address} onChange={(e) => setJobInfo({ owner_address: e.target.value })} />
              </label>
              <label>
                Phone
                <input value={j.owner_phone} onChange={(e) => setJobInfo({ owner_phone: e.target.value })} />
              </label>
              <label className="grid-span-2">
                City, state, zip
                <input
                  value={j.owner_city_state_zip}
                  onChange={(e) => setJobInfo({ owner_city_state_zip: e.target.value })}
                />
              </label>
            </div>
          </JobSection>

          <IcbiInfoSection key={projectId} jobInfo={j} onChange={setJobInfo} />

          <TradeAppsSyncSection project={project} projectId={projectId} />

          <footer className="job-info-drawer-footer row-gap wrap">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save job info"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Done
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
