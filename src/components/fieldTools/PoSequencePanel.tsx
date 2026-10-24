import { useCallback, useEffect, useState } from "react";
import {
  clearPoSequence,
  getPoSequence,
  previewPoNumber,
  setPoSequence,
  type PoSequence,
} from "../../lib/poSequence";

type JobCode = { code: string; labels: string[] };

type Props = {
  jobs: JobCode[];
};

export function PoSequencePanel({ jobs }: Props) {
  const [rows, setRows] = useState<Record<string, PoSequence>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await Promise.all(jobs.map((job) => getPoSequence(job.code)));
      const nextRows: Record<string, PoSequence> = {};
      const nextDrafts: Record<string, string> = {};
      for (const row of loaded) {
        nextRows[row.jobCode] = row;
        nextDrafts[row.jobCode] = String(row.nextSeq);
      }
      setRows(nextRows);
      setDrafts(nextDrafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the PO sequence.");
    } finally {
      setLoading(false);
    }
  }, [jobs]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(code: string) {
    const parsed = Number.parseInt(drafts[code] ?? "", 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Enter a next sequence of 1 or higher.");
      return;
    }
    setBusyCode(code);
    setError(null);
    try {
      await setPoSequence(code, parsed);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the PO sequence.");
    } finally {
      setBusyCode(null);
    }
  }

  async function reset(code: string) {
    const ok = window.confirm(
      `Reset ${code} so the next PO is the number after the highest one already issued?`,
    );
    if (!ok) return;
    setBusyCode(code);
    setError(null);
    try {
      await clearPoSequence(code);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the PO sequence.");
    } finally {
      setBusyCode(null);
    }
  }

  if (!jobs.length) return null;

  return (
    <section className="card stack po-sequence-panel">
      <div>
        <h3>PO sequence</h3>
        <p className="muted small">
          Same next number Field Tools uses for this job. Saving it does not issue a PO. The next order takes that
          number.
        </p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted small">Loading sequence…</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table po-sequence-table">
            <thead>
              <tr>
                <th>Job</th>
                <th className="paint-estimates-num">Highest issued</th>
                <th className="paint-estimates-num">Next sequence</th>
                <th>Next PO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const row = rows[job.code];
                const draft = drafts[job.code] ?? "";
                const parsed = Number.parseInt(draft, 10);
                const preview =
                  row && Number.isFinite(parsed) && parsed >= 1
                    ? previewPoNumber(row.jobCode, parsed, row.digits)
                    : "—";
                const unchanged = row ? parsed === row.nextSeq : true;
                const busy = busyCode === job.code;
                return (
                  <tr key={job.code}>
                    <td>
                      <div className="po-sequence-job">{job.code}</div>
                      <div className="muted small">{job.labels.join(" · ")}</div>
                    </td>
                    <td className="paint-estimates-num">{row ? row.highestIssued : "—"}</td>
                    <td className="paint-estimates-num">
                      <input
                        className="input po-sequence-input"
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={draft}
                        aria-label={`Next PO sequence for ${job.code}`}
                        disabled={!row || busy}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [job.code]: e.target.value }))}
                      />
                    </td>
                    <td>{preview}</td>
                    <td>
                      <div className="po-sequence-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={!row || busy || unchanged}
                          onClick={() => void save(job.code)}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        {row?.hasOverride ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void reset(job.code)}
                          >
                            Reset
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
