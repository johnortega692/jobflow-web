import {
  WC_COMPONENT_TYPES,
  WC_COMPONENT_TYPE_LABEL,
  WC_FABRIC_STAGES,
  applyComponentStage,
  componentStatus,
  componentTag,
  emptyWcComponent,
  shipToLabel,
  submittalModeLabel,
  type WcComponent,
  type WcComponentSubmittalMode,
  type WcComponentType,
  type WcShipTo,
} from "../../lib/wcComponents";
import { WC_LINE_STAGES, wcStatusLabel, type WcFieldStatus } from "../../lib/fieldTrackerStatus";

type Props = {
  parentLabel: string;
  components: WcComponent[];
  mode: "submittal" | "tracker";
  panels?: boolean;
  fabricatedAssembly?: boolean;
  shopDrawings?: boolean;
  e84ClassA?: boolean;
  onChange: (components: WcComponent[]) => void;
  onPanelFlags?: (patch: { fabricatedAssembly?: boolean; shopDrawings?: boolean; e84ClassA?: boolean }) => void;
};

const UNITS = ["LF", "SF", "YD", "EA"];

export function WcComponentEditor({
  parentLabel,
  components,
  mode,
  panels,
  fabricatedAssembly,
  shopDrawings,
  e84ClassA,
  onChange,
  onPanelFlags,
}: Props) {
  function patchAt(index: number, patch: Partial<WcComponent>) {
    onChange(components.map((component, i) => (i === index ? { ...component, ...patch } : component)));
  }

  return (
    <div className="wc-components">
      <div className="row-between wrap">
        <p className="wc-components-title">Components</p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...components, emptyWcComponent("trim", parentLabel)])}
        >
          Add component
        </button>
      </div>
      {panels && onPanelFlags ? (
        <div className="wc-component-flags">
          <label className="wc-inline-check">
            <input
              type="checkbox"
              checked={Boolean(fabricatedAssembly)}
              onChange={(event) => onPanelFlags({ fabricatedAssembly: event.target.checked })}
            />
            Fabricated assembly
          </label>
          <label className="wc-inline-check">
            <input
              type="checkbox"
              checked={Boolean(shopDrawings)}
              onChange={(event) => onPanelFlags({ shopDrawings: event.target.checked })}
            />
            Shop drawings
          </label>
          <label className="wc-inline-check">
            <input
              type="checkbox"
              checked={Boolean(e84ClassA)}
              onChange={(event) => onPanelFlags({ e84ClassA: event.target.checked })}
            />
            E84 Class A
          </label>
        </div>
      ) : null}
      {components.length > 0 ? (
        <div className="wc-component-table">
          {components.map((component, index) => (
            <div key={component.id} className="wc-component-row">
              <select
                aria-label="Component type"
                value={component.type}
                onChange={(event) => {
                  const type = event.target.value as WcComponentType;
                  const next = emptyWcComponent(type, parentLabel);
                  patchAt(index, {
                    type,
                    unit: next.unit,
                    shipTo: next.shipTo,
                    submittal: next.submittal,
                    tag: componentTag(parentLabel, type),
                    fromGotTrack: false,
                  });
                }}
              >
                {WC_COMPONENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {WC_COMPONENT_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Component item"
                value={component.item}
                placeholder="Item"
                onChange={(event) => patchAt(index, { item: event.target.value, fromGotTrack: false })}
              />
              <input
                aria-label="Finish or spec"
                value={component.finish}
                placeholder="Finish"
                onChange={(event) => patchAt(index, { finish: event.target.value, fromGotTrack: false })}
              />
              <input
                aria-label="Vendor"
                value={component.vendor}
                placeholder="Vendor"
                onChange={(event) => patchAt(index, { vendor: event.target.value, fromGotTrack: false })}
              />
              <input
                aria-label="Quantity"
                value={component.qty}
                placeholder="Qty"
                onChange={(event) => patchAt(index, { qty: event.target.value })}
              />
              <select
                aria-label="Unit"
                value={UNITS.includes(component.unit) ? component.unit : component.unit}
                onChange={(event) => patchAt(index, { unit: event.target.value })}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <select
                aria-label="Ship to"
                value={component.shipTo}
                onChange={(event) => patchAt(index, { shipTo: event.target.value as WcShipTo })}
              >
                {(["jobsite", "fabricator", "shop"] as WcShipTo[]).map((shipTo) => (
                  <option key={shipTo} value={shipTo}>
                    {shipToLabel(shipTo)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Submittal"
                value={component.submittal}
                onChange={(event) =>
                  patchAt(index, { submittal: event.target.value as WcComponentSubmittalMode, fromGotTrack: false })
                }
              >
                {(["sample", "data", "track"] as WcComponentSubmittalMode[]).map((submittal) => (
                  <option key={submittal} value={submittal}>
                    {submittalModeLabel(submittal)}
                  </option>
                ))}
              </select>
              {mode === "tracker" ? (
                component.type === "fabric" && component.shipTo === "fabricator" ? (
                  <select
                    aria-label="Fabric status"
                    value={component.fabricStage || "ordered"}
                    onChange={(event) => {
                      const next = event.target.value as WcComponent["fabricStage"];
                      const rank = ["ordered", "at_fabricator", "in_fabrication", "shipped", "delivered"];
                      const currentRank = rank.indexOf(component.fabricStage || "ordered");
                      const nextRank = rank.indexOf(next);
                      const stage =
                        nextRank > rank.indexOf("at_fabricator") && currentRank < rank.indexOf("at_fabricator")
                          ? "at_fabricator"
                          : next;
                      patchAt(index, { fabricStage: stage });
                    }}
                  >
                    {WC_FABRIC_STAGES.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    aria-label="Component status"
                    value={componentStatus(component)}
                    onChange={(event) =>
                      onChange(
                        components.map((row, i) =>
                          i === index ? applyComponentStage(row, event.target.value as WcFieldStatus) : row,
                        ),
                      )
                    }
                  >
                    {WC_LINE_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {wcStatusLabel(stage)}
                      </option>
                    ))}
                  </select>
                )
              ) : null}
              {mode === "tracker" && component.type === "fabric" ? (
                <>
                  <input
                    aria-label="Yards required"
                    value={component.yardsRequired}
                    placeholder="Yards required"
                    onChange={(event) => patchAt(index, { yardsRequired: event.target.value })}
                  />
                  <input
                    aria-label="Yards sent"
                    value={component.yardsSent}
                    placeholder="Yards sent"
                    onChange={(event) => patchAt(index, { yardsSent: event.target.value })}
                  />
                  {component.yardsRequired.trim() ? (
                    <span className="wc-component-tag">
                      {component.yardsSent.trim() || "0"} / {component.yardsRequired} YD
                    </span>
                  ) : null}
                </>
              ) : null}
              <span className="wc-component-tag">{component.tag}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onChange(components.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">No components yet. Trim, core, fabric, and mounting live under this finish.</p>
      )}
    </div>
  );
}
