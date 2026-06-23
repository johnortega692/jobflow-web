import { FormEvent, useMemo, useState } from "react";
import {
  buildEmailRelayPlainBody,
  copyEmailRelayHtml,
  defaultEmailRelayDetails,
  openEmailRelayMailto,
  type EmailRelayDetails,
} from "../../lib/transmittalHelpers";
import type { ComposeEmailMethod } from "../../lib/paintUserSettings";
import { composeEmailButtonLabel } from "../../lib/paintUserSettings";
import type { TransmittalData } from "../../types/tradeDocuments";

type Props = {
  project: { job_number: string; job_name: string };
  transmittal: TransmittalData;
  composeEmailMethod?: ComposeEmailMethod;
  onClose: () => void;
  onDone?: (message: string) => void;
};

export function TransmittalEmailRelayModal({
  project,
  transmittal,
  composeEmailMethod = "gmail",
  onClose,
  onDone,
}: Props) {
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

  function onOpenMailto(e: FormEvent) {
    e.preventDefault();
    void (async () => {
      const result = await openEmailRelayMailto(project, transmittal, details, composeEmailMethod);
      const msg =
        result.warning ??
        "Compose opened (empty body) — press Ctrl+V to paste formatted HTML, then attach transmittal PDF(s).";
      setMessage(msg);
      onDone?.(msg);
    })();
  }

  async function onCopyHtml() {
    await copyEmailRelayHtml(project, transmittal, details);
    setMessage("Formatted HTML copied — paste with Ctrl+V in the empty compose body, then attach PDFs.");
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
            <button type="submit" className="btn btn-primary">
              {composeEmailButtonLabel(composeEmailMethod)}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onCopyHtml()}>
              Copy HTML
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
