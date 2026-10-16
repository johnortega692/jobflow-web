import { useEffect, useMemo, useState } from "react";
import { useLetterhead } from "../../contexts/LetterheadContext";
import { wcTrackerJobName, wcTrackerJobNumber } from "../../lib/jobInfo";
import {
  materialPackageUrl,
  packageLabelCopies,
  packageLabelInput,
  packageLabelMark,
} from "../../lib/materialPackageLabel";
import type { SampleLabelOrientation } from "../../lib/sampleLabelContent";
import { downloadSampleLabelsPdf, downloadSampleLabelsZip } from "../../lib/sampleLabelExport";
import type { SampleLabelMedia } from "../../lib/sampleLabelPrefs";
import { renderSampleLabel, renderSheetLabel } from "../../lib/sampleLabelRender";
import {
  estimateNiimbotPrintProgress,
  niimbotPrintSupported,
  printNiimbotLabels,
  type NiimbotPrintProgress,
} from "../../lib/niimbotPrint";
import { downloadSheetLabelsPdf, printSheetLabelsPdf } from "../../lib/sheetLabelExport";
import { DEFAULT_SHEET_LABEL_TEMPLATE, layoutSheetPages, type SheetLabelTemplate } from "../../lib/sheetLabelTemplate";
import type { WcTrackerLineState } from "../../types/fieldTracker";
import type { ProjectForm } from "../../types/database";

type Props = {
  project: ProjectForm;
  line: WcTrackerLineState;
  onClose: () => void;
};

function packageDialogHeading(line: WcTrackerLineState): { code: string; detail: string } {
  const code = line.label.trim();
  const product = line.product.trim() || line.wallcoveringName.trim();
  const maker = line.manufacturer.trim();
  const named =
    maker && product && !product.toLowerCase().includes(maker.toLowerCase())
      ? `${maker} ${product}`
      : product || maker;
  const detail = [named, line.color.trim()].filter(Boolean).join(" · ") || "Material";
  return { code, detail };
}

function sheetMediaLine(template: SheetLabelTemplate): string {
  const per = template.columns * template.rows;
  return `Avery 5163 · ${template.labelHeightIn} × ${template.labelWidthIn} in · ${per} per sheet`;
}

