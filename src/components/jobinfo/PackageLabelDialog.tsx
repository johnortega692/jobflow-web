import { useEffect, useMemo, useState } from "react";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { wcTrackerJobName, wcTrackerJobNumber } from "../../lib/jobInfo";
import {
  materialPackageUrl,
  packageLabelCopies,
  packageLabelInput,
  packageLabelMark,
} from "../../lib/materialPackageLabel";
import {
  SAMPLE_LABEL_HEIGHT,
  SAMPLE_LABEL_LANDSCAPE_HEIGHT,
  SAMPLE_LABEL_LANDSCAPE_WIDTH,
  SAMPLE_LABEL_WIDTH,
  type SampleLabelOrientation,
} from "../../lib/sampleLabelContent";
import { downloadSampleLabelsPdf, downloadSampleLabelsZip } from "../../lib/sampleLabelExport";
import type { SampleLabelMedia } from "../../lib/sampleLabelPrefs";
import { renderSampleLabel, renderSheetLabel } from "../../lib/sampleLabelRender";
import { niimbotPrintSupported, printNiimbotLabels } from "../../lib/niimbotPrint";
import { downloadSheetLabelsPdf } from "../../lib/sheetLabelExport";
import { DEFAULT_SHEET_LABEL_TEMPLATE, layoutSheetPages } from "../../lib/sheetLabelTemplate";
import type { WcTrackerLineState } from "../../types/fieldTracker";
import type { ProjectForm } from "../../types/database";

const PORTRAIT_PREVIEW_W = SAMPLE_LABEL_WIDTH / 2;
const PORTRAIT_PREVIEW_H = SAMPLE_LABEL_HEIGHT / 2;
const LANDSCAPE_PREVIEW_W = SAMPLE_LABEL_LANDSCAPE_WIDTH / 2;
const LANDSCAPE_PREVIEW_H = SAMPLE_LABEL_LANDSCAPE_HEIGHT / 2;

type Props = {
  project: ProjectForm;
  line: WcTrackerLineState;
  onClose: () => void;
};

