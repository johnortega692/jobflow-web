import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { ContractListFilter, type ContractListFilterValue } from "../components/jobinfo/ContractListFilter";
import { RfiStatusBadge } from "../components/rfi/RfiStatusBadge";
import { useLetterhead } from "../contexts/LetterheadContext";
import { formatDateDisplay, parseFlexibleDate } from "../lib/dateInputUtils";
import {
  hasTransmittalContractSwitch,
  projectPrintInfoForContract,
  TRANSMITTAL_CONTRACT_LABELS,
} from "../lib/jobInfo";
import { logProjectActivityEvent } from "../lib/projectActivity";
import { downloadRfiPdf } from "../lib/rfiPdf";
import { supabase } from "../lib/supabase";
import { RFI_STATUS_CLOSED, RFI_STATUS_OPEN, isRfiClosed, normalizeRfiStatus, rfiStatusCounts } from "../lib/rfiStatus";
import type { ProjectForm, Rfi } from "../types/database";
import { normalizeRfiFormData, rfiContractFromData } from "../types/database";

type StatusFilter = "open" | "closed" | "all";

function displayRfiNumber(raw: string | null | undefined): string {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? String(n).padStart(3, "0") : raw?.trim() || "—";
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calendarDaysBetween(from: Date, to: Date): number {
  const ms = startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

function dueParts(dueDate: string): { date: string; hint: string; tone: "neutral" | "soon" | "overdue" } | null {
  const due = parseFlexibleDate(dueDate);
  if (!due) return null;
  const days = calendarDaysBetween(new Date(), due);
  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      date: formatDateDisplay(due),
      hint: `${overdue} day${overdue === 1 ? "" : "s"} overdue`,
      tone: "overdue",
    };
  }
  if (days === 0) return { date: formatDateDisplay(due), hint: "due today", tone: "soon" };
  return {
    date: formatDateDisplay(due),
    hint: `in ${days} day${days === 1 ? "" : "s"}`,
    tone: days <= 3 ? "soon" : "neutral",
  };
}

