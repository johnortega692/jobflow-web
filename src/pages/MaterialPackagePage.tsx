import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

type PackageCard = {
  job_number: string;
  job_name: string;
  label: string;
  material_name: string;
  manufacturer: string;
  product: string;
  color: string;
  package_qty: string;
  order_qty: string;
  order_unit: string;
  order_notes: string;
  lead_time: string;
  approval_received: string;
  date_ordered: string;
  ship_date: string;
  install_date: string;
  follow_up: string;
  esd_follow_up: string;
  tracking: string;
  delivery_notes: string;
  revision_notes: string;
  image_url: string;
  document_url: string;
  ordered: boolean;
  sent_for_approval: boolean;
  revision: boolean;
  approved: boolean;
  field_measure: boolean;
  shops: boolean;
  panels: boolean;
  material_order: boolean;
  delivered: boolean;
};

const TEXT_KEYS = [
  "job_number",
  "job_name",
  "label",
  "material_name",
  "manufacturer",
  "product",
  "color",
  "package_qty",
  "order_qty",
  "order_unit",
  "order_notes",
  "lead_time",
  "approval_received",
  "date_ordered",
  "ship_date",
  "install_date",
  "follow_up",
  "esd_follow_up",
  "tracking",
  "delivery_notes",
  "revision_notes",
  "image_url",
  "document_url",
] as const;

const FLAG_KEYS = [
  "ordered",
  "sent_for_approval",
  "revision",
  "approved",
  "field_measure",
  "shops",
  "panels",
  "material_order",
  "delivered",
] as const;

function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asFlag(value: unknown): boolean {
  return value === true || value === "true";
}

function asCard(value: unknown): PackageCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const card = {} as PackageCard;
  for (const key of TEXT_KEYS) card[key] = asText(row[key]);
  for (const key of FLAG_KEYS) card[key] = asFlag(row[key]);
  return card;
}

function httpUrl(value: string): string {
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) return text;
  return "";
}

function packageStatus(card: PackageCard): { label: string; tone: string } {
  if (card.delivered) return { label: "Delivered", tone: "delivered" };
  if (card.material_order) return { label: "Material order", tone: "ordered" };
  if (card.revision && !card.approved) return { label: "Needs revision", tone: "revision" };
  if (card.approved) return { label: "Approved", tone: "approved" };
  if (card.sent_for_approval) return { label: "Sent approval", tone: "sent" };
  if (card.ordered) return { label: "Ordered", tone: "submittal" };
  return { label: "Not started", tone: "idle" };
}

function leadTimeLabel(value: string): string {
  const text = value.trim();
  if (!text || /week/i.test(text)) return text;
  return `${text} weeks`;
}

function containedIn(name: string, value: string): boolean {
  const part = value.trim().toLowerCase();
  if (!part) return true;
  return name.trim().toLowerCase().includes(part);
}

export function MaterialPackagePage() {
  const { token } = useParams();
  const [card, setCard] = useState<PackageCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [imageHidden, setImageHidden] = useState(false);

  useEffect(() => {
    const code = token?.trim() ?? "";
    if (!code || !isSupabaseConfigured) {
      setMissing(true);
      return;
    }
    let cancelled = false;
    setMissing(false);
    setCard(null);
    setImageHidden(false);
    void supabase
      .rpc("material_package_card" as never, { p_token: code } as never)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setMissing(true);
          return;
        }
        const next = asCard(data);
        if (!next) setMissing(true);
        else setCard(next);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const job = [card?.job_number, card?.job_name].filter(Boolean).join(" ");
  const title = card?.material_name.trim() || card?.product.trim() || card?.label.trim() || "Material";
  const image = httpUrl(card?.image_url ?? "");
  const link = httpUrl(card?.document_url ?? "");
  const status = card ? packageStatus(card) : null;
  const order = [card?.order_qty, card?.order_unit].filter(Boolean).join(" ");
  const facts = card
    ? (
        [
          ["Manufacturer", containedIn(title, card.manufacturer) ? "" : card.manufacturer],
          ["Product", card.product !== title && !containedIn(title, card.product) ? card.product : ""],
          ["Color", containedIn(title, card.color) ? "" : card.color],
          ["Approval received", card.approval_received],
          ["Date ordered", card.date_ordered],
          ["Ship date", card.ship_date],
          ["Install date", card.install_date],
          ["Lead time", leadTimeLabel(card.lead_time)],
          ["Package qty", card.package_qty],
          ["Order qty", order],
          ["Follow up", card.follow_up],
          ["ESD follow up", card.esd_follow_up],
          ["Tracking", card.tracking, true],
        ] as [string, string, boolean?][]
      ).filter((row) => row[1].trim())
    : [];
  const flags = card
    ? [
        card.field_measure ? "Field measure" : "",
        card.shops ? "Shops" : "",
        card.panels ? "Panels" : "",
        card.revision ? "Needs revision" : "",
      ].filter(Boolean)
    : [];

  return (
    <main className="pkg-page">
      <article className="pkg-card">
        {!card && !missing ? <p className="pkg-muted">Loading…</p> : null}
        {missing ? <h1>This package label is no longer on the tracker.</h1> : null}
        {card && status ? (
          <>
            {image && !imageHidden ? (
              <img className="pkg-image" src={image} alt="" onError={() => setImageHidden(true)} />
            ) : null}
            <div className="pkg-top">
              <p className="pkg-kicker">Material</p>
              <p className={`pkg-status pkg-status-${status.tone}`}>{status.label}</p>
            </div>
            {job ? <p className="pkg-job">{job}</p> : null}
            {card.label.trim() ? <p className="pkg-code">{card.label.trim()}</p> : null}
            <h1>{title}</h1>
            {facts.length > 0 ? (
              <dl className="pkg-facts">
                {facts.map(([label, value, wide]) => (
                  <div key={label} className={wide ? "pkg-wide" : undefined}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {flags.length > 0 ? (
              <ul className="pkg-flags">
                {flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            ) : null}
            {card.delivery_notes.trim() ? (
              <section className="pkg-notes">
                <h2>Delivery notes</h2>
                <p>{card.delivery_notes.trim()}</p>
              </section>
            ) : null}
            {card.revision && card.revision_notes.trim() ? (
              <section className="pkg-notes">
                <h2>Revision notes</h2>
                <p>{card.revision_notes.trim()}</p>
              </section>
            ) : null}
            {card.order_notes.trim() ? (
              <section className="pkg-notes">
                <h2>Order notes</h2>
                <p>{card.order_notes.trim()}</p>
              </section>
            ) : null}
            {link ? (
              <a className="pkg-docs" href={link} target="_blank" rel="noopener noreferrer">
                Open link
              </a>
            ) : card.document_url.trim() ? (
              <p className="pkg-link-text">{card.document_url.trim()}</p>
            ) : null}
          </>
        ) : null}
      </article>
    </main>
  );
}
