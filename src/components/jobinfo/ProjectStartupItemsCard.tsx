import { useEffect, useState } from "react";
import { STARTUP_CHECKLIST_GROUP_META, STARTUP_SOURCE_LABELS } from "../../config/projectStartupItemsCatalog";
import { DashboardTablerIcon } from "./DashboardTablerIcon";
import {
  dueBadgeForItem,
  groupProgress,
  itemsForGroup,
  startupGroupsWithEnabledItems,
  startupItemsProgress,
  type StartupChecklistGroup,
  type StartupChecklistItem,
  type StartupItemsState,
} from "../../lib/projectStartupItems";
import type { JobInfoData } from "../../types/jobInfo";

type Props = {
  items: StartupItemsState;
  jobInfo: JobInfoData;
  focus?: { group: StartupChecklistGroup; itemId: string } | null;
  onFocusHandled?: () => void;
  onOpenJobSetup: () => void;
  onConfigureStartup?: () => void;
  onToggleManualItem: (itemId: string, complete: boolean) => void;
  savingId: string | null;
};

function groupCountClass(done: number, total: number): string {
  if (total === 0) return "muted";
  if (done === total) return "job-startup-group-count--done";
  if (done === 0) return "job-startup-group-count--none";
  return "job-startup-group-count--partial";
}

function ItemRow({
  item,
  jobInfo,
  highlighted,
  saving,
  onToggle,
  onOpenJobSetup,
}: {
  item: StartupChecklistItem;
  jobInfo: JobInfoData;
  highlighted: boolean;
  saving: boolean;
  onToggle: (complete: boolean) => void;
  onOpenJobSetup: () => void;
}) {
  const dueBadge = dueBadgeForItem(item, jobInfo);
  const isManual = item.source === "manual";
  const canToggle = isManual && !saving;

  return (
    <div
      className={`job-startup-item${item.complete ? " job-startup-item--done" : ""}${highlighted ? " job-startup-item--highlight" : ""}`}
      id={`startup-item-${item.id}`}
    >
      <button
        type="button"
        className="job-startup-item-main"
        disabled={!canToggle}
        onClick={() => {
          if (!canToggle) return;
          onToggle(!item.complete);
        }}
      >
        <span className={`job-startup-item-check${item.complete ? " job-startup-item-check--done" : ""}`} aria-hidden>
          {item.complete ? <DashboardTablerIcon name="check" size={12} /> : null}
        </span>
        <span className={`job-startup-item-label${item.complete ? " job-startup-item-label--done" : ""}`}>
          {item.label}
        </span>
      </button>
      <div className="job-startup-item-badges">
        {item.source !== "manual" && (
          <span className="job-startup-badge job-startup-badge--source">
            auto · {STARTUP_SOURCE_LABELS[item.source]}
          </span>
        )}
        {item.blocking && !item.complete && (
          <span className="job-startup-badge job-startup-badge--blocking">blocking</span>
        )}
        {dueBadge &&
          (dueBadge.label === "set start date" ? (
            <button
              type="button"
              className={`job-startup-badge job-startup-badge--due job-startup-badge--due-${dueBadge.tone}`}
              onClick={onOpenJobSetup}
            >
              {dueBadge.label}
            </button>
          ) : (
            <span className={`job-startup-badge job-startup-badge--due job-startup-badge--due-${dueBadge.tone}`}>
              {dueBadge.label}
            </span>
          ))}
      </div>
    </div>
  );
}

export function ProjectStartupItemsCard({
  items,
  jobInfo,
  focus,
  onFocusHandled,
  onOpenJobSetup,
  onConfigureStartup,
  onToggleManualItem,
  savingId,
}: Props) {
  const progress = startupItemsProgress(items);
  const groups = startupGroupsWithEnabledItems(items);
  const [expanded, setExpanded] = useState<StartupChecklistGroup | null>(null);

  useEffect(() => {
    if (!focus) return;
    setExpanded(focus.group);
    requestAnimationFrame(() => {
      document.getElementById(`startup-item-${focus.itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusHandled?.();
    });
  }, [focus, onFocusHandled]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="job-startup-items-card stack">
      <div className="job-startup-items-head">
        <div className="row-between wrap gap">
          <h3 className="job-startup-stepper-title">Project startup</h3>
          <span className="job-startup-stepper-count muted small">
            {progress.done}/{progress.total}
          </span>
        </div>
        <div className="job-startup-progress" aria-hidden>
          <div className="job-startup-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="job-startup-groups">
        {groups.map((group) => {
          const meta = STARTUP_CHECKLIST_GROUP_META[group];
          const groupItems = itemsForGroup(items, group);
          const { done, total } = groupProgress(items, group);
          const open = expanded === group;

          return (
            <div key={group} className={`job-startup-group${open ? " job-startup-group--open" : ""}`}>
              <button type="button" className="job-startup-group-row" onClick={() => setExpanded(open ? null : group)}>
                <span className="job-startup-group-icon">
                  <DashboardTablerIcon name={meta.icon} size={16} />
                </span>
                <span className="job-startup-group-label">{meta.label}</span>
                <span className={`job-startup-group-count ${groupCountClass(done, total)}`}>
                  {done}/{total}
                </span>
                <DashboardTablerIcon name={open ? "chevron-down" : "chevron-right"} size={16} className="job-startup-group-chevron" />
              </button>
              {open && (
                <div className="job-startup-group-items">
                  {groupItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      jobInfo={jobInfo}
                      highlighted={focus?.itemId === item.id}
                      saving={savingId === item.id}
                      onToggle={(complete) => onToggleManualItem(item.id, complete)}
                      onOpenJobSetup={onOpenJobSetup}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted small job-startup-config-link">
        <button type="button" className="link-btn" onClick={onConfigureStartup ?? onOpenJobSetup}>
          Configure items · Job setup
        </button>
      </p>
    </div>
  );
}