function formatPrintStamp(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function PortraitIcon() {
  return (
    <svg width="11" height="15" viewBox="0 0 11 15" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="9" height="13" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function LandscapeIcon() {
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="13" height="9" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CautionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 9.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d={dir === "left" ? "M14.5 6 8.5 12l6 6" : "M9.5 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [printProgress, setPrintProgress] = useState<NiimbotPrintProgress | null>(null);
  const [printed, setPrinted] = useState<{ count: number; at: Date } | null>(null);
  const canPrintNiimbot = niimbotPrintSupported();
  const jobNumber = wcTrackerJobNumber(project);
  const jobName = wcTrackerJobName(project);
  const heading = packageDialogHeading(line);
  const name = line.label.trim() || line.wallcoveringName.trim() || heading.detail;
  const sheetMode = media === "sheet";
  const template = DEFAULT_SHEET_LABEL_TEMPLATE;
  const spotCount = template.columns * template.rows;

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
        if (cancel) return;
        setPreviewUrl(canvas.toDataURL("image/png"));
        setError(null);
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
        if (cancel) return;
        setSheetUrls(urls);
        setError(null);
      })
      .catch(() => {
        if (!cancel) setError("Could not draw the label.");
      });
    return () => {
      cancel = true;
    };
  }, [sheetMode, sheetInputs]);

  const fileStem = [jobNumber, name].filter(Boolean).join(" ") || "package-label";

  function setCopyCount(next: number) {
    setCopies(Math.min(99, Math.max(1, Math.floor(next) || 1)));
  }

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
    const count = copies;
    setBusy("print");
    setError(null);
    setPrintNote(null);
    setPrintProgress({ percent: 1, label: "Starting…" });
    setPrinted(null);
    try {
      await printNiimbotLabels(
        thermalInputs.map((input) => ({ input, copies: 1 })),
        (message) => {
          const next = estimateNiimbotPrintProgress(message, count);
          setPrintProgress(next);
          if (!message.startsWith("Printed ")) setPrintNote(message);
        },
      );
      setPrintProgress({ percent: 100, label: "Done" });
      setPrintNote(null);
      setPrinted({ count, at: new Date() });
    } catch (err) {
      setPrintNote(null);
      setPrintProgress(null);
      setError(err instanceof Error ? err.message : "Could not print on the NIIMBOT.");
    } finally {
      setBusy(null);
      window.setTimeout(() => setPrintProgress(null), 900);
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

  async function printSheet() {
    const count = copies;
    setBusy("print");
    setError(null);
    setPrintNote(null);
    setPrinted(null);
    try {
      await printSheetLabelsPdf({ inputs: sheetInputs, template, startAt: sheetStart });
      setPrinted({ count, at: new Date() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not print the sheet.");
    } finally {
      setBusy(null);
    }
  }

  const sizeLine = orientation === "landscape" ? "80 × 50 mm" : "50 × 80 mm";
  const statusText =
    error ??
    printNote ??
    (printed
      ? `Printed ${printed.count} ${printed.count === 1 ? "label" : "labels"} · ${formatPrintStamp(printed.at)}`
      : null) ??
    (!sheetMode && !canPrintNiimbot
      ? "This browser can't reach the printer. Save the PDF and open it in the NIIMBOT app."
      : null);
  const statusClass = error ? " is-error" : printed && !printNote && !busy && !error ? " is-done" : "";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal card pkg-label-dialog${sheetMode ? " is-sheet" : orientation === "landscape" ? " is-landscape" : " is-portrait"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pkg-label-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pkg-label-head">
          <div>
            <h3 id="pkg-label-title">Package labels</h3>
            <p className="pkg-label-sub">
              {heading.code ? <span className="pkg-label-code">{heading.code}</span> : null}
              <span className="pkg-label-sub-text">{heading.detail}</span>
            </p>
          </div>
          <button type="button" className="pkg-label-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="pkg-label-body">
          <div className="pkg-label-side">
            <section>
              <p className="pkg-label-kicker">Print to</p>
              <div className="pkg-label-dests" role="radiogroup" aria-label="Print to">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!sheetMode}
                  className={`pkg-label-dest${sheetMode ? "" : " is-on"}`}
                  onClick={() => setMedia("niimbot")}
                >
                  <span className={`pkg-label-radio${sheetMode ? "" : " is-on"}`} aria-hidden="true" />
                  <span>
                    <strong>NIIMBOT B1</strong>
                    <em>50 × 80 mm roll</em>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={sheetMode}
                  className={`pkg-label-dest${sheetMode ? " is-on" : ""}`}
                  onClick={() => setMedia("sheet")}
                >
                  <span className={`pkg-label-radio${sheetMode ? " is-on" : ""}`} aria-hidden="true" />
                  <span>
                    <strong>Sheet labels</strong>
                    <em>{sheetMediaLine(template)}</em>
                  </span>
                </button>
              </div>
            </section>

            <section>
              <p className="pkg-label-kicker">Labels</p>
              <div className="pkg-label-stepper">
                <button
                  type="button"
                  aria-label="Fewer labels"
                  disabled={busy !== null || copies <= 1}
                  onClick={() => setCopyCount(copies - 1)}
                >
                  −
                </button>
                <strong aria-live="polite">{copies}</strong>
                <button
                  type="button"
                  aria-label="More labels"
                  disabled={busy !== null || copies >= 99}
                  onClick={() => setCopyCount(copies + 1)}
                >
                  +
                </button>
              </div>
            </section>

            {sheetMode ? (
              <section>
                <p className="pkg-label-kicker">Start at spot</p>
                <div
                  className="pkg-label-spots"
                  role="group"
                  aria-label="Start at spot"
                  style={{ gridTemplateColumns: `repeat(${template.columns}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: spotCount }, (_, index) => {
                    const spot = index + 1;
                    const selected = spot === sheetStart;
                    const used = spot < sheetStart;
                    return (
                      <button
                        key={spot}
                        type="button"
                        className={`pkg-label-spot${selected ? " is-on" : used ? " is-used" : ""}`}
                        aria-pressed={selected}
                        aria-label={used ? `Spot ${spot}, used. Start here` : `Start at spot ${spot}`}
                        disabled={busy !== null}
                        onClick={() => setSheetStart(spot)}
                      >
                        {spot}
                      </button>
                    );
                  })}
                </div>
                <p className="pkg-label-hint">Grey spots were used on an earlier print. Click a spot to start there.</p>
                <p className="pkg-label-caution">
                  <CautionIcon />
                  <span>Print at 100% / Actual size. Turn off Fit to page.</span>
                </p>
              </section>
            ) : (
              <section>
                <p className="pkg-label-kicker">Orientation</p>
                <div className="pkg-label-orient" role="radiogroup" aria-label="Orientation">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={orientation === "portrait"}
                    className={orientation === "portrait" ? "is-on" : ""}
                    disabled={busy !== null}
                    onClick={() => setOrientation("portrait")}
                  >
                    <PortraitIcon />
                    Portrait
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={orientation === "landscape"}
                    className={orientation === "landscape" ? "is-on" : ""}
                    disabled={busy !== null}
                    onClick={() => setOrientation("landscape")}
                  >
                    <LandscapeIcon />
                    Landscape
                  </button>
                </div>
              </section>
            )}
          </div>

          <section className="pkg-label-stage" aria-label="Preview">
            <div className="pkg-label-stage-head">
              <p className="pkg-label-kicker">Preview</p>
              <p className="pkg-label-stage-meta">
                {sheetMode
                  ? `Starts at spot ${sheetStart} · ${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`
                  : `Label ${packageLabelMark(previewIndex + 1, copies)} · ${sizeLine}`}
              </p>
            </div>
            <div className="pkg-label-canvas">
              {sheetMode ? (
                <div className="wc-sheet-page" aria-label="Sheet preview">
                  {(sheetPages[sheetPage] ?? []).map((slot) => {
                    const url =
                      slot.kind === "label" && slot.labelIndex !== undefined ? (sheetUrls[slot.labelIndex] ?? "") : "";
                    return (
                      <div
                        key={slot.index}
                        className={`wc-sheet-cell${slot.kind === "used" ? " is-used" : ""}`}
                        style={{
                          left: `${(slot.xIn / template.pageWidthIn) * 100}%`,
                          top: `${(slot.yIn / template.pageHeightIn) * 100}%`,
                          width: `${(template.labelWidthIn / template.pageWidthIn) * 100}%`,
                          height: `${(template.labelHeightIn / template.pageHeightIn) * 100}%`,
                        }}
                      >
                        {url ? <img src={url} alt="" /> : null}
                      </div>
                    );
                  })}
                </div>
              ) : previewUrl ? (
                <img
                  className="pkg-label-thermal"
                  src={previewUrl}
                  alt={`Package label ${packageLabelMark(previewIndex + 1, copies)} for ${heading.detail}`}
                />
              ) : (
                <div className="pkg-label-pending">Rendering…</div>
              )}
            </div>
            {sheetMode ? (
              <div className="pkg-label-pager">
                <button
                  type="button"
                  aria-label="Previous sheet"
                  disabled={sheetPage <= 0}
                  onClick={() => setSheetPage((page) => Math.max(0, page - 1))}
                >
                  <Chevron dir="left" />
                </button>
                <span>
                  Sheet {sheetPage + 1} of {sheetPages.length}
                </span>
                <button
                  type="button"
                  aria-label="Next sheet"
                  disabled={sheetPage >= sheetPages.length - 1}
                  onClick={() => setSheetPage((page) => Math.min(sheetPages.length - 1, page + 1))}
                >
                  <Chevron dir="right" />
                </button>
              </div>
            ) : (
              <div className="pkg-label-pager">
                <button
                  type="button"
                  aria-label="Previous label"
                  disabled={previewIndex <= 0}
                  onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}
                >
                  <Chevron dir="left" />
                </button>
                <span>
                  {previewIndex + 1} of {copies}
                </span>
                <button
                  type="button"
                  aria-label="Next label"
                  disabled={previewIndex >= copies - 1}
                  onClick={() => setPreviewIndex((index) => Math.min(copies - 1, index + 1))}
                >
                  <Chevron dir="right" />
                </button>
              </div>
            )}
          </section>
        </div>

        <footer className="pkg-label-foot">
          {printProgress && (busy === "print" || printProgress.percent >= 100) ? (
            <div
              className="pkg-label-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={printProgress.percent}
              aria-label={printProgress.label}
            >
              <div className="pkg-label-progress-meta">
                <span>{printProgress.label}</span>
                <span>{printProgress.percent}%</span>
              </div>
              <div className="pkg-label-progress-track">
                <div className="pkg-label-progress-fill" style={{ width: `${printProgress.percent}%` }} />
              </div>
            </div>
          ) : (
            <p className={`pkg-label-status${statusClass}`} aria-live="polite">
              {statusText}
            </p>
          )}
          <div className="pkg-label-actions">
            {sheetMode ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy !== null}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void downloadSheet(true)}
                >
                  {busy === "test" ? "Preparing…" : "Test on plain paper"}
                </button>
                <button
                  type="button"
                  className="pkg-label-ghost"
                  disabled={busy !== null}
                  onClick={() => void downloadSheet(false)}
                >
                  {busy === "pdf" ? "Preparing…" : "Download PDF"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null || copies < 1}
                  onClick={() => void printSheet()}
                >
                  {busy === "print" ? "Printing…" : `Print ${copies} ${copies === 1 ? "label" : "labels"}`}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="pkg-label-ghost"
                  disabled={busy !== null}
                  onClick={() => void downloadThermal("zip")}
                >
                  {busy === "zip" ? "Saving…" : "Save PNG"}
                </button>
                <button
                  type="button"
                  className={canPrintNiimbot ? "pkg-label-ghost" : "btn btn-primary"}
                  disabled={busy !== null}
                  onClick={() => void downloadThermal("pdf")}
                >
                  {busy === "pdf" ? "Saving…" : "Save PDF"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy !== null}>
                  Cancel
                </button>
                {canPrintNiimbot ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy !== null || copies < 1}
                    onClick={() => void printOnNiimbot()}
                  >
                    {busy === "print" ? "Printing…" : `Print ${copies} ${copies === 1 ? "label" : "labels"}`}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
