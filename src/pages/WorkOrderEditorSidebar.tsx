import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DateInput } from "../components/DateInput";
import { SegmentedControl } from "../components/SegmentedControl";
import { formatMoney, computeBudgetFromCosts } from "../lib/workOrderCalc";
import { materialUnitPrice } from "../types/workOrderSettings";
import type { WorkOrderFormData } from "../types/workOrder";
import type { WorkOrderFontSettings, WorkOrderLaborRateItem, WorkOrderMaterialCatalogItem } from "../types/workOrderSettings";
import type { WorkOrderScanBoxes, ScanBoxKind } from "../types/workOrderScan";
import type { WorkOrderOverlay } from "../types/workOrder";
import {
  MAX_OVERLAY_SPACING,
  MIN_OVERLAY_SPACING,
  overlayDisplayText,
} from "../lib/workOrderOverlayLayout";
import { isPlaceholderEwoNumber } from "../lib/workOrderEwoDetect";

export type EwoEditorTab = "controls" | "setup" | "materials" | "other";

type Props = {
  activeTab: EwoEditorTab;
  onTabChange: (tab: EwoEditorTab) => void;
  tabs: { id: EwoEditorTab; label: string }[];
  hasDocument: boolean;
  pdfPages: number;
  sourcePdfPage: number;
  onPdfPageChange: (page: number) => void;
  ewoNumber: string;
  onEwoNumberChange: (v: string) => void;
  ewoDate: string;
  onEwoDateChange: (v: string) => void;
  projectJobNumber: string;
  ocrBusy: boolean;
  scanBoxes: WorkOrderScanBoxes;
  showScanBoxes: boolean;
  onShowScanBoxesChange: (v: boolean) => void;
  scanSetupMode: ScanBoxKind | null;
  onSelectEwoArea: () => void;
  onDrawNewEwoArea: () => void;
  onResetEwoArea: () => void;
  onSelectJobArea: () => void;
  onDrawNewJobArea: () => void;
  onResetJobArea: () => void;
  onSelectDateArea: () => void;
  onDrawNewDateArea: () => void;
  onResetDateArea: () => void;
  onClearScanBoxes: () => void;
  onFinishScanSetup: () => void;
  onOpenSetupFields: () => void;
  onCloseSetupFields: () => void;
  scanSetupComplete: boolean;
  showSetupTab: boolean;
  onAutoDetectFields: () => void;
  form: WorkOrderFormData;
  onFieldChange: <K extends keyof WorkOrderFormData>(key: K, value: WorkOrderFormData[K]) => void;
  onResetScanEnhance: () => void;
  onInitializeTotals: () => void;
  onSaveTotalPositionsDefault: () => void;
  onRestoreTotalPositions: () => void;
  onResetFactoryTotalPositions: () => void;
  hasTotalOverlays: boolean;
  onApplyFontsToAll: () => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onRemoveSelectedOverlay: () => void;
  materials: WorkOrderMaterialCatalogItem[];
  selectedMaterial: string;
  onSelectedMaterialChange: (v: string) => void;
  materialQty: string;
  onMaterialQtyChange: (v: string) => void;
  /** Returns true when a material overlay was added. */
  onAddMaterialToCanvas: () => boolean;
  laborRates: WorkOrderLaborRateItem[];
  onLaborRateChange: (name: string) => void;
  onAddLaborToCanvas: () => void;
  parkingAmount: string;
  onParkingAmountChange: (v: string) => void;
  onAddParkingToCanvas: () => void;
  supervisionHours: string;
  onSupervisionHoursChange: (v: string) => void;
  supervisionRate: string;
  onSupervisionRateChange: (v: string) => void;
  onAddSupervisionToCanvas: () => void;
  fonts: WorkOrderFontSettings;
  onFontsChange: (fonts: WorkOrderFontSettings) => void;
  delivered: boolean;
  onDeliveredChange: (v: boolean) => void;
  totals: { total_amount: number; material_cost: number; labor_cost: number; raw_cost: number; indirects: number | null };
  backgroundUrl: string | null;
};

