import { shouldShowRevisionNote } from "../../lib/printCore";

type Props = {
  revisionNumber: number;
  value: string;
  onChange: (value: string) => void;
  /** When "revised", the note field shows even on Rev 0. */
  submittalType?: string;
};

export function RevisionNoteField({ revisionNumber, value, onChange, submittalType }: Props) {
  if (!shouldShowRevisionNote(revisionNumber, submittalType)) return null;

  return (
    <label className="stack revision-note-field">
      <span>
        Revision Note{" "}
        <span className="muted small">(optional — explains why this revision was created)</span>
      </span>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Updated color selections per design team review dated 06/18/2026."
      />
    </label>
  );
}
