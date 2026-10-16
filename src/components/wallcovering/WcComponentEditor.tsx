import { useEffect, useState } from "react";
import {
  WC_COMPONENT_TYPES,
  WC_COMPONENT_TYPE_LABEL,
  WC_FABRIC_STAGES,
  applyComponentStage,
  componentStatus,
  componentTag,
  emptyWcComponent,
  shipToLabel,
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

const UNITS = ["LF", "EA", "SF", "YD"] as const;
const SHIP_OPTIONS: WcShipTo[] = ["jobsite", "shop", "fabricator"];

function qtyLabel(component: WcComponent): string {
  const qty = component.qty.trim();
  const unit = component.unit.trim();
  if (!qty && !unit) return "";
  return [qty || "—", unit].filter(Boolean).join(" ");
}

function modeValue(submittal: WcComponentSubmittalMode): "track" | "order" {
  return submittal === "track" ? "track" : "order";
}

function Seg<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  ariaLabel: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="wc-comp-seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "is-on" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const [openId, setOpenId] = useState<string | null>(components[0]?.id ?? null);

  useEffect(() => {
    if (!components.length) {
      setOpenId(null);
      return;
    }
    if (openId && components.some((row) => row.id === openId)) return;
    setOpenId(components[0]?.id ?? null);
  }, [components, openId]);

  function patchAt(index: number, patch: Partial<WcComponent>) {
    onChange(components.map((component, i) => (i === index ? { ...component, ...patch } : component)));
  }

  function addComponent() {
    const next = emptyWcComponent("trim", parentLabel);
    onChange([...components, next]);
    setOpenId(next.id);
  }

  return (
    <div className="wc-components">
      <div className="wc-components-head">
        <p className="wc-components-title">
          Components
          {components.length ? <span className="wc-components-count"> · {components.length}</span> : null}
        </p>
        <button type="button" className="wc-comp-add" onClick={addComponent}>
          + Add component
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
        <div className="wc-comp-list">
          {components.map((component, index) => {
            const open = openId === component.id;
            const status = componentStatus(component);
            return (
              <article key={component.id} className={`wc-comp-card${open ? " is-open" : ""}`}>
                <div className="wc-comp-summary">
                  <button
                    type="button"
                    className="wc-comp-toggle"
                    aria-expanded={open}
                    aria-label={open ? "Collapse component" : "Expand component"}
                    onClick={() => setOpenId(open ? null : component.id)}
                  >
                    <span className={`wc-comp-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
                  </button>
                  <span className="wc-comp-tag">{component.tag}</span>
                  <button
                    type="button"
                    className="wc-comp-title"
                    onClick={() => setOpenId(open ? null : component.id)}
                  >
                    <strong>{WC_COMPONENT_TYPE_LABEL[component.type]}</strong>
                    {component.item.trim() || component.finish.trim() ? (
                      <span>
                        {" "}
                        · {[component.item.trim(), component.finish.trim()].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </button>
                  <span className="wc-comp-ship">{shipToLabel(component.shipTo)}</span>
                  {qtyLabel(component) ? <span className="wc-comp-qty">{qtyLabel(component)}</span> : null}
                  {mode === "tracker" ? (
                    component.type === "fabric" && component.shipTo === "fabricator" ? (
                      <select
                        className="wc-comp-status"
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
                        onClick={(event) => event.stopPropagation()}
                      >
                        {WC_FABRIC_STAGES.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className="wc-comp-status"
                        aria-label="Component status"
                        value={status}
                        onChange={(event) =>
                          onChange(
                            components.map((row, i) =>
                              i === index ? applyComponentStage(row, event.target.value as WcFieldStatus) : row,
                            ),
                          )
                        }
                        onClick={(event) => event.stopPropagation()}
                      >
                        {WC_LINE_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {wcStatusLabel(stage)}
                          </option>
                        ))}
                      </select>
                    )
                  ) : null}
                </div>

                {open ? (
                  <div className="wc-comp-body">
                    <div className="wc-comp-grid wc-comp-grid-main">
                      <label className="wc-comp-field">
                        <span>Type</span>
                        <select
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
                      </label>
                      <label className="wc-comp-field">
                        <span>Item</span>
                        <input
                          value={component.item}
                          placeholder="Item"
                          onChange={(event) => patchAt(index, { item: event.target.value, fromGotTrack: false })}
                        />
                      </label>
                      <label className="wc-comp-field">
                        <span>Finish</span>
                        <input
                          value={component.finish}
                          placeholder="Finish"
                          onChange={(event) => patchAt(index, { finish: event.target.value, fromGotTrack: false })}
                        />
                      </label>
                      <label className="wc-comp-field">
                        <span>Vendor</span>
                        <input
                          value={component.vendor}
                          placeholder="Vendor"
                          onChange={(event) => patchAt(index, { vendor: event.target.value, fromGotTrack: false })}
                        />
                      </label>
                    </div>

                    <div className="wc-comp-grid wc-comp-grid-meta">
                      <label className="wc-comp-field wc-comp-field-qty">
                        <span>Qty</span>
                        <input
                          value={component.qty}
                          placeholder="Qty"
                          onChange={(event) => patchAt(index, { qty: event.target.value })}
                        />
                      </label>
                      <div className="wc-comp-field">
                        <span>Unit</span>
                        <Seg
                          ariaLabel="Unit"
                          value={component.unit.trim() || "LF"}
                          options={(
                            UNITS.includes(component.unit as (typeof UNITS)[number]) || !component.unit.trim()
                              ? [...UNITS]
                              : [component.unit, ...UNITS]
                          ).map((unit) => ({ value: unit, label: unit }))}
                          onChange={(unit) => patchAt(index, { unit })}
                        />
                      </div>
                      <div className="wc-comp-field">
                        <span>Ship to</span>
                        <Seg
                          ariaLabel="Ship to"
                          value={component.shipTo}
                          options={SHIP_OPTIONS.map((shipTo) => ({ value: shipTo, label: shipToLabel(shipTo) }))}
                          onChange={(shipTo) => patchAt(index, { shipTo })}
                        />
                      </div>
                    </div>

                    <div className="wc-comp-grid wc-comp-grid-mode">
                      <div className="wc-comp-field">
                        <span>Mode</span>
                        <Seg
                          ariaLabel="Mode"
                          value={modeValue(component.submittal)}
                          options={[
                            { value: "track", label: "Track only" },
                            { value: "order", label: "Order" },
                          ]}
                          onChange={(next) =>
                            patchAt(index, {
                              submittal: next === "track" ? "track" : component.submittal === "data" ? "data" : "sample",
                              fromGotTrack: false,
                            })
                          }
                        />
                      </div>
                      {mode === "tracker" && component.type === "fabric" ? (
                        <>
                          <label className="wc-comp-field">
                            <span>Yards required</span>
                            <input
                              value={component.yardsRequired}
                              placeholder="Yards required"
                              onChange={(event) => patchAt(index, { yardsRequired: event.target.value })}
                            />
                          </label>
                          <label className="wc-comp-field">
                            <span>Yards sent</span>
                            <input
                              value={component.yardsSent}
                              placeholder="Yards sent"
                              onChange={(event) => patchAt(index, { yardsSent: event.target.value })}
                            />
                          </label>
                        </>
                      ) : (
                        <span className="wc-comp-spacer" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="wc-comp-remove"
                        onClick={() => {
                          const next = components.filter((_, i) => i !== index);
                          onChange(next);
                          if (openId === component.id) setOpenId(next[0]?.id ?? null);
                        }}
                      >
                        <TrashIcon />
                        Remove
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted small">No components yet. Trim, core, fabric, and mounting live under this finish.</p>
      )}
    </div>
  );
}
