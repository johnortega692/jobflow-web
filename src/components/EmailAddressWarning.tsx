import { emailListWarning } from "../lib/emailAddressWarning";

type Props = {
  value: string;
  /** Tighter note under a table/grid input. Default is the Schedules-style banner. */
  compact?: boolean;
};

export function EmailAddressWarning({ value, compact = false }: Props) {
  const warning = emailListWarning(value);
  if (!warning) return null;
  if (compact) {
    return (
      <p className="muted small" role="status" style={{ margin: "4px 0 0", color: "var(--warn, #9a6700)" }}>
        {warning}
      </p>
    );
  }
  return (
    <div className="banner banner-warn" role="status">
      {warning} You can still save — fix it if this address should receive mail.
    </div>
  );
}
