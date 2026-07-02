type Metric = {
  id: string;
  label: string;
  value: string;
  onClick: () => void;
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
          <span className="job-dashboard-metric-value">{m.value}</span>
        </button>
      ))}
    </div>
  );
}