export function PackageLabelDialog({ project, line, onClose }: Props) {
  const { settings } = useLetterhead();
  const [copies, setCopies] = useState(() => packageLabelCopies(line.packageQty));
  const [media, setMedia] = useState<SampleLabelMedia>("niimbot");
  const [orientation, setOrientation] = useState<SampleLabelOrientation>("portrait");
  const [sheetStart, setSheetStart] = useState(1);
  const [sheetPage, setSheetPage] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sheetUrls, setSheetUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "pdf" | "zip" | "test" | "print">(null);
  const [error, setError] = useState<string | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  const canPrintNiimbot = niimbotPrintSupported();
  const jobNumber = wcTrackerJobNumber(project);
  const jobName = wcTrackerJobName(project);
  const name = line.label.trim() || line.wallcoveringName.trim() || "Material";
  const sheetMode = media === "sheet";
  const template = DEFAULT_SHEET_LABEL_TEMPLATE;

  const thermalInputs = useMemo(
    () =>
      Array.from({ length: copies }, (_, index) =>
        packageLabelInput({
          letterhead: settings,
          line,
          jobNumber,
          jobName,
          qrUrl: materialPackageUrl(line.shareToken, window.location.origin, index + 1),
          orientation,
          packageMark: packageLabelMark(index + 1, copies),
        }),
      ),
    [copies, settings, line, jobNumber, jobName, orientation],
  );
  const sheetInputs = useMemo(
    () =>
      Array.from({ length: copies }, (_, index) =>
        packageLabelInput({
          letterhead: settings,
          line,
          jobNumber,
          jobName,
          qrUrl: materialPackageUrl(line.shareToken, window.location.origin, index + 1),
          orientation: "landscape",
          colorLogo: true,
          packageMark: packageLabelMark(index + 1, copies),
        }),
      ),
    [copies, settings, line, jobNumber, jobName],
  );
  const sheetPages = useMemo(() => layoutSheetPages(template, copies, sheetStart), [copies, sheetStart, template]);
  const spotsLeft = (sheetPages[sheetPage] ?? []).filter((slot) => slot.kind === "empty").length;

  useEffect(() => {
    setSheetPage((page) => Math.min(page, Math.max(0, sheetPages.length - 1)));
  }, [sheetPages.length]);

  useEffect(() => {
    setPreviewIndex((index) => Math.min(index, Math.max(0, copies - 1)));
  }, [copies]);

  useEffect(() => {
    if (sheetMode) return;
    const input = thermalInputs[previewIndex];
    if (!input) return;
    let cancel = false;
    setPreviewUrl("");
    void renderSampleLabel(input)
      .then((canvas) => {
        if (!cancel) setPreviewUrl(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        if (!cancel) setError("Could not draw the label.");
      });
    return () => {
      cancel = true;
    };
  }, [sheetMode, thermalInputs, previewIndex]);

  useEffect(() => {
    if (!sheetMode) return;
    let cancel = false;
    setSheetUrls([]);
    void Promise.all(sheetInputs.map((input) => renderSheetLabel(input).then((canvas) => canvas.toDataURL("image/png"))))
      .then((urls) => {
        if (!cancel) setSheetUrls(urls);
      })
      .catch(() => {
        if (!cancel) setError("Could not draw the label.");
      });
    return () => {
      cancel = true;
    };
  }, [sheetMode, sheetInputs]);

  const fileStem = [jobNumber, name].filter(Boolean).join(" ") || "package-label";

  async function downloadThermal(kind: "pdf" | "zip") {
    setBusy(kind);
    setError(null);
    try {
      const files = thermalInputs.map((input, index) => ({
        input,
        copies: 1,
        stem: `${fileStem} ${packageLabelMark(index + 1, copies)}`,
      }));
      if (kind === "zip") await downloadSampleLabelsZip(files, `${fileStem} labels.zip`);
      else await downloadSampleLabelsPdf(files, `${fileStem} labels.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the labels.");
    } finally {
      setBusy(null);
    }
  }

  async function printOnNiimbot() {
    setBusy("print");
    setError(null);
    setPrintNote(null);
    try {
      await printNiimbotLabels(
        thermalInputs.map((input) => ({ input, copies: 1 })),
        setPrintNote,
      );
    } catch (err) {
      setPrintNote(null);
      setError(err instanceof Error ? err.message : "Could not print on the NIIMBOT.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadSheet(outlines: boolean) {
    setBusy(outlines ? "test" : "pdf");
    setError(null);
    try {
      await downloadSheetLabelsPdf(
        { inputs: sheetInputs, template, startAt: sheetStart, outlines },
        outlines ? `${fileStem} label test.pdf` : `${fileStem} sheet labels.pdf`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the sheet.");
    } finally {
      setBusy(null);
    }
  }

  const previewW = orientation === "landscape" ? LANDSCAPE_PREVIEW_W : PORTRAIT_PREVIEW_W;
  const previewH = orientation === "landscape" ? LANDSCAPE_PREVIEW_H : PORTRAIT_PREVIEW_H;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card wc-print-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pkg-label-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wc-print-head">
          <div>
            <h3 id="pkg-label-title">Package labels</h3>
            <p className="wc-print-sub">{name}</p>
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
            <p className="muted small">
              The QR code opens this material, its photo, and document links. Each label is numbered{" "}
              {packageLabelMark(1, copies)}
              {copies > 1 ? ` through ${packageLabelMark(copies, copies)}` : ""}.
            </p>
            <label className="pkg-label-copies">
              Labels
              <input
                type="number"
                min={1}
                max={99}
                value={copies}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setCopies(Number.isFinite(next) ? Math.min(99, Math.max(1, Math.floor(next))) : 1);
                }}
              />
            </label>
            {sheetMode ? (
              <p className="wc-print-template-line">
                Template: {template.name} · {template.columns * template.rows} per Letter sheet
              </p>
            ) : (
              <div className="wc-print-orient">
                <p className="wc-print-kicker">Orientation</p>
                <div className="wc-print-pills" role="radiogroup" aria-label="Orientation">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={orientation === "portrait"}
                    className={orientation === "portrait" ? "is-on" : ""}
                    onClick={() => setOrientation("portrait")}
                  >
                    <span className="wc-print-shape wc-print-shape-portrait" aria-hidden="true" />
                    Portrait 50 x 80
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={orientation === "landscape"}
                    className={orientation === "landscape" ? "is-on" : ""}
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
                      slot.kind === "label" && slot.labelIndex !== undefined ? (sheetUrls[slot.labelIndex] ?? "") : "";
                    const clickable = sheetPage === 0 && slot.kind !== "label";
                    return (
                      <button
                        key={slot.index}
                        type="button"
                        className={`wc-sheet-cell${slot.kind === "used" ? " is-used" : ""}${clickable ? " is-spot" : ""}`}
                        aria-label={
                          clickable ? `Start at spot ${slot.index + 1}` : `Label spot ${slot.index + 1}`
                        }
                        style={{
                          left: `${(slot.xIn / template.pageWidthIn) * 100}%`,
                          top: `${(slot.yIn / template.pageHeightIn) * 100}%`,
                          width: `${(template.labelWidthIn / template.pageWidthIn) * 100}%`,
                          height: `${(template.labelHeightIn / template.pageHeightIn) * 100}%`,
                        }}
                        onClick={() => {
                          if (clickable) setSheetStart(slot.index + 1);
                        }}
                      >
                        {url ? <img src={url} alt="" /> : slot.kind === "used" ? <span>Used</span> : null}
                      </button>
                    );
                  })}
                </div>
                <p className="wc-print-sheet-caption">
                  Starts at spot {sheetStart} · {copies} {copies === 1 ? "label" : "labels"} · {spotsLeft}{" "}
                  {spotsLeft === 1 ? "spot" : "spots"} left on sheet
                </p>
              </>
            ) : (
              <>
                <div className="wc-print-preview-head">
                  <p className="wc-print-kicker">Preview · {packageLabelMark(previewIndex + 1, copies)}</p>
                  {copies > 1 && (
                    <div className="wc-print-nav">
                      <button
                        type="button"
                        disabled={previewIndex <= 0}
                        onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}
                      >
                        &lt; Prev
                      </button>
                      <button
                        type="button"
                        disabled={previewIndex >= copies - 1}
                        onClick={() => setPreviewIndex((index) => Math.min(copies - 1, index + 1))}
                      >
                        Next &gt;
                      </button>
                    </div>
                  )}
                </div>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    width={previewW}
                    height={previewH}
                    alt={`Package label ${packageLabelMark(previewIndex + 1, copies)} for ${name}`}
                  />
                ) : (
                  <div className="wc-print-preview-empty" style={{ width: previewW, height: previewH }}>
                    Rendering…
                  </div>
                )}
              </>
            )}
          </aside>
        </div>

        {error && <p className="wc-print-warn">{error}</p>}

        <div className="wc-print-footer">
          <p className="muted small">
            {sheetMode
              ? "Print at 100% / Actual size. Turn off Fit to page."
              : printNote
                ? printNote
                : canPrintNiimbot
                  ? "Prints on a nearby B1. Chrome or Edge."
                  : "This browser can't reach the printer. Download the PDF and open it in the NIIMBOT app."}
          </p>
          <div className="wc-print-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy !== null}>
              Cancel
            </button>
            {sheetMode ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void downloadSheet(true)}
                >
                  {busy === "test" ? "Preparing test…" : "Print test on plain paper"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => void downloadSheet(false)}
                >
                  {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void downloadThermal("zip")}
                >
                  {busy === "zip" ? "Preparing PNGs…" : "Download PNGs (.zip)"}
                </button>
                {canPrintNiimbot ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy !== null || copies < 1}
                    onClick={() => void printOnNiimbot()}
                  >
                    {busy === "print" ? "Printing…" : "Print on NIIMBOT"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={canPrintNiimbot ? "btn btn-secondary" : "btn btn-primary"}
                  disabled={busy !== null}
                  onClick={() => void downloadThermal("pdf")}
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
