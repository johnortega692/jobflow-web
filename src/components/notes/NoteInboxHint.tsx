import { useState } from "react";
import { noteInboxAddress } from "../../lib/noteInbox";

type Props = {
  jobNumber: string;
};

export function NoteInboxHint({ jobNumber }: Props) {
  const address = noteInboxAddress(jobNumber);
  const [copied, setCopied] = useState(false);
  if (!address) return null;

  return (
    <p className="note-inbox-hint">
      Forward an email to{" "}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }).catch(() => undefined);
        }}
      >
        {address}
      </button>
      {copied ? " · Copied" : ""}. Send it from the email on a JobFlow account. The subject and message are saved as a note. COR or “change order” turns the COR flag on.
    </p>
  );
}
