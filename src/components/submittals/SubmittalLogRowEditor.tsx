import { useState } from "react";
import { DateInput } from "../DateInput";
import {
  SUBMITTAL_RESULTS,
  SUBMITTAL_SCOPES,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
} from "../../types/database";
import { lineNumberInUse, normalizeLogRow } from "../../lib/submittalLogHelpers";
import type { SubmittalLogRow } from "../../types/submittalLog";

type Props = {
  title: string;
  row: SubmittalLogRow;
  existingRows: SubmittalLogRow[];
  onSave: (row: SubmittalLogRow) => void;
  onClose: () => void;
};

export function SubmittalLogRowEditor({ title, row, existingRows, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => normalizeLogRow(row));
  const [error, setError] = useState<string | null>(null);

  function patch(partial: Partial<SubmittalLogRow>) {
    setDraft((d) => normalizeLogRow({ ...d, ...partial, id: d.id }));
  }

  function submit() {
    const normalized = normalizeLogRow({ ...draft, id: row.id || draft.id });
    if (!normalized.line_number.trim()) {
      setError("Line # is required.");
      return;
    }
    if (lineNumberInUse(existingRows, normalized.line_number, row.id || undefined)) {
      setError(`Line #${normalized.line_number} is already used.`);
      return;
    }
    onSave(normalized);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack submittal-log-editor"
        role="dialog"
        aria-labelledby="submittal-log-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="submittal-log-editor-title">{title}</h3>

        <div className="grid-2">
          <label>
            Line #
            <input value={draft.line_number} onChange={(e) => patch({ line_number: e.target.value })} />
          </label>
          <label>
            SPEC
            <input value={draft.spec} onChange={(e) => patch({ spec: e.target.value })} />
          </label>
          <label>
            SCOPE
            <select value={draft.scope} onChange={(e) => patch({ scope: e.target.value })}>
              {SUBMITTAL_SCOPES.map((s) => (
                <option key={s || "blank"} value={s}>
                  {s || "—"}
                </option>
              ))}
            </select>
          </label>
          <label>
            SECTION
            <input value={draft.section} onChange={(e) => patch({ section: e.target.value })} />
          </label>
          <label>
            SUBMITTAL
            <select
              value={draft.submittal_type}
              onChange={(e) => patch({ submittal_type: e.target.value })}
            >
              {SUBMITTAL_TYPES.map((t) => (
                <option key={t || "blank"} value={t}>
                  {t || "—"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={draft.status} onChange={(e) => patch({ status: e.target.value })}>
              {SUBMITTAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            SUBMIT
            <DateInput value={draft.submit_date} onChange={(v) => patch({ submit_date: v })} />
          </label>
          <label>
            RETURN
            <DateInput value={draft.return_date} onChange={(v) => patch({ return_date: v })} />
          </label>
          <label>
            RESULT
            <select value={draft.result} onChange={(e) => patch({ result: e.target.value })}>
              {SUBMITTAL_RESULTS.map((r) => (
                <option key={r || "blank"} value={r}>
                  {r || "—"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trans #
            <input
              value={draft.transmittal_number}
              onChange={(e) => patch({ transmittal_number: e.target.value })}
            />
          </label>
          <label>
            Revises line #
            <input value={draft.revises_line} onChange={(e) => patch({ revises_line: e.target.value })} />
          </label>
          <label>
            Trade submittal #
            <input
              value={draft.trade_submittal_number}
              onChange={(e) => patch({ trade_submittal_number: e.target.value })}
            />
          </label>
        </div>

        <label>
          NOTES
          <textarea rows={3} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </label>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" onClick={submit}>
            Save row
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