export function WorkOrderEditorSidebar(props: Props) {
  const { activeTab, onTabChange, tabs } = props;

  return (
    <aside className="ewo-controls card">
      <SegmentedControl
        className="ewo-editor-segmented"
        aria-label="Work order editor sections"
        options={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
        value={activeTab}
        onChange={onTabChange}
      />

      {activeTab === "controls" && <ControlsPanel {...props} />}
      {activeTab === "setup" && <SetupPanel {...props} />}
      {activeTab === "materials" && <MaterialsPanel {...props} />}
      {activeTab === "other" && <OtherPanel {...props} />}
    </aside>
  );
}

function ScanSetupFields(p: Props) {
  if (!p.hasDocument) {
    return (
      <section className="stack">
        <h3 className="small">Setup Fields</h3>
        <p className="muted small">
          Upload a work order with <strong>Upload work order</strong> at the top of this page, then define scan areas
          below and run <strong>Auto-Detect Fields</strong>.
        </p>
      </section>
    );
  }

  return (
    <section className="ewo-scan-setup stack">
      <h3 className="small">Setup Fields</h3>
      <p className="muted small">
        Define where OCR reads the EWO #, date, and job number on your form. Saved once to your account and reused
        for every upload with the same layout.
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={p.showScanBoxes}
          onChange={(e) => p.onShowScanBoxesChange(e.target.checked)}
        />
        Show scan regions on document
      </label>

      <div className={`ewo-scan-area-card${p.scanSetupMode === "ewo" ? " active" : ""}`}>
        <div className="row-between wrap">
          <strong className="small">EWO number area</strong>
          <span className={`ewo-scan-status${p.scanBoxes.ewo ? " ok" : ""}`}>
            {p.scanBoxes.ewo ? "Set" : "Not set"}
          </span>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onSelectEwoArea}>
            Select area
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onDrawNewEwoArea}>
            Draw new area
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!p.scanBoxes.ewo}
            onClick={p.onResetEwoArea}
          >
            Reset position
          </button>
        </div>
      </div>

      <div className={`ewo-scan-area-card${p.scanSetupMode === "job" ? " active" : ""}`}>
        <div className="row-between wrap">
          <strong className="small">Job number area</strong>
          <span className={`ewo-scan-status${p.scanBoxes.job ? " ok" : ""}`}>
            {p.scanBoxes.job ? "Set" : "Not set"}
          </span>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onSelectJobArea}>
            Select area
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onDrawNewJobArea}>
            Draw new area
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!p.scanBoxes.job}
            onClick={p.onResetJobArea}
          >
            Reset position
          </button>
        </div>
      </div>

      <div className={`ewo-scan-area-card${p.scanSetupMode === "date" ? " active" : ""}`}>
        <div className="row-between wrap">
          <strong className="small">EWO date area</strong>
          <span className={`ewo-scan-status${p.scanBoxes.date ? " ok" : ""}`}>
            {p.scanBoxes.date ? "Set" : "Not set"}
          </span>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onSelectDateArea}>
            Select area
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onDrawNewDateArea}>
            Draw new area
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!p.scanBoxes.date}
            onClick={p.onResetDateArea}
          >
            Reset position
          </button>
        </div>
      </div>

      {p.scanSetupMode && (
        <button type="button" className="btn btn-primary btn-sm" onClick={p.onFinishScanSetup}>
          Done adjusting scan area
        </button>
      )}

      <div className="row-gap wrap">
        <button type="button" className="btn btn-ghost btn-sm" onClick={p.onClearScanBoxes}>
          Clear all areas
        </button>
      </div>
    </section>
  );
}

function SetupPanel(p: Props) {
  return (
    <div className="ewo-editor-tab-panel stack">
      {p.scanSetupComplete && (
        <div className="row-between wrap">
          <p className="muted small" style={{ margin: 0 }}>
            Scan areas are saved to your account and reused for every work order upload.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onCloseSetupFields}>
            Done
          </button>
        </div>
      )}

      <ScanSetupFields {...p} />

      {p.hasDocument && p.showSetupTab && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={p.ocrBusy || !p.backgroundUrl}
          onClick={() => void p.onAutoDetectFields()}
        >
          {p.ocrBusy ? "Detecting…" : "Auto-Detect Fields"}
        </button>
      )}
    </div>
  );
}

