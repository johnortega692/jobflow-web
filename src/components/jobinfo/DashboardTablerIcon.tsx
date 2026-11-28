type IconName =
  | "user"
  | "hard-hat"
  | "shield-check"
  | "flag"
  | "check"
  | "clock"
  | "file-certificate"
  | "color-swatch"
  | "truck-delivery"
  | "receipt"
  | "cube"
  | "chevron-right"
  | "chevron-down"
  | "circle-check"
  | "clipboard-check"
  | "rocket"
  | "file-check"
  | "palette";

const PATHS: Record<IconName, string | readonly string[]> = {
  user: "M8 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
  "hard-hat":
    "M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1 -1v-6a6 6 0 0 0 -12 0v6M12 9v-6m-4 6h8",
  "shield-check":
    "M12 3l8 4v5c0 5 -3.5 8.5 -8 9c-4.5 -.5 -8 -4 -8 -9v-5l8 -4m3.5 5.5l-4.5 4.5l-2 -2",
  flag: "M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0zM5 21v-7",
  check: "M5 12l5 5l10 -10",
  clock: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 7v5l3 3",
  "file-certificate":
    "M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2m-7 -7h6m-6 4h6",
  "color-swatch": "M19 3h-14a2 2 0 0 0 -2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2 -2v-14a2 2 0 0 0 -2 -2m-11 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  "truck-delivery":
    "M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M5 17h-2v-4m0 -5h11v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5",
  receipt: "M17 17h2v2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-2h2m12 -5v8m-4 -8v8m-4 -8v8m-4 -8v8",
  cube: "M21 16.042v-8.084a2 2 0 0 0 -1 -1.732l-7 -4.042a2 2 0 0 0 -2 0l-7 4.042a2 2 0 0 0 -1 1.732v8.084a2 2 0 0 0 1 1.732l7 4.042a2 2 0 0 0 2 0l7 -4.042a2 2 0 0 0 1 -1.732",
  "chevron-right": "M9 6l6 6l-6 6",
  "chevron-down": "M6 9l6 6l6 -6",
  "circle-check": ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M9 12l2 2l4 -4"],
  "clipboard-check": [
    "M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2",
    "M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z",
    "M9 14l2 2l4 -4",
  ],
  rocket: [
    "M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3",
    "M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3",
    "M15 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  ],
  "file-check": [
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2",
    "M9 15l2 2l4 -4",
  ],
  palette: [
    "M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25",
    "M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  ],
};

function iconPaths(name: IconName): readonly string[] {
  const value = PATHS[name];
  return typeof value === "string" ? [value] : value;
}

type Props = {
  name: IconName;
  className?: string;
  size?: number;
};

export function DashboardTablerIcon({ name, className, size = 16 }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {iconPaths(name).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
