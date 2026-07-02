import { useState } from "react";
import { DateInput } from "../DateInput";
import {
  STARTUP_CHECKLIST_CATALOG,
  STARTUP_CHECKLIST_GROUP_META,
  STARTUP_SOURCE_LABELS,
} from "../../config/projectStartupItemsCatalog";
import {
  addCalendarDaysIso,
  effectiveDueDateIso,
  isPublicWorksCatalogItem,
  isWallcoveringCatalogItem,
  newCustomStartupItemId,
  PRELIM_NOTICE_ITEM_ID,
  prelimDeadlineExplanation,
  prelimReferenceIso,
  type StartupChecklistGroup,
  type StartupChecklistItem,
  type StartupItemsState,
} from "../../lib/projectStartupItems";
import { isoDateToDisplay, toIsoDateValue } from "../../lib/dateInputUtils";
import type { JobInfoData } from "../../types/jobInfo";

type Props = {
  value: StartupItemsState;
  jobInfo: JobInfoData;
  onChange: (next: StartupItemsState) => void;
  embedded?: boolean;
};

const GROUPS = Object.keys(STARTUP_CHECKLIST_GROUP_META) as StartupChecklistGroup[];

function ConfigBadges({ item }: { item: StartupChecklistItem }) {
  const seed = STARTUP_CHECKLIST_CATALOG.find((s) => s.id === item.id);
  return (
    <div className="startup-config-badges">
      {item.blocking && <span className="startup-config-badge startup-config-badge--blocking">blocking</span>}
      {isPublicWorksCatalogItem(item.id) && (
        <span className="startup-config-badge startup-config-badge--public-works">public works</span>
      )}
      {isWallcoveringCatalogItem(item.id) && (
        <span className="startup-config-badge startup-config-badge--wallcovering">wallcovering</span>
      )}
      {item.source !== "manual" && (
        <span className="startup-config-badge startup-config-badge--auto">
          auto · {STARTUP_SOURCE_LABELS[item.source]}
        </span>
      )}
      {seed?.dateSensitive && !item.dueDateOverride && (
        <span className="startup-config-badge startup-config-badge--due">due date</span>
      )}
    </div>
  );
}