function ControlsPanel(p: Props) {
  const fsi = computeBudgetFromCosts(p.totals.material_cost, p.totals.raw_cost, p.totals.indirects);
  const notesFilled = p.form.notes.trim().length > 0;
  const overlayCount = p.form.overlays.length;

  const overlayGroups = (() => {
    const order: WorkOrderOverlay["section"][] = [];
    const map = new Map<WorkOrderOverlay["section"], WorkOrderOverlay[]>();
    for (const o of p.form.overlays) {
      if (!map.has(o.section)) {
        order.push(o.section);
        map.set(o.section, []);
      }
      map.get(o.section)!.push(o);
    }
    return order.map((section) => ({ section, items: map.get(section)! }));
  })();

  const sectionTitle: Record<WorkOrderOverlay["section"], string> = {
    total: "Totals",
    material: "Material",
    labor: "Labor",
    custom: "Other",
  };

  function overlayRowValue(o: WorkOrderOverlay): string {
    if (o.amount) return o.amount;
    if (o.section === "total") return "—";
    return overlayDisplayText(o, p.form.display) || "—";
  }

  function onOverlayKeyDown(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      p.onSelectOverlay(id);
    }
  }

  return (
    <div className="ewo-editor-tab-panel stack ewo-controls-panel">
      {p.hasDocument && (
        <div className="ewo-scan-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={p.ocrBusy || !p.backgroundUrl}
            title="Auto-Detect Fields"
            onClick={() => void p.onAutoDetectFields()}
          >
            {p.ocrBusy ? "Detecting…" : "Auto-Detect"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title="Adjust scan areas…"
            onClick={p.onOpenSetupFields}
          >
            Scan areas…
          </button>
        </div>
      )}

      {!p.scanSetupComplete && p.hasDocument && (
        <p className="muted small">
          One-time setup: define where OCR reads EWO # and date on your form template.
        </p>
      )}

      {p.pdfPages > 1 && (
        <label className="ewo-field">
          <span className="ewo-field-label">PDF page</span>
          <select value={p.sourcePdfPage} onChange={(e) => p.onPdfPageChange(Number(e.target.value))}>
            {Array.from({ length: p.pdfPages }, (_, i) => (
              <option key={i} value={i}>
                Page {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ewo-fields-grid">
        <label className="ewo-field">
          <span className="ewo-field-label">EWO #</span>
          <input
            value={p.ewoNumber}
            onChange={(e) => p.onEwoNumberChange(e.target.value)}
            placeholder={p.ocrBusy ? "Detecting…" : "From document"}
          />
        </label>
        <label className="ewo-field">
          <span className="ewo-field-label">Job #</span>
          <input value={p.projectJobNumber} readOnly className="readonly" title="From project" />
        </label>
        <label className="ewo-field ewo-field--full">
          <span className="ewo-field-label">EWO date</span>
          <DateInput value={p.ewoDate} onChange={p.onEwoDateChange} />
        </label>
      </div>

      <div className="ewo-status-chips">
        <button
          type="button"
          className={`ewo-status-chip${p.form.fsi_checked ? " ewo-status-chip--on" : ""}`}
          aria-pressed={p.form.fsi_checked}
          onClick={() => p.onFieldChange("fsi_checked", !p.form.fsi_checked)}
        >
          <span className="ewo-status-chip-dot" aria-hidden="true" />
          Added FSI
        </button>
        <button
          type="button"
          className={`ewo-status-chip${p.delivered ? " ewo-status-chip--on" : ""}`}
          aria-pressed={p.delivered}
          onClick={() => p.onDeliveredChange(!p.delivered)}
        >
          <span className="ewo-status-chip-dot" aria-hidden="true" />
          Delivered to GC
        </button>
      </div>

      {p.hasDocument && isPlaceholderEwoNumber(p.ewoNumber) && !p.ocrBusy && (
        <p className="muted small">
          Use <strong>Auto-Detect</strong> above to read EWO # from the uploaded form.
        </p>
      )}

      <div className="ewo-totals-block">
        <div className="ewo-mini-ledger" role="table" aria-label="Material and labor totals">
          <div className="ewo-mini-ledger-row" role="row">
            <span className="ewo-mini-ledger-label" role="rowheader">
              Material
            </span>
            <span className="ewo-mini-ledger-value" role="cell">
              {formatMoney(p.totals.material_cost)}
            </span>
          </div>
          <div className="ewo-mini-ledger-row" role="row">
            <span className="ewo-mini-ledger-label" role="rowheader">
              Labor
            </span>
            <span className="ewo-mini-ledger-value" role="cell">
              {formatMoney(p.totals.labor_cost)}
            </span>
          </div>
        </div>
        <div className="ewo-grand-total-bar" role="status">
          <span className="ewo-grand-total-label">Grand total</span>
          <strong className="ewo-grand-total-value">{formatMoney(p.totals.total_amount)}</strong>
        </div>
      </div>

      <details className="ewo-panel-details">
        <summary className="ewo-panel-details-summary">
          <span className="ewo-panel-details-chevron" aria-hidden="true" />
          FSI budget
        </summary>
        <div className="ewo-panel-details-body">
          <div className="ewo-mini-ledger" role="table" aria-label="FSI budget">
            <div className="ewo-mini-ledger-row" role="row">
              <span className="ewo-mini-ledger-label" role="rowheader">
                Mat (90% up)
              </span>
              <span className="ewo-mini-ledger-value" role="cell">
                {formatMoney(fsi.material_minus_10)}
              </span>
            </div>
            <div className="ewo-mini-ledger-row" role="row">
              <span className="ewo-mini-ledger-label" role="rowheader">
                Indirects
              </span>
              <span className="ewo-mini-ledger-value" role="cell">
                {formatMoney(fsi.indirects)}
              </span>
            </div>
            <div className="ewo-mini-ledger-row" role="row">
              <span className="ewo-mini-ledger-label" role="rowheader">
                Raw labor
              </span>
              <span className="ewo-mini-ledger-value" role="cell">
                {formatMoney(fsi.raw_labor)}
              </span>
            </div>
            <div className="ewo-mini-ledger-row ewo-mini-ledger-row--budget" role="row">
              <span className="ewo-mini-ledger-label" role="rowheader">
                Budget
              </span>
              <span className="ewo-mini-ledger-value ewo-mini-ledger-value--ok" role="cell">
                {formatMoney(fsi.budget_total)}
              </span>
            </div>
          </div>
        </div>
      </details>

      <details className="ewo-panel-details">
        <summary className="ewo-panel-details-summary">
          <span className="ewo-panel-details-chevron" aria-hidden="true" />
          Notes{notesFilled ? " •" : ""}
        </summary>
        <div className="ewo-panel-details-body">
          <textarea
            className="ewo-notes-textarea"
            rows={3}
            value={p.form.notes}
            onChange={(e) => p.onFieldChange("notes", e.target.value)}
            aria-label="Notes"
          />
        </div>
      </details>

      <details className="ewo-panel-details" open>
        <summary className="ewo-panel-details-summary">
          <span className="ewo-panel-details-chevron" aria-hidden="true" />
          Overlays ({overlayCount})
        </summary>
        <div className="ewo-panel-details-body stack">
          <div className="ewo-overlay-toolbar">
            <button type="button" className="btn btn-secondary btn-sm" onClick={p.onInitializeTotals}>
              Place totals
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!p.selectedOverlayId}
              onClick={p.onRemoveSelectedOverlay}
            >
              Remove
            </button>
          </div>

          {overlayCount > 0 ? (
            <div className="ewo-overlay-list" role="list">
              {overlayGroups.map(({ section, items }) => (
                <div key={section} className="ewo-overlay-group" role="group" aria-label={sectionTitle[section]}>
                  <div className="ewo-overlay-group-header">{sectionTitle[section]}</div>
                  {items.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="listitem"
                      tabIndex={0}
                      className={`ewo-overlay-row${p.selectedOverlayId === o.id ? " ewo-overlay-row--selected" : ""}`}
                      onClick={() => p.onSelectOverlay(o.id)}
                      onKeyDown={(e) => onOverlayKeyDown(e, o.id)}
                    >
                      <span className="ewo-overlay-row-name">{o.label || "Untitled"}</span>
                      <span className="ewo-overlay-row-value">{overlayRowValue(o)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No overlays yet. Use Place totals or add from Mat &amp; Labor.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

const RECENT_MATERIALS_KEY = "jobflow.ewo.recent-materials";
const RECENT_MATERIALS_MAX = 3;

function loadRecentMaterialNames(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_MATERIALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, RECENT_MATERIALS_MAX);
  } catch {
    return [];
  }
}

function saveRecentMaterialNames(names: string[]) {
  try {
    localStorage.setItem(RECENT_MATERIALS_KEY, JSON.stringify(names.slice(0, RECENT_MATERIALS_MAX)));
  } catch {
    // ignore quota / private mode
  }
}

function pushRecentMaterialName(name: string, current: string[]): string[] {
  const next = [name, ...current.filter((n) => n !== name)].slice(0, RECENT_MATERIALS_MAX);
  saveRecentMaterialNames(next);
  return next;
}

function SearchMagnifierIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
      focusable={false}
      className="ewo-material-search-icon"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5 13.5 13.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden
      focusable={false}
      className="ewo-plus-icon"
    >
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </svg>
  );
}

function FontLedgerLabel({ text }: { text: string }) {
  const space = text.indexOf(" ");
  if (space < 0) return <strong>{text}</strong>;
  return (
    <>
      <strong>{text.slice(0, space)}</strong>
      {text.slice(space)}
    </>
  );
}

const FONT_LEDGER_ROWS: {
  key: keyof WorkOrderFontSettings;
  label: string;
  inputAria: string;
}[] = [
  { key: "material", label: "Material rows", inputAria: "Mat pt" },
  { key: "material_total1", label: "Material total 1", inputAria: "Mat T1 pt" },
  { key: "material_total2", label: "Material total 2", inputAria: "Mat T2 pt" },
  { key: "labor", label: "Labor rows", inputAria: "Labor pt" },
  { key: "labor_total", label: "Labor total 1", inputAria: "Lab T1 pt" },
  { key: "labor_total2", label: "Labor total 2", inputAria: "Lab T2 pt" },
  { key: "grand_total", label: "Grand total", inputAria: "Grand pt" },
];

function MaterialsPanel(p: Props) {
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [recentNames, setRecentNames] = useState<string[]>(() => loadRecentMaterialNames());
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return p.materials;
    return p.materials.filter((m) => {
      const name = m.name.toLowerCase();
      const category = (m.category || "General").toLowerCase();
      return name.includes(q) || category.includes(q);
    });
  }, [p.materials, query]);

  const recentItems = useMemo(() => {
    return recentNames
      .map((name) => p.materials.find((m) => m.name === name))
      .filter((m): m is WorkOrderMaterialCatalogItem => Boolean(m));
  }, [recentNames, p.materials]);

  const selectedItem = useMemo(
    () => p.materials.find((m) => m.name === p.selectedMaterial) ?? null,
    [p.materials, p.selectedMaterial],
  );

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, matches.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mat-index="${highlightIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  function selectMaterial(name: string) {
    p.onSelectedMaterialChange(name);
  }

  function clearSelection() {
    p.onSelectedMaterialChange("");
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!matches.length) return;
      setHighlightIndex((i) => Math.min(i + 1, matches.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!matches.length) return;
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = matches[highlightIndex];
      if (hit) selectMaterial(hit.name);
    }
  }

  function onAddMaterial() {
    if (!p.selectedMaterial) return;
    const name = p.selectedMaterial;
    if (!p.onAddMaterialToCanvas()) return;
    setRecentNames((prev) => pushRecentMaterialName(name, prev));
  }

  return (
    <div className="ewo-editor-tab-panel stack ewo-mat-labor-panel">
      <section className="ewo-panel-section">
        <h3 className="ewo-panel-section-title">Material</h3>

        {recentItems.length > 0 && (
          <div className="ewo-material-recents" aria-label="Recent materials">
            <span className="ewo-material-recents-label muted">Recent:</span>
            {recentItems.map((m) => (
              <button
                key={m.name}
                type="button"
                className={`ewo-material-recent-chip${p.selectedMaterial === m.name ? " ewo-material-recent-chip--active" : ""}`}
                onClick={() => selectMaterial(m.name)}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        <div className="ewo-material-search">
          <SearchMagnifierIcon />
          <input
            type="search"
            className="ewo-material-search-input"
            value={query}
            placeholder="Search materials…"
            aria-label="Search materials"
            aria-controls="ewo-material-results"
            aria-autocomplete="list"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>

        <div
          id="ewo-material-results"
          className="ewo-material-results"
          role="listbox"
          aria-label="Material search results"
          ref={listRef}
        >
          {matches.length === 0 ? (
            <p className="ewo-material-empty muted">
              No matches — add items in{" "}
              <Link to="/settings" state={{ tab: "work-orders" }}>
                Settings → Work orders
              </Link>
            </p>
          ) : (
            matches.map((m, index) => {
              const selected = p.selectedMaterial === m.name;
              const highlighted = index === highlightIndex;
              return (
                <button
                  key={m.name}
                  type="button"
                  role="option"
                  data-mat-index={index}
                  aria-selected={selected}
                  className={`ewo-material-result${highlighted ? " ewo-material-result--highlight" : ""}${selected ? " ewo-material-result--selected" : ""}`}
                  onClick={() => selectMaterial(m.name)}
                  onMouseEnter={() => setHighlightIndex(index)}
                >
                  <span className="ewo-material-result-name">{m.name}</span>
                  <span className="ewo-material-result-category">{m.category || "General"}</span>
                  <span className="ewo-material-result-price">{formatMoney(materialUnitPrice(m))}</span>
                </button>
              );
            })
          )}
        </div>

        {selectedItem && (
          <div className="ewo-material-selected" role="status">
            <span className="ewo-material-selected-name">{selectedItem.name}</span>
            <span className="ewo-material-selected-price muted">
              {formatMoney(materialUnitPrice(selectedItem))}
            </span>
            <button
              type="button"
              className="ewo-material-selected-clear"
              aria-label="Clear selected material"
              onClick={clearSelection}
            >
              ✕
            </button>
          </div>
        )}

        <div className="ewo-inline-action-row">
          <label className="ewo-field ewo-field--qty">
            <span className="ewo-field-label">Qty</span>
            <input
              type="number"
              min={0}
              step={1}
              value={p.materialQty}
              onChange={(e) => p.onMaterialQtyChange(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm ewo-add-btn"
            disabled={!p.selectedMaterial}
            onClick={onAddMaterial}
          >
            <PlusIcon />
            Add material
          </button>
        </div>
        <p className="ewo-panel-footnote muted">
          Library items come from{" "}
          <Link to="/settings" state={{ tab: "work-orders" }}>
            Settings → Work orders
          </Link>
        </p>
      </section>

      <section className="ewo-panel-section">
        <h3 className="ewo-panel-section-title">Labor</h3>
        <div className="ewo-inline-action-row">
          <label className="ewo-field ewo-field--qty">
            <span className="ewo-field-label">Hours</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={p.form.hours || ""}
              onChange={(e) => p.onFieldChange("hours", Number(e.target.value) || 0)}
            />
          </label>
          <label className="ewo-field ewo-field--flex">
            <span className="ewo-field-label">Rate</span>
            <select
              className="ewo-dark-select"
              value={p.form.labor_rate_name}
              onChange={(e) => p.onLaborRateChange(e.target.value)}
            >
              <option value="">— Select —</option>
              {p.laborRates.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="btn btn-secondary btn-sm ewo-add-btn" onClick={p.onAddLaborToCanvas}>
          <PlusIcon />
          Add labor
        </button>
      </section>

      <section className="ewo-panel-section">
        <h3 className="ewo-panel-section-title">Quick add</h3>
        <div className="ewo-inline-action-row">
          <label className="ewo-field ewo-field--flex">
            <span className="ewo-field-label">Parking $</span>
            <input value={p.parkingAmount} onChange={(e) => p.onParkingAmountChange(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm ewo-add-btn ewo-add-btn--compact"
            onClick={p.onAddParkingToCanvas}
          >
            <PlusIcon />
            Parking
          </button>
        </div>
        <div className="ewo-inline-action-row">
          <label className="ewo-field ewo-field--qty">
            <span className="ewo-field-label">Sup. hrs</span>
            <input value={p.supervisionHours} onChange={(e) => p.onSupervisionHoursChange(e.target.value)} />
          </label>
          <label className="ewo-field ewo-field--flex">
            <span className="ewo-field-label">Rate</span>
            <input value={p.supervisionRate} onChange={(e) => p.onSupervisionRateChange(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm ewo-add-btn ewo-add-btn--compact"
            onClick={p.onAddSupervisionToCanvas}
          >
            <PlusIcon />
            Add
          </button>
        </div>
      </section>
    </div>
  );
}

function OtherPanel(p: Props) {
  return (
    <div className="ewo-editor-tab-panel stack ewo-other-panel">
      {p.hasDocument && (
        <details className="ewo-panel-details">
          <summary className="ewo-panel-details-summary">
            <span className="ewo-panel-details-chevron" aria-hidden="true" />
            Enhance scan
          </summary>
          <div className="ewo-panel-details-body stack">
            {(
              [
                ["ink", "Ink", "Darken"],
                ["paper", "Paper", "Lighten"],
                ["contrast", "Contrast", undefined],
                ["sharpness", "Sharpness", undefined],
              ] as const
            ).map(([key, label, tip]) => (
              <div key={key} className="ewo-slider-row">
                <span className="ewo-slider-label ewo-slider-label--scan" title={tip}>
                  {label}
                </span>
                <input
                  type="range"
                  className="ewo-range"
                  min={0}
                  max={100}
                  value={p.form.scan_enhance[key]}
                  aria-label={tip ? `${label} (${tip.toLowerCase()})` : label}
                  onChange={(e) =>
                    p.onFieldChange("scan_enhance", {
                      ...p.form.scan_enhance,
                      [key]: Number(e.target.value),
                    })
                  }
                />
                <span className="ewo-value-pill">{p.form.scan_enhance[key]}</span>
              </div>
            ))}
            <button type="button" className="ewo-quiet-reset" onClick={p.onResetScanEnhance}>
              Reset
            </button>
          </div>
        </details>
      )}

      <section className="ewo-panel-section">
        <h3 className="ewo-panel-section-title">Line spacing</h3>
        <div className="ewo-slider-row">
          <span className="ewo-slider-label">Material</span>
          <input
            type="range"
            className="ewo-range"
            min={MIN_OVERLAY_SPACING}
            max={MAX_OVERLAY_SPACING}
            value={p.form.text_spacing.material}
            onChange={(e) =>
              p.onFieldChange("text_spacing", {
                ...p.form.text_spacing,
                material: Number(e.target.value),
              })
            }
            aria-label="Material spacing"
          />
          <span className="ewo-value-pill">{p.form.text_spacing.material}</span>
        </div>
        <div className="ewo-slider-row">
          <span className="ewo-slider-label">Labor</span>
          <input
            type="range"
            className="ewo-range"
            min={MIN_OVERLAY_SPACING}
            max={MAX_OVERLAY_SPACING}
            value={p.form.text_spacing.labor}
            onChange={(e) =>
              p.onFieldChange("text_spacing", {
                ...p.form.text_spacing,
                labor: Number(e.target.value),
              })
            }
            aria-label="Labor spacing"
          />
          <span className="ewo-value-pill">{p.form.text_spacing.labor}</span>
        </div>
      </section>

      <section className="ewo-panel-section">
        <h3 className="ewo-panel-section-title">Text appearance</h3>
        <div className="ewo-font-ledger" role="table" aria-label="Text appearance">
          {FONT_LEDGER_ROWS.map(({ key, label, inputAria }) => (
            <div key={key} className="ewo-font-ledger-row" role="row">
              <span className="ewo-font-ledger-label" role="rowheader">
                <FontLedgerLabel text={label} />
              </span>
              <span className="ewo-font-ledger-cell" role="cell">
                <input
                  type="number"
                  min={8}
                  max={36}
                  className="ewo-font-pt-input"
                  value={p.fonts[key] as number}
                  aria-label={inputAria}
                  title={inputAria}
                  onChange={(e) => p.onFontsChange({ ...p.fonts, [key]: Number(e.target.value) || 14 })}
                />
              </span>
            </div>
          ))}
          <div className="ewo-font-ledger-row" role="row">
            <span className="ewo-font-ledger-label" role="rowheader">
              <FontLedgerLabel text="Overlay color" />
            </span>
            <span className="ewo-font-ledger-cell" role="cell">
              <input
                type="color"
                className="ewo-font-color-input"
                value={p.fonts.overlay_color}
                aria-label="Overlay color"
                onChange={(e) => p.onFontsChange({ ...p.fonts, overlay_color: e.target.value })}
              />
            </span>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm ewo-apply-fonts-btn" onClick={p.onApplyFontsToAll}>
          Apply font settings
        </button>
        <p className="ewo-panel-footnote muted">
          Applies to this document · defaults in{" "}
          <Link to="/settings" state={{ tab: "work-orders" }}>
            Settings → Work orders
          </Link>
        </p>
      </section>
    </div>
  );
}
