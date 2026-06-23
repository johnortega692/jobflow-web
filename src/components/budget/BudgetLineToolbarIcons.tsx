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
