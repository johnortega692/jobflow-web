const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function FieldMobileIcon() {
  return (
    <svg {...svgProps} className="field-view-icon">
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

export function FieldDesktopIcon() {
  return (
    <svg {...svgProps} className="field-view-icon">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 17v3" />
    </svg>
  );
}

export function FieldSunIcon() {
  return (
    <svg {...svgProps} className="field-view-icon">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.93 19.07l1.41-1.41" />
      <path d="M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function FieldMoonIcon() {
  return (
    <svg {...svgProps} className="field-view-icon">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