function formatUpdated(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = calendarDaysBetween(date, new Date());
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${formatDateDisplay(date)}, ${time}`;
}

type Ctx = { project: ProjectForm; projectId: string };

function nextRfiNumber(numbers: string[]): string {
  const max = numbers.reduce((m, num) => {
    const n = parseInt(num, 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1).padStart(3, "0");
}

export function ProjectRfisPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { branding } = useLetterhead();
  const navigate = useNavigate();
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [contractFilter, setContractFilter] = useState<ContractListFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  const showContractColumn = hasTransmittalContractSwitch(project);

  const filteredRfis = useMemo(() => {
    if (contractFilter === "all") return rfis;
    return rfis.filter((rfi) => rfiContractFromData(rfi.data) === contractFilter);
  }, [contractFilter, rfis]);

  const statusSummary = rfiStatusCounts(filteredRfis);
  const visibleRfis = useMemo(() => {
    if (statusFilter === "all") return filteredRfis;
    return filteredRfis.filter((rfi) =>
      statusFilter === "closed" ? isRfiClosed(rfi.status) : !isRfiClosed(rfi.status),
    );
  }, [filteredRfis, statusFilter]);

  useEffect(() => {
    setContractFilter("all");
    setStatusFilter("open");
    setMenuId(null);
  }, [projectId]);

  useEffect(() => {
    if (!menuId) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-rfi-menu]")) return;
      setMenuId(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuId(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("rfis")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (err) setError(err.message);
    else setRfis(data ?? []);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function createRfi() {
    const nextNum = nextRfiNumber(rfis.map((r) => r.rfi_number ?? ""));
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("rfis")
      .insert({
        project_id: projectId,
        rfi_number: nextNum,
        subject: "New RFI",
        status: RFI_STATUS_OPEN,
        created_by: userData.user?.id ?? null,
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_created",
      summary: `RFI #${nextNum} created`,
    });
    navigate(`/projects/${projectId}/rfis/${data.id}`);
  }

  async function onDelete(rfi: Rfi) {
    if (!window.confirm(`Delete RFI #${rfi.rfi_number} — "${rfi.subject}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(rfi.id);
    setError(null);
    const { error: err } = await supabase.from("rfis").delete().eq("id", rfi.id);
    setDeletingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_deleted",
      summary: `RFI #${rfi.rfi_number} — "${rfi.subject}" deleted`,
    });
    setRfis((prev) => prev.filter((r) => r.id !== rfi.id));
  }

  async function setRfiStatus(rfi: Rfi, status: typeof RFI_STATUS_OPEN | typeof RFI_STATUS_CLOSED) {
    if (normalizeRfiStatus(rfi.status) === status) return;
    setStatusBusyId(rfi.id);
    setError(null);
    const { error: err } = await supabase.from("rfis").update({ status }).eq("id", rfi.id);
    setStatusBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_status_updated",
      summary: `RFI #${rfi.rfi_number} marked ${status}`,
    });
    setRfis((prev) => prev.map((r) => (r.id === rfi.id ? { ...r, status } : r)));
  }

  async function onDownloadPdf(rfi: Rfi) {
    const form = normalizeRfiFormData(rfi.data);
    const subject = rfi.subject?.trim() ?? "";
    if (!subject) {
      setError("Enter a subject before downloading the PDF.");
      return;
    }
    if (!form.question.trim()) {
      const ok = window.confirm("Question is empty — generate PDF anyway?");
      if (!ok) return;
    }
    setPdfBusyId(rfi.id);
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
        rfi_number: rfi.rfi_number ?? "",
        subject,
        form,
        branding,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setPdfBusyId(null);
    }
  }

  return (
    <section className="stack project-rfis-page">
      <div className="rfi-list-header">
        <h1>RFIs</h1>
        <button type="button" className="btn btn-primary" onClick={() => void createRfi()}>
          + New RFI
        </button>
      </div>

      <div className="rfi-status-switch" role="group" aria-label="Filter RFIs">
        <button
          type="button"
          className={statusFilter === "open" ? "is-on" : undefined}
          aria-pressed={statusFilter === "open"}
          onClick={() => setStatusFilter("open")}
        >
          Open {statusSummary.open}
        </button>
        <button
          type="button"
          className={statusFilter === "closed" ? "is-on" : undefined}
          aria-pressed={statusFilter === "closed"}
          onClick={() => setStatusFilter("closed")}
        >
          Closed {statusSummary.closed}
        </button>
        <button
          type="button"
          className={statusFilter === "all" ? "is-on" : undefined}
          aria-pressed={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        >
          All {statusSummary.total}
        </button>
      </div>

      <ContractListFilter project={project} value={contractFilter} onChange={setContractFilter} />

      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading RFIs…</p>
      ) : rfis.length === 0 ? (
        <p className="muted">No RFIs yet.</p>
      ) : visibleRfis.length === 0 ? (
        <p className="muted">
          {statusFilter === "open"
            ? "No open RFIs."
            : statusFilter === "closed"
              ? "No closed RFIs."
              : `No RFIs for ${contractFilter === "all" ? "this job" : TRANSMITTAL_CONTRACT_LABELS[contractFilter]}.`}
        </p>
      ) : (
        <div className="card rfi-list-card">
            <table className="data-table rfi-list-table">
              <thead>
                <tr>
                  <th>#</th>
                  {showContractColumn && <th>Contract</th>}
                  <th>Subject</th>
                  <th>Ball in court</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRfis.map((r) => {
                  const form = normalizeRfiFormData(r.data);
                  const due = dueParts(form.due_date);
                  const ball = form.to_name.trim();
                  const open = normalizeRfiStatus(r.status) === RFI_STATUS_OPEN;
                  return (
                    <tr key={r.id}>
                      <td className="rfi-list-num">{displayRfiNumber(r.rfi_number)}</td>
                      {showContractColumn && (
                        <td className="muted small">
                          {TRANSMITTAL_CONTRACT_LABELS[rfiContractFromData(r.data)]}
                        </td>
                      )}
                      <td>
                        <Link className="rfi-subject-link" to={`/projects/${projectId}/rfis/${r.id}`}>
                          {r.subject?.trim() || "Untitled RFI"}
                        </Link>
                      </td>
                      <td className={ball ? undefined : "rfi-placeholder"}>{ball || "[ball in court]"}</td>
                      <td>
                        {due ? (
                          <span className="rfi-due">
                            <span>{due.date}</span>
                            <span className={`rfi-due-hint is-${due.tone}`}>{due.hint}</span>
                          </span>
                        ) : (
                          <span className="rfi-placeholder">[due date]</span>
                        )}
                      </td>
                      <td>
                        <RfiStatusBadge status={r.status} />
                      </td>
                      <td className="muted">{formatUpdated(r.updated_at)}</td>
                      <td>
                        <div className="rfi-row-actions">
                          {open ? (
                            <button
                              type="button"
                              className="btn btn-secondary rfi-close-btn"
                              disabled={statusBusyId === r.id}
                              onClick={() => void setRfiStatus(r, RFI_STATUS_CLOSED)}
                            >
                              Close
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary rfi-close-btn"
                              disabled={statusBusyId === r.id}
                              onClick={() => void setRfiStatus(r, RFI_STATUS_OPEN)}
                            >
                              Reopen
                            </button>
                          )}
                          <div className="rfi-row-menu" data-rfi-menu>
                            <button
                              type="button"
                              className="rfi-row-more"
                              aria-label="More actions"
                              aria-expanded={menuId === r.id}
                              onClick={() => setMenuId((current) => (current === r.id ? null : r.id))}
                            >
                              ···
                            </button>
                            {menuId === r.id ? (
                              <div className="rfi-row-menu-pop" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={pdfBusyId === r.id}
                                  onClick={() => {
                                    setMenuId(null);
                                    void onDownloadPdf(r);
                                  }}
                                >
                                  Download PDF
                                </button>
                                <Link
                                  role="menuitem"
                                  to={`/projects/${projectId}/rfis/${r.id}`}
                                  onClick={() => setMenuId(null)}
                                >
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={deletingId === r.id}
                                  onClick={() => {
                                    setMenuId(null);
                                    void onDelete(r);
                                  }}
                                >
                                  {deletingId === r.id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>
      )}
    </section>
  );
}
