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
          <div className="projects-attention-card-title-row">
            <span className="projects-attention-card-title">No open attention flags</span>
          </div>
          <div className="projects-attention-card-meta muted small">
            All {spotlight.projectCount} active project{spotlight.projectCount === 1 ? "" : "s"}{" "}
            {spotlight.projectCount === 1 ? "is" : "are"} running clean
          </div>
        </div>
        <div className="projects-attention-card-stat">
          <span className="projects-attention-card-stat-label muted small">Open flags</span>
          <div className="projects-attention-card-stat-row">
            <strong className="projects-attention-card-stat-value">0</strong>
          </div>
        </div>
      </div>
    );
  }

  const { project, summary, totalFlags, jobCount, daysStale } = spotlight;
  const title = `${project.job_number} — ${project.job_name || "Untitled job"}`;
  const staleLabel =
    daysStale === 0
      ? "updated today"
      : daysStale === 1
        ? "1 day stale"
        : `${daysStale} days stale`;

  return (
    <Link className="projects-attention-card" to={`/projects/${project.id}`}>
      <div className="projects-attention-card-main">
        <div className="projects-attention-card-eyebrow">
          <DashboardTablerIcon name="flag" size={14} />
          Most attention needed
        </div>
        <div className="projects-attention-card-title-row">
          <span className="projects-attention-card-title">{title}</span>
          <span className="projects-attention-card-flags-pill">
            {summary.attentionCount} flag{summary.attentionCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="projects-attention-card-meta muted small">
          {summary.submittalStage} · last updated {formatProjectUpdatedShort(project.updated_at)},{" "}
          {staleLabel}
        </div>
      </div>
      <div className="projects-attention-card-stat">
        <span className="projects-attention-card-stat-label muted small">Open flags</span>
        <div className="projects-attention-card-stat-row">
          <strong className="projects-attention-card-stat-value">{totalFlags}</strong>
          <span className="muted small">
            across {jobCount} job{jobCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Link>
  );
}
