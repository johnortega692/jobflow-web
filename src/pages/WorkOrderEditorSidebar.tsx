import { Link } from "react-router-dom";
import { DateInput } from "../components/DateInput";
import { FONT_SETTING_FIELDS } from "../lib/workOrderFonts";
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

export type EwoEditorTab = "controls" | "materials" | "settings" | "other";

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
  materialCategories: string[];
  materialCategory: string;
  onMaterialCategoryChange: (v: string) => void;
  filteredMaterials: WorkOrderMaterialCatalogItem[];
  selectedMaterial: string;
  onSelectedMaterialChange: (v: string) => void;
  materialQty: string;
  onMaterialQtyChange: (v: string) => void;
  onAddMaterialToCanvas: () => void;
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
      <nav className="ewo-editor-tabs" aria-label="Work order editor sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`ewo-editor-tab${activeTab === tab.id ? " ewo-editor-tab--active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "controls" && <ControlsPanel {...props} />}
      {activeTab === "materials" && <MaterialsPanel {...props} />}
      {activeTab === "settings" && <SettingsPanel {...props} />}
      {activeTab === "other" && <OtherPanel {...props} />}
    </aside>
  );
}

function ControlsPanel(p: Props) {
  const fsi = computeBudgetFromCosts(p.totals.material_cost, p.totals.raw_cost, p.totals.indirects);

  return (
    <div className="ewo-editor-tab-panel stack">
      {p.pdfPages > 1 && (
        <label>
          PDF page
          <select value={p.sourcePdfPage} onChange={(e) => p.onPdfPageChange(Number(e.target.value))}>
            {Array.from({ length: p.pdfPages }, (_, i) => (
              <option key={i} value={i}>
                Page {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid-2">
        <label>
          EWO #
          <input
            value={p.ewoNumber}
            onChange={(e) => p.onEwoNumberChange(e.target.value)}
            placeholder={p.ocrBusy ? "Detecting…" : "From document"}
          />
        </label>
        <label>
          Job #
          <input value={p.projectJobNumber} readOnly className="readonly" title="From project" />
        </label>
      </div>

      <div className="grid-2">
        <label>
          EWO date
          <DateInput value={p.ewoDate} onChange={p.onEwoDateChange} />
        </label>
        <label className="check" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={p.delivered} onChange={(e) => p.onDeliveredChange(e.target.checked)} />
          Delivered to GC
        </label>
      </div>

      <div className="grid-2">
        <label className="check">
          <input
            type="checkbox"
            checked={p.form.gc_checked}
            onChange={(e) => p.onFieldChange("gc_checked", e.target.checked)}
          />
          GC approved
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.form.fsi_checked}
            onChange={(e) => p.onFieldChange("fsi_checked", e.target.checked)}
          />
          FSI approved
        </label>
      </div>

      {p.hasDocument && isPlaceholderEwoNumber(p.ewoNumber) && !p.ocrBusy && (
        <p className="muted small">Use Auto-Detect Fields below to read EWO # from the uploaded form.</p>
      )}

      <div className="budget-metrics-bar">
        <div className="budget-metric ok">
          <span className="muted small">Grand total</span>
          <strong>{formatMoney(p.totals.total_amount)}</strong>
        </div>
        <div className="budget-metric">
          <span className="muted small">Material</span>
          <strong>{formatMoney(p.totals.material_cost)}</strong>
        </div>
        <div className="budget-metric">
          <span className="muted small">Labor</span>
          <strong>{formatMoney(p.totals.labor_cost)}</strong>
        </div>
      </div>

      <details className="job-section" open>
        <summary className="job-section-summary">
          <h3>FSI budget</h3>
        </summary>
        <div className="budget-metrics-bar">
          <div className="budget-metric">
            <span className="muted small">Mat (90% up)</span>
            <strong>{formatMoney(fsi.material_minus_10)}</strong>
          </div>
          <div className="budget-metric">
            <span className="muted small">Indirects</span>
            <strong>{formatMoney(fsi.indirects)}</strong>
          </div>
          <div className="budget-metric">
            <span className="muted small">Raw labor</span>
            <strong>{formatMoney(fsi.raw_labor)}</strong>
          </div>
          <div className="budget-metric ok">
            <span className="muted small">Budget</span>
            <strong>{formatMoney(fsi.budget_total)}</strong>
          </div>
        </div>
      </details>

      <label>
        Notes
        <textarea rows={4} value={p.form.notes} onChange={(e) => p.onFieldChange("notes", e.target.value)} />
      </label>

      {p.hasDocument && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={p.ocrBusy || !p.backgroundUrl}
          onClick={() => void p.onAutoDetectFields()}
        >
          {p.ocrBusy ? "Detecting…" : "Auto-Detect Fields"}
        </button>
      )}

      {p.hasDocument && !p.ocrBusy && (
        <p className="muted small">Reads EWO #, date, and job number (when scan areas are set) from the form.</p>
      )}

      {p.hasDocument && (
        <details className="job-section">
          <summary className="job-section-summary">
            <h3>Enhance scan</h3>
          </summary>
          <div className="stack">
            {(
              [
                ["ink", "Ink (darken)"],
                ["paper", "Paper (lighten)"],
                ["contrast", "Contrast"],
                ["sharpness", "Sharpness"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.form.scan_enhance[key]}
                  onChange={(e) =>
                    p.onFieldChange("scan_enhance", {
                      ...p.form.scan_enhance,
                      [key]: Number(e.target.value),
                    })
                  }
                />
                <span className="muted small">{p.form.scan_enhance[key]}</span>
              </label>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={p.onResetScanEnhance}>
              Reset scan enhance
            </button>
          </div>
        </details>
      )}

      <h3 className="small">All overlays</h3>
      <div className="row-gap wrap">
        <button type="button" className="btn btn-secondary btn-sm" onClick={p.onInitializeTotals}>
          Place total fields
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!p.selectedOverlayId}
          onClick={p.onRemoveSelectedOverlay}
        >
          Remove selected
        </button>
      </div>

      {p.form.overlays.length > 0 && (
        <ul className="ewo-overlay-list">
          {p.form.overlays.map((o: WorkOrderOverlay) => (
            <li key={o.id}>
              <button
                type="button"
                className={`ewo-overlay-list-item${p.selectedOverlayId === o.id ? " active" : ""}`}
                onClick={() => p.onSelectOverlay(o.id)}
              >
                    <span className="muted small">{o.section}</span>
                    {o.section === "total" ? (
                      <>
                        {o.label} → {o.amount}
                      </>
                    ) : (
                      overlayDisplayText(o, p.form.display)
                    )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaterialsPanel(p: Props) {
  return (
    <div className="ewo-editor-tab-panel stack">
      <h3 className="small">Material (library)</h3>
      {p.materialCategories.length > 1 && (
        <label>
          Category
          <select value={p.materialCategory} onChange={(e) => p.onMaterialCategoryChange(e.target.value)}>
            <option value="">All categories</option>
            {p.materialCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Material
        <select value={p.selectedMaterial} onChange={(e) => p.onSelectedMaterialChange(e.target.value)}>
          <option value="">— Select —</option>
          {p.filteredMaterials.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({formatMoney(materialUnitPrice(m))})
            </option>
          ))}
        </select>
      </label>
      <label>
        Qty
        <input type="number" min={0} step={1} value={p.materialQty} onChange={(e) => p.onMaterialQtyChange(e.target.value)} />
      </label>
      <button type="button" className="btn btn-secondary" onClick={p.onAddMaterialToCanvas}>
        Add material to document
      </button>

      <h3 className="small">Labor</h3>
      <div className="grid-2">
        <label>
          Hours
          <input
            type="number"
            min={0}
            step={0.5}
            value={p.form.hours || ""}
            onChange={(e) => p.onFieldChange("hours", Number(e.target.value) || 0)}
          />
        </label>
        <label>
          Rate
          <select value={p.form.labor_rate_name} onChange={(e) => p.onLaborRateChange(e.target.value)}>
            <option value="">— Select —</option>
            {p.laborRates.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="btn btn-secondary" onClick={p.onAddLaborToCanvas}>
        Add labor to document
      </button>

      <h3 className="small">Quick add</h3>
      <div className="grid-2">
        <label>
          Parking $
          <input value={p.parkingAmount} onChange={(e) => p.onParkingAmountChange(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={p.onAddParkingToCanvas}>
          Add parking
        </button>
      </div>
      <div className="grid-3">
        <label>
          Supervision hrs
          <input value={p.supervisionHours} onChange={(e) => p.onSupervisionHoursChange(e.target.value)} />
        </label>
        <label>
          Rate
          <input value={p.supervisionRate} onChange={(e) => p.onSupervisionRateChange(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "end" }} onClick={p.onAddSupervisionToCanvas}>
          Add
        </button>
      </div>
    </div>
  );
}

function SettingsPanel(p: Props) {
  return (
    <div className="ewo-editor-tab-panel stack">
      {p.hasDocument ? (
        <section className="ewo-scan-setup stack">
          <h3 className="small">Setup Fields</h3>
          <p className="muted small">
            Define where OCR reads the EWO #, date, and job number on your form. Areas are saved to your account.
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
      ) : (
        <section className="stack">
          <h3 className="small">Setup Fields</h3>
          <p className="muted small">Upload a work order on the Controls tab to configure EWO, date, and job scan areas.</p>
        </section>
      )}

      <section className="stack">
        <h3 className="small">Text on document</h3>
        <div className="stack">
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_material_names}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_material_names: e.target.checked })
              }
            />
            Show material names
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_material_quantity}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_material_quantity: e.target.checked })
              }
            />
            Show material quantity
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_labor_names}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_labor_names: e.target.checked })
              }
            />
            Show labor rate names
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_hours}
              onChange={(e) => p.onFieldChange("display", { ...p.form.display, show_hours: e.target.checked })}
            />
            Show labor hours
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_supervision_hours}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_supervision_hours: e.target.checked })
              }
            />
            Show supervision hours
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_total_labels}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_total_labels: e.target.checked })
              }
            />
            Show total labels on canvas
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.export_totals}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, export_totals: e.target.checked })
              }
            />
            Include total labels on PDF export
          </label>
        </div>
      </section>

      <section className="stack">
        <h3 className="small">Totals on document</h3>
        <p className="muted small">
          Total fields appear on the canvas when you upload a form. Drag them to align with your template, then save
          the layout as your default.
        </p>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.onInitializeTotals}>
            Place / refresh totals
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!p.hasTotalOverlays}
            onClick={() => void p.onSaveTotalPositionsDefault()}
          >
            Save layout as default
          </button>
        </div>
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!p.hasTotalOverlays}
            onClick={p.onRestoreTotalPositions}
          >
            Restore saved layout
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!p.hasTotalOverlays}
            onClick={p.onResetFactoryTotalPositions}
          >
            Reset to factory defaults
          </button>
        </div>
        <div className="stack">
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_material_total_1}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_material_total_1: e.target.checked })
              }
            />
            Show Material Total 1
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.form.display.show_labor_total}
              onChange={(e) =>
                p.onFieldChange("display", { ...p.form.display, show_labor_total: e.target.checked })
              }
            />
            Show Labor Total 1
          </label>
        </div>
        <p className="muted small">
          Material Total 2, Labor Total 2, and Grand Total always export dollar amounts. Inline totals above can be
          hidden with the toggles above.
        </p>
      </section>
    </div>
  );
}

