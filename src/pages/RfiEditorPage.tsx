import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DateInput } from "../components/DateInput";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { RfiAiAssistModal } from "../components/rfi/RfiAiAssistModal";
import { RfiAttachmentsSection } from "../components/rfi/RfiAttachmentsSection";
import { RfiStatusBadge } from "../components/rfi/RfiStatusBadge";
import { formatDateDisplay, parseFlexibleDate } from "../lib/dateInputUtils";
import { logProjectActivityEvent } from "../lib/projectActivity";
import { removeRfiAttachments } from "../lib/rfiFileStorage";
import {
  RFI_STATUS_CLOSED,
  RFI_STATUS_OPEN,
  normalizeRfiStatus,
  type RfiWorkflowStatus,
} from "../lib/rfiStatus";
import { supabase } from "../lib/supabase";
import { downloadRfiPdf } from "../lib/rfiPdf";
import { rfiFilename } from "../lib/pdfFilenames";
import { evaluateRfiReadiness } from "../lib/rfiReadiness";
import { applyRfiProfileDefaults } from "../lib/userProfile";
import {
  RFI_ACTION_LABELS,
  RFI_IMPACT_OPTIONS,
  RFI_REASON_LABELS,
  rfiCostImpact,
  rfiCostImpactFlags,
  rfiScheduleImpact,
  rfiScheduleImpactFlags,
  type RfiImpactChoice,
} from "../lib/rfiFormLabels";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  applyJobInfoToRfi,
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  projectPrintInfoForContract,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import {
  defaultRfiFormData,
  normalizeProject,
  normalizeRfiFormData,
  type Json,
  type ProjectForm,
  type Rfi,
  type RfiAttachedFile,
  type RfiFormData,
} from "../types/database";

function parseRfiData(raw: unknown): RfiFormData {
  return normalizeRfiFormData(raw);
}

function formatRfiClosedDate(d = new Date()): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calendarDaysBetween(from: Date, to: Date): number {
  const ms = startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

function formatOpenedLabel(rfiDate: string): string {
  const opened = parseFlexibleDate(rfiDate);
  if (!opened) return rfiDate.trim() ? `Opened ${rfiDate.trim()}` : "Opened —";
  const display = formatDateDisplay(opened);
  const days = calendarDaysBetween(opened, new Date());
  if (days === 0) return `Opened ${display} (today)`;
  return `Opened ${display}`;
}

function daysOpenCaption(rfiDate: string): string {
  const opened = parseFlexibleDate(rfiDate);
  if (!opened) return "—";
  const days = Math.max(0, calendarDaysBetween(opened, new Date()));
  return `${days} day${days === 1 ? "" : "s"} open`;
}

function dueTimeline(dueDate: string): { label: string; tone: "neutral" | "soon" | "overdue" } | null {
  const due = parseFlexibleDate(dueDate);
  if (!due) return null;
  const display = formatDateDisplay(due);
  const days = calendarDaysBetween(new Date(), due);
  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      label: `Due ${display} — ${overdue} day${overdue === 1 ? "" : "s"} overdue`,
      tone: "overdue",
    };
  }
  if (days <= 3) {
    return {
      label: `Due ${display} — in ${days} day${days === 1 ? "" : "s"}`,
      tone: "soon",
    };
  }
  return {
    label: `Due ${display} — in ${days} day${days === 1 ? "" : "s"}`,
    tone: "neutral",
  };
}

