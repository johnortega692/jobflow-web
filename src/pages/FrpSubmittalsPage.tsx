import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { FrpAddTrimModal } from "../components/frp/FrpAddTrimModal";
import { FrpItemRow } from "../components/frp/FrpItemRow";
import { useLetterhead } from "../contexts/LetterheadContext";
import type { FrpCatalog } from "../lib/frpCatalog";
import { loadFrpCatalog } from "../lib/frpCatalog";
import { printFrpSubmittal } from "../lib/frpSubmittalPrint";
import {
  applyTransmittalContractIfDistinct,
  frpJobLabel,
  frpJobName,
  frpJobNumber,
  frpPrintInfo,
  hasDistinctFrpContract,
} from "../lib/jobInfo";
import { frpSubmittalFilename } from "../lib/pdfFilenames";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultFrpSubmittal,
  defaultTransmittal,
  emptyFrpItem,
  type FrpItem,
  type FrpSubmittalData,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function frpItemHasContent(item: FrpItem): boolean {
  return Boolean(item.manufacturer.trim() || item.product.trim() || item.label.trim());
}

function normalizeFrpDraft(raw: FrpSubmittalData): FrpSubmittalData {
  const items = (raw.items ?? [emptyFrpItem()]).map((i) => ({
    ...emptyFrpItem(),
    ...i,
    order: i.order ?? false,
  }));
  return {
    ...defaultFrpSubmittal(),
    ...raw,
    items,
  };
}

export function FrpSubmittalsPage() {
  const { branding } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<FrpSubmittalData>(defaultFrpSubmittal());
  const [catalog, setCatalog] = useState<FrpCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [trimOpen, setTrimOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      setDraft(normalizeFrpDraft(tradeData.frp_submittal ?? defaultFrpSubmittal()));
    }
  }, [loading, tradeData.frp_submittal]);

  useEffect(() => {
    let cancelled = false;
    void loadFrpCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load FRP catalog");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  async function persist(nextDraft: FrpSubmittalData) {
    const ok = await save({ ...tradeData, frp_submittal: nextDraft });
    if (ok) {
      setDraft(nextDraft);
      setError(null);
    }
    return ok;
  }

  function patchItem(index: number, patch: Partial<FrpItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  async function onSave() {
    await persist(draft);
    setStatus("FRP items saved.");
  }

  const frpPrint = useMemo(() => frpPrintInfo(project, project.jobInfo), [project]);
  const frpNum = frpJobNumber(project);
  const frpName = frpJobName(project);

  async function onSubmittalPdf() {
    const items = draft.items.filter(frpItemHasContent);
    if (!items.length) {
      setError("Add FRP items before generating a submittal.");
      return;
    }
    if (!frpNum || !frpName) {
      setError("Job number and job name are required.");
      return;
    }
    try {
      printFrpSubmittal(frpPrint, draft, branding);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: "Product Data",
          scope: "FRP",
          spec: "066000",
          notes: `FRP submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* optional */
      }
      let transmittal = queuePendingItem(tradeData.transmittal ?? defaultTransmittal(), {
        submittal_type: "Product Data",
        scope: "FRP",
        source: "frp_submittal",
        trade_submittal_number: String(draft.submittal_number),
        log_row_id: logRowId,
      });
      transmittal = applyTransmittalContractIfDistinct(project, transmittal, "frp");
      await save({ ...tradeData, frp_submittal: draft, transmittal });
      setStatus("FRP submittal PDF opened.");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    }
  }

  function addTrimItems(items: FrpItem[]) {
    setDraft((d) => {
      const existing = d.items.filter(frpItemHasContent);
      const merged = [...existing, ...items];
      return { ...d, items: merged.length ? merged : [emptyFrpItem()] };
    });
    setStatus(`Added ${items.length} trim item(s). Save to keep changes.`);
  }

  const submittalPdfFilename = useMemo(
    () => frpSubmittalFilename(frpPrint.job_name, frpPrint.job_number, draft.submittal_number),
    [frpPrint.job_name, frpPrint.job_number, draft.submittal_number],
  );

  if (loading || catalogLoading) return <p className="muted">Loading FRP submittal…</p>;
  if (!catalog) return <p className="muted">FRP catalog unavailable.</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>FRP</h2>
          <p className="muted small">
            FRP items and submittal PDFs. Material orders →{" "}
            <Link to={`/projects/${projectId}/orders`}>Orders</Link>.
          </p>
          {hasDistinctFrpContract(project) && (
            <p className="muted small">Contract: {frpJobLabel(project)}.</p>
          )}
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSubmittalPdf()}>
            Submittal PDF
          </button>
        </div>
      </div>

      <p className="sds-filename-preview muted small">
        PDF filename: <code>{submittalPdfFilename}</code>
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card frp-items-section">
        <div className="frp-items-toolbar row-gap wrap">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setDraft((d) => ({ ...d, items: [...d.items.filter(frpItemHasContent), emptyFrpItem()] }))
            }
          >
            Add
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setTrimOpen(true)}>
            Add trim
          </button>
        </div>

        <div className="frp-items-list">
          {draft.items.map((item, index) => (
            <FrpItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              catalog={catalog}
              onChange={(patch) => patchItem(index, patch)}
              onMoveUp={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                setDraft((d) => {
                  const next = d.items.filter((_, i) => i !== index);
                  return { ...d, items: next.length ? next : [emptyFrpItem()] };
                })
              }
            />
          ))}
        </div>
      </section>

      {trimOpen && (
        <FrpAddTrimModal catalog={catalog} onAdd={addTrimItems} onClose={() => setTrimOpen(false)} />
      )}
    </div>
  );
}
