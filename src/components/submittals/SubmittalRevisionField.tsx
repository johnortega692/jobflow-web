type Props = {
  revisionNumber: number;
  locked: boolean;
  onCreateNextRevision?: () => void;
};

/** Compact read-only revision + optional “next revision” action beside the field. */
export function SubmittalRevisionField({ revisionNumber, locked, onCreateNextRevision }: Props) {
  return (
    <div className="submittal-revision-row">
      <label className="submittal-revision-label">
        Revision
        <input
          type="number"
          className="submittal-revision-input"
          min={0}
          value={revisionNumber}
          readOnly
          aria-readonly
        />
      </label>
      {locked && onCreateNextRevision && (
        <button
          type="button"
          className="btn btn-secondary btn-small submittal-revision-next-btn"
          onClick={onCreateNextRevision}
        >
          Create next revision
        </button>
      )}
    </div>
  );
}
