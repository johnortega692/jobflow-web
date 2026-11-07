/** Explains plain follow-ups vs. ones flagged as a problem, under the note form's follow-up options. */
export function FollowUpHelp() {
  return (
    <p className="project-notes-help">
      <strong>Follow-up:</strong> a to-do that stays quiet until its date, then shows as due or overdue.{" "}
      <strong>Flag as problem:</strong> also marks the job as having an issue and raises its attention. Give it a date
      to allow time for a response; with no date it appears in every digest until resolved.
    </p>
  );
}