function OtherPanel(p: Props) {
  return (
    <div className="ewo-editor-tab-panel stack">
      <section className="stack">
        <h3 className="small">Line spacing</h3>
        <p className="muted small">Horizontal gap between name, hours, rate, and amount on each row (10–200).</p>
        <label>
          Material spacing
          <input
            type="range"
            min={MIN_OVERLAY_SPACING}
            max={MAX_OVERLAY_SPACING}
            value={p.form.text_spacing.material}
            onChange={(e) =>
              p.onFieldChange("text_spacing", {
                ...p.form.text_spacing,
                material: Number(e.target.value),
              })
            }
          />
          <span className="muted small">{p.form.text_spacing.material}</span>
        </label>
        <label>
          Labor spacing
          <input
            type="range"
            min={MIN_OVERLAY_SPACING}
            max={MAX_OVERLAY_SPACING}
            value={p.form.text_spacing.labor}
            onChange={(e) =>
              p.onFieldChange("text_spacing", {
                ...p.form.text_spacing,
                labor: Number(e.target.value),
              })
            }
          />
          <span className="muted small">{p.form.text_spacing.labor}</span>
        </label>
      </section>

      <h3 className="small">Text appearance</h3>
      <div className="stack">
        {FONT_SETTING_FIELDS.map(({ key, label }) => (
          <label key={key}>
            {label} (pt)
            <input
              type="number"
              min={8}
              max={36}
              value={p.fonts[key] as number}
              onChange={(e) => p.onFontsChange({ ...p.fonts, [key]: Number(e.target.value) || 14 })}
            />
          </label>
        ))}
        <label>
          Color
          <input
            type="color"
            value={p.fonts.overlay_color}
            onChange={(e) => p.onFontsChange({ ...p.fonts, overlay_color: e.target.value })}
          />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={p.onApplyFontsToAll}>
          Apply font settings
        </button>
        <p className="muted small">
          Saved defaults live in <Link to="/settings">Settings → Work orders</Link>. Apply font settings updates
          overlays on this document.
        </p>
      </div>
    </div>
  );
}
