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
};

export function ProjectStatusBadge({ summary, tableMode = false }: Props) {
  if (isDueSoonOrOverdue(summary)) {
    const label = statusBadgeDueLabel(summary) ?? "Due";
    return (
      <span className="project-status-badge project-status-badge--due">
        <DashboardTablerIcon name="clock" size={12} />
        {label}
      </span>
    );
  }

  if (summary.attentionCount > 0) {
    return (
      <span className="project-status-badge project-status-badge--attention">
        <DashboardTablerIcon name="flag" size={12} />
        {summary.attentionCount}
      </span>
    );
  }

  if (tableMode) {
    return <span className="muted">—</span>;
  }

  return (
    <span className="project-status-badge project-status-badge--clear">
      <DashboardTablerIcon name="check" size={12} />
      Clear
    </span>
  );
}