export function RfiEditorPage() {
  const { branding, profile } = useLetterhead();
  const navigate = useNavigate();
  const { projectId, rfiId } = useParams<{ projectId: string; rfiId: string }>();
  const [project, setProject] = useState<ProjectForm | null>(null);
  const [rfiNumber, setRfiNumber] = useState("001");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState<RfiWorkflowStatus>(RFI_STATUS_OPEN);
  const [form, setForm] = useState<RfiFormData>(defaultRfiFormData());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [aiAssistOpen, setAiAssistOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    async function load() {
      if (!projectId || !rfiId) return;
      setLoading(true);
      const [projRes, rfiRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("rfis").select("*").eq("id", rfiId).single(),
      ]);
      setLoading(false);
      if (projRes.error || rfiRes.error) {
        setError(projRes.error?.message ?? rfiRes.error?.message ?? "Load failed");
        return;
      }
      setProject(normalizeProject(projRes.data));
      const rfi = rfiRes.data as Rfi;
      setRfiNumber(rfi.rfi_number ?? "001");
      setSubject(rfi.subject ?? "");
      setStatus(normalizeRfiStatus(rfi.status));
      const proj = normalizeProject(projRes.data);
      const withProfile = applyRfiProfileDefaults(parseRfiData(rfi.data), profile);
      const withJobInfo = applyJobInfoToRfi(withProfile, proj.contractor, proj.jobInfo);
      const nextForm = { ...withJobInfo, contract: coerceTransmittalContract(proj, withJobInfo.contract) };
      setForm(nextForm);
      setNotesOpen(Boolean(nextForm.impact_notes.trim()));
    }
    void load();
  }, [projectId, rfiId, profile]);

  useEffect(() => {
    if (notesOpen) notesTextareaRef.current?.focus();
  }, [notesOpen]);

  function setField<K extends keyof RfiFormData>(key: K, value: RfiFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function persistFormData(next: RfiFormData) {
    if (!rfiId) return;
    const { error: err } = await supabase
      .from("rfis")
      .update({
        data: next as unknown as Json,
      })
      .eq("id", rfiId);
    if (err) throw new Error(err.message);
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "rfi_saved",
        summary: `RFI #${rfiNumber} updated (attachments)`,
      });
    }
  }

  async function persistAttachedFiles(files: RfiAttachedFile[]) {
    const next = { ...form, attached_files: files };
    setForm(next);
    await persistFormData(next);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!rfiId) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("rfis")
      .update({
        rfi_number: rfiNumber,
        subject,
        data: form as unknown as Json,
        status,
      })
      .eq("id", rfiId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "rfi_saved",
        summary: `RFI #${rfiNumber}${subject.trim() ? ` — ${subject.trim()}` : ""} saved`,
      });
    }
  }

  async function markStatus(next: RfiWorkflowStatus) {
    if (!rfiId || status === next) return;
    setStatusBusy(true);
    setError(null);
    const nextForm: RfiFormData = {
      ...form,
      closed_date: next === RFI_STATUS_CLOSED ? formatRfiClosedDate() : "",
    };
    const { error: err } = await supabase
      .from("rfis")
      .update({
        status: next,
        data: nextForm as unknown as Json,
      })
      .eq("id", rfiId);
    setStatusBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setForm(nextForm);
    setStatus(next);
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "rfi_status_updated",
        summary: `RFI #${rfiNumber} marked ${next}`,
      });
    }
  }

  async function onDownloadPdf() {
    if (!project) return;
    if (!subject.trim()) {
      setError("Enter a subject before downloading the PDF.");
      return;
    }
    if (!form.question.trim()) {
      const ok = window.confirm("Question is empty — generate PDF anyway?");
      if (!ok) return;
    }
    setPrinting(true);
    setError(null);
    try {
      const printProject = projectPrintInfoForContract(project, form.contract);
      await downloadRfiPdf({
        project: {
          job_number: printProject.job_number,
          job_name: printProject.job_name,
          job_address: printProject.job_address,
          job_address2: printProject.job_address_line2,
          contractor: project.contractor ?? "",
          architect: project.architect ?? "",
          owner: project.owner ?? "",
        },
        rfi_number: rfiNumber,
        subject,
        form,
        branding,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setPrinting(false);
    }
  }

  async function onDelete() {
    if (!rfiId || !projectId) return;
    if (!window.confirm(`Delete RFI ${rfiNumber}? This can't be undone.`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await removeRfiAttachments(form.attached_files.map((f) => f.storage_path));
    } catch {
      /* storage cleanup best-effort */
    }
    const { error: err } = await supabase.from("rfis").delete().eq("id", rfiId);
    setDeleting(false);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_deleted",
      summary: `RFI #${rfiNumber}${subject.trim() ? ` — ${subject.trim()}` : ""} deleted`,
    });
    navigate(`/projects/${projectId}/rfis`);
  }

  const contractJob = useMemo(
    () => (project ? transmittalPrintInfo(project, form.contract) : { job_number: "", job_name: "" }),
    [project, form.contract],
  );

  const outputFilename = project
    ? rfiFilename(contractJob.job_name, contractJob.job_number, rfiNumber)
    : "";

  const readiness = useMemo(() => evaluateRfiReadiness(form), [form]);

  const titleSubject = subject.trim();
  const pageTitle = titleSubject ? `RFI ${rfiNumber} · ${titleSubject}` : `RFI ${rfiNumber}`;
  const dueInfo = dueTimeline(form.due_date);
  const ballInCourt = form.to_name.trim() || "—";

  if (loading) return <p className="muted">Loading RFI…</p>;
  if (!project) return <p className="banner banner-error">{error ?? "Not found"}</p>;

  return (
    <div className="page stack rfi-editor-page">
      <header className="stack rfi-editor-header">
        <p className="breadcrumb rfi-editor-breadcrumb">
          <Link to="/projects">Projects</Link> /{" "}
          <Link to={`/projects/${projectId}/rfis`}>{project.job_number}</Link> / RFI {rfiNumber}
        </p>
        <div className="rfi-editor-title-row">
          <h1>{pageTitle}</h1>
          {hasTransmittalContractSwitch(project) && (
            <div className="rfi-editor-title-actions">
              <TradeContractTabs
                project={project}
                value={form.contract}
                onChange={(contract) => setField("contract", contract)}
              />
            </div>
          )}
        </div>
        <div className="rfi-editor-timeline" aria-label="RFI timeline">
          <RfiStatusBadge status={status} />
          <span className="rfi-editor-timeline-sep" aria-hidden>
            ·
          </span>
          <span>{formatOpenedLabel(form.rfi_date)}</span>
          {dueInfo && (
            <>
              <span className="rfi-editor-timeline-sep" aria-hidden>
                ·
              </span>
              <span
                className={`rfi-editor-due-pill${
                  dueInfo.tone === "soon"
                    ? " rfi-editor-due-pill--soon"
                    : dueInfo.tone === "overdue"
                      ? " rfi-editor-due-pill--overdue"
                      : ""
                }`}
              >
                {dueInfo.label}
              </span>
            </>
          )}
          <span className="rfi-editor-timeline-sep" aria-hidden>
            ·
          </span>
          <span>Ball in court: {ballInCourt}</span>
        </div>
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="rfi-editor-layout">
        <div className="rfi-editor-main">
          <form id="rfi-form" className="stack" onSubmit={onSave}>
            <section className="card stack">
              <div className="grid-3">
                <label>
                  RFI #
                  <input value={rfiNumber} onChange={(e) => setRfiNumber(e.target.value)} />
                </label>
                <label>
                  Date
                  <DateInput value={form.rfi_date} onChange={(v) => setField("rfi_date", v)} />
                </label>
                <label>
                  Due date
                  <DateInput value={form.due_date} onChange={(v) => setField("due_date", v)} />
                </label>
              </div>
              <label>
                Subject
                <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
              </label>
              <div className="grid-2">
                <label>
                  To
                  <input value={form.to_name} onChange={(e) => setField("to_name", e.target.value)} />
                  {!form.to_name.trim() && project?.contractor.trim() && (
                    <span className="muted small">Defaults from Job setup → GC (contractor)</span>
                  )}
                </label>
                <label>
                  Attn
                  <input
                    value={form.attn_name}
                    onChange={(e) => setField("attn_name", e.target.value)}
                  />
                  {!form.attn_name.trim() &&
                    (project?.jobInfo.gc_pm.trim() || project?.jobInfo.gc_superintendent.trim()) && (
                      <span className="muted small">Defaults from Job setup → GC PM / super</span>
                    )}
                </label>
                <label>
                  From
                  <input
                    value={form.from_name}
                    onChange={(e) => setField("from_name", e.target.value)}
                  />
                  {!form.from_name.trim() && profile.name.trim() && (
                    <span className="muted small">Defaults from Settings → Your profile</span>
                  )}
                </label>
                <label>
                  Spec ref
                  <input value={form.spec_ref} onChange={(e) => setField("spec_ref", e.target.value)} />
                </label>
                <label>
                  Drawing ref
                  <input
                    value={form.drawing_ref}
                    onChange={(e) => setField("drawing_ref", e.target.value)}
                  />
                </label>
                <label>
                  Detail #
                  <input
                    value={form.detail_no}
                    onChange={(e) => setField("detail_no", e.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="card stack">
              <div className="row-between wrap">
                <h2>Question</h2>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (!form.question.trim()) {
                      setError("Fill in the Request field first, then open AI Assist.");
                      return;
                    }
                    setError(null);
                    setAiAssistOpen(true);
                  }}
                >
                  ✦ AI Assist
                </button>
              </div>
              <label>
                Request / question
                <textarea
                  rows={8}
                  value={form.question}
                  onChange={(e) => setField("question", e.target.value)}
                  placeholder="Describe the RFI question…"
                />
              </label>

              <div className="rfi-chip-group">
                <h3 className="rfi-chip-group-label">Reason for request</h3>
                <div className="rfi-chip-row" role="group" aria-label="Reason for request">
                  {(Object.keys(RFI_REASON_LABELS) as (keyof typeof RFI_REASON_LABELS)[]).map((key) => {
                    const selected = form[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`rfi-chip${selected ? " rfi-chip--selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setField(key, !selected)}
                      >
                        {selected ? <span className="rfi-chip-check" aria-hidden="true">✓</span> : null}
                        {RFI_REASON_LABELS[key]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rfi-chip-group">
                <h3 className="rfi-chip-group-label">Action requested</h3>
                <div className="rfi-chip-row" role="group" aria-label="Action requested">
                  {(Object.keys(RFI_ACTION_LABELS) as (keyof typeof RFI_ACTION_LABELS)[]).map((key) => {
                    const selected = form[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`rfi-chip${selected ? " rfi-chip--selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setField(key, !selected)}
                      >
                        {selected ? <span className="rfi-chip-check" aria-hidden="true">✓</span> : null}
                        {RFI_ACTION_LABELS[key]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="card stack">
              <h2>Impact</h2>
              <div className="rfi-impact-row">
                <span className="rfi-impact-row-label">Cost</span>
                <div className="rfi-impact-seg" role="radiogroup" aria-label="Cost impact">
                  {RFI_IMPACT_OPTIONS.map(({ value, label }) => {
                    const selected = rfiCostImpact(form) === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`rfi-chip rfi-chip--impact-${value}${selected ? " rfi-chip--selected" : ""}`}
                        onClick={() => setForm((prev) => ({ ...prev, ...rfiCostImpactFlags(value as RfiImpactChoice) }))}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {(rfiCostImpact(form) === "increase" || rfiCostImpact(form) === "decrease") && (
                  <label className="rfi-impact-amount">
                    <span className="sr-only">Cost amount optional</span>
                    <input
                      value={form.cost_change}
                      onChange={(e) => setField("cost_change", e.target.value)}
                      placeholder="$ amount (optional)"
                    />
                  </label>
                )}
              </div>
              <div className="rfi-impact-row">
                <span className="rfi-impact-row-label">Schedule</span>
                <div className="rfi-impact-seg" role="radiogroup" aria-label="Schedule impact">
                  {RFI_IMPACT_OPTIONS.map(({ value, label }) => {
                    const selected = rfiScheduleImpact(form) === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`rfi-chip rfi-chip--impact-${value}${selected ? " rfi-chip--selected" : ""}`}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, ...rfiScheduleImpactFlags(value as RfiImpactChoice) }))
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {(rfiScheduleImpact(form) === "increase" || rfiScheduleImpact(form) === "decrease") && (
                  <label className="rfi-impact-amount">
                    <span className="sr-only">Schedule days optional</span>
                    <input
                      value={form.sched_change}
                      onChange={(e) => setField("sched_change", e.target.value)}
                      placeholder="Days (optional, working days)"
                    />
                  </label>
                )}
              </div>
            </section>

            {form.pdf_show_solution && (
              <section className="card stack">
                <h2>
                  Recommendation{" "}
                  <span className="muted small rfi-editor-card-hint">
                    Contractor&apos;s recommended resolution
                  </span>
                </h2>
                <textarea
                  rows={4}
                  value={form.solution_text}
                  onChange={(e) => setField("solution_text", e.target.value)}
                  aria-label="Contractor's recommended resolution"
                />
              </section>
            )}

            <section className={`card stack${notesOpen ? "" : " rfi-notes-card--collapsed"}`}>
              {notesOpen ? (
                <>
                  <div className="row-between wrap rfi-notes-card-head">
                    <h2>
                      Internal notes
                      {form.impact_notes.trim() ? (
                        <span
                          className="rfi-notes-has-indicator"
                          title="Has note"
                          aria-label="Has note"
                        />
                      ) : null}{" "}
                      <span className="muted small rfi-editor-card-hint">
                        Not printed on the RFI PDF.
                      </span>
                    </h2>
                    {!form.impact_notes.trim() && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setNotesOpen(false)}
                      >
                        Collapse
                      </button>
                    )}
                  </div>
                  <label>
                    Notes
                    <textarea
                      ref={notesTextareaRef}
                      rows={4}
                      value={form.impact_notes}
                      onChange={(e) => setField("impact_notes", e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <button
                  type="button"
                  className="rfi-notes-add-row"
                  onClick={() => setNotesOpen(true)}
                >
                  <span className="rfi-notes-add-label">＋ Add internal note</span>
                  <span className="muted small">Not printed on the RFI PDF.</span>
                </button>
              )}
            </section>

            {projectId && rfiId && (
              <RfiAttachmentsSection
                projectId={projectId}
                rfiId={rfiId}
                form={form}
                setField={setField}
                onFilesPersisted={persistAttachedFiles}
                onError={(message) => setError(message || null)}
              />
            )}
          </form>
        </div>

        <aside className="stack rfi-editor-rail" aria-label="RFI actions">
          <section className="card stack rfi-editor-rail-card">
            <h3>Status</h3>
            <div className="rfi-editor-status-row">
              <RfiStatusBadge status={status} />
              <p className="muted small rfi-editor-status-caption">{daysOpenCaption(form.rfi_date)}</p>
            </div>
            {status === RFI_STATUS_OPEN ? (
              <button
                type="button"
                className="btn btn-success-soft btn-small"
                disabled={statusBusy || saving || deleting}
                onClick={() => void markStatus(RFI_STATUS_CLOSED)}
              >
                Mark closed
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={statusBusy || saving || deleting}
                onClick={() => void markStatus(RFI_STATUS_OPEN)}
              >
                Reopen
              </button>
            )}
            {savedAt && <p className="muted small">Saved {savedAt}</p>}
          </section>

          <section className="card stack rfi-editor-rail-card">
            <h3>PDF options</h3>
            <div className="stack rfi-editor-rail-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.pdf_show_solution}
                  onChange={(e) => setField("pdf_show_solution", e.target.checked)}
                />
                Recommendation
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.pdf_show_response}
                  onChange={(e) => setField("pdf_show_response", e.target.checked)}
                />
                Response space (for GC)
              </label>
            </div>
            <p className="sds-filename-preview muted small">
              <code>{outputFilename}</code>
            </p>
            <ul className="rfi-readiness-list" aria-label="PDF readiness">
              {readiness.map((item) => {
                const tone = item.ok
                  ? "ok"
                  : item.optional
                    ? "optional"
                    : "warn";
                return (
                  <li
                    key={item.id}
                    className={`rfi-readiness-item rfi-readiness-item--${tone}`}
                  >
                    <span className="rfi-readiness-mark" aria-hidden="true">
                      {item.ok ? "✓" : item.optional ? "·" : "!"}
                    </span>
                    <span>{item.label}</span>
                  </li>
                );
              })}
            </ul>
            <div className="stack rfi-editor-rail-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={printing || saving}
                onClick={() => void onDownloadPdf()}
              >
                {printing ? "Generating…" : "Download PDF"}
              </button>
              <button
                type="submit"
                form="rfi-form"
                className="btn btn-secondary"
                disabled={saving || printing || deleting}
              >
                {saving ? "Saving…" : "Save RFI"}
              </button>
            </div>
          </section>

          <button
            type="button"
            className="rfi-editor-delete-link"
            disabled={deleting || saving || printing}
            onClick={() => void onDelete()}
          >
            {deleting ? "Deleting…" : "Delete RFI…"}
          </button>
        </aside>
      </div>

      {aiAssistOpen && (
        <RfiAiAssistModal
          projectName={project.job_name}
          subject={subject}
          question={form.question}
          solutionText={form.solution_text}
          onApply={(q, sol, subj) => {
            setField("question", q);
            if (sol) setField("solution_text", sol);
            if (subj) setSubject(subj);
            setAiAssistOpen(false);
          }}
          onClose={() => setAiAssistOpen(false)}
        />
      )}
    </div>
  );
}
