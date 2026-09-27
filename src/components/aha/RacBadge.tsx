import { RAC_COLORS } from "../../lib/aha/rac";
import type { RacLevel } from "../../lib/aha/types";

const RAC_WORDS: Record<RacLevel, string> = {
  E: "Extremely high",
  H: "High",
  M: "Moderate",
  L: "Low",
};

type Props = {
  level: RacLevel;
  size: 30 | 36 | 48;
};

export function RacBadge({ level, size }: Props) {
  const colors = RAC_COLORS[level];
  return (
    <span
      className={`aha-rac aha-rac--${size}`}
      style={{ background: colors.background, color: colors.color }}
      aria-label={`RAC ${level}, ${RAC_WORDS[level]}`}
    >
      {level}
    </span>
  );
}
