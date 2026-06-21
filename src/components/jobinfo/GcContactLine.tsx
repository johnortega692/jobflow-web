import type { ReactNode } from "react";

type GcContactLineProps = {
  label: string;
  name: string;
  phone: string;
  email: string;
};

function displayContactName(name: string): string {
  const trimmed = name.trim();
  return trimmed.toUpperCase() === "TBD" ? "" : trimmed;
}

export function GcContactLine({ label, name, phone, email }: GcContactLineProps) {
  const displayName = displayContactName(name);
  if (!displayName && !phone && !email) return null;

  const parts: ReactNode[] = [];
  if (displayName) parts.push(<span className="job-dashboard-contact-value">{displayName}</span>);
  if (phone) {
    parts.push(
      <a key="phone" href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="job-dashboard-contact-link">
        {phone}
      </a>,
    );
  }
  if (email) {
    parts.push(
      <a key="email" href={`mailto:${email}`} className="job-dashboard-contact-link">
        {email}
      </a>,
    );
  }

  return (
    <p className="job-dashboard-contact muted small">
      <span className="job-dashboard-contact-role">{label}</span>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="job-dashboard-contact-sep"> · </span>}
          {part}
        </span>
      ))}
    </p>
  );
}
