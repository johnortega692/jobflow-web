const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "budget-toolbar-icon",
  "aria-hidden": true,
  focusable: false,
};

export function BudgetIconSelectAll() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="budget-toolbar-icon"
      aria-hidden
      focusable={false}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M8 10a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" />
      <path d="M8 14.5l6.492 -6.492" />
      <path d="M13.496 20l6.504 -6.504" />
      <path d="M8.586 19.414l10.827 -10.827" />
      <path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function BudgetIconAdd() {
  return (
    <svg {...iconProps}>
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </svg>
  );
}

export function BudgetIconDuplicate() {
  return (
    <svg {...iconProps}>
      <rect x="5.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M3.5 5.5v7a1 1 0 0 0 1 1h7" />
    </svg>
  );
}

export function BudgetIconHide() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 2.5 13.5 13.5" />
      <path d="M6.4 6.6a2.1 2.1 0 0 0 2.9 2.9" />
      <path d="M4.1 8.4C3.6 9 3.4 9.6 3.4 10.3c0 2.3 2.1 5 4.6 5 .7 0 1.3-.2 2-.6" />
      <path d="M8 3.8c2.3 0 4.2 1.2 5.1 3" />
      <path d="M11.7 7.1c.5.8.8 1.7.8 2.7" />
    </svg>
  );
}

export function BudgetIconRemove() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 4.5h9" />
      <path d="M6 4.5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M5 4.5l.5 8a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-8" />
    </svg>
  );
}

export function BudgetIconPush() {
  return (
    <svg {...iconProps}>
      <path d="M3 8h8" />
      <path d="M8.5 5.5 11 8l-2.5 2.5" />
    </svg>
  );
}

export function BudgetIconClear() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 4.5l7 7" />
      <path d="M11.5 4.5l-7 7" />
    </svg>
  );
}

export function BudgetIconSplit() {
  return (
    <svg {...iconProps}>
      <circle cx="4.25" cy="4.25" r="1.6" />
      <circle cx="4.25" cy="11.75" r="1.6" />
      <path d="M5.8 5.3 13.5 13" />
      <path d="M5.8 10.7 13.5 3" />
    </svg>
  );
}

export function BudgetIconAutoPush() {
  return (
    <svg {...iconProps}>
      <path d="M8 2.5v2.2" />
      <path d="M8 11.3v2.2" />
      <path d="M2.5 8h2.2" />
      <path d="M11.3 8h2.2" />
      <path d="M4.1 4.1l1.5 1.5" />
      <path d="M10.4 10.4l1.5 1.5" />
      <path d="M11.9 4.1l-1.5 1.5" />
      <path d="M5.6 10.4l-1.5 1.5" />
      <circle cx="8" cy="8" r="2.1" />
    </svg>
  );
}

export function BudgetIconImport() {
  return (
    <svg {...iconProps}>
      <path d="M8 9.5v-7" />
      <path d="M5.5 5 8 2.5 10.5 5" />
      <path d="M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
    </svg>
  );
}

export function BudgetIconExcel() {
  return (
    <svg {...iconProps}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" />
      <path d="M2.5 6h11" />
      <path d="M2.5 9.5h11" />
      <path d="M6.5 2.5v11" />
      <path d="M10 2.5v11" />
    </svg>
  );
}

export function BudgetIconPdf() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 2.5h5l3 3v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
      <path d="M9.5 2.5v3h3" />
      <path d="M5.5 10.5h5" />
      <path d="M5.5 8h5" />
    </svg>
  );
}
