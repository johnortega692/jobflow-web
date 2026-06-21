import { normalizeRfiStatus } from "../../lib/rfiStatus";

type Props = {
  status: string | null | undefined;
};

export function RfiStatusBadge({ status }: Props) {
  const label = normalizeRfiStatus(status);
  return (
    <span className={`rfi-status-badge rfi-status-badge--${label.toLowerCase()}`}>{label}</span>
  );
}
