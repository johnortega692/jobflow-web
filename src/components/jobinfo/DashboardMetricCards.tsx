type Metric = {
  id: string;
  label: string;
  value: string;
  onClick: () => void;
  tone?: "ok" | "muted";
  compact?: boolean;
};

type Props = {
  metrics: Metric[];
};

export function DashboardMetricCards({ metrics }: Props) {
  return (
    <div className="job-dashboard-metrics">
      {metrics.map((m) => (
        <button key={m.id} type="button" className="job-dashboard-metric-card" onClick={m.onClick}>
          <span className="job-dashboard-metric-label">{m.label}</span>
          <span
            className={[
              "job-dashboard-metric-value",
              m.tone === "ok" ? "job-dashboard-metric-value--ok" : "",
              m.tone === "muted" ? "job-dashboard-metric-value--muted" : "",
              m.compact ? "job-dashboard-metric-value--compact" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {m.value}
          </span>
        </button>
      ))}
    </div>
  );
}
