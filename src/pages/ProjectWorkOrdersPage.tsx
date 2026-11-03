import { useEffect, useMemo, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import JSZip from "jszip";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  allocateEwoNumber,
  deleteExtraWorkTag,
  loadExtraWorkTags,
  openExtraWorkTagPdf,
  saveExtraWorkTagPrice,
  type OfficeExtraWorkTag,
} from "../lib/extraWorkTags";
import { ContractListFilter, type ContractListFilterValue } from "../components/jobinfo/ContractListFilter";
import {
  hasTransmittalContractSwitch,
  TRANSMITTAL_CONTRACT_LABELS,
} from "../lib/jobInfo";
import { commitProjectUpdate, logProjectActivityEvent } from "../lib/projectActivity";
import { extraWorkSignatureContacts } from "../lib/jobInfo";
import { supabase } from "../lib/supabase";
import {
  computeBudgetFromCosts,
  formatMoney,
  nextEwoNumber,
} from "../lib/workOrderCalc";
import type { ProjectForm } from "../types/database";
import { parseWorkOrderData, type WorkOrderRow } from "../types/workOrder";
import "./ProjectWorkOrdersPage.css";

type Ctx = { project: ProjectForm; projectId: string };

function todayDisplay(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

/** List timestamp without seconds (e.g. 6/25/2026, 5:50 PM). */
function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type RowView = WorkOrderRow & {
  parsed: ReturnType<typeof parseWorkOrderData>;
  budget: ReturnType<typeof computeBudgetFromCosts>;
};

function buildRowView(order: WorkOrderRow): RowView {
  const parsed = parseWorkOrderData(order.data);
  const budget = computeBudgetFromCosts(
    Number(order.material_cost),
    parsed.raw_cost,
    parsed.indirects,
  );
  return { ...order, parsed, budget };
}

function moneyDraft(value: number | null): string {
  return value == null ? "" : value.toFixed(2);
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999.99) return null;
  return Math.round(amount * 100) / 100;
}

function tagDateDisplay(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso || "—";
  return `${month}/${day}/${year}`;
}

function formatHourCount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function signedAtPhrase(value: string): string {
  const formatted = formatUpdatedAt(value);
  if (!value || formatted === "—") return "";
  const comma = formatted.lastIndexOf(",");
  if (comma < 0) return formatted;
  return `${formatted.slice(0, comma)} at ${formatted.slice(comma + 1).trim()}`;
}

type TagFilter = "all" | "needs" | "draft" | "waiting" | "signed";

function tagNeedsPricing(tag: OfficeExtraWorkTag): boolean {
  return tag.status === "signed" && tag.laborAmount == null && tag.materialAmount == null;
}

function tagStatusLabel(status: string): string {
  if (status === "waiting") return "Waiting for signature";
  if (status === "signed") return "Signed";
  if (status === "refused") return "Refused";
  return "Draft";
}

function tagStatusTone(status: string): string {
  if (status === "waiting") return "waiting";
  if (status === "signed") return "signed";
  if (status === "refused") return "refused";
  return "draft";
}

function photoSrc(photo: string): string {
  return photo.startsWith("data:") ? photo : `data:image/jpeg;base64,${photo}`;
}

