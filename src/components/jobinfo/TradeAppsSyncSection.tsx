import { useMemo, useState } from "react";
import { syncProjectTradeJobsToFieldTools } from "../../lib/fieldToolsJobSync";
import { projectTradeJobIdentities } from "../../lib/jobInfo";
import { registerProjectTradeJobsInManpower } from "../../lib/registerProjectTradeJobs";
import { fieldAppsSyncReady, syncProjectTradeApps } from "../../lib/tradeAppsSync";
import type { ProjectForm } from "../../types/database";

type Props = {
  project: ProjectForm;
  projectId: string;
  /** Render as a flat section (e.g. inside Job setup tab) instead of collapsible details. */
  embedded?: boolean;
};

export function TradeAppsSyncSection({ project, projectId, embedded }: Props) {
  const identities = useMemo(() => projectTradeJobIdentities(project), [project]);
  const [busy, setBusy] = useState<"field" | "manpower" | "both" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSync(mode: "both" | "field" | "manpower") {
    setBusy(mode);
    setError(null);
    setStatus(null);
    try {
      if (mode === "both") {
        const result = await syncProjectTradeApps(project, projectId);
        if (result.errors.length) setError(result.errors.join(" "));
        if (result.messages.length) setStatus(result.messages.join(" · "));
        return;
      }

      if (mode === "field") {
        const rows = await syncProjectTradeJobsToFieldTools(project);
        const failed = rows.filter((r) => !r.ok);
        if (failed.length) setError(failed.map((r) => `${r.contractLabel}: ${r.message}`).join(" "));
        else {
          setStatus(
            rows.length === 1
              ? `Field Tools: ${rows[0]!.jobNumber} registered.`
              : `Field Tools: ${rows.map((r) => r.jobNumber).join(", ")} registered.`,
          );
        }
        return;
      }

      const { rows, error: rpcError } = await registerProjectTradeJobsInManpower(projectId, project);
      if (rpcError) {
        setError(rpcError);
        return;
      }
      const failed = rows.filter((r) => !r.ok);
      if (failed.length) setError(failed.map((r) => `${r.contractLabel}: ${r.message}`).join(" "));
      else {
        setStatus(
          rows.length === 1
            ? `Manpower: ${rows[0]!.manpowerName} registered.`
            : `Manpower: ${rows.map((r) => r.manpowerName).join("; ")} registered.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!identities.length) return null;

  const ready = fieldAppsSyncReady(project);

  const body = (
    <>
      <p className="muted small">
        Job numbers register in the Field Tools order app and Manpower hours tracker. When PM,
        super, address, and job # are filled, saving job setup syncs automatically. Dual-contract
        jobs register each trade job # separately.
      </p>
      <ul className="trade-apps-sync-list muted small">
        {identities.map((identity) => (
          <li key={identity.contract}>
            <strong>{identity.contractLabel}</strong> — {identity.jobNumber}
            {identity.jobName ? ` · ${identity.jobName}` : ""}
          </li>
        ))}
      </ul>
      {!ready && (
        <p className="muted small">
          Auto-sync on save needs job #, job address, Field Request PM, and Field Request Super.
        </p>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}
      <div className="row-gap wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => void runSync("both")}
        >
          {busy === "both" ? "Syncing…" : "Sync all to Field & Manpower"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy !== null}
          onClick={() => void runSync("field")}
        >
          {busy === "field" ? "Syncing…" : "Field Tools only"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy !== null}
          onClick={() => void runSync("manpower")}
        >
          {busy === "manpower" ? "Registering…" : "Manpower only"}
        </button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <section className="job-section card stack job-setup-tab-section">
        <h3 className="job-setup-tab-section-title">Field Tools &amp; Manpower</h3>
        {body}
      </section>
    );
  }

  return (
    <details className="job-section card stack">
      <summary className="job-section-summary">
        <h3>Field Tools &amp; Manpower</h3>
      </summary>
      {body}
    </details>
  );
}
