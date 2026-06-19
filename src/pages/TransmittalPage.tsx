import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { TransmittalCustomLineModal } from "../components/transmittal/TransmittalCustomLineModal";
import { DateInput } from "../components/DateInput";
import { TransmittalEnclosureRow } from "../components/transmittal/TransmittalEnclosureRow";
import { TransmittalHistoryPickerModal } from "../components/transmittal/TransmittalHistoryPickerModal";
import { TransmittalSheetPickerModal } from "../components/transmittal/TransmittalSheetPickerModal";
import { useLetterhead } from "../contexts/LetterheadContext";
import { applyJobInfoToTransmittal } from "../lib/jobInfo";
import {
  loadSubmittalLogRows,
  markRowsSubmitted,
} from "../lib/submittalLogService";
import { applyTransmittalProfileDefaults } from "../lib/userProfile";
import {
  nextTransmittalNumber,
  normalizeTransmittalNumber,
} from "../lib/transmittalNumber";
import { remarkTemplateGroups } from "../lib/transmittalRemarks";
import { printTransmittal } from "../lib/transmittalPrint";
import {
  addItemsFromPaintHistory,
  addItemsFromWallcoveringHistory,
  appendPendingToEnclosures,
  buildEmailRelayBody,
  includedLogRowIds,
  moveEnclosure,
  paintSheetLabel,
  patchEnclosureList,
  pendingItemLabel,
  refreshEnclosuresFromTradeData,
  removePendingItems,
} from "../lib/transmittalHelpers";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  type PaintItem,
  type WallcoveringItem,
  defaultTransmittal,
  emptyEnclosure,
  normalizeTransmittal,
  type TransmittalData,
  type TransmittalEnclosure,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

const CONTENT_CHECKS: { key: keyof TransmittalData; label: string }[] = [
  { key: "cb_submittal", label: "Submittal" },
  { key: "cb_product_data", label: "Product Data" },
  { key: "cb_samples", label: "Samples" },
  { key: "cb_shop_drawings", label: "Shop Drawings" },
  { key: "cb_om_manuals", label: "O&M Manuals" },
  { key: "cb_plans", label: "Plans" },
  { key: "cb_letters", label: "Letters" },
  { key: "cb_specifications", label: "Specifications" },
  { key: "cb_prints", label: "Prints" },
  { key: "cb_addenda", label: "Addenda" },
  { key: "cb_change_orders", label: "Change Orders" },
  { key: "cb_sds_safety", label: "SDS/Safety" },
  { key: "cb_arch_drawings", label: "Architectural Drawings" },
  { key: "cb_invoices", label: "Invoices" },
  { key: "cb_eng_drawings", label: "Engineering Drawings" },
];

const DELIVERY_RADIO = ["FedEx", "UPS", "Courier", "Hand Delivered"] as const;

