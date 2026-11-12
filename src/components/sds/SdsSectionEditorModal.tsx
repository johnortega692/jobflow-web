import { useId, useRef, useState } from "react";
import type { SdsPacketType } from "../../lib/sdsPacketPresets";
import { requiredAttachmentsForSection } from "../../lib/sdsPacketRequirements";
import { parseSdsFilename, removeSdsPdf, uploadSdsPdf } from "../../lib/sdsFileStorage";
import { downloadProductSheet, searchProductSheets, type ProductSheetHit } from "../../lib/productSheetSearch";
import {
  intendedUseHasSelfPriming,
  sanitizeFinishType,
  sectionAttachmentFiles,
  setSelfPrimingNote,
  type SdsAttachmentKind,
} from "../../lib/sdsSectionModel";
import type { SdsSection } from "../../types/tradeDocuments";
import { SpecSectionSelect } from "../submittals/SpecSectionSelect";
import { AttachmentGroup } from "./AttachmentGroup";

const PRIMARY_ATTACHMENTS: { kind: SdsAttachmentKind; label: string }[] = [
  { kind: "product_data", label: "Product Data / TDS" },
  { kind: "sds", label: "SDS" },
];

const OPTIONAL_ATTACHMENTS: { kind: SdsAttachmentKind; label: string; chip: string }[] = [
  { kind: "warranty", label: "Warranty", chip: "Warranty" },
  { kind: "leed_hpd", label: "LEED / HPD / EPD", chip: "LEED / HPD / EPD" },
  { kind: "test_report", label: "Test report", chip: "Test report" },
  { kind: "maintenance", label: "Maintenance data", chip: "Maintenance data" },
];

type Props = {
  mode: "add" | "edit";
  section: SdsSection;
  projectId: string;
  packetType: SdsPacketType;
  showSelfPriming?: boolean;
  onSave: (section: SdsSection) => void;
  onClose: () => void;
};

