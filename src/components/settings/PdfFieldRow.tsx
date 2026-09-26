import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

type PillProps = {
  showInPdf: boolean;
  onChange: (show: boolean) => void;
  label: string;
  disabled?: boolean;
};

function EyeIcon({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.1A10.8 10.8 0 0 1 12 5c5 0 9.3 3.1 11 7-1 2.2-2.6 4.1-4.6 5.4" />
        <path d="M6.1 6.1C4.2 7.4 2.7 9.2 1.8 11.2 3.5 16 7.8 19 12.8 19c1.1 0 2.2-.2 3.2-.5" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PdfVisibilityPill({ showInPdf, onChange, label, disabled }: PillProps) {
  return (
    <button
      type="button"
      className={`plh-pdf${showInPdf ? " is-on" : ""}`}
      disabled={disabled}
      aria-pressed={showInPdf}
      aria-label={showInPdf ? `Hide ${label} in PDF` : `Show ${label} in PDF`}
      onClick={() => onChange(!showInPdf)}
    >
      <EyeIcon off={!showInPdf} />
      {showInPdf ? "In PDF" : "Hidden"}
    </button>
  );
}

type Props = {
  label: string;
  showInPdf: boolean;
  onShowInPdfChange: (show: boolean) => void;
  children: ReactNode;
  className?: string;
  hint?: string;
  disabled?: boolean;
};

/** Settings input with an In PDF / Hidden pill inside the field. */
export function PdfFieldRow({
  label,
  showInPdf,
  onShowInPdfChange,
  children,
  className,
  hint,
  disabled,
}: Props) {
  const fieldId = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: fieldId })
    : children;

  return (
    <div className={`plh-field${className ? ` ${className}` : ""}`}>
      <label className="plh-field-label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="plh-control">
        {control}
        <PdfVisibilityPill
          showInPdf={showInPdf}
          onChange={onShowInPdfChange}
          label={label}
          disabled={disabled}
        />
      </div>
      {hint ? <p className="plh-hint">{hint}</p> : null}
    </div>
  );
}
