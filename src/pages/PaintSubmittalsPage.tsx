import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FLOOR_ORDER } from "../lib/printCore";
import { printPaintSubmittal } from "../lib/paintSubmittalPrint";
import type { ExtractedPaintRow } from "../lib/paintImageImport";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { PaintImageImport } from "../components/PaintImageImport";
import type { ProjectForm } from "../types/database";
import {
  defaultPaintSubmittal,
  emptyPaintItem,
  PAINT_SUBMITTAL_TYPES,
  paintSubjectForType,
  type PaintItem,
  type PaintSubmittalData,
  type TradeSubmittalType,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

export function PaintSubmittalsPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<PaintSubmittalData>(defaultPaintSubmittal());

  useEffect(() => {
    if (!loading) setDraft(tradeData.paint_submittal ?? defaultPaintSubmittal());
  }, [loading, tradeData.paint_submittal]);

  function setType(t: TradeSubmittalType) {
    setDraft((d) => ({ ...d, submittal_type: t, subject: paintSubjectForType(t) }));
  }

  function patchItem(index: number, patch: Partial<PaintItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function onImported(rows: ExtractedPaintRow[], mode: "replace" | "append") {
    const mapped: PaintItem[] = rows.map((r) => ({
      label: r.label,
      floor: r.floor,
      manufacturer: r.manufacturer,
      color: r.color,
      product: r.product,
      sheen: r.sheen,
      previous_color: "",
    }));
    setDraft((d) => ({
      ...d,
      items: mode === "append" ? [...d.items.filter((i) => i.label || i.color), ...mapped] : mapped,
    }));
    setError(null);
  }

  async function onSave() {
    const ok = await save({ ...tradeData, paint_submittal: draft });
    if (ok) setError(null);
  }

  function onPrint() {
    try {
      printPaintSubmittal(
        {
          job_number: project.job_number,
          job_name: project.job_name,
          job_address: project.job_address ?? "",
        },
        draft,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    }
  }

  if (loading) return <p className="muted">Loading paint submittal…</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Paint submittals</h2>
          <p className="muted small">Same PDF layout as desktop Paint tab.</p>
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
        <div className="grid-3">
          <label>
            Submittal #
            <input
              type="number"
              min={1}
              value={draft.submittal_number}
              onChange={(e) => setDraft({ ...draft, submittal_number: Number(e.target.value) || 1 })}
            />
          </label>
          <label>
            Type
            <select
              value={draft.submittal_type}
              onChange={(e) => setType(e.target.value as TradeSubmittalType)}
            >
              {PAINT_SUBMITTAL_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
        </div>
        <label>
          Subject
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </label>
      </section>

      <PaintImageImport onImported={onImported} />

      <section className="card stack">
        <div className="row-between">
          <h3>Paint items</h3>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyPaintItem()] }))}
          >
            Add row
          </button>
        </div>
        {draft.items.map((item, index) => (
          <div key={index} className="submittal-row card stack">
            <div className="grid-3">
              <label>
                Label
                <input value={item.label} onChange={(e) => patchItem(index, { label: e.target.value })} />
              </label>
              <label>
                Manufacturer
                <input
                  value={item.manufacturer}
                  onChange={(e) => patchItem(index, { manufacturer: e.target.value })}
                  placeholder="BM, SW, DE…"
                />
              </label>
              <label>
                Color
                <input value={item.color} onChange={(e) => patchItem(index, { color: e.target.value })} />
              </label>
            </div>
            <div className="grid-3">
              <label>
                Floor
                <select value={item.floor} onChange={(e) => patchItem(index, { floor: e.target.value })}>
                  <option value="">—</option>
                  {FLOOR_ORDER.filter(Boolean).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Product
                <input value={item.product} onChange={(e) => patchItem(index, { product: e.target.value })} />
              </label>
              <label>
                Sheen
                <input value={item.sheen} onChange={(e) => patchItem(index, { sheen: e.target.value })} />
              </label>
            </div>
            {draft.submittal_type === "substitution" && (
              <label>
                Previous color
                <input
                  value={item.previous_color}
                  onChange={(e) => patchItem(index, { previous_color: e.target.value })}
                />
              </label>
            )}
            {draft.items.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== index) }))
                }
              >
                Remove row
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
