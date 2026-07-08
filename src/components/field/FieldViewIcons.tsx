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

export function FieldNavWallcoveringIcon() {
  return (
    <svg {...svgProps} className="field-bottom-nav-icon">
      <path d="M6 4h9a2 2 0 0 1 2 2v13a1 1 0 0 1-1.45.89L12 17.2l-3.55 2.69A1 1 0 0 1 7 19V6a2 2 0 0 1 2-2Z" />
      <path d="M9 7h6" />
    </svg>
  );
}

export function FieldNavManpowerIcon() {
  return (
    <svg {...svgProps} className="field-bottom-nav-icon">
      <circle cx="9" cy="8" r="2.5" />
      <path d="M5 18v-1a4 4 0 0 1 4-4h0" />
      <circle cx="16.5" cy="9" r="2" />
      <path d="M14 18v-1a3 3 0 0 1 2.6-2.97" />
    </svg>
  );
}

export function FieldNavPaintIcon() {
  return (
    <svg {...svgProps} className="field-bottom-nav-icon">
      <path d="M14 4l6 6" />
      <path d="M6 20h7l8.5-8.5a2.1 2.1 0 0 0-3-3L10 17v3Z" />
      <path d="M5 20h2" />
    </svg>
  );
}

export function FieldNavCalendarIcon() {
  return (
    <svg {...svgProps} className="field-bottom-nav-icon">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="M9 14h2" />
      <path d="M13 14h2" />
    </svg>
  );
}

export function FieldNavWorkloadIcon() {
  return (
    <svg {...svgProps} className="field-bottom-nav-icon">
      <path d="M6 20V11" />
      <path d="M12 20V6" />
      <path d="M18 20V14" />
    </svg>
  );
}

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