export function SdsSectionEditorModal({
  mode,
  section: initial,
  projectId,
  packetType,
  showSelfPriming = false,
  onSave,
  onClose,
}: Props) {
  const [section, setSection] = useState<SdsSection>({ ...initial });
  const [uploading, setUploading] = useState<string | null>(null);
  const [openedOptional, setOpenedOptional] = useState<Set<SdsAttachmentKind>>(() => new Set());
  const addInputs = useRef<Partial<Record<SdsAttachmentKind, HTMLInputElement | null>>>({});
  const [finding, setFinding] = useState(false);
  const [sheetHits, setSheetHits] = useState<ProductSheetHit[] | null>(null);
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  const [usingUrl, setUsingUrl] = useState<string | null>(null);
  const [attachedUrls, setAttachedUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const tipId = useId();
  const requiredKinds = new Set(requiredAttachmentsForSection(section, packetType));
  const title = mode === "add" ? "Add section" : "Edit section";

  function patch(patch: Partial<SdsSection>) {
    setSection((s) => ({ ...s, ...patch }));
  }

  function kindBusy(kind: SdsAttachmentKind): boolean {
    return uploading?.startsWith(`${kind}|`) ?? false;
  }

  function kindReplacingIndex(kind: SdsAttachmentKind): number | null {
    if (!uploading?.startsWith(`${kind}|`)) return null;
    const rest = uploading.slice(kind.length + 1);
    if (rest === "add") return null;
    const index = Number(rest);
    return Number.isInteger(index) ? index : null;
  }

  async function addFiles(kind: SdsAttachmentKind, incoming: File[], applyName: boolean) {
    const pdfs = incoming.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return false;
    const existing = sectionAttachmentFiles(section, kind);
    setUploading(`${kind}|add`);
    setError(null);
    const uploaded: { path: string; filename: string }[] = [];
    try {
      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i]!;
        const storagePath =
          existing.length + i === 0 ? undefined : `${projectId}/${section.id}/${kind}-${crypto.randomUUID()}.pdf`;
        uploaded.push(await uploadSdsPdf(projectId, section.id, kind, file, storagePath));
      }
      const fillNames =
        applyName &&
        existing.length === 0 &&
        !section.manufacturer.trim() &&
        !section.product.trim();
      const meta = fillNames ? parseSdsFilename(pdfs[0]!.name) : null;
      setSection({
        ...section,
        attachments: { ...section.attachments, [kind]: [...existing, ...uploaded] },
        ...(meta?.manufacturer ? { manufacturer: meta.manufacturer } : {}),
        ...(meta?.product ? { product: meta.product } : {}),
        ...(meta?.finish_type ? { finish_type: meta.finish_type } : {}),
      });
    } catch (e) {
      if (uploaded.length) {
        setSection({
          ...section,
          attachments: { ...section.attachments, [kind]: [...existing, ...uploaded] },
        });
      }
      setError(e instanceof Error ? e.message : "Upload failed");
      return false;
    } finally {
      setUploading(null);
    }
    return true;
  }

  async function replaceFile(kind: SdsAttachmentKind, index: number, file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) return false;
    const files = sectionAttachmentFiles(section, kind);
    const existing = files[index];
    if (!existing) return false;
    setUploading(`${kind}|${index}`);
    setError(null);
    try {
      const uploaded = await uploadSdsPdf(projectId, section.id, kind, file, existing.path);
      const nextFiles = [...files];
      nextFiles[index] = uploaded;
      setSection({
        ...section,
        attachments: { ...section.attachments, [kind]: nextFiles },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      return false;
    } finally {
      setUploading(null);
    }
    return true;
  }

  async function removeFile(kind: SdsAttachmentKind, index: number) {
    const files = sectionAttachmentFiles(section, kind);
    const target = files[index];
    if (!target) return;
    try {
      if (target.path) await removeSdsPdf(target.path);
    } catch {
      /* ignore */
    }
    const next = files.filter((_, fileIndex) => fileIndex !== index);
    const attachments = { ...section.attachments };
    if (next.length) attachments[kind] = next;
    else delete attachments[kind];
    patch({ attachments });
    if (!next.length) {
      setOpenedOptional((open) => {
        if (!open.has(kind)) return open;
        const copy = new Set(open);
        copy.delete(kind);
        return copy;
      });
    }
  }

  function openOptional(kind: SdsAttachmentKind) {
    setOpenedOptional((open) => {
      if (open.has(kind)) return open;
      const copy = new Set(open);
      copy.add(kind);
      return copy;
    });
    addInputs.current[kind]?.click();
  }

  const canSearch = Boolean(section.manufacturer.trim() || section.product.trim());

  async function findSheets() {
    if (!canSearch || finding || usingUrl) return;
    setFinding(true);
    setError(null);
    setSheetNote(null);
    setSheetHits(null);
    setAttachedUrls([]);
    try {
      const results = await searchProductSheets({
        manufacturer: section.manufacturer,
        product: section.product,
        finish: section.finish_type,
        color: section.color,
      });
      setSheetHits(results);
      setSheetNote(
        results.length
          ? "Confirm the sheet matches this product before attaching it."
          : "No downloadable PDF turned up. Upload the file in a slot below.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI search failed");
    } finally {
      setFinding(false);
    }
  }

  async function useSheet(hit: ProductSheetHit) {
    if (usingUrl || attachedUrls.includes(hit.url)) return;
    setUsingUrl(hit.url);
    setError(null);
    try {
      const file = await downloadProductSheet(hit);
      const attached = await addFiles(hit.kind, [file], false);
      if (attached) setAttachedUrls((urls) => [...urls, hit.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach that PDF.");
    } finally {
      setUsingUrl(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card sds-section-editor"
        role="dialog"
        aria-labelledby="sds-section-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sds-section-editor-header">
          <div className="sds-section-editor-header-row">
            <h3 id="sds-section-editor-title">{title}</h3>
            <div className="sds-section-editor-packet-meta">
              <span className="muted small sds-section-editor-packet-type">{packetType}</span>
              <div className="sds-filename-tip">
                <button
                  type="button"
                  className="sds-filename-tip-btn"
                  aria-label="File naming convention"
                  aria-expanded={tipOpen}
                  aria-controls={tipId}
                  onClick={() => setTipOpen((open) => !open)}
                >
                  ⓘ
                </button>
                {tipOpen && (
                  <div id={tipId} className="sds-filename-tip-popover" role="note">
                    Name files like{" "}
                    <code>PPG - Speedhide - Eggshell.pdf</code> or{" "}
                    <code>PPG - Speedhide - Eggshell - SDS.pdf</code> — the finish field stays{" "}
                    <strong>Eggshell</strong> (attachment type comes from the slot you use).
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="muted small sds-section-editor-intro">
            Attach one or more PDFs per type. Drop them on a card or use Add file.
          </p>
        </header>

        <div className="sds-section-editor-body stack">
          {error && <div className="banner banner-error">{error}</div>}
          <div className="grid-2">
            <label className="grid-span-2">
              Spec section
              <SpecSectionSelect
                value={section.spec_section}
                onChange={(spec_section) => patch({ spec_section })}
              />
            </label>
            <label>
              Manufacturer
              <input
                value={section.manufacturer}
                onChange={(e) => patch({ manufacturer: e.target.value })}
              />
            </label>
            <label>
              Product
              <input value={section.product} onChange={(e) => patch({ product: e.target.value })} />
            </label>
            <label>
              Finish / Type
              <input
                value={section.finish_type}
                onChange={(e) => patch({ finish_type: e.target.value })}
                placeholder="Eggshell, Type II Vinyl, Class A…"
              />
            </label>
            <label>
              System / Material
              <input
                value={section.system_material}
                onChange={(e) => patch({ system_material: e.target.value })}
                placeholder="Interior Paint, Vinyl Wallcovering…"
              />
            </label>
            <label>
              Color / Pattern / Finish
              <input value={section.color} onChange={(e) => patch({ color: e.target.value })} />
            </label>
            {section.category === "Wallcovering" ? (
              <label>
                Size
                <input
                  value={section.size}
                  onChange={(e) => patch({ size: e.target.value })}
                  placeholder={'54"'}
                />
              </label>
            ) : null}
            <label className="grid-span-2">
              Notes / intended use
              <textarea
                className="sds-notes-input"
                value={section.intended_use}
                onChange={(e) => patch({ intended_use: e.target.value })}
                rows={4}
                placeholder="Optional — press Enter for a new line. TDS/SDS attachments are listed separately."
              />
            </label>
            {showSelfPriming ? (
              <label className="check sds-self-prime">
                <input
                  type="checkbox"
                  checked={intendedUseHasSelfPriming(section.intended_use)}
                  onChange={(event) =>
                    patch({ intended_use: setSelfPrimingNote(section.intended_use, event.target.checked) })
                  }
                />
                Self-priming
              </label>
            ) : null}
          </div>

          <div className="stack sds-attachments-block">
            <div className="sds-attachments-head">
              <h4 className="sds-attachments-heading">Attachments</h4>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={!canSearch || finding || Boolean(usingUrl)}
                title={canSearch ? "Search for this product’s PDS and SDS" : "Enter a manufacturer or product first."}
                onClick={() => void findSheets()}
              >
                {finding ? "Searching…" : "Find PDS / SDS"}
              </button>
            </div>
            {sheetNote ? <p className="muted small sds-sheet-note">{sheetNote}</p> : null}
            {sheetHits && sheetHits.length > 0 ? (
              <ul className="sds-sheet-results">
                {sheetHits.map((hit) => {
                  const attached = attachedUrls.includes(hit.url);
                  return (
                    <li key={hit.url} className="sds-sheet-result">
                      <div className="sds-sheet-result-copy">
                        <strong>{hit.kind === "sds" ? "SDS" : "Product Data"}</strong>
                        <span>{hit.title}</span>
                        <a href={hit.url} target="_blank" rel="noreferrer">
                          {hit.source || hit.url}
                        </a>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={attached || usingUrl === hit.url || Boolean(uploading)}
                        onClick={() => void useSheet(hit)}
                      >
                        {attached ? "Attached" : usingUrl === hit.url ? "Attaching…" : "Use this"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="sds-attachment-stack">
              {PRIMARY_ATTACHMENTS.map(({ kind, label }) => (
                <AttachmentGroup
                  key={kind}
                  label={label}
                  files={sectionAttachmentFiles(section, kind)}
                  required={requiredKinds.has(kind)}
                  busy={kindBusy(kind)}
                  replacingIndex={kindReplacingIndex(kind)}
                  onAdd={(files) => void addFiles(kind, files, true)}
                  onReplace={(index, file) => void replaceFile(kind, index, file)}
                  onRemove={(index) => void removeFile(kind, index)}
                />
              ))}
              <div className="sds-other-docs">
                <p className="sds-other-docs-label">Other documents</p>
                {OPTIONAL_ATTACHMENTS.filter(
                  ({ kind }) => sectionAttachmentFiles(section, kind).length > 0 || openedOptional.has(kind),
                ).map(({ kind, label }) => (
                  <AttachmentGroup
                    key={kind}
                    label={label}
                    files={sectionAttachmentFiles(section, kind)}
                    required={requiredKinds.has(kind)}
                    busy={kindBusy(kind)}
                    replacingIndex={kindReplacingIndex(kind)}
                    onAdd={(files) => void addFiles(kind, files, true)}
                    onReplace={(index, file) => void replaceFile(kind, index, file)}
                    onRemove={(index) => void removeFile(kind, index)}
                  />
                ))}
                {OPTIONAL_ATTACHMENTS.map(({ kind }) => (
                  <input
                    key={`${kind}-pick`}
                    ref={(node) => {
                      addInputs.current[kind] = node;
                    }}
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const picked = [...(event.target.files ?? [])];
                      event.target.value = "";
                      if (picked.length) void addFiles(kind, picked, true);
                    }}
                  />
                ))}
                {OPTIONAL_ATTACHMENTS.some(
                  ({ kind }) => sectionAttachmentFiles(section, kind).length === 0 && !openedOptional.has(kind),
                ) ? (
                  <div className="sds-attachment-chips">
                    {OPTIONAL_ATTACHMENTS.filter(
                      ({ kind }) => sectionAttachmentFiles(section, kind).length === 0 && !openedOptional.has(kind),
                    ).map(({ kind, chip }) => (
                      <button
                        key={kind}
                        type="button"
                        className="sds-attachment-chip"
                        onClick={() => openOptional(kind)}
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="sds-section-editor-footer">
          <span className="sds-section-editor-footer-status" aria-live="polite" />
          <div className="row-gap wrap sds-section-editor-footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                onSave({
                  ...section,
                  finish_type: sanitizeFinishType(section.finish_type),
                })
              }
            >
              Save section
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
