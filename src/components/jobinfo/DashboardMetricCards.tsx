import { DashboardTablerIcon } from "./DashboardTablerIcon";

export type DashboardMetricStatus = "ok" | "warn" | "muted";

export type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  detail?: string;
  status: DashboardMetricStatus;
  onClick: () => void;
};

const ICONS = {
  "job-setup": "clipboard-check",
  startup: "rocket",
  submittal: "file-check",
  "brush-outs": "palette",
} as const;

type Props = {
  metrics: DashboardMetric[];
};

export function DashboardMetricCards({ metrics }: Props) {
  return (
    <div className="job-dashboard-metrics">
      {metrics.map((metric) => {
        const icon = ICONS[metric.id as keyof typeof ICONS];
        return (
          <button key={metric.id} type="button" className="job-dashboard-metric-card" onClick={metric.onClick}>
            <span className="job-dashboard-metric-label">
              {icon ? <DashboardTablerIcon name={icon} size={14} /> : null}
              {metric.label}
            </span>
            <span className="job-dashboard-metric-value">
              <span className={`job-dashboard-metric-dot job-dashboard-metric-dot--${metric.status}`} />
              {metric.value}
            </span>
            <span className="job-dashboard-metric-detail">{metric.detail || "\u00a0"}</span>
          </button>
        );
      })}
    </div>
  );
}
