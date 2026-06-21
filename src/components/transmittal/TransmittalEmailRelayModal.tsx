import { FormEvent, useMemo, useState } from "react";
import {
  buildEmailRelayPlainBody,
  copyEmailRelayHtml,
  defaultEmailRelayDetails,
  downloadEmailRelayEml,
  openEmailRelayMailto,
  type EmailRelayDetails,
} from "../../lib/transmittalHelpers";
import type { TransmittalData } from "../../types/tradeDocuments";

type Props = {
  project: { job_number: string; job_name: string };
  transmittal: TransmittalData;
  fromEmail?: string;
  onClose: () => void;
  onDone?: (message: string) => void;
};

export function TransmittalEmailRelayModal({ project, transmittal, fromEmail = "", onClose, onDone }: Props) {
  const isHand = transmittal.delivery_method === "Hand Delivered";
  const [details, setDetails] = useState<EmailRelayDetails>(() => defaultEmailRelayDetails(transmittal));
  const [message, setMessage] = useState<string | null>(null);

  const preview = useMemo(
    () => buildEmailRelayPlainBody(project, transmittal, details),
    [project, transmittal, details],
  );

  function patch(partial: EmailRelayDetails) {
    setDetails((d) => ({ ...d, ...partial }));
  }

  function finish(msg: string) {
    onDone?.(msg);
    onClose();
  }

  function onOpenMailto(e: FormEvent) {
    e.preventDefault();
    openEmailRelayMailto(project, transmittal, details);
    finish(
      "Opened your mail app with subject and plain-text body. Attach the transmittal PDF(s) before sending.",
    );
  }

  function onDownloadEml() {
    downloadEmailRelayEml(project, transmittal, details, fromEmail);
    finish(
      "Downloaded .eml draft with HTML formatting (desktop-style). Double-click to open in Outlook, then attach PDFs.",
    );
  }

  async function onCopyHtml() {
    await copyEmailRelayHtml(project, transmittal, details);
    setMessage("HTML copied — paste into the Outlook compose body (Ctrl+V), then attach PDFs.");
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack transmittal-email-relay-modal"
        role="dialog"
        aria-labelledby="transmittal-email-relay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="transmittal-email-relay-title">Email Relay – Delivery Details</h3>
        <p className="muted small">
          Same message as the desktop app. <strong>mailto:</strong> uses plain text only; use{" "}
          <strong>Download .eml</strong> for HTML formatting in Outlook.
        </p>

        <form className="stack" onSubmit={onOpenMailto}>
          <section className="stack">
            <h4 className="transmittal-relay-section-title">Delivery details</h4>
            {isHand ? (
              <>
                <label>
                  Delivered To
                  <input
                    value={details.delivered_to ?? ""}
                    onChange={(e) => patch({ delivered_to: e.target.value })}
                    placeholder="Recipient or location"
                  />
                </label>
                <label>
                  Date Delivered
                  <input
                    value={details.date_delivered ?? ""}
                    onChange={(e) => patch({ date_delivered: e.target.value })}
                    placeholder="June 16, 2026"
                  />
                </label>
              </>
            ) : (
              <>
                <p className="muted small">
                  Delivery method on transmittal: <strong>{transmittal.delivery_method}</strong>
                </p>
                <label>
                  Tracking Number
                  <input
                    value={details.tracking ?? ""}
                    onChange={(e) => patch({ tracking: e.target.value })}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Est. Delivery
                  <input
                    value={details.est_delivery ?? ""}
                    onChange={(e) => patch({ est_delivery: e.target.value })}
                    placeholder="Optional"
                  />
                </label>
              </>
            )}
          </section>

          <section className="stack">
            <h4 className="transmittal-relay-section-title">Message preview (plain text)</h4>
            <pre className="transmittal-relay-preview">{preview}</pre>
          </section>

          {message && <div className="banner banner-ok">{message}</div>}

          <div className="row-gap wrap">
            <button type="submit" className="btn btn-success">
              Open in mail app
            </button>
            <button type="button" className="btn btn-primary" onClick={onDownloadEml}>
              Download .eml
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onCopyHtml()}>
              Copy HTML
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
