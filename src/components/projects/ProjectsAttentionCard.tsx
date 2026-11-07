import { Link } from "react-router-dom";
import { DashboardTablerIcon } from "../jobinfo/DashboardTablerIcon";
import {
  formatProjectUpdatedShort,
  type ProjectsSpotlight,
} from "../../lib/projectListSummary";

type Props = {
  spotlight: ProjectsSpotlight;
};

export function ProjectsAttentionCard({ spotlight }: Props) {
  if (spotlight.kind === "clear") {
    return (
      <div className="projects-attention-card projects-attention-card--clear" role="status">
        <div className="projects-attention-card-main">
          <div className="projects-attention-card-eyebrow">
            <DashboardTablerIcon name="check" size={14} />
            All clear
          </div>
          <span className="projects-attention-card-title">No open attention flags</span>
          <span className="projects-attention-card-meta muted small">
            {spotlight.projectCount} active job{spotlight.projectCount === 1 ? "" : "s"} running clean
          </span>
        </div>
        <div className="projects-attention-card-stat">
          <span className="projects-attention-card-stat-label muted small">Open flags</span>
          <strong className="projects-attention-card-stat-value">0</strong>
        </div>
      </div>
    );
  }

  const { project, summary, totalFlags, jobCount, daysStale } = spotlight;
  const title = `${project.job_number} — ${project.job_name || "Untitled job"}`;
  const staleLabel = daysStale === 0 ? "updated today" : `${daysStale}d stale`;

  return (
    <Link
      className="projects-attention-card"
      to={`/projects/${project.id}`}
      title={`Most attention needed · last updated ${formatProjectUpdatedShort(project.updated_at)}`}
    >
      <div className="projects-attention-card-main">
        <div className="projects-attention-card-eyebrow">
          <DashboardTablerIcon name="flag" size={14} />
          Most attention
        </div>
        <span className="projects-attention-card-title">{title}</span>
        <span className="projects-attention-card-flags-pill">
          {summary.attentionCount} flag{summary.attentionCount === 1 ? "" : "s"}
        </span>
        <span className="projects-attention-card-meta muted small">
          {summary.submittalStage} · {staleLabel}
        </span>
      </div>
      <div className="projects-attention-card-stat">
        <span className="projects-attention-card-stat-label muted small">Open flags</span>
        <strong className="projects-attention-card-stat-value">{totalFlags}</strong>
        <span className="muted small">
          · {jobCount} job{jobCount === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}
