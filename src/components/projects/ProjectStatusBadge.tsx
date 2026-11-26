import { DashboardTablerIcon } from "../jobinfo/DashboardTablerIcon";
import {
  isDueSoonOrOverdue,
  statusBadgeDueLabel,
  type ProjectListSummary,
} from "../../lib/projectListSummary";

type Props = {
  summary: ProjectListSummary;
  /** Table column: show muted dash when clear instead of green pill. */
  tableMode?: boolean;
  /** Skip the empty dash when another pill already fills the cell. */
  suppressClear?: boolean;
};

export function ProjectStatusBadge({ summary, tableMode = false, suppressClear = false }: Props) {
  const due = isDueSoonOrOverdue(summary);
  const dueLabel = due ? statusBadgeDueLabel(summary) ?? "Due" : null;
  const rfiCount = summary.openRfiCount ?? 0;
  const flagCount = due ? rfiCount : summary.attentionCount;

  if (!dueLabel && flagCount <= 0) {
    if (suppressClear) return null;
    if (tableMode) return <span className="muted">—</span>;
    return (
      <span className="project-status-badge project-status-badge--clear">
        <DashboardTablerIcon name="check" size={12} />
        Clear
      </span>
    );
  }

  return (
    <span className="project-status-badge-row">
      {dueLabel ? (
        <span className="project-status-badge project-status-badge--due">
          <DashboardTablerIcon name="clock" size={12} />
          {dueLabel}
        </span>
      ) : null}
      {flagCount > 0 ? (
        <span className="project-status-badge project-status-badge--attention">
          <DashboardTablerIcon name="flag" size={12} />
          {flagCount}
        </span>
      ) : null}
    </span>
  );
}
