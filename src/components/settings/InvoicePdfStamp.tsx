import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { useLetterhead } from "../../contexts/LetterheadContext";
import {
  AP_GL_OPTIONS,
  DEFAULT_AP_COST_CODES,
  DEFAULT_AP_GL,
  apGlOption,
  bumpJobCount,
  mergeCustomCode,
  notesAreAutomatic,
  notesForJob,
  readJobCounts,
  readLastStamp,
  readSavedCodes,
  sequenceUsedInNotes,
  writeJobCounts,
  writeLastStamp,
  writeSavedCodes,
} from "../../lib/invoiceStampData";
import {
  defaultInvoiceStampPlacement,
  stampInvoicePdfMany,
  type InvoiceStampFields,
  type InvoiceStampPlacement,
} from "../../lib/invoiceStamp";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type StampContextMenu = {
  x: number;
  y: number;
  pageIndex: number;
  relX: number;
  relY: number;
  stampId: string | null;
};

type PlacedStamp = {
  id: string;
  placement: InvoiceStampPlacement;
  gl: string;
  job: string;
  jobTouched: boolean;
  costCode: string;
  customCode: string;
  rememberCode: boolean;
  approved: string;
  approvedTouched: boolean;
  notes: string;
};

function printPdfBytes(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "none";
  frame.src = url;
  document.body.appendChild(frame);
  const cleanup = () => {
    URL.revokeObjectURL(url);
    frame.remove();
  };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      cleanup();
      window.open(url, "_blank", "noopener");
      return;
    }
    win.focus();
    win.print();
    win.addEventListener("afterprint", cleanup, { once: true });
  };
}

function offsetPlacement(index: number): InvoiceStampPlacement {
  const base = defaultInvoiceStampPlacement();
  const row = Math.floor(index / 2);
  const x = index % 2 === 0 ? base.x : 0.04;
  return {
    pageIndex: 0,
    x,
    y: clamp(base.y + row * 0.12, 0, 1 - base.height),
    width: base.width,
    height: base.height,
  };
}

function notesForNewStamp(job: string, existing: PlacedStamp[]): string {
  const trimmed = job.trim();
  if (!trimmed) return "";
  let count = readJobCounts()[trimmed] || 0;
  for (const stamp of existing) {
    const used = sequenceUsedInNotes(trimmed, stamp.notes);
    if (used != null && used > count) count = used;
  }
  return notesForJob(trimmed, count);
}

function fieldsOf(stamp: PlacedStamp): InvoiceStampFields {
  const choice = apGlOption(stamp.gl);
  return {
    gl: choice.gl,
    job: stamp.job.trim(),
    costCode: stamp.customCode.trim() || stamp.costCode.trim(),
    costClass: choice.costClass,
    approved: stamp.approved.trim(),
    notes: stamp.notes.trim(),
  };
}

function stampReady(stamp: PlacedStamp): boolean {
  const fields = fieldsOf(stamp);
  return Boolean(fields.gl && fields.job && fields.costCode && fields.approved);
}