export function StartupChecklistConfigSection({ value, jobInfo, onChange, embedded }: Props) {
  const [customLabel, setCustomLabel] = useState("");
  const [customGroup, setCustomGroup] = useState<StartupChecklistGroup>("procurement_field");
  const [customBlocking, setCustomBlocking] = useState(false);

  function updateItem(id: string, patch: Partial<StartupChecklistItem>) {
    onChange({
      ...value,
      items: value.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  function toggleEnabled(id: string, enabled: boolean) {
    updateItem(id, { enabled });
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    const item: StartupChecklistItem = {
      id: newCustomStartupItemId(label),
      group: customGroup,
      label,
      source: "manual",
      blocking: customBlocking,
      dueDate: null,
      enabled: true,
      complete: false,
      completedBy: null,
      completedAt: null,
    };
    onChange({ ...value, items: [...value.items, item] });
    setCustomLabel("");
    setCustomBlocking(false);
  }

  function removeCustom(id: string) {
    onChange({ ...value, items: value.items.filter((item) => item.id !== id) });
  }

  function resetPrelimDueDate(item: StartupChecklistItem) {
    const ref = prelimReferenceIso(jobInfo);
    const derived = ref ? addCalendarDaysIso(ref, 20) : null;
    updateItem(item.id, { dueDateOverride: false, dueDate: derived });
  }

  const catalogIds = new Set(STARTUP_CHECKLIST_CATALOG.map((s) => s.id));
  const prelimExplanation = prelimDeadlineExplanation(jobInfo);

  const body = (
    <>
      <p className="muted small startup-config-help" style={{ marginTop: embedded ? 0 : undefined }}>
        Enabled items appear on the project dashboard checklist. Set due dates where needed or add custom tasks.
      </p>

      {jobInfo.public_works && (
        <p className="startup-config-status-strip startup-config-status-strip--public-works">
          Public works project — DIR registration and certified payroll items are enabled for this job.
        </p>
      )}

      {jobInfo.has_wallcovering && (
        <p className="startup-config-status-strip startup-config-status-strip--wallcovering">
          Wallcovering contract — wallcovering checklist items are enabled for this job.
        </p>
      )}

      {GROUPS.map((group) => {
        const meta = STARTUP_CHECKLIST_GROUP_META[group];
        const rows = value.items.filter((item) => item.group === group);
        if (!rows.length) return null;
        return (
          <div key={group} className="startup-config-group stack">
            <p className="paint-col-head">{meta.label}</p>
            {rows.map((item) => {
              const seed = STARTUP_CHECKLIST_CATALOG.find((s) => s.id === item.id);
              const isCustom = !catalogIds.has(item.id);
              const isPrelim = item.id === PRELIM_NOTICE_ITEM_ID;
              const derivedDue = isPrelim ? effectiveDueDateIso({ ...item, dueDateOverride: false }, jobInfo) : null;

              return (
                <div key={item.id} className="startup-config-row stack">
                  <div className="startup-config-row-head">
                    <label className="checkbox-row startup-config-enable">
                      <input
                        type="checkbox"
                        checked={item.enabled || item.complete}
                        disabled={item.complete && !item.enabled}
                        onChange={(e) => toggleEnabled(item.id, e.target.checked)}
                      />
                      <span className="startup-config-row-label">{item.label}</span>
                    </label>
                    <ConfigBadges item={item} />
                    {isCustom && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-small startup-config-remove"
                        onClick={() => removeCustom(item.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {item.enabled && seed?.dateSensitive && isPrelim && (
                    <div className="startup-config-due stack">
                      <p className="muted small startup-config-prelim-math" style={{ margin: 0 }}>
                        {prelimExplanation ??
                          "Calculated deadline: set start date or first furnishing date in Job info (+ 20 calendar days)."}
                      </p>
                      {item.dueDateOverride ? (
                        <label>
                          Manual override
                          <DateInput
                            value={item.dueDate ? isoDateToDisplay(item.dueDate) : ""}
                            onChange={(v) =>
                              updateItem(item.id, {
                                dueDate: v.trim() ? toIsoDateValue(v) : null,
                                dueDateOverride: true,
                              })
                            }
                          />
                        </label>
                      ) : derivedDue ? (
                        <p className="muted small" style={{ margin: 0 }}>
                          Due {isoDateToDisplay(derivedDue)}
                        </p>
                      ) : null}
                      {item.dueDateOverride ? (
                        <button type="button" className="link-btn small" onClick={() => resetPrelimDueDate(item)}>
                          Reset to calculated
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="link-btn small"
                          onClick={() =>
                            updateItem(item.id, {
                              dueDateOverride: true,
                              dueDate: derivedDue,
                            })
                          }
                        >
                          Override calculated date
                        </button>
                      )}
                    </div>
                  )}

                  {item.enabled && isCustom && (
                    <label className="checkbox-row startup-config-blocking">
                      <input
                        type="checkbox"
                        checked={item.blocking}
                        onChange={(e) => updateItem(item.id, { blocking: e.target.checked })}
                      />
                      Blocking — surfaces in Needs attention when incomplete
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="startup-config-add stack">
        <p className="paint-col-head">Add custom item</p>
        <div className="row-gap wrap startup-config-add-form">
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Task label…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <select value={customGroup} onChange={(e) => setCustomGroup(e.target.value as StartupChecklistGroup)}>
            {GROUPS.map((group) => (
              <option key={group} value={group}>
                {STARTUP_CHECKLIST_GROUP_META[group].label}
              </option>
            ))}
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={customBlocking}
              onChange={(e) => setCustomBlocking(e.target.checked)}
            />
            Blocking
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={addCustom} disabled={!customLabel.trim()}>
            Add item
          </button>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <section className="job-section card stack job-setup-tab-section startup-config-section">
        <h3 className="job-setup-tab-section-title">Startup checklist</h3>
        {body}
      </section>
    );
  }

  return (
    <details className="job-section card stack startup-config-section" open>
      <summary className="job-section-summary">
        <h3>Startup checklist</h3>
      </summary>
      {body}
    </details>
  );
}
