import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getPrintBranding } from "../lib/printCore";
import { printTransmittal } from "../lib/transmittalPrint";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultTransmittal,
  emptyEnclosure,
  paintItemDescription,
  DELIVERY_METHODS,
  type TransmittalData,
  type TransmittalEnclosure,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

const CONTENT_CHECKS: { key: keyof TransmittalData; label: string }[] = [
  { key: "cb_submittal", label: "Submittal" },
  { key: "cb_product_data", label: "Product data" },
  { key: "cb_samples", label: "Samples" },
  { key: "cb_shop_drawings", label: "Shop drawings" },
  { key: "cb_om_manuals", label: "O&M manuals" },
  { key: "cb_plans", label: "Plans" },
  { key: "cb_letters", label: "Letters" },
  { key: "cb_specifications", label: "Specifications" },
  { key: "cb_prints", label: "Prints" },
  { key: "cb_addenda", label: "Addenda" },
  { key: "cb_change_orders", label: "Change orders" },
  { key: "cb_sds_safety", label: "SDS / safety" },
  { key: "cb_arch_drawings", label: "Architectural drawings" },
  { key: "cb_eng_drawings", label: "Engineering drawings" },
  { key: "cb_invoices", label: "Invoices" },
];

export function TransmittalPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<TransmittalData>(defaultTransmittal());

  useEffect(() => {
    if (!loading) {
      const base = tradeData.transmittal ?? defaultTransmittal();
      const branding = getPrintBranding();
      setDraft({
        ...base,
        from_block: base.from_block || branding.fromBlock,
        from_phone: base.from_phone || branding.fromPhone,
        signer_name: base.signer_name || branding.signerName,
      });
    }
  }, [loading, tradeData.transmittal]);

  function patchEnclosure(index: number, patch: Partial<TransmittalEnclosure>) {
    setDraft((d) => ({
      ...d,
      enclosures: d.enclosures.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function pullFromPaint() {
    const paint = tradeData.paint_submittal;
    if (!paint?.items.length) {
      setError("Save paint submittal items first.");
      return;
    }
    const rows = paint.items
      .filter((i) => i.color.trim() || i.label.trim())
      .map((item) => ({
        ...emptyEnclosure(),
        description: paintItemDescription(item),
      }));
    setDraft((d) => ({ ...d, enclosures: rows.length ? rows : d.enclosures }));
    setError(null);
  }

  function pullPaintSubmittalSheet() {
    const n = tradeData.paint_submittal?.submittal_number ?? 1;
    setDraft((d) => ({
      ...d,
      enclosures: [
        ...d.enclosures.filter((e) => e.description.trim()),
        {
          ...emptyEnclosure(),
          description: `Paint Submittal #${n}`,
        },
      ],
    }));
  }

  async function onSave() {
    const ok = await save({ ...tradeData, transmittal: draft });
    if (ok) setError(null);
  }

  function onPrint() {
    try {
      printTransmittal({ job_number: project.job_number, job_name: project.job_name }, draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    }
  }

  if (loading) return <p className="muted">Loading transmittal…</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Transmittal</h2>
          <p className="muted small">Ironwood-style layout — same as desktop Transmittal tab.</p>
        </div>
        <div className="row-gap">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-primary" onClick={onPrint}>
            Print / Save PDF
          </button>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}

      <section className="card stack">
        <h3>To / from</h3>
        <div className="grid-2">
          <label>
            Attn (to name)
            <input value={draft.to_name} onChange={(e) => setDraft({ ...draft, to_name: e.target.value })} />
          </label>
          <label>
            GC name
            <input value={draft.gc_name} onChange={(e) => setDraft({ ...draft, gc_name: e.target.value })} />
          </label>
          <label>
            To address
            <textarea
              rows={3}
              value={draft.to_address}
              onChange={(e) => setDraft({ ...draft, to_address: e.target.value })}
            />
          </label>
          <label>
            To phone
            <input value={draft.to_phone} onChange={(e) => setDraft({ ...draft, to_phone: e.target.value })} />
          </label>
          <label>
            From block
            <textarea
              rows={3}
              value={draft.from_block}
              onChange={(e) => setDraft({ ...draft, from_block: e.target.value })}
            />
          </label>
          <label>
            From phone
            <input value={draft.from_phone} onChange={(e) => setDraft({ ...draft, from_phone: e.target.value })} />
          </label>
        </div>
        <div className="grid-3">
          <label>
            Transmittal #
            <input
              type="number"
              min={1}
              value={draft.transmittal_number}
              onChange={(e) =>
                setDraft({ ...draft, transmittal_number: Number(e.target.value) || 1 })
              }
            />
          </label>
          <label>
            Date
            <input value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label>
            Delivery method
            <select
              value={draft.delivery_method}
              onChange={(e) => setDraft({ ...draft, delivery_method: e.target.value })}
            >
              {DELIVERY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        {draft.delivery_method === "Other" && (
          <label>
            Other delivery note
            <input
              value={draft.delivery_other_text}
              onChange={(e) => setDraft({ ...draft, delivery_other_text: e.target.value })}
            />
          </label>
        )}
      </section>

      <section className="card stack">
        <h3>Sent as</h3>
        <div className="check-grid">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_enclosed}
              onChange={(e) => setDraft({ ...draft, cb_enclosed: e.target.checked })}
            />
            Enclosed
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_under_sep_cover}
              onChange={(e) => setDraft({ ...draft, cb_under_sep_cover: e.target.checked })}
            />
            Under separate cover
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_via}
              onChange={(e) => setDraft({ ...draft, cb_via: e.target.checked })}
            />
            Via
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.show_for_column}
              onChange={(e) => setDraft({ ...draft, show_for_column: e.target.checked })}
            />
            Show &quot;For&quot; column on PDF
          </label>
        </div>
        <h3>Content types</h3>
        <div className="check-grid">
          {CONTENT_CHECKS.map(({ key, label }) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={Boolean(draft[key])}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="card stack">
        <div className="row-between">
          <h3>Enclosures</h3>
          <div className="row-gap">
            <button type="button" className="btn btn-secondary btn-small" onClick={pullFromPaint}>
              Pull paint lines
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={pullPaintSubmittalSheet}>
              Add paint submittal sheet
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setDraft((d) => ({ ...d, enclosures: [...d.enclosures, emptyEnclosure()] }))}
            >
              Add row
            </button>
          </div>
        </div>
        {draft.enclosures.map((row, index) => (
          <div key={index} className="submittal-row card stack">
            <label className="check">
              <input
                type="checkbox"
                checked={row.included}
                onChange={(e) => patchEnclosure(index, { included: e.target.checked })}
              />
              Include on PDF
            </label>
            <label>
              Description
              <input
                value={row.description}
                onChange={(e) => patchEnclosure(index, { description: e.target.value })}
              />
            </label>
            <div className="grid-3">
              <label>
                Copies
                <input value={row.copies} onChange={(e) => patchEnclosure(index, { copies: e.target.value })} />
              </label>
              <label>
                For
                <input
                  value={row.for_field}
                  onChange={(e) => patchEnclosure(index, { for_field: e.target.value })}
                />
              </label>
              <label className="check" style={{ marginTop: "1.5rem" }}>
                <input
                  type="checkbox"
                  checked={row.digital_copy}
                  onChange={(e) => patchEnclosure(index, { digital_copy: e.target.checked })}
                />
                Digital copy
              </label>
            </div>
            {draft.enclosures.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    enclosures: d.enclosures.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove row
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>Closing</h3>
        <label>
          Remarks
          <textarea
            rows={3}
            value={draft.remarks}
            onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
          />
        </label>
        <label>
          Copies to
          <textarea
            rows={2}
            value={draft.copies_to}
            onChange={(e) => setDraft({ ...draft, copies_to: e.target.value })}
          />
        </label>
        <label>
          Signer name (By:)
          <input
            value={draft.signer_name}
            onChange={(e) => setDraft({ ...draft, signer_name: e.target.value })}
          />
        </label>
      </section>
    </div>
  );
}