export function InvoicePdfStamp({
  bytes,
  suggestedJob,
  actionsSlot = null,
}: {
  bytes: Uint8Array;
  suggestedJob: string;
  actionsSlot?: HTMLElement | null;
}) {
  const { profile } = useLetterhead();
  const pagesRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const idRef = useRef(0);
  const skipLastWrite = useRef(false);
  const [pageCount, setPageCount] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [stamps, setStamps] = useState<PlacedStamp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stampsVisible, setStampsVisible] = useState(true);
  const [savedCodes, setSavedCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<StampContextMenu | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const popupMoved = useRef(false);

  const selected = stamps.find((stamp) => stamp.id === selectedId) ?? null;

  useEffect(() => {
    const trimmed = suggestedJob.trim();
    setStamps((current) => current.map((stamp) => {
      if (stamp.jobTouched) return stamp;
      const notes = !trimmed || !notesAreAutomatic(stamp.notes)
        ? stamp.notes
        : notesForJob(trimmed, readJobCounts()[trimmed] || 0);
      return { ...stamp, job: suggestedJob, notes };
    }));
  }, [suggestedJob]);

  useEffect(() => {
    const name = profile.name.trim();
    if (!name) return;
    setStamps((current) => current.map((stamp) => (
      stamp.approvedTouched || stamp.approved.trim() ? stamp : { ...stamp, approved: name }
    )));
  }, [profile.name]);

  useEffect(() => {
    setSavedCodes(readSavedCodes());
  }, []);

  useEffect(() => {
    if (skipLastWrite.current) {
      skipLastWrite.current = false;
      return;
    }
    if (!selected) return;
    writeLastStamp({
      gl: selected.gl,
      costCode: selected.costCode,
      customCode: selected.customCode,
      rememberCode: selected.rememberCode,
      approved: selected.approved,
    });
    if (!selected.rememberCode || !selected.customCode.trim()) return;
    const codes = mergeCustomCode(readSavedCodes(), selected.customCode, true);
    writeSavedCodes(codes);
    const remembered = codes.filter((code) => !DEFAULT_AP_COST_CODES.includes(code));
    setSavedCodes((current) => (
      current.length === remembered.length && current.every((code, index) => code === remembered[index])
        ? current
        : remembered
    ));
  }, [selected?.id, selected?.gl, selected?.costCode, selected?.customCode, selected?.rememberCode, selected?.approved]);

  useEffect(() => {
    if (!contextMenu) return;
    function dismiss(event: Event) {
      const target = event.target;
      if (target instanceof Element && target.closest(".read-invoice-context-menu")) return;
      setContextMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    setStamps([]);
    setSelectedId(null);
    setMenuOpen(false);
    setStampsVisible(true);
    setContextMenu(null);
    setPageCount(0);
  }, [bytes]);

  useEffect(() => {
    const box = pagesRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setLayoutWidth(box.clientWidth));
    observer.observe(box);
    setLayoutWidth(box.clientWidth);
    return () => observer.disconnect();
  }, [bytes]);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: bytes.slice(0) });
    void task.promise
      .then((doc) => {
        if (!cancelled) setPageCount(doc.numPages);
      })
      .catch(() => {
        if (!cancelled) setPageCount(0);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (!pageCount || layoutWidth <= 0) return;
    let cancelled = false;
    const task = getDocument({ data: bytes.slice(0) });
    void (async () => {
      const doc = await task.promise;
      for (let index = 0; index < pageCount; index += 1) {
        if (cancelled) return;
        const canvas = canvasRefs.current[index];
        if (!canvas) continue;
        const page = await doc.getPage(index + 1);
        const natural = page.getViewport({ scale: 1 });
        const width = canvas.parentElement?.clientWidth || natural.width;
        const viewport = page.getViewport({ scale: width / natural.width });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })().catch(() => {
      if (!cancelled) setError("Could not show that PDF.");
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes, pageCount, layoutWidth]);

  const codeChoices = [
    ...DEFAULT_AP_COST_CODES,
    ...savedCodes.filter((code) => !DEFAULT_AP_COST_CODES.includes(code)),
  ];

  function updateStamp(id: string, patch: Partial<PlacedStamp>) {
    setStamps((current) => current.map((stamp) => (stamp.id === id ? { ...stamp, ...patch } : stamp)));
  }

  function placementAt(pageIndex: number, relX: number, relY: number): InvoiceStampPlacement {
    const base = defaultInvoiceStampPlacement();
    return {
      pageIndex,
      x: clamp(relX, 0, 1 - base.width),
      y: clamp(relY, 0, 1 - base.height),
      width: base.width,
      height: base.height,
    };
  }

  function placeStamp(placement: InvoiceStampPlacement, openPopup: boolean) {
    const last = readLastStamp();
    const jobValue = suggestedJob.trim();
    const approvedValue = (last?.approved || profile.name).trim();
    idRef.current += 1;
    const next: PlacedStamp = {
      id: `stamp-${idRef.current}`,
      placement,
      gl: last?.gl || DEFAULT_AP_GL,
      job: jobValue,
      jobTouched: Boolean(jobValue),
      costCode: last?.costCode || DEFAULT_AP_COST_CODES[0] || "",
      customCode: last?.rememberCode ? last.customCode : "",
      rememberCode: Boolean(last?.rememberCode),
      approved: approvedValue,
      approvedTouched: Boolean(approvedValue),
      notes: notesForNewStamp(jobValue, stamps),
    };
    setStamps((current) => [...current, next]);
    setSelectedId(next.id);
    setStampsVisible(true);
    if (openPopup) openStampMenu();
    setError(null);
    setContextMenu(null);
  }

  function addStamp() {
    placeStamp(offsetPlacement(stamps.length), true);
  }

  function duplicateStamp(stamp: PlacedStamp) {
    const page = pagesRef.current?.querySelectorAll(".read-invoice-pdf-page")[stamp.placement.pageIndex];
    const rect = page instanceof HTMLElement ? page.getBoundingClientRect() : null;
    const dx = rect && rect.width > 0 ? 24 / rect.width : 0.03;
    const dy = rect && rect.height > 0 ? 24 / rect.height : 0.03;
    idRef.current += 1;
    const next: PlacedStamp = {
      ...stamp,
      id: `stamp-${idRef.current}`,
      jobTouched: true,
      approvedTouched: true,
      placement: {
        ...stamp.placement,
        x: clamp(stamp.placement.x + dx, 0, 1 - stamp.placement.width),
        y: clamp(stamp.placement.y + dy, 0, 1 - stamp.placement.height),
      },
    };
    setStamps((current) => [...current, next]);
    setSelectedId(next.id);
    setStampsVisible(true);
    setContextMenu(null);
  }

  function clearStamps() {
    setStamps([]);
    setSelectedId(null);
    setMenuOpen(false);
    setContextMenu(null);
  }

  function popupAtRightPanel(): { x: number; y: number } {
    const width = Math.min(352, window.innerWidth - 24);
    const side = document.querySelector(".read-invoice-side");
    if (!(side instanceof HTMLElement)) return { x: 16, y: 76 };
    const rect = side.getBoundingClientRect();
    return {
      x: clamp(rect.left + 10, 8, Math.max(8, window.innerWidth - width - 8)),
      y: clamp(rect.top + 8, 8, Math.max(8, window.innerHeight - 120)),
    };
  }

  function openStampMenu() {
    if (!popupMoved.current) setPopupPos(popupAtRightPanel());
    setMenuOpen(true);
  }

  function openStampEditor(id: string) {
    setSelectedId(id);
    openStampMenu();
    setStampsVisible(true);
    setContextMenu(null);
    setError(null);
  }

  function removeStamp(id: string) {
    const remaining = stamps.filter((stamp) => stamp.id !== id);
    setStamps(remaining);
    setSelectedId((current) => (current === id ? remaining[0]?.id ?? null : current));
    if (remaining.length === 0) setMenuOpen(false);
  }

  function fillNotesForJob(stamp: PlacedStamp, nextJob: string) {
    const trimmed = nextJob.trim();
    if (!trimmed || !notesAreAutomatic(stamp.notes)) return;
    if (sequenceUsedInNotes(trimmed, stamp.notes) != null) return;
    const others = stamps.filter((item) => item.id !== stamp.id);
    updateStamp(stamp.id, { notes: notesForNewStamp(trimmed, others) });
  }

  function onPageContextMenu(event: ReactMouseEvent<HTMLDivElement>, pageIndex: number) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const target = event.target;
    const stampNode = target instanceof Element ? target.closest("[data-stamp-id]") : null;
    const menuWidth = 230;
    const menuHeight = stampNode ? 140 : 156;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      pageIndex,
      relX: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0,
      relY: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0,
      stampId: stampNode?.getAttribute("data-stamp-id") ?? null,
    });
  }

  function beginPopupDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button")) return;
    const popup = event.currentTarget.parentElement;
    if (!(popup instanceof HTMLElement)) return;
    event.preventDefault();
    popupMoved.current = true;
    const rect = popup.getBoundingClientRect();
    const originX = popupPos?.x ?? rect.left;
    const originY = popupPos?.y ?? rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const onMove = (ev: PointerEvent) => {
      const nextX = clamp(originX + ev.clientX - startX, 8, window.innerWidth - rect.width - 8);
      const nextY = clamp(originY + ev.clientY - startY, 8, window.innerHeight - 64);
      setPopupPos({ x: nextX, y: nextY });
    };
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, stamp: PlacedStamp, mode: "move" | "resize") {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(stamp.id);
    const page = event.currentTarget.closest(".read-invoice-pdf-page");
    if (!(page instanceof HTMLElement)) return;
    const rect = page.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = stamp.placement;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      if (mode === "move") {
        updateStamp(stamp.id, {
          placement: {
            ...start,
            x: clamp(start.x + dx, 0, 1 - start.width),
            y: clamp(start.y + dy, 0, 1 - start.height),
          },
        });
        return;
      }
      let width = clamp(start.width + dx, 0.18, 1 - start.x);
      updateStamp(stamp.id, {
        placement: {
          ...start,
          width,
        },
      });
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  async function print() {
    if (stampsVisible) {
      const missing = stamps.find((stamp) => !stampReady(stamp));
      if (stamps.length && missing) {
        setSelectedId(missing.id);
        openStampMenu();
        setError("Fill in the GL, job, cost code, and who approved it on every stamp before printing.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const printable = stampsVisible ? stamps : [];
      const payload = printable.length
        ? await stampInvoicePdfMany(bytes, printable.map((stamp) => ({
          fields: fieldsOf(stamp),
          placement: stamp.placement,
        })))
        : bytes;
      if (printable.length) {
        let codes = readSavedCodes();
        for (const stamp of stamps) codes = mergeCustomCode(codes, stamp.customCode, stamp.rememberCode);
        writeSavedCodes(codes);
        setSavedCodes(codes.filter((code) => !DEFAULT_AP_COST_CODES.includes(code)));
        let counts = readJobCounts();
        let countsChanged = false;
        for (const stamp of stamps) {
          const fields = fieldsOf(stamp);
          const nextCounts = bumpJobCount(counts, fields.job, fields.notes);
          if (nextCounts) {
            counts = nextCounts;
            countsChanged = true;
          }
        }
        if (countsChanged) writeJobCounts(counts);
        skipLastWrite.current = true;
        setStamps((current) => current.map((stamp) => ({ ...stamp, customCode: "", rememberCode: false })));
      }
      printPdfBytes(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not print that PDF.");
    } finally {
      setBusy(false);
    }
  }

  const selectedFields = selected ? fieldsOf(selected) : null;

  const contextStamp = contextMenu?.stampId ? stamps.find((stamp) => stamp.id === contextMenu.stampId) ?? null : null;

  const stampActions = (
    <div className="read-invoice-stamp-actions">
      <button type="button" className="btn read-invoice-tool-btn" onClick={addStamp}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add Stamp
      </button>
      {stamps.length > 0 ? (
        <button type="button" className="btn read-invoice-tool-btn" aria-pressed={stampsVisible} onClick={() => setStampsVisible((current) => !current)}>
          {stampsVisible ? (
            <svg className="read-invoice-eye" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          ) : (
            <svg className="read-invoice-eye" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 3l18 18" />
              <path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-3.2 3.8" />
              <path d="M6.1 6.7C3.6 8.4 2 12 2 12s3.5 6 10 6c1.5 0 2.9-.3 4.1-.9" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </svg>
          )}
          {`Stamps: ${stamps.length}`}
        </button>
      ) : null}
      <button type="button" className="btn btn-primary read-invoice-tool-btn" disabled={busy} onClick={() => void print()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9V3h12v6" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <path d="M6 14h12v7H6z" />
        </svg>
        {busy ? "Printing…" : "Print"}
      </button>
    </div>
  );

  return (
    <div className="read-invoice-stage">
      {actionsSlot ? createPortal(stampActions, actionsSlot) : stampActions}
      <div className="read-invoice-pdf-pages" ref={pagesRef}>
        {Array.from({ length: pageCount }, (_, index) => (
          <div key={index} className="read-invoice-pdf-page" onContextMenu={(event) => onPageContextMenu(event, index)}>
            <canvas ref={(node) => { canvasRefs.current[index] = node; }} aria-label={`Invoice page ${index + 1}`} />
            {stampsVisible ? stamps.filter((stamp) => stamp.placement.pageIndex === index).map((stamp) => {
              const fields = fieldsOf(stamp);
              return (
                <div
                  key={stamp.id}
                  data-stamp-id={stamp.id}
                  className={`read-invoice-stamp-box${stamp.id === selectedId ? " is-selected" : ""}`}
                  style={{
                    left: `${stamp.placement.x * 100}%`,
                    top: `${stamp.placement.y * 100}%`,
                    width: `${stamp.placement.width * 100}%`,
                    height: "auto",
                  }}
                  onPointerDown={(event) => beginDrag(event, stamp, "move")}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openStampEditor(stamp.id);
                  }}
                >
                  <div className="read-invoice-stamp-lines">
                    <div><span>GL:</span><span>{fields.gl}</span></div>
                    <div><span>JOB#:</span><span>{fields.job}</span></div>
                    <div><span>COST CODE:</span><span>{fields.costCode}</span></div>
                    <div><span>COST CLASS:</span><span>{fields.costClass}</span></div>
                    <div><span>APPROVED:</span><span>{fields.approved}</span></div>
                    <div><span>NOTES:</span><span>{fields.notes}</span></div>
                  </div>
                  <div className="read-invoice-stamp-tools">
                    <button
                      type="button"
                      aria-label={`Edit stamp ${fields.job || stamp.id}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => openStampEditor(stamp.id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete stamp ${fields.job || stamp.id}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => removeStamp(stamp.id)}
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    className="read-invoice-stamp-handle"
                    aria-label="Resize stamp"
                    onPointerDown={(event) => beginDrag(event, stamp, "resize")}
                  />
                </div>
              );
            }) : null}
          </div>
        ))}
        {pageCount === 0 ? <p className="read-invoice-pdf-empty muted small">The invoice PDF shows here.</p> : null}
      </div>
      {stamps.length > 0 && !stampsVisible ? (
        <p className="muted small">Stamps are hidden on the page. Show stamps puts them back before printing.</p>
      ) : null}
      {menuOpen && selected ? createPortal(
        <form
          className="read-invoice-stamp-popup"
          role="dialog"
          aria-label="Stamp options"
          style={popupPos ? { left: popupPos.x, top: popupPos.y, right: "auto" } : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void print();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenuOpen(false);
          }}
        >
          <div className="read-invoice-stamp-popup-head" onPointerDown={beginPopupDrag}>
            <strong>Stamp</strong>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addStamp}>+ New</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(false)}>Close</button>
          </div>
          <p className="muted small">Drag the title to move this panel. Closing keeps every stamp on the PDF.</p>
          {stamps.length > 1 ? (
            <div className="read-invoice-stamp-pills" role="tablist" aria-label="Stamps">
              {stamps.map((stamp, index) => (
                <button
                  type="button"
                  key={stamp.id}
                  role="tab"
                  aria-selected={stamp.id === selected.id}
                  className={stamp.id === selected.id ? "is-on" : undefined}
                  onClick={() => setSelectedId(stamp.id)}
                >
                  {`Stamp ${index + 1} (P${stamp.placement.pageIndex + 1})`}
                </button>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStamp(selected.id)}>Delete</button>
            </div>
          ) : (
            <div className="read-invoice-stamp-popup-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStamp(selected.id)}>Delete</button>
            </div>
          )}
          {pageCount > 0 ? (
            <label className="read-invoice-stamp-page">
              Page
              <select
                value={selected.placement.pageIndex}
                onChange={(event) => updateStamp(selected.id, {
                  placement: { ...selected.placement, pageIndex: Number(event.target.value) },
                })}
              >
                {Array.from({ length: pageCount }, (_, index) => (
                  <option key={index} value={index}>{index + 1}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            GL account
            <select value={selected.gl} onChange={(event) => updateStamp(selected.id, { gl: event.target.value })} required>
              {AP_GL_OPTIONS.map((option) => (
                <option key={option.gl} value={option.label}>{option.label}</option>
              ))}
            </select>
          </label>
          <p className="muted small read-invoice-stamp-class"><span>Cost class</span><span>{selectedFields?.costClass}</span></p>
          <label>
            Job number
            <input
              value={selected.job}
              onChange={(event) => updateStamp(selected.id, { jobTouched: true, job: event.target.value })}
              onBlur={() => fillNotesForJob(selected, selected.job)}
              required
            />
          </label>
          <label>
            Cost code
            <select value={selected.costCode} onChange={(event) => updateStamp(selected.id, { costCode: event.target.value })} required>
              {codeChoices.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>
          <label>
            Custom code
            <input
              value={selected.customCode}
              placeholder="Overrides the cost code"
              onChange={(event) => updateStamp(selected.id, { customCode: event.target.value })}
            />
          </label>
          <label className="read-invoice-stamp-remember">
            <input
              type="checkbox"
              checked={selected.rememberCode}
              onChange={(event) => updateStamp(selected.id, { rememberCode: event.target.checked })}
            />
            Remember custom code for next time
          </label>
          <label>
            Approved
            <input
              value={selected.approved}
              placeholder="Name"
              onChange={(event) => updateStamp(selected.id, { approvedTouched: true, approved: event.target.value })}
              required
            />
          </label>
          <label>
            Notes
            <input value={selected.notes} onChange={(event) => updateStamp(selected.id, { notes: event.target.value })} />
          </label>
          {error ? <p className="material-prices-error">{error}</p> : null}
        </form>,
        document.body,
      ) : null}
      {contextMenu ? createPortal(
        <div
          className="read-invoice-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextStamp ? (
            <>
              <button type="button" role="menuitem" onClick={() => openStampEditor(contextStamp.id)}>Edit Stamp</button>
              <button type="button" role="menuitem" onClick={() => duplicateStamp(contextStamp)}>Duplicate</button>
              <button type="button" role="menuitem" onClick={() => { removeStamp(contextStamp.id); setContextMenu(null); }}>Delete Stamp</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => placeStamp(placementAt(contextMenu.pageIndex, contextMenu.relX, contextMenu.relY), true)}>+ Add Stamp Here</button>
              <button type="button" role="menuitem" onClick={() => placeStamp(placementAt(contextMenu.pageIndex, contextMenu.relX, contextMenu.relY), false)}>+ Quick Stamp (Last Used)</button>
              <button type="button" role="menuitem" disabled={stamps.length === 0} onClick={clearStamps}>Clear All Stamps</button>
            </>
          )}
        </div>,
        document.body,
      ) : null}
      {!menuOpen && error ? <p className="material-prices-error">{error}</p> : null}
    </div>
  );
}
