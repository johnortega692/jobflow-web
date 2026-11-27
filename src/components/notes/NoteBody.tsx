type Props = {
  body: string;
};

export function noteSubject(body: string): string {
  const line = body.replace(/\r\n/g, "\n").split("\n").find((item) => item.trim());
  return line?.trim() || "Note";
}

function noteDetail(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first === -1) return "";
  return lines.slice(first + 1).join("\n").trim();
}

export function NoteBody({ body }: Props) {
  const subject = noteSubject(body);
  const detail = noteDetail(body);
  return (
    <div className="project-notes-body">
      <div className="project-notes-subject">{subject}</div>
      {detail ? (
        <details className="project-notes-details" onClick={(event) => event.stopPropagation()}>
          <summary>Message</summary>
          <div className="project-notes-details-body">{detail}</div>
        </details>
      ) : null}
    </div>
  );
}
