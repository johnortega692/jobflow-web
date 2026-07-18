import type { ProjectModuleId } from "../config/projectModules";

type Props = {
  id: ProjectModuleId;
  className?: string;
};

export function ProjectNavIcon({ id, className = "project-nav-icon" }: Props) {
  const common = {
    className,
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (id) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "rfis":
      return (
        <svg {...common}>
          <path d="M7.5 8.5h9M7.5 12h6" />
          <path d="M6 4h12a2 2 0 0 1 2 2v10l-3-2.5H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          <circle cx="16.5" cy="7.5" r="2.25" fill="currentColor" stroke="none" />
          <path d="M16 6.75v1.5M15.25 7.5h1.5" stroke="var(--bg-elevated)" strokeWidth="1.25" />
        </svg>
      );
    case "submittals":
      return (
        <svg {...common}>
          <path d="M8 6h8M8 10h8M8 14h5" />
          <rect x="5" y="4" width="14" height="16" rx="2" />
        </svg>
      );
    case "procurement-log":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 7h8M8 11h8M8 15h5" />
          <path d="M7 7.5l1.5 1.5L11 6.5" strokeWidth="1.5" />
        </svg>
      );
    case "excel-paste":
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M14 3v5h5" />
          <path d="M8 12h8M8 16h8M8 12v4M12 12v4M16 12v4" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="14" rx="2" />
          <path d="M8 10h8M8 14h5" />
          <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
        </svg>
      );
    case "po":
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M8 8h8M8 12h5" />
          <path d="M9 16h6" strokeWidth="2" />
        </svg>
      );
    case "budget":
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6" />
          <path d="M12 16v-1.5a1.5 1.5 0 1 0-3 0V16" />
        </svg>
      );
    case "billing":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
          <path d="M7 15h3" />
        </svg>
      );
    case "work-orders":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
          <path d="M8.5 8.5l1 1 2.5-2.5" strokeWidth="1.5" />
        </svg>
      );
    default:
      return null;
  }
}
