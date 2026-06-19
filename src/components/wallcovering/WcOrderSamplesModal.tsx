import { useMemo, useState } from "react";
import {
  buildWcSampleOrderEmail,
  loadWcShippingAddress,
  saveWcShippingAddress,
  type WcSampleOrderItem,
} from "../../lib/wcSampleOrderEmail";

type Props = {
  vendor: string;
  vendorEmail: string;
  jobNumber: string;
  jobName: string;
  architect: string;
  items: WcSampleOrderItem[];
  onClose: () => void;
};

export function WcOrderSamplesModal({
  vendor,
  vendorEmail,
  jobNumber,
  jobName,
  architect,
  items,
  onClose,
}: Props) {
  const [address, setAddress] = useState(() => loadWcShippingAddress());
  const [copied, setCopied] = useState(false);

  const email = useMemo(
    () =>
      buildWcSampleOrderEmail({
        vendor,
        jobNumber,
        jobName,
        architect,
        shippingAddress: address,
        items,
      }),
    [address, architect, items, jobName, jobNumber, vendor],
  );

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(email.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  function openMailto() {
    saveWcShippingAddress(address);
    const to = vendorEmail.trim();
    const params = new URLSearchParams({
      subject: email.subject,
      body: email.body,
    });
    window.location.href = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-email-modal"
        role="dialog"
        aria-labelledby="wc-samples-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="wc-samples-title">Order samples — {vendor}</h3>
        <label>
          Ship samples to
          <textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <p className="muted small">Subject: {email.subject}</p>
        <textarea className="paint-email-preview" rows={14} readOnly value={email.body} />
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" onClick={() => void copyBody()}>
            {copied ? "Copied" : "Copy email"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={openMailto}>
            Open in email
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