function materialGroups(lines: { name: string; quantity: string }[]): { label: string; items: { name: string; quantity: string }[] }[] {
  const groups: { label: string; items: { name: string; quantity: string }[] }[] = [];
  for (const line of lines) {
    const parts = line.name.split(" · ").map((part) => part.trim()).filter(Boolean);
    const label = parts.length >= 2 ? parts.slice(0, -1).join(" · ") : "Misc";
    const name = parts.length >= 2 ? parts[parts.length - 1] ?? line.name : line.name;
    const found = groups.find((group) => group.label === label);
    const item = { name, quantity: line.quantity };
    if (found) found.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function tagMatchesFilter(tag: OfficeExtraWorkTag, filter: TagFilter): boolean {
  if (filter === "needs") return tagNeedsPricing(tag);
  if (filter === "draft") return tag.status === "draft";
  if (filter === "waiting") return tag.status === "waiting";
  if (filter === "signed") return tag.status === "signed";
  return true;
}

function ExtraWorkPdfActions({ path, filename }: { path: string; filename: string }) {
  const [busy, setBusy] = useState<"" | "view" | "download">("");
  const [error, setError] = useState<string | null>(null);

  async function open(download: boolean) {
    setBusy(download ? "download" : "view");
    setError(null);
    try {
      await openExtraWorkTagPdf(path, filename, download);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the PDF.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy !== ""} onClick={() => void open(false)}>
        {busy === "view" ? "Opening…" : "View PDF"}
      </button>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy !== ""} onClick={() => void open(true)}>
        {busy === "download" ? "Downloading…" : "Download PDF"}
      </button>
      {error ? <span className="muted small">{error}</span> : null}
    </div>
  );
}

function FieldTagPhotos({ photos, tagNumber }: { photos: string[]; tagNumber: string }) {
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState("");

  useEffect(() => {
    if (viewIndex == null) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setViewIndex(null);
      if (event.key === "ArrowRight") setViewIndex((current) => (current == null ? current : (current + 1) % photos.length));
      if (event.key === "ArrowLeft") setViewIndex((current) => (current == null ? current : (current - 1 + photos.length) % photos.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, viewIndex]);

  async function downloadZip() {
    setZipping(true);
    setZipError("");
    try {
      const zip = new JSZip();
      for (let index = 0; index < photos.length; index += 1) {
        const src = photoSrc(photos[index] ?? "");
        const response = await fetch(src);
        if (!response.ok) throw new Error("Could not read a photo.");
        const blob = await response.blob();
        const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        zip.file(`${String(index + 1).padStart(2, "0")}.${ext}`, blob);
      }
      const file = await zip.generateAsync({ type: "blob" });
      const stem = tagNumber.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "field-tag";
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${stem}-photos.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : "Could not download the photos.");
    } finally {
      setZipping(false);
    }
  }

  const viewing = viewIndex != null ? photos[viewIndex] : "";

  return (
    <div>
      <div className="field-tag-photo-head">
        <div className="field-tag-block-label">Photos ({photos.length})</div>
        <button type="button" className="btn btn-secondary btn-small" disabled={zipping} onClick={() => void downloadZip()}>
          {zipping ? "Preparing…" : "Download zip"}
        </button>
      </div>
      <div className="field-tag-photos">
        {photos.map((photo, index) => (
          <button key={index} type="button" onClick={() => setViewIndex(index)} aria-label={`View photo ${index + 1}`}>
            <img src={photoSrc(photo)} alt="" />
          </button>
        ))}
      </div>
      {zipError ? <p className="muted small">{zipError}</p> : null}
      {viewing ? (
        <div className="field-tag-lightbox" role="dialog" aria-modal="true" aria-label={`Photo ${(viewIndex ?? 0) + 1} of ${photos.length}`} onClick={() => setViewIndex(null)}>
          <div className="field-tag-lightbox-frame" onClick={(event) => event.stopPropagation()}>
            <div className="field-tag-lightbox-bar">
              <span>
                {(viewIndex ?? 0) + 1} of {photos.length}
              </span>
              <span className="field-tag-lightbox-actions">
                {photos.length > 1 ? (
                  <>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setViewIndex((current) => (current == null ? 0 : (current - 1 + photos.length) % photos.length))}>
                      Previous
                    </button>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setViewIndex((current) => (current == null ? 0 : (current + 1) % photos.length))}>
                      Next
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setViewIndex(null)}>
                  Close
                </button>
              </span>
            </div>
            <img src={photoSrc(viewing)} alt={`Photo ${(viewIndex ?? 0) + 1}`} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const SIGN_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function ExtraWorkSignatureEmails({ project, projectId }: { project: ProjectForm; projectId: string }) {
  const contacts = useMemo(() => extraWorkSignatureContacts(project.jobInfo), [project.jobInfo]);
  const saved = project.jobInfo.extra_work_sign_emails;
  const [checked, setChecked] = useState<string[]>(saved);
  const [added, setAdded] = useState<string[]>(() => saved.filter((email) => !extraWorkSignatureContacts(project.jobInfo).some((contact) => contact.email === email)));
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  function toggle(email: string) {
    setChecked((current) => (current.includes(email) ? current.filter((item) => item !== email) : [...current, email]));
    setNote("");
  }

  function addCustom() {
    const email = custom.trim().toLowerCase();
    if (!SIGN_EMAIL_RE.test(email)) {
      setNote("Enter a valid email.");
      return;
    }
    setAdded((current) => (current.includes(email) || contacts.some((contact) => contact.email === email) ? current : [...current, email]));
    setChecked((current) => (current.includes(email) ? current : [...current, email]));
    setCustom("");
    setNote("");
  }

  async function save() {
    setSaving(true);
    setNote("");
    const data =
      project.data && typeof project.data === "object" && !Array.isArray(project.data)
        ? (project.data as Record<string, unknown>)
        : {};
    const jobInfo =
      data.job_info && typeof data.job_info === "object" && !Array.isArray(data.job_info)
        ? (data.job_info as Record<string, unknown>)
        : {};
    const message = await commitProjectUpdate({
      projectId,
      mergeData: { job_info: { ...jobInfo, extra_work_sign_emails: checked } },
      activity: { action: "project_data_saved", summary: "Extra work signature emails saved" },
    });
    setSaving(false);
    setNote(message ?? "Saved. Field Tools adds the checked emails to the signature.");
  }

  return (
    <div className="stack">
      <div>
        <h3>Signature emails</h3>
        <p className="muted small">
          Checked emails are added to the extra work signature in Field Tools. Add anyone who is not already on the job.
        </p>
      </div>
      {contacts.length === 0 && added.length === 0 ? (
        <p className="muted small">No emails are on this job yet.</p>
      ) : (
        <div className="ewo-sign-email-list">
          {contacts.map((contact) => (
            <label key={contact.email} className="ewo-sign-email">
              <input type="checkbox" checked={checked.includes(contact.email)} onChange={() => toggle(contact.email)} />
              <span className="ewo-sign-email-text">
                <span className="ewo-sign-email-name">{contact.label}</span>
                <span className="ewo-sign-email-address">{contact.email}</span>
              </span>
            </label>
          ))}
          {added.map((email) => (
            <label key={email} className="ewo-sign-email">
              <input type="checkbox" checked={checked.includes(email)} onChange={() => toggle(email)} />
              <span className="ewo-sign-email-text">
                <span className="ewo-sign-email-name">{email}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="ewo-sign-add">
        <input
          aria-label="Additional signature email"
          inputMode="email"
          placeholder="name@company.com"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="btn btn-secondary btn-small" onClick={addCustom}>
          Add email
        </button>
        <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {note ? <span className="muted small">{note}</span> : null}
    </div>
  );
}

function FieldTagList({
  tags,
  priceDrafts,
  setPriceDrafts,
  savingPriceId,
  savedPriceId,
  clearSaved,
  onSave,
  deletingId,
  onDelete,
}: {
  tags: OfficeExtraWorkTag[];
  priceDrafts: Record<string, { labor: string; material: string }>;
  setPriceDrafts: Dispatch<SetStateAction<Record<string, { labor: string; material: string }>>>;
  savingPriceId: string | null;
  savedPriceId: string | null;
  clearSaved: () => void;
  onSave: (tag: OfficeExtraWorkTag) => void;
  deletingId: string | null;
  onDelete: (tag: OfficeExtraWorkTag) => void;
}) {
  const [filter, setFilter] = useState<TagFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const counts = {
    all: tags.length,
    needs: tags.filter(tagNeedsPricing).length,
    draft: tags.filter((tag) => tag.status === "draft").length,
    waiting: tags.filter((tag) => tag.status === "waiting").length,
    signed: tags.filter((tag) => tag.status === "signed").length,
  };
  const chips: { id: TagFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "needs", label: "Needs pricing" },
    { id: "draft", label: "Draft" },
    { id: "waiting", label: "Waiting" },
    { id: "signed", label: "Signed" },
  ];
  const visible = tags.filter((tag) => tagMatchesFilter(tag, filter));

  return (
    <div className="field-tags">
      <div className="field-tag-filters" role="group" aria-label="Filter field tags">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="field-tag-filter"
            aria-pressed={filter === chip.id}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
            <span className="field-tag-chip-count">{counts[chip.id]}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="muted">No tags match this filter.</p>
      ) : (
        <div className="field-tag-list">
          <div className="field-tag-head" aria-hidden="true">
            <span>Tag</span>
            <span>Title</span>
            <span>Date</span>
            <span>Status</span>
            <span />
          </div>
          {visible.map((tag) => {
            const open = openId === tag.id;
            const panelId = `field-tag-${tag.id}`;
            const draft = priceDrafts[tag.id] ?? {
              labor: moneyDraft(tag.laborAmount),
              material: moneyDraft(tag.materialAmount),
            };
            const labor = parsePrice(draft.labor);
            const material = parsePrice(draft.material);
            const canSave = tag.status === "signed"
              && (draft.labor.trim() !== moneyDraft(tag.laborAmount)
                || draft.material.trim() !== moneyDraft(tag.materialAmount));
            const hours = tag.hoursSummary;
            const signedWhen = signedAtPhrase(tag.signedAt);
            const signedWho = [tag.signerName, tag.signerCompany].filter(Boolean).join(", ");
            const signedLine = [signedWho, signedWhen].filter(Boolean).join(", ");
            const amount = tag.status === "signed" && (tag.laborAmount != null || tag.materialAmount != null)
              ? formatMoney((tag.laborAmount ?? 0) + (tag.materialAmount ?? 0))
              : "";
            const title = tag.area.trim();
            const statusNote =
              tag.status === "draft" || tag.status === "waiting"
                ? "Not signed yet"
                : tag.status === "signed" && tag.signerName.trim()
                  ? `Signed by ${tag.signerName.trim()}`
                  : amount;
            const groups = materialGroups(tag.materialLines);
            return (
              <article key={tag.id} className={`field-tag${open ? " field-tag--open" : ""}`}>
                <button
                  type="button"
                  className="field-tag-row"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId((current) => (current === tag.id ? null : tag.id))}
                >
                  <span className="field-tag-id">
                    <span className="field-tag-number">{tag.tagNumber || "—"}</span>
                    <span className="field-tag-by">By {tag.submittedByName}</span>
                  </span>
                  <span className={`field-tag-title${title ? "" : " field-tag-title--empty"}`}>{title || "No title"}</span>
                  <span className="field-tag-when">{tagDateDisplay(tag.tagDate)}</span>
                  <span className="field-tag-status">
                    <span className="field-tag-badges">
                      <span className={`field-tag-badge field-tag-badge--${tagStatusTone(tag.status)}`}>
                        <span className="field-tag-dot" aria-hidden="true" />
                        {tagStatusLabel(tag.status)}
                      </span>
                      {tagNeedsPricing(tag) ? <span className="field-tag-needs">Needs pricing</span> : null}
                    </span>
                    {statusNote ? <span className="field-tag-pending">{statusNote}</span> : null}
                  </span>
                  <span className="field-tag-chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6.2 8 10l4-3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                <div id={panelId} className="field-tag-panel" hidden={!open}>
                  <div className="field-tag-detail">
                    <div className="field-tag-desc-block">
                      <div className="field-tag-block-label">Description</div>
                      <div>{tag.description.trim() || "—"}</div>
                    </div>
                    <div className="field-tag-detail-grid">
                    <div className="field-tag-detail-card">
                      <div className="field-tag-block-label">Hours</div>
                      <div className="field-tag-people">{hours.people === 1 ? "1 person" : `${hours.people} people`}</div>
                      <div className="field-tag-stats">
                        <div className="field-tag-stat">
                          <span>Reg</span>
                          <strong>{formatHourCount(hours.regular)}</strong>
                        </div>
                        <div className="field-tag-stat">
                          <span>OT</span>
                          <strong>{formatHourCount(hours.overtime)}</strong>
                        </div>
                        <div className="field-tag-stat">
                          <span>DT</span>
                          <strong>{formatHourCount(hours.doubleTime)}</strong>
                        </div>
                      </div>
                      {hours.premium > 0 ? (
                        <div className="muted small">{formatHourCount(hours.premium)} premium only</div>
                      ) : null}
                    </div>
                    <div className="field-tag-detail-card">
                      <div className="field-tag-block-label">Materials ({tag.materialLines.length})</div>
                      {groups.length === 0 ? (
                        <div className="muted small">No materials recorded</div>
                      ) : (
                        groups.map((group) => (
                          <div key={group.label} className="field-tag-material-group">
                            <div className="field-tag-block-label">{group.label}</div>
                            {group.items.map((item, index) => (
                              <div key={`${item.name}-${index}`} className="field-tag-material-row">
                                <span>{item.name}</span>
                                {item.quantity ? <strong>× {item.quantity}</strong> : null}
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="field-tag-detail-card">
                      <div className="field-tag-block-label">Pricing</div>
                      {tag.status === "signed" ? (
                        <>
                          {tagNeedsPricing(tag) ? <p className="muted small">Signed. Ready for labor and material pricing.</p> : null}
                        <div className="field-tag-price">
                          <label>
                            Labor $
                            <input
                              aria-label={`Labor price for tag ${tag.tagNumber}`}
                              inputMode="decimal"
                              value={draft.labor}
                              onChange={(event) => {
                                if (savedPriceId === tag.id) clearSaved();
                                const next = event.target.value;
                                setPriceDrafts((current) => ({
                                  ...current,
                                  [tag.id]: { ...(current[tag.id] ?? draft), labor: next },
                                }));
                              }}
                            />
                          </label>
                          <label>
                            Material $
                            <input
                              aria-label={`Material price for tag ${tag.tagNumber}`}
                              inputMode="decimal"
                              value={draft.material}
                              onChange={(event) => {
                                if (savedPriceId === tag.id) clearSaved();
                                const next = event.target.value;
                                setPriceDrafts((current) => ({
                                  ...current,
                                  [tag.id]: { ...(current[tag.id] ?? draft), material: next },
                                }));
                              }}
                            />
                          </label>
                          <div className="field-tag-price-total">
                            <span className="muted small">Total</span>
                            <strong>{labor != null && material != null ? formatMoney(labor + material) : "—"}</strong>
                            {canSave ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-small"
                                disabled={savingPriceId === tag.id}
                                onClick={() => onSave(tag)}
                              >
                                {savingPriceId === tag.id ? "Saving…" : "Save"}
                              </button>
                            ) : savedPriceId === tag.id ? (
                              <span className="muted small">Saved</span>
                            ) : null}
                          </div>
                        </div>
                        </>
                      ) : (
                        <p className="field-tag-locked muted small">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
                            <path d="M5.25 7V5.1a2.75 2.75 0 0 1 5.5 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                          Available after the tag is signed.
                        </p>
                      )}
                    </div>
                    </div>
                    {tag.status === "signed" ? (
                      <div className="field-tag-detail-card">
                        <div className="field-tag-block-label">Files</div>
                        {tag.pdfPath ? (
                          <ExtraWorkPdfActions path={tag.pdfPath} filename={tag.pdfFilename || `Extra work tag ${tag.tagNumber}.pdf`} />
                        ) : (
                          <p className="muted small">The PDF is saved when the signed tag is emailed.</p>
                        )}
                      </div>
                    ) : null}
                    {tag.status === "signed" ? (
                      <div className="field-tag-detail-card">
                        <div className="field-tag-block-label">Signed by</div>
                        {signedLine ? <p className="small">{signedLine}</p> : null}
                        {tag.signaturePng ? (
                          <img className="field-tag-signature" src={tag.signaturePng} alt="Signature" />
                        ) : null}
                      </div>
                    ) : null}
                    {tag.status === "refused" && (tag.signerName || tag.refusedNote) ? (
                      <div className="field-tag-detail-card">
                        <div className="field-tag-block-label">Refused by</div>
                        <p className="small">
                          {tag.signerName}
                          {tag.signerCompany ? `, ${tag.signerCompany}` : ""}
                          {tag.refusedNote ? ` — ${tag.refusedNote}` : ""}
                        </p>
                      </div>
                    ) : null}
                    {tag.photos.length > 0 ? (
                      <div className="field-tag-detail-card field-tag-photos-card">
                        <FieldTagPhotos photos={tag.photos} tagNumber={tag.tagNumber} />
                      </div>
                    ) : null}
                    <div className="field-tag-delete">
                      <button
                        type="button"
                        className="btn btn-danger-soft btn-small"
                        disabled={deletingId === tag.id}
                        onClick={() => onDelete(tag)}
                      >
                        {deletingId === tag.id ? "Deleting…" : "Delete tag"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusMark({ on, label }: { on: boolean; label: string }) {
  if (on) {
    return (
      <span className="work-orders-status-ok" aria-label={label}>
        ✓
      </span>
    );
  }
  return (
    <span className="work-orders-status-empty" aria-label={`Not ${label.toLowerCase()}`}>
      —
    </span>
  );
}

export function ProjectWorkOrdersPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [tags, setTags] = useState<OfficeExtraWorkTag[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { labor: string; material: string }>>({});
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [savedPriceId, setSavedPriceId] = useState<string | null>(null);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractFilter, setContractFilter] = useState<ContractListFilterValue>("all");
  const [section, setSection] = useState<"orders" | "field">("orders");

  const showContractColumn = hasTransmittalContractSwitch(project);

  async function load() {
    setLoading(true);
    const ordersPromise = supabase
      .from("work_orders")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    const tagsPromise = isAdmin ? loadExtraWorkTags(projectId) : Promise.resolve({ tags: [] as OfficeExtraWorkTag[], error: null });
    const [{ data, error: err }, tagResult] = await Promise.all([ordersPromise, tagsPromise]);
    if (err) setError(err.message);
    else setOrders((data ?? []) as WorkOrderRow[]);
    if (tagResult.error) setError(tagResult.error);
    else setTags(tagResult.tags);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [projectId, isAdmin]);

  useEffect(() => {
    const next: Record<string, { labor: string; material: string }> = {};
    for (const tag of tags) {
      if (tag.status !== "signed") continue;
      next[tag.id] = {
        labor: moneyDraft(tag.laborAmount),
        material: moneyDraft(tag.materialAmount),
      };
    }
    setPriceDrafts(next);
  }, [tags]);

  const rows = useMemo(() => orders.map(buildRowView), [orders]);

  const filteredRows = useMemo(() => {
    if (contractFilter === "all") return rows;
    return rows.filter((row) => row.parsed.contract === contractFilter);
  }, [contractFilter, rows]);

  const summary = useMemo(() => {
    let totalAmount = 0;
    let pendingFsi = 0;
    for (const row of filteredRows) {
      totalAmount += Number(row.total_amount);
      if (!row.parsed.fsi_checked) pendingFsi += 1;
    }
    return { totalAmount, pendingFsi, count: filteredRows.length };
  }, [filteredRows]);
  const showOrderTable = filteredRows.length > 0;

  useEffect(() => {
    setContractFilter("all");
    setSection("orders");
  }, [projectId]);

  function openOrder(id: string) {
    navigate(`/projects/${projectId}/work-orders/${id}`);
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openOrder(id);
    }
  }

  async function savePrice(tag: OfficeExtraWorkTag) {
    const draft = priceDrafts[tag.id] ?? {
      labor: moneyDraft(tag.laborAmount),
      material: moneyDraft(tag.materialAmount),
    };
    const labor = parsePrice(draft.labor);
    const material = parsePrice(draft.material);
    if (labor == null || material == null) {
      setError("Enter a labor amount and a material amount.");
      return;
    }
    setSavingPriceId(tag.id);
    setError(null);
    const message = await saveExtraWorkTagPrice(tag.id, labor, material);
    setSavingPriceId(null);
    if (message) {
      setError(message);
      return;
    }
    setTags((current) =>
      current.map((row) => (row.id === tag.id ? { ...row, laborAmount: labor, materialAmount: material } : row)),
    );
    setSavedPriceId(tag.id);
  }

  async function deleteTag(tag: OfficeExtraWorkTag) {
    const label = tag.tagNumber || "this tag";
    const signedNote = tag.status === "signed" ? " It is signed, so its signature and PDF are deleted too." : "";
    if (!window.confirm(`Delete field tag ${label}?${signedNote} This can't be undone.`)) return;
    setDeletingTagId(tag.id);
    setError(null);
    const message = await deleteExtraWorkTag(tag.id);
    setDeletingTagId(null);
    if (message) {
      setError(message);
      return;
    }
    setTags((current) => current.filter((row) => row.id !== tag.id));
  }

  async function createWorkOrder() {
    const nextNum = await allocateEwoNumber(projectId, orders.map((o) => o.ewo_number), nextEwoNumber);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("work_orders")
      .insert({
        project_id: projectId,
        ewo_number: nextNum,
        ewo_date: todayDisplay(),
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
      action: "work_order_created",
      summary: `EWO #${nextNum} created`,
    });
    navigate(`/projects/${projectId}/work-orders/${data.id}`);
  }

  return (
    <div className="stack work-orders-page">
      {isAdmin && (
        <nav className="submittals-hub-tabs job-tracker-tabs" role="tablist" aria-label="Work order sections">
          <button
            type="button"
            role="tab"
            id="work-orders-tab-orders"
            aria-selected={section === "orders"}
            aria-controls="work-orders-panel-orders"
            className={`job-tracker-tab${section === "orders" ? " job-tracker-tab--active" : ""}`}
            onClick={() => setSection("orders")}
          >
            Work orders
          </button>
          <button
            type="button"
            role="tab"
            id="work-orders-tab-field"
            aria-selected={section === "field"}
            aria-controls="work-orders-panel-field"
            className={`job-tracker-tab${section === "field" ? " job-tracker-tab--active" : ""}`}
            onClick={() => setSection("field")}
          >
            Field tags
            {tags.length > 0 ? <span className="submittals-hub-tab-count">{tags.length}</span> : null}
          </button>
        </nav>
      )}
    <section className="card stack">
      {error && <div className="banner banner-error">{error}</div>}

      {(!isAdmin || section === "orders") && (
      <div
        className="stack"
        role={isAdmin ? "tabpanel" : undefined}
        id={isAdmin ? "work-orders-panel-orders" : undefined}
        aria-labelledby={isAdmin ? "work-orders-tab-orders" : undefined}
      >
      <div className="work-orders-toolbar">
        <ContractListFilter project={project} value={contractFilter} onChange={setContractFilter} />
        <button type="button" className="btn btn-primary" onClick={() => void createWorkOrder()}>
          New EWO
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading work orders…</p>
      ) : !showOrderTable && orders.length === 0 ? (
        <p className="muted">No work orders yet. Create an EWO to enter labor, material, and totals.</p>
      ) : !showOrderTable ? (
        <p className="muted">
          No work orders for{" "}
          {contractFilter === "all" ? "this job" : TRANSMITTAL_CONTRACT_LABELS[contractFilter]}.
        </p>
      ) : (
        <>
          <div className="billing-calc-stat-strip work-orders-summary">
            <div className="billing-calc-stat-tile">
              <span className="billing-calc-stat-label">Total EWOs</span>
              <strong className="billing-calc-stat-value">{summary.count}</strong>
            </div>
            <div className="billing-calc-stat-tile">
              <span className="billing-calc-stat-label">Total amount</span>
              <strong className="billing-calc-stat-value work-orders-stat-ok">
                {formatMoney(summary.totalAmount)}
              </strong>
            </div>
            <div className="billing-calc-stat-tile">
              <span className="billing-calc-stat-label">Not added FSI</span>
              <strong
                className={`billing-calc-stat-value${summary.pendingFsi > 0 ? " work-orders-stat-warn" : ""}`}
              >
                {summary.pendingFsi}
              </strong>
            </div>
          </div>

          <div className="table-wrap work-orders-table-wrap">
            <table className="data-table work-orders-table">
              <thead>
                <tr>
                  <th>EWO #</th>
                  {showContractColumn && <th>Contract</th>}
                  <th>Date</th>
                  <th className="num">Hrs</th>
                  <th className="num">Total</th>
                  <th className="num">Mat</th>
                  <th className="num">Indirects</th>
                  <th className="num">Raw Lab</th>
                  <th className="num">Budget</th>
                  <th className="work-orders-status-col">FSI</th>
                  <th className="work-orders-status-col">Delivered</th>
                  <th>Updated</th>
                  <th className="work-orders-chevron-col" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((o) => (
                  <tr
                    key={o.id}
                    className="work-orders-row"
                    tabIndex={0}
                    role="link"
                    aria-label={`Open EWO ${o.ewo_number}`}
                    onClick={() => openOrder(o.id)}
                    onKeyDown={(e) => onRowKeyDown(e, o.id)}
                  >
                    <td>{o.ewo_number}</td>
                    {showContractColumn && (
                      <td className="muted small">
                        {TRANSMITTAL_CONTRACT_LABELS[o.parsed.contract]}
                      </td>
                    )}
                    <td>{o.ewo_date || "—"}</td>
                    <td className="num">
                      {o.parsed.hours > 0
                        ? o.parsed.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : "—"}
                    </td>
                    <td className="num">{formatMoney(Number(o.total_amount))}</td>
                    <td className="num">{formatMoney(o.budget.material_minus_10)}</td>
                    <td className="num">{formatMoney(o.budget.indirects)}</td>
                    <td className="num">{formatMoney(o.budget.raw_labor)}</td>
                    <td className="num">{formatMoney(o.budget.budget_total)}</td>
                    <td className="work-orders-status-col">
                      <StatusMark on={o.parsed.fsi_checked} label="Added FSI" />
                    </td>
                    <td className="work-orders-status-col">
                      <StatusMark on={o.delivered} label="Delivered" />
                    </td>
                    <td className="work-orders-updated">{formatUpdatedAt(o.updated_at)}</td>
                    <td className="work-orders-chevron-col" aria-hidden="true">
                      <span className="work-orders-chevron">›</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
      )}

      {isAdmin && section === "field" && (
        <div
          className="stack"
          role="tabpanel"
          id="work-orders-panel-field"
          aria-labelledby="work-orders-tab-field"
        >
          {loading ? (
            <p className="muted">Loading work orders…</p>
          ) : (
            <>
          <ExtraWorkSignatureEmails project={project} projectId={projectId} />
          <div>
            <h3>Field tags</h3>
            <p className="muted small field-tag-intro">
              Tags saved from Field Tools. They share this job&apos;s EWO numbers. Enter labor and materials after a tag is signed.
            </p>
          </div>
          {tags.length === 0 ? (
            <p className="muted">No field tags yet.</p>
          ) : (
            <FieldTagList
              tags={tags}
              priceDrafts={priceDrafts}
              setPriceDrafts={setPriceDrafts}
              savingPriceId={savingPriceId}
              savedPriceId={savedPriceId}
              clearSaved={() => setSavedPriceId(null)}
              onSave={(tag) => void savePrice(tag)}
              deletingId={deletingTagId}
              onDelete={(tag) => void deleteTag(tag)}
            />
          )}
            </>
          )}
        </div>
      )}
    </section>
    </div>
  );
}
