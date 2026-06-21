import type { ReactNode } from "react";

type Props = {
  label: string;
  showInPdf: boolean;
  onShowInPdfChange: (show: boolean) => void;
  children: ReactNode;
  className?: string;
};

/** Settings input row with a show/hide toggle for PDF output. */
export function PdfFieldRow({ label, showInPdf, onShowInPdfChange, children, className }: Props) {
  return (
    <div className={`settings-pdf-field${className ? ` ${className}` : ""}`}>
      <label className="settings-pdf-field-input">
        <span className="settings-pdf-field-label">{label}</span>
        {children}
      </label>
      <label className="settings-pdf-toggle" title={`${showInPdf ? "Hide" : "Show"} in PDF output`}>
        <input
          type="checkbox"
          checked={showInPdf}
          onChange={(e) => onShowInPdfChange(e.target.checked)}
        />
        <span className="settings-pdf-toggle-track" aria-hidden="true">
          <span className="settings-pdf-toggle-thumb" />
        </span>
        <span className="settings-pdf-toggle-text">{showInPdf ? "Show in PDF" : "Hidden in PDF"}</span>
      </label>
    </div>
  );
}
