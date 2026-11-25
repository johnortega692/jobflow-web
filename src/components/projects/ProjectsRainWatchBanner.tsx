import { RAIN_WATCH_BANNER_COLORS } from "../../lib/projectWeatherDisplay";

export type RainWatchJob = {
  id: string;
  jobNumber: string;
  jobName: string;
  label: string;
};

type Props = {
  jobs: RainWatchJob[];
  active: boolean;
  onShowOnly: () => void;
  onOpen: (projectId: string) => void;
};

export function ProjectsRainWatchBanner({ jobs, active, onShowOnly, onOpen }: Props) {
  if (!jobs.length) return null;
  const colors = RAIN_WATCH_BANNER_COLORS;
  return (
    <div
      className="projects-rain-watch"
      role="status"
      style={{ background: colors.background, color: colors.color, borderColor: colors.border }}
    >
      <div className="projects-rain-watch-copy">
        <p className="projects-rain-watch-title">Rain watch</p>
        <ul className="projects-rain-watch-jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <button type="button" onClick={() => onOpen(job.id)}>
                <span className="projects-rain-watch-job">{job.jobNumber}</span>{" "}
                {job.jobName || "Untitled job"}
              </button>
              <span className="projects-rain-watch-detail">{job.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className={`projects-rain-watch-action${active ? " projects-rain-watch-action--on" : ""}`}
        style={{ background: colors.actionBackground, color: colors.actionColor }}
        aria-pressed={active}
        onClick={onShowOnly}
      >
        Show only these
      </button>
    </div>
  );
}
