import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { patchUserSettings, loadRawUserSettings } from "../../lib/budgetLibrary";
import { commitProjectUpdate } from "../../lib/projectActivity";
import { projectFilenamePart } from "../../lib/pdfFilenames";
import {
  SAMPLE_LABEL_HEIGHT,
  SAMPLE_LABEL_LANDSCAPE_HEIGHT,
  SAMPLE_LABEL_LANDSCAPE_WIDTH,
  SAMPLE_LABEL_WIDTH,
  formatSampleLabelSubmittal,
  sampleLabelInputForPrint,
  sampleLabelQrForItem,
  type SampleLabelOrientation,
  type SampleLabelPrintShow,
  type SampleLabelQrKind,
} from "../../lib/sampleLabelContent";
import { downloadSampleLabelsPdf, downloadSampleLabelsZip, uniqueSampleLabelStem } from "../../lib/sampleLabelExport";
import {
  SAMPLE_LABEL_PRINT_KEY,
  defaultSampleLabelPrintPrefs,
  normalizeSampleLabelPrintPrefs,
  type SampleLabelMedia,
  type SampleLabelPrintPrefs,
} from "../../lib/sampleLabelPrefs";
import { renderSampleLabel, renderSheetLabel } from "../../lib/sampleLabelRender";
import { downloadSheetLabelsPdf } from "../../lib/sheetLabelExport";
import { DEFAULT_SHEET_LABEL_TEMPLATE, SHEET_LABEL_TEMPLATES, layoutSheetPages, sheetLabelTemplateById } from "../../lib/sheetLabelTemplate";
import { wcContentItems } from "../../lib/wcItemLabels";
import type { ProjectForm } from "../../types/database";
import {
  leadSpecSection,
  wcDualSpecEnabled,
  wcItemSpecScope,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../../types/tradeDocuments";

const SHOW_FIELDS: { key: keyof SampleLabelPrintShow; label: string }[] = [
  { key: "logo", label: "Logo" },
  { key: "project", label: "Project name" },
  { key: "submittal", label: "Submittal # / Rev" },
  { key: "spec", label: "Spec section" },
  { key: "date", label: "Date" },
  { key: "addressPhone", label: "Address & phone" },
  { key: "license", label: "License #" },
];

const QR_MODES: { value: SampleLabelQrKind; label: string }[] = [
  { value: "share", label: "Project share folder" },
  { value: "product", label: "Product page" },
  { value: "website", label: "Company website" },
  { value: "none", label: "None" },
];
const PORTRAIT_PREVIEW_W = SAMPLE_LABEL_WIDTH / 2;
const PORTRAIT_PREVIEW_H = SAMPLE_LABEL_HEIGHT / 2;
const LANDSCAPE_PREVIEW_W = SAMPLE_LABEL_LANDSCAPE_WIDTH / 2;
const LANDSCAPE_PREVIEW_H = SAMPLE_LABEL_LANDSCAPE_HEIGHT / 2;

type Props = {
  userId: string | undefined;
  project: ProjectForm;
  projectId: string;
  setProject: (project: ProjectForm) => void;
  draft: WallcoveringSubmittalData;
  projectName: string;
  jobNumber: string;
  onClose: () => void;
};

function labelItems(draft: WallcoveringSubmittalData): WallcoveringItem[] {
  const content = wcContentItems(draft.items);
  if (!wcDualSpecEnabled(draft)) return content;
  return [
    ...content.filter((item) => wcItemSpecScope(item) === "primary"),
    ...content.filter((item) => wcItemSpecScope(item) === "secondary"),
  ];
}

function specForItem(draft: WallcoveringSubmittalData, item: WallcoveringItem): string {
  if (wcDualSpecEnabled(draft) && wcItemSpecScope(item) === "secondary") {
    return (draft.spec_sections?.[1] ?? "").trim();
  }
  return leadSpecSection(draft).trim();
}

function itemTitle(item: WallcoveringItem): string {
  return item.label.trim() || "Untitled";
}

function itemDetail(item: WallcoveringItem): string {
  return [item.manufacturer, item.product, item.color].map((part) => part.trim()).filter(Boolean).join(" · ");
}

function withShareUrl(project: ProjectForm, url: string): ProjectForm {
  const jobInfo = { ...project.jobInfo, sample_share_url: url };
  const data =
    project.data && typeof project.data === "object" && !Array.isArray(project.data)
      ? { ...(project.data as Record<string, unknown>), job_info: jobInfo }
      : project.data;
  return { ...project, jobInfo, data: data as ProjectForm["data"] };
}

export function PrintSampleLabelsDialog({
  userId,
  project,
  projectId,
  setProject,
  draft,
  projectName,
  jobNumber,
  onClose,
}: Props) {
  const { settings: letterhead } = useLetterhead();
  const titleId = useId();
  const items = useMemo(() => labelItems(draft), [draft]);
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => true));
  const [copies, setCopies] = useState<number[]>(() => items.map(() => 1));
  const [qrMode, setQrMode] = useState<SampleLabelQrKind>("product");
  const [shareUrl, setShareUrl] = useState(project.jobInfo.sample_share_url);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<SampleLabelPrintPrefs>(defaultSampleLabelPrintPrefs);
  const [prefsReady, setPrefsReady] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sheetUrls, setSheetUrls] = useState<string[]>([]);
  const [sheetStart, setSheetStart] = useState(1);
  const [sheetPage, setSheetPage] = useState(0);
  const [busy, setBusy] = useState<"pdf" | "zip" | "test" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const prefsTouched = useRef(false);
  const prefsSaved = useRef("");
  const projectRef = useRef(project);
  const saveQueue = useRef(Promise.resolve());
  const saveSeq = useRef(0);
  projectRef.current = project;

  const selected = useMemo(
    () =>
      items
        .map((item, index) => ({ item, index }))
        .filter((row) => checked[row.index]),
    [items, checked],
  );

  const sheetMode = prefs.media === "sheet";
  const [templateId, setTemplateId] = useState(DEFAULT_SHEET_LABEL_TEMPLATE.id);
  const sheetTemplate = useMemo(() => sheetLabelTemplateById(templateId), [templateId]);
  const labelCount = selected.reduce((sum, row) => sum + (copies[row.index] ?? 1), 0);
  const selectedCount = selected.length;
  const sheetPages = useMemo(
    () => layoutSheetPages(sheetTemplate, labelCount, sheetStart),
    [labelCount, sheetStart, sheetTemplate],
  );
  const missingProduct = selected.filter((row) => !row.item.product_page_url.trim());

  useEffect(() => {
    setPreviewIndex((index) => {
      if (selected.length === 0) return 0;
      return Math.min(index, selected.length - 1);
    });
  }, [selected.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!userId) {
      setPrefsReady(true);
      return;
    }
    let cancel = false;
    void loadRawUserSettings(userId)
      .then((raw) => {
        if (cancel || prefsTouched.current) return;
        const next = normalizeSampleLabelPrintPrefs(raw[SAMPLE_LABEL_PRINT_KEY]);
        prefsSaved.current = JSON.stringify(next);
        setPrefs(next);
        setPrefsReady(true);
      })
      .catch(() => {
        if (!cancel) setPrefsReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !prefsReady) return;
    const json = JSON.stringify(prefs);
    if (json === prefsSaved.current) return;
    const timer = window.setTimeout(() => {
      prefsSaved.current = json;
      void patchUserSettings(userId, { [SAMPLE_LABEL_PRINT_KEY]: prefs });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [prefs, prefsReady, userId]);

  const saveShare = useCallback(
    (url: string) => {
      const seq = ++saveSeq.current;
      saveQueue.current = saveQueue.current.then(async () => {
        if (seq !== saveSeq.current) return;
        const current = projectRef.current;
        const trimmed = url.trim();
        if (trimmed === current.jobInfo.sample_share_url.trim()) return;
        setShareStatus("Saving…");
        const jobInfo = { ...current.jobInfo, sample_share_url: trimmed };
        const err = await commitProjectUpdate({
          projectId,
          mergeData: { job_info: jobInfo },
          activity: { action: "job_info_saved", summary: "Sample share link updated" },
        });
        if (seq !== saveSeq.current) return;
        if (err) {
          setShareStatus(err);
          return;
        }
        const next = withShareUrl(current, trimmed);
        projectRef.current = next;
        setProject(next);
        setShareStatus("Saved");
      });
    },
    [projectId, setProject],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => saveShare(shareUrl), 400);
    return () => window.clearTimeout(timer);
  }, [saveShare, shareUrl]);

  function qrFor(item: WallcoveringItem) {
    return sampleLabelQrForItem({
      mode: qrMode,
      productPageUrl: item.product_page_url,
      shareUrl,
      websiteUrl: prefs.companyWebsiteUrl,
    });
  }

  const previewInput = useMemo(() => {
    const row = selected[previewIndex];
    if (!row) return null;
    const qr = sampleLabelQrForItem({
      mode: qrMode,
      productPageUrl: row.item.product_page_url,
      shareUrl,
      websiteUrl: prefs.companyWebsiteUrl,
    });
    return sampleLabelInputForPrint({
      letterhead,
      projectName,
      item: row.item,
      submittal: draft,
      spec: specForItem(draft, row.item),
      qrKind: qr.kind,
      qrUrl: qr.url,
      show: prefs,
      orientation: prefs.orientation,
      bandText: prefs.bandText,
    });
  }, [draft, letterhead, prefs, previewIndex, projectName, qrMode, selected, shareUrl]);

  const sheetInputs = useMemo(() => {
    if (!sheetMode) return [];
    return selected.flatMap((row) => {
      const qr = sampleLabelQrForItem({
        mode: qrMode,
        productPageUrl: row.item.product_page_url,
        shareUrl,
        websiteUrl: prefs.companyWebsiteUrl,
      });
      const input = sampleLabelInputForPrint({
        letterhead,
        projectName,
        item: row.item,
        submittal: draft,
        spec: specForItem(draft, row.item),
        qrKind: qr.kind,
        qrUrl: qr.url,
        show: prefs,
        orientation: "landscape",
        bandText: prefs.bandText,
        colorLogo: true,
      });
      return Array.from({ length: copies[row.index] ?? 1 }, () => input);
    });
  }, [copies, draft, letterhead, prefs, projectName, qrMode, selected, shareUrl, sheetMode]);

  useEffect(() => {
    setSheetPage((page) => Math.min(page, Math.max(0, sheetPages.length - 1)));
  }, [sheetPages.length]);

  useEffect(() => {
    if (!sheetMode) return;
    let cancel = false;
    void Promise.all(
      sheetInputs.map((input) =>
        renderSheetLabel(input)
          .then((canvas) => canvas.toDataURL("image/png"))
          .catch(() => ""),
      ),
    ).then((urls) => {
      if (!cancel) setSheetUrls(urls);
    });
    return () => {
      cancel = true;
    };
  }, [sheetInputs, sheetMode]);

  useEffect(() => {
    if (sheetMode || !previewInput) {
      if (!sheetMode) setPreviewUrl("");
      return;
    }
    let cancel = false;
    void renderSampleLabel(previewInput)
      .then((canvas) => {
        if (!cancel) setPreviewUrl(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        if (!cancel) setPreviewUrl("");
      });
    return () => {
      cancel = true;
    };
  }, [previewInput, sheetMode]);

  function setFlag(key: keyof SampleLabelPrintShow, value: boolean) {
    prefsTouched.current = true;
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  function setOrientation(next: SampleLabelOrientation) {
    prefsTouched.current = true;
    setPrefs((prev) => ({ ...prev, orientation: next }));
  }

  function setMedia(next: SampleLabelMedia) {
    prefsTouched.current = true;
    setPrefs((prev) => ({ ...prev, media: next }));
  }

  function setCopy(index: number, delta: number) {
    setCopies((prev) => {
      const next = items.map((_, itemIndex) => prev[itemIndex] ?? 1);
      next[index] = Math.min(99, Math.max(1, (next[index] ?? 1) + delta));
      return next;
    });
  }

  function addProductUrls() {
    const item = items.find((row) => !row.product_page_url.trim());
    const index = item ? draft.items.indexOf(item) : -1;
    onClose();
    if (index < 0) return;
    window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`.wc-item-block[data-index="${index}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      const toggle = row.querySelector<HTMLButtonElement>(".wc-product-url-toggle");
      if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
      window.setTimeout(() => {
        row.querySelector<HTMLInputElement>('input[type="url"]')?.focus();
      }, 0);
    }, 0);
  }

  function filesForDownload() {
    const used = new Set<string>();
    return selected.map((row) => {
      const qr = qrFor(row.item);
      return {
      input: sampleLabelInputForPrint({
        letterhead,
        projectName,
        item: row.item,
        submittal: draft,
        spec: specForItem(draft, row.item),
        qrKind: qr.kind,
        qrUrl: qr.url,
        show: prefs,
        orientation: prefs.orientation,
        bandText: prefs.bandText,
      }),
      copies: copies[row.index] ?? 1,
      stem: uniqueSampleLabelStem(itemTitle(row.item), row.index, used),
    };
    });
  }

  async function onDownloadPdf() {
    if (!selected.length || busy) return;
    setBusy("pdf");
    setDownloadError(null);
    try {
      const name = `${projectFilenamePart(projectName, jobNumber, "Project")}_Sample_Labels.pdf`;
      await downloadSampleLabelsPdf(filesForDownload(), name);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function onDownloadSheet(outlines: boolean) {
    if (!sheetInputs.length || busy) return;
    setBusy(outlines ? "test" : "pdf");
    setDownloadError(null);
    try {
      const suffix = outlines ? "Sample_Label_Test" : "Sample_Labels";
      const name = `${projectFilenamePart(projectName, jobNumber, "Project")}_${suffix}.pdf`;
      await downloadSheetLabelsPdf(
        { inputs: sheetInputs, template: sheetTemplate, startAt: sheetStart, outlines },
        name,
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not build the sheet PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function onDownloadZip() {
    if (!selected.length || busy) return;
    setBusy("zip");
    setDownloadError(null);
    try {
      const name = `${projectFilenamePart(projectName, jobNumber, "Project")}_Sample_Labels.zip`;
      await downloadSampleLabelsZip(filesForDownload(), name);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not build the PNG zip.");
    } finally {
      setBusy(null);
    }
  }

  const previewRow = selected[previewIndex] ?? null;
  const pageSlots = sheetPages[sheetPage] ?? [];
  const spotsLeft = pageSlots.filter((slot) => slot.kind === "empty").length;
  const previewW = prefs.orientation === "landscape" ? LANDSCAPE_PREVIEW_W : PORTRAIT_PREVIEW_W;
  const previewH = prefs.orientation === "landscape" ? LANDSCAPE_PREVIEW_H : PORTRAIT_PREVIEW_H;
  const shareProblem = Boolean(shareStatus && shareStatus !== "Saving…" && shareStatus !== "Saved");
  const submittalLine = formatSampleLabelSubmittal(draft.submittal_number, draft.revision_number);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card wc-print-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wc-print-head">
          <div>
            <h3 id={titleId}>Print sample labels</h3>
            <p className="wc-print-sub">Submittal {submittalLine}</p>
          </div>
          <div className="wc-print-head-tools">
            <div className="wc-print-segment" role="radiogroup" aria-label="Print on">
              <button
                type="button"
                role="radio"
                aria-checked={!sheetMode}
                className={sheetMode ? "" : "is-on"}
                onClick={() => setMedia("niimbot")}
              >
                NIIMBOT B1 · 50 x 80
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={sheetMode}
                className={sheetMode ? "is-on" : ""}
                onClick={() => setMedia("sheet")}
              >
                Sheet labels · 2&quot; x 4&quot;
              </button>
            </div>
            <button type="button" className="wc-print-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div className="wc-print-body">
          <div className="wc-print-controls">
            <div className="wc-print-items">
              <div className="wc-print-kicker-row">
                <p className="wc-print-kicker">Items · {selectedCount} selected</p>
                <button
                  type="button"
                  className="wc-print-select-all"
                  disabled={items.length === 0}
                  onClick={() => setChecked(items.map(() => true))}
                >
                  Select all
                </button>
              </div>
              {items.length === 0 ? (
                <p className="muted small">No wallcovering items to print.</p>
              ) : (
                <ul className={`wc-print-item-list${items.length > 8 ? " is-scroll" : ""}`}>
                  {items.map((item, index) => {
                    const missing = qrMode === "product" && !item.product_page_url.trim();
                    const detail = itemDetail(item);
                    const count = copies[index] ?? 1;
                    return (
                      <li key={index} className={`wc-print-item${checked[index] ? " is-on" : ""}`}>
                        <label className="wc-print-item-main">
                          <input
                            type="checkbox"
                            checked={Boolean(checked[index])}
                            onChange={(event) =>
                              setChecked((prev) => {
                                const next = [...prev];
                                next[index] = event.target.checked;
                                return next;
                              })
                            }
                          />
                          <span className="wc-print-code">{itemTitle(item)}</span>
                          <span className="wc-print-item-detail">{detail}</span>
                        </label>
                        {missing ? (
                          <span
                            className="wc-print-url-warn"
                            title="No product page URL"
                            role="img"
                            aria-label="No product page URL"
                          >
                            ⚠
                          </span>
                        ) : null}
                        <div className="wc-print-stepper">
                          <button
                            type="button"
                            aria-label={`Fewer copies of ${itemTitle(item)}`}
                            disabled={count <= 1}
                            onClick={() => setCopy(index, -1)}
                          >
                            −
                          </button>
                          <span>{count}</span>
                          <button
                            type="button"
                            aria-label={`More copies of ${itemTitle(item)}`}
                            disabled={count >= 99}
                            onClick={() => setCopy(index, 1)}
                          >
                            +
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="wc-print-split">
              <div className="wc-print-qr">
                <p className="wc-print-kicker">QR code links to</p>
                <select
                  aria-label="QR code links to"
                  value={qrMode}
                  onChange={(event) => setQrMode(event.target.value as SampleLabelQrKind)}
                >
                  {QR_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                {qrMode === "share" && (
                  <div className="wc-print-option-extra">
                    <input
                      type="url"
                      value={shareUrl}
                      placeholder="Paste the share folder link (saved to this project)"
                      aria-label="Project share folder link"
                      onChange={(event) => {
                        setShareStatus(null);
                        setShareUrl(event.target.value);
                      }}
                      onBlur={() => saveShare(shareUrl)}
                    />
                    {shareStatus && <p className={shareProblem ? "wc-print-warn" : "muted small"}>{shareStatus}</p>}
                  </div>
                )}
                {qrMode === "product" && missingProduct.length > 0 && (
                  <p className="wc-print-warn">
                    {missingProduct.length === 1
                      ? "1 item has no product page URL and will print without a QR."
                      : `${missingProduct.length} items have no product page URL and will print without a QR.`}{" "}
                    <button type="button" className="wc-print-add-urls" onClick={addProductUrls}>
                      Add URLs
                    </button>
                  </p>
                )}
                {qrMode === "website" && (
                  <div className="wc-print-option-extra">
                    <input
                      type="url"
                      value={prefs.companyWebsiteUrl}
                      placeholder="https://"
                      aria-label="Company website URL"
                      onChange={(event) => {
                        prefsTouched.current = true;
                        setPrefs((prev) => ({ ...prev, companyWebsiteUrl: event.target.value }));
                      }}
                    />
                    {!prefs.companyWebsiteUrl.trim() && (
                      <p className="wc-print-warn">Enter a website URL to print a QR code.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="wc-print-heading">
                <p className="wc-print-kicker">Heading</p>
                <input
                  type="text"
                  value={prefs.bandText}
                  aria-label="Heading"
                  placeholder="Wallcovering Sample"
                  onChange={(event) => {
                    prefsTouched.current = true;
                    setPrefs((prev) => ({ ...prev, bandText: event.target.value }));
                  }}
                />
              </div>
            </div>

            <div className="wc-print-show">
              <p className="wc-print-kicker">Show on label</p>
              <div className="wc-print-toggles">
                {SHOW_FIELDS.map((field) => (
                  <label key={field.key} className="check">
                    <input
                      type="checkbox"
                      checked={prefs[field.key]}
                      onChange={(event) => setFlag(field.key, event.target.checked)}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            </div>

            {sheetMode ? (
              SHEET_LABEL_TEMPLATES.length > 1 ? (
                <label className="wc-print-template">
                  <span className="wc-print-kicker">Template</span>
                  <select
                    aria-label="Template"
                    value={sheetTemplate.id}
                    onChange={(event) => setTemplateId(event.target.value)}
                  >
                    {SHEET_LABEL_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="wc-print-template-line">
                  Template: {sheetTemplate.name} · {sheetTemplate.columns * sheetTemplate.rows} per Letter sheet
                </p>
              )
            ) : (
              <div className="wc-print-orient">
                <p className="wc-print-kicker">Orientation</p>
                <div className="wc-print-pills" role="radiogroup" aria-label="Orientation">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={prefs.orientation === "portrait"}
                    className={prefs.orientation === "portrait" ? "is-on" : ""}
                    onClick={() => setOrientation("portrait")}
                  >
                    <span className="wc-print-shape wc-print-shape-portrait" aria-hidden="true" />
                    Portrait 50 x 80
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={prefs.orientation === "landscape"}
                    className={prefs.orientation === "landscape" ? "is-on" : ""}
                    onClick={() => setOrientation("landscape")}
                  >
                    <span className="wc-print-shape wc-print-shape-landscape" aria-hidden="true" />
                    Landscape 80 x 50
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="wc-print-preview">
            {sheetMode ? (
              <>
                <div className="wc-print-preview-head">
                  <p className="wc-print-kicker">
                    Sheet {sheetPage + 1} of {sheetPages.length}
                  </p>
                  {sheetPages.length > 1 && (
                    <div className="wc-print-nav">
                      <button
                        type="button"
                        disabled={sheetPage <= 0}
                        onClick={() => setSheetPage((page) => Math.max(0, page - 1))}
                      >
                        &lt; Prev
                      </button>
                      <button
                        type="button"
                        disabled={sheetPage >= sheetPages.length - 1}
                        onClick={() => setSheetPage((page) => Math.min(sheetPages.length - 1, page + 1))}
                      >
                        Next &gt;
                      </button>
                    </div>
                  )}
                </div>
                {sheetPage === 0 && <p className="wc-print-hint">Click a spot to start there</p>}
                <div className="wc-sheet-page" aria-label="Sheet preview">
                  {(sheetPages[sheetPage] ?? []).map((slot) => {
                    const url =
                      slot.kind === "label" && slot.labelIndex !== undefined ? sheetUrls[slot.labelIndex] : "";
                    const clickable = sheetPage === 0 && slot.kind !== "label";
                    return (
                      <button
                        key={slot.index}
                        type="button"
                        className={`wc-sheet-cell${slot.kind === "used" ? " is-used" : ""}${clickable ? " is-spot" : ""}`}
                        aria-label={
                          clickable
                            ? `Start at spot ${slot.index + 1}`
                            : slot.kind === "used"
                              ? `Used spot ${slot.index + 1}`
                              : slot.kind === "label"
                                ? `Label spot ${slot.index + 1}`
                                : `Empty spot ${slot.index + 1}`
                        }
                        style={{
                          left: `${(slot.xIn / sheetTemplate.pageWidthIn) * 100}%`,
                          top: `${(slot.yIn / sheetTemplate.pageHeightIn) * 100}%`,
                          width: `${(sheetTemplate.labelWidthIn / sheetTemplate.pageWidthIn) * 100}%`,
                          height: `${(sheetTemplate.labelHeightIn / sheetTemplate.pageHeightIn) * 100}%`,
                        }}
                        onClick={() => {
                          if (clickable) setSheetStart(slot.index + 1);
                        }}
                      >
                        {url ? (
                          <img src={url} alt="" />
                        ) : slot.kind === "used" ? (
                          <span>Used</span>
                        ) : slot.kind === "label" ? (
                          <span>…</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <p className="wc-print-sheet-caption">
                  Starts at spot {sheetStart} · {labelCount} {labelCount === 1 ? "label" : "labels"} · {spotsLeft}{" "}
                  {spotsLeft === 1 ? "spot" : "spots"} left on sheet
                </p>
              </>
            ) : (
              <>
                <p className="wc-print-kicker">
                  Preview
                  {previewRow ? ` · ${itemTitle(previewRow.item)} of ${selected.length}` : ""}
                </p>
                {previewRow && previewUrl ? (
                  <img
                    src={previewUrl}
                    width={previewW}
                    height={previewH}
                    alt={`Sample label preview for ${itemTitle(previewRow.item)}`}
                  />
                ) : (
                  <div className="wc-print-preview-empty" style={{ width: previewW, height: previewH }}>
                    {previewRow ? "Rendering…" : "Select an item to preview."}
                  </div>
                )}
                <div className="wc-print-nav">
                  <button
                    type="button"
                    disabled={!previewRow || previewIndex <= 0}
                    onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}
                  >
                    &lt; Prev
                  </button>
                  <button
                    type="button"
                    disabled={!previewRow || previewIndex >= selected.length - 1}
                    onClick={() => setPreviewIndex((index) => Math.min(selected.length - 1, index + 1))}
                  >
                    Next &gt;
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>

        {downloadError && <p className="wc-print-warn">{downloadError}</p>}

        <div className="wc-print-footer">
          <p className="muted small">
            {sheetMode
              ? "Print at 100% / Actual size. Turn off Fit to page."
              : "Open in the NIIMBOT desktop app, pick 50 x 80, print"}
          </p>
          <div className="wc-print-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {sheetMode ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={selected.length === 0 || busy !== null}
                  onClick={() => void onDownloadSheet(true)}
                >
                  {busy === "test" ? "Preparing test…" : "Print test on plain paper"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={selected.length === 0 || busy !== null}
                  onClick={() => void onDownloadSheet(false)}
                >
                  {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={selected.length === 0 || busy !== null}
                  onClick={() => void onDownloadZip()}
                >
                  {busy === "zip" ? "Preparing PNGs…" : "Download PNGs (.zip)"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={selected.length === 0 || busy !== null}
                  onClick={() => void onDownloadPdf()}
                >
                  {busy === "pdf" ? "Preparing PDF…" : "Download PDF (one label per page)"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
