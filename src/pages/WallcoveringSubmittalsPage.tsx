import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FLOOR_ORDER } from "../lib/printCore";
import { printWallcoveringSubmittal } from "../lib/wallcoveringSubmittalPrint";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultWallcoveringSubmittal,
  emptyWallcoveringItem,
  PAINT_SUBMITTAL_TYPES,
  wcSubjectForType,
  type TradeSubmittalType,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

export function WallcoveringSubmittalsPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<WallcoveringSubmittalData>(defaultWallcoveringSubmittal());

  useEffect(() => {
    if (!loading) setDraft(tradeData.wallcovering_submittal ?? defaultWallcoveringSubmittal());
  }, [loading, tradeData.wallcovering_submittal]);

  function setType(t: TradeSubmittalType) {
    setDraft((d) => ({ ...d, submittal_type: t, subject: wcSubjectForType(t) }));
  }

  function patchItem(index: number, patch: Partial<WallcoveringItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  async function onSave() {
    const ok = await save({ ...tradeData, wallcovering_submittal: draft });
    if (ok) setError(null);
  }

  function onPrint() {
    try {
      printWallcoveringSubmittal(
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

  if (loading) return <p className="muted">Loading wallcovering submittal…</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Wallcovering submittals</h2>
          <p className="muted small">Same PDF layout as desktop Wallcovering tab.</p>
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

      <section className="card stack">
        <div className="row-between">
          <h3>Wallcovering items</h3>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyWallcoveringItem()] }))}
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
                Manufacturer
                <input
                  value={item.manufacturer}
                  onChange={(e) => patchItem(index, { manufacturer: e.target.value })}
                />
              </label>
            </div>
            <div className="grid-2">
              <label>
                Product
                <input value={item.product} onChange={(e) => patchItem(index, { product: e.target.value })} />
              </label>
              <label>
                Color
                <input value={item.color} onChange={(e) => patchItem(index, { color: e.target.value })} />
              </label>
            </div>
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
