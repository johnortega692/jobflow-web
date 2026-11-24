import { trackingLink } from "../lib/trackingLink";

export function TrackingLink({ value, className }: { value: string; className?: string }) {
  const text = value.trim();
  const link = trackingLink(text);
  if (!text) return null;
  if (!link) return <span title={text}>{text}</span>;
  const where = link.carrier === "Google" ? "Google" : link.carrier;
  return (
    <a className={className} href={link.url} target="_blank" rel="noopener noreferrer" title={`Open tracking on ${where}`}>
      {text}
    </a>
  );
}
