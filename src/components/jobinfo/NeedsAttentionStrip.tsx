import { DashboardTablerIcon } from "./DashboardTablerIcon";
import type { AttentionItem } from "../../lib/projectDashboardSnapshot";

type Props = {
  items: AttentionItem[];
  onItemClick: (item: AttentionItem) => void;
};

export function NeedsAttentionStrip({ items, onItemClick }: Props) {
  if (!items.length) return null;

  return (
    <section className="card job-dashboard-attention" aria-label="Needs attention">
      <div className="job-dashboard-attention-head">
        <DashboardTablerIcon name="flag" size={18} />
        <h3 className="job-dashboard-attention-title">
          Needs attention · {items.length}
        </h3>
      </div>
      <div className="job-dashboard-attention-chips">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="job-dashboard-attention-chip"
            onClick={() => onItemClick(item)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