export function TransmittalPage() {
  const { branding, profile } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<TransmittalData>(defaultTransmittal());
  const [status, setStatus] = useState<string | null>(null);
  const [pendingSelected, setPendingSelected] = useState<number[]>([]);
  const [customLineOpen, setCustomLineOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheetPicker, setSheetPicker] = useState<"paint" | "wallcovering" | null>(null);
  const [remarkTemplateKey, setRemarkTemplateKey] = useState("");

  const reloadDraft = useCallback(() => {
    const base = normalizeTransmittal(tradeData.transmittal);
    const withProfile = applyTransmittalProfileDefaults(base, profile, branding);
    setDraft(applyJobInfoToTransmittal(withProfile, project.contractor, project.jobInfo));
  }, [tradeData.transmittal, profile, branding, project.contractor, project.jobInfo]);

  useEffect(() => {
    if (!loading) reloadDraft();
  }, [loading, reloadDraft]);

  async function persistTransmittal(next: TransmittalData) {
    setDraft(next);
    const ok = await save({ ...tradeData, transmittal: next });
    if (ok) {
      setError(null);
      return true;
    }
    return false;
  }

  function patch(patch: Partial<TransmittalData>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function patchEnclosure(index: number, rowPatch: Partial<TransmittalEnclosure>) {
    setDraft((d) => ({
      ...d,
      enclosures: patchEnclosureList(d.enclosures, index, rowPatch),
    }));
  }

  function pullFromJobInfo() {
    setDraft((d) => applyJobInfoToTransmittal(d, project.contractor, project.jobInfo));
    setStatus("Filled recipient fields from Job Info.");
  }

  function onRefreshEnclosures() {
    setDraft((d) => refreshEnclosuresFromTradeData(d, tradeData));
    setStatus("Refreshed enclosure list from paint and wallcovering tabs.");
  }

  function togglePendingSelect(index: number) {
    setPendingSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }

  async function onAddPendingToEnclosures(all = false) {
    const indices = all
      ? (draft.pending_submittal_queue ?? []).map((_, i) => i)
      : pendingSelected;
    const { transmittal: next, added, skipped } = appendPendingToEnclosures(draft, indices);
    if (!added && !skipped) {
      setError(all ? "No pending packages to add." : "Select pending package(s) first.");
      return;
    }
    await persistTransmittal(next);
    setPendingSelected([]);
    if (skipped && !added) setStatus("Selected package(s) are already on the enclosure list.");
    else if (skipped) setStatus(`Added ${added} to enclosures. ${skipped} already on the list.`);
    else setStatus(`Added ${added} package(s) to enclosures.`);
    setError(null);
  }

  async function onRemovePending() {
    if (!pendingSelected.length) {
      setError("Select a pending package to remove.");
      return;
    }
    const next = removePendingItems(draft, pendingSelected);
    await persistTransmittal(next);
    setPendingSelected([]);
    setStatus("Removed pending package(s).");
  }

  async function onSave() {
    const ok = await persistTransmittal(draft);
    if (ok) setStatus("Transmittal saved.");
  }

  async function onGenerate() {
    if (draft.use_excel_template) {
      setError("Excel transmittal template is available in the desktop app only.");
      return;
    }
    const ok = await persistTransmittal(draft);
    if (!ok) return;
    try {
      printTransmittal(
        { job_number: project.job_number, job_name: project.job_name },
        draft,
        branding,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
      return;
    }

    const logIds = includedLogRowIds(draft);
    let stamped = 0;
    if (logIds.length) {
      try {
        const rows = await loadSubmittalLogRows(projectId);
        const toMark = rows.filter((r) => logIds.includes(r.id));
        if (toMark.length) {
          await markRowsSubmitted(toMark, draft.transmittal_number);
          stamped = toMark.length;
        }
      } catch {
        /* optional */
      }
    }

    const consumedPending = new Set(
      draft.enclosures.filter((e) => e.included && e.pending_id).map((e) => e.pending_id!),
    );
    const nextQueue = (draft.pending_submittal_queue ?? []).filter((p) => !consumedPending.has(p.id));
    const nextNumber = nextTransmittalNumber(draft.transmittal_number);
    const nextDraft: TransmittalData = {
      ...draft,
      transmittal_number: nextNumber,
      pending_submittal_queue: nextQueue,
    };
    await persistTransmittal(nextDraft);

    const parts = ["Transmittal PDF opened for save/print."];
    if (stamped) parts.push(`Stamped ${stamped} submittal log row(s) as Submitted.`);
    else if (logIds.length === 0) {
      parts.push("No submittal log rows stamped — link enclosures to log rows before generating.");
    }
    if (draft.combine_enclosures) {
      parts.push("Combine into one PDF: attach saved PDFs manually in the browser print dialog.");
    }
    setStatus(parts.join(" "));
    setError(null);
  }

  function onEmailRelay() {
    const subject = `${project.job_number} — ${draft.transmittal_number} — ${draft.subject || "Submittals"}`;
    const body = buildEmailRelayBody(project, draft);
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus("Opened email draft (attach PDFs from your downloads folder).");
  }

  function applyRemarkTemplate(templateId: string) {
    if (!templateId) return;
    const groups = remarkTemplateGroups();
    const template = groups.flatMap((g) => g.templates).find((t) => t.id === templateId);
    if (!template) return;
    if (
      draft.remarks.trim() &&
      draft.remarks.trim() !== template.text &&
      !window.confirm("Replace current remarks with the selected template?")
    ) {
      setRemarkTemplateKey("");
      return;
    }
    patch({ remarks: template.text });
    setRemarkTemplateKey("");
  }

  if (loading) return <p className="muted">Loading transmittal…</p>;

  const queue = draft.pending_submittal_queue ?? [];
  const paintHistory = tradeData.paint_submittal_history ?? [];
  const wcHistory = tradeData.wallcovering_submittal_history ?? [];

  return (
    <div className="stack transmittal-page">
      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">RECIPIENT &amp; SUBJECT</p>
        <div className="transmittal-header-grid">
          <div className="stack">
            <label>
              Attn:
              <input value={draft.to_name} onChange={(e) => patch({ to_name: e.target.value })} />
            </label>
            <label>
              GC Name:
              <input value={draft.gc_name} onChange={(e) => patch({ gc_name: e.target.value })} />
            </label>
            <label>
              Address:
              <textarea
                rows={3}
                value={draft.to_address}
                onChange={(e) => patch({ to_address: e.target.value })}
              />
            </label>
            <label>
              Phone:
              <input value={draft.to_phone} onChange={(e) => patch({ to_phone: e.target.value })} />
            </label>
          </div>
          <div className="stack transmittal-header-right">
            <div className="transmittal-meta-row">
              <label>
                Date:
                <DateInput value={draft.date} onChange={(v) => patch({ date: v })} />
              </label>
              <label>
                Job #:
                <input value={project.job_number} readOnly className="readonly" />
              </label>
              <label>
                Transmittal #:
                <input
                  value={draft.transmittal_number}
                  onChange={(e) => patch({ transmittal_number: e.target.value })}
                  onBlur={() =>
                    patch({ transmittal_number: normalizeTransmittalNumber(draft.transmittal_number) })
                  }
                  placeholder="TR-001"
                />
              </label>
            </div>
            <label>
              Job Name:
              <input value={project.job_name} readOnly className="readonly" />
            </label>
            <label>
              Subject:
              <input value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-small" onClick={pullFromJobInfo}>
            From Job Info
          </button>
          <span className="muted small">
            Fills Attn, GC, Address, and Phone from tab 1 GC Info.
          </span>
        </div>
        <div className="transmittal-delivery-row">
          <span className="transmittal-delivery-label">Delivery Method:</span>
          <div className="row-gap wrap">
            {DELIVERY_RADIO.map((m) => (
              <label key={m} className="check">
                <input
                  type="radio"
                  name="delivery"
                  checked={draft.delivery_method === m}
                  onChange={() => patch({ delivery_method: m })}
                />
                {m}
              </label>
            ))}
            <label className="check">
              <input
                type="radio"
                name="delivery"
                checked={draft.delivery_method === "Other"}
                onChange={() => patch({ delivery_method: "Other" })}
              />
              Other
            </label>
            <input
              value={draft.delivery_other_text}
              onChange={(e) => patch({ delivery_other_text: e.target.value })}
              placeholder="(specify)"
              style={{ width: "10rem" }}
            />
          </div>
        </div>
        <div className="row-gap wrap transmittal-sent-row">
          <span>Items listed are being sent:</span>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_enclosed}
              onChange={(e) => patch({ cb_enclosed: e.target.checked })}
            />
            Enclosed
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_under_sep_cover}
              onChange={(e) => patch({ cb_under_sep_cover: e.target.checked })}
            />
            Under Separate Cover
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_via}
              onChange={(e) => patch({ cb_via: e.target.checked })}
            />
            Via
          </label>
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">WE ARE TRANSMITTING THE FOLLOWING TO YOU:</p>
        <div className="check-grid">
          {CONTENT_CHECKS.map(({ key, label }) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={Boolean(draft[key])}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">
          PENDING FOR NEXT SEND — double-click or Add to enclosures; Generate Transmittal stamps
          SUBMIT on checked rows
        </p>
        <div className="transmittal-pending-panel">
          <div className="transmittal-pending-list" role="listbox" aria-multiselectable="true">
            {!queue.length ? (
              <p className="muted small transmittal-pending-empty">
                No pending packages — build a submittal package or print a paint/wallcovering
                submittal with transmittal options checked to queue items here.
              </p>
            ) : (
              queue.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={pendingSelected.includes(index)}
                  className={`transmittal-pending-item${pendingSelected.includes(index) ? " selected" : ""}`}
                  onClick={() => togglePendingSelect(index)}
                  onDoubleClick={async () => {
                    const { transmittal: next, added } = appendPendingToEnclosures(draft, [index]);
                    if (added) {
                      await persistTransmittal(next);
                      setStatus("Added pending package to enclosures.");
                    }
                  }}
                >
                  {pendingItemLabel(item)}
                </button>
              ))
            )}
          </div>
          <div className="transmittal-pending-actions stack">
            <button
              type="button"
              className="btn btn-warning"
              onClick={() => void onAddPendingToEnclosures(false)}
            >
              Add to enclosures
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onAddPendingToEnclosures(true)}>
              Add all
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onRemovePending()}>
              Remove
            </button>
          </div>
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">
          LIST OF ENCLOSURES (SELECT AND REORDER; INCLUDE ONLY CHECKED)
        </p>
        <div className="transmittal-enc-toolbar row-gap wrap">
          <button type="button" className="btn btn-primary btn-small" onClick={onRefreshEnclosures}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setCustomLineOpen(true)}>
            Add Item
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                enclosures: d.enclosures.map((e) => ({ ...e, included: true })),
              }))
            }
          >
            Include all
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                enclosures: d.enclosures.map((e) => ({ ...e, included: false })),
              }))
            }
          >
            Exclude all
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_paint_floor}
              onChange={(e) => patch({ include_paint_floor: e.target.checked })}
            />
            Include Floor paint
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_wc_floor}
              onChange={(e) => patch({ include_wc_floor: e.target.checked })}
            />
            Include Floor WC
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.show_for_column}
              onChange={(e) => patch({ show_for_column: e.target.checked })}
            />
            Show For column
          </label>
        </div>
        <div className="transmittal-enc-list">
          {draft.enclosures.map((row, index) => (
            <TransmittalEnclosureRow
              key={row.id}
              row={row}
              index={index}
              showForColumn={draft.show_for_column}
              canMoveUp={index > 0}
              canMoveDown={index < draft.enclosures.length - 1}
              onChange={(p) => patchEnclosure(index, p)}
              onMoveUp={() =>
                setDraft((d) => ({ ...d, enclosures: moveEnclosure(d.enclosures, index, -1) }))
              }
              onMoveDown={() =>
                setDraft((d) => ({ ...d, enclosures: moveEnclosure(d.enclosures, index, 1) }))
              }
              onRemove={() =>
                setDraft((d) => ({
                  ...d,
                  enclosures:
                    d.enclosures.length > 1
                      ? d.enclosures.filter((_, i) => i !== index)
                      : [{ ...emptyEnclosure() }],
                }))
              }
            />
          ))}
        </div>
      </section>

      <button type="button" className="btn btn-primary btn-small transmittal-history-btn" onClick={() => setHistoryOpen(true)}>
        Submittal History
      </button>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">REMARKS</p>
        <label>
          Remark template
          <select
            value={remarkTemplateKey}
            onChange={(e) => {
              const id = e.target.value;
              setRemarkTemplateKey(id);
              if (id) applyRemarkTemplate(id);
            }}
          >
            <option value="">Choose a remark template…</option>
            {remarkTemplateGroups().map(({ group, templates }) => (
              <optgroup key={group} label={group}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Remarks
          <textarea
            rows={4}
            value={draft.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
          />
        </label>
        <label>
          Copies To:
          <input value={draft.copies_to} onChange={(e) => patch({ copies_to: e.target.value })} />
        </label>
        <label>
          By:
          <input
            value={draft.signer_name}
            onChange={(e) => patch({ signer_name: e.target.value })}
            placeholder={profile.name || "From Settings"}
          />
        </label>
      </section>

      <section className="card stack transmittal-generate-section">
        <div className="row-gap wrap transmittal-generate-row">
          <button type="button" className="btn btn-primary" onClick={() => void onGenerate()}>
            Generate Transmittal
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.combine_enclosures}
              onChange={(e) => patch({ combine_enclosures: e.target.checked })}
            />
            Combine into one PDF
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.use_excel_template}
              onChange={(e) => patch({ use_excel_template: e.target.checked })}
            />
            Use Excel template
          </label>
          <button type="button" className="btn btn-success" onClick={onEmailRelay}>
            Email Relay
          </button>
          <button type="button" className="btn btn-secondary" disabled title="Available in desktop app">
            Order Attic Stock
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="transmittal-sheet-row row-gap wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_paint_sheet}
              onChange={(e) => patch({ include_paint_sheet: e.target.checked })}
            />
            Include Paint sheet
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSheetPicker("paint")}>
            Choose…
          </button>
          <span className="muted small">{paintSheetLabel(draft.paint_submittal_nums)}</span>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_wc_sheet}
              onChange={(e) => patch({ include_wc_sheet: e.target.checked })}
            />
            Include Wallcovering sheet
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSheetPicker("wallcovering")}>
            Choose…
          </button>
          <span className="muted small">{paintSheetLabel(draft.wc_submittal_nums)}</span>
        </div>
      </section>

      {customLineOpen && (
        <TransmittalCustomLineModal
          showForColumn={draft.show_for_column}
          onAdd={(payload) =>
            setDraft((d) => ({
              ...d,
              enclosures: [
                ...d.enclosures.filter((e) => e.description.trim()),
                { ...emptyEnclosure(), ...payload, included: true },
              ],
            }))
          }
          onClose={() => setCustomLineOpen(false)}
        />
      )}

      {historyOpen && (
        <TransmittalHistoryPickerModal
          paintHistory={paintHistory}
          wcHistory={wcHistory}
          onAddPaint={(entry, replace) => {
            setDraft((d) =>
              addItemsFromPaintHistory(d, entry.items as PaintItem[], replace, d.include_paint_floor),
            );
            setHistoryOpen(false);
            setStatus(`Loaded paint submittal #${entry.submittal_number} into enclosures.`);
          }}
          onAddWallcovering={(entry, replace) => {
            setDraft((d) =>
              addItemsFromWallcoveringHistory(
                d,
                entry.items as WallcoveringItem[],
                replace,
                d.include_wc_floor,
              ),
            );
            setHistoryOpen(false);
            setStatus(`Loaded wallcovering submittal #${entry.submittal_number} into enclosures.`);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {sheetPicker && (
        <TransmittalSheetPickerModal
          scope={sheetPicker}
          history={sheetPicker === "paint" ? paintHistory : wcHistory}
          selected={
            sheetPicker === "paint" ? draft.paint_submittal_nums : draft.wc_submittal_nums
          }
          onSave={(nums) => {
            if (sheetPicker === "paint") patch({ paint_submittal_nums: nums, include_paint_sheet: nums.length > 0 });
            else patch({ wc_submittal_nums: nums, include_wc_sheet: nums.length > 0 });
            setSheetPicker(null);
          }}
          onClose={() => setSheetPicker(null)}
        />
      )}
    </div>
  );
}
