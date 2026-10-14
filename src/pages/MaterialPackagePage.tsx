import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { parseFlexibleDate } from "../lib/dateInputUtils";
import { packageLabelCopies } from "../lib/materialPackageLabel";
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function monthDay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function weekdayMonthDay(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${monthDay(date)}`;
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function relativeDay(date: Date, now = new Date()): string {
  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

function firstDate(text: string): Date | null {
  const match = text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  return match ? parseFlexibleDate(match[0]) : parseFlexibleDate(text);
}

function packageStatus(card: PackageCard): { label: string; tone: string } {
  if (card.delivered) {
    const stamped = firstDate(card.delivery_notes);
    return { label: stamped ? `Delivered ${monthDay(stamped)}` : "Delivered", tone: "delivered" };
  }
  if (card.material_order) return { label: "Material order", tone: "ordered" };
  if (card.revision && !card.approved) return { label: "Needs revision", tone: "revision" };
  if (card.approved) return { label: "Approved", tone: "approved" };
  if (card.sent_for_approval) return { label: "Sent approval", tone: "sent" };
  if (card.ordered) return { label: "Ordered", tone: "submittal" };
  return { label: "Not started", tone: "idle" };
}

function materialTitle(card: PackageCard): string {
  const product = card.product.trim();
  const color = card.color.trim();
  const maker = card.manufacturer.trim();
  if (product && color) return `${[maker, product].filter(Boolean).join(" ")} — ${color}`;
  return card.material_name.trim() || product || maker || "Material";
}

function leadTimeLabel(value: string): string {
  const text = value.trim();
  if (!text || /week/i.test(text)) return text;
  return `${text} weeks`;
}

type HistoryItem = { label: string; value: string; at: number };

function historyItems(card: PackageCard): HistoryItem[] {
  const dated: HistoryItem[] = [];
  const addDate = (label: string, raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const date = parseFlexibleDate(text) ?? firstDate(text);
    dated.push({ label, value: text, at: date ? date.getTime() : Number.MAX_SAFE_INTEGER });
  };
  addDate("Approval received", card.approval_received);
  addDate("Date ordered", card.date_ordered);
  addDate("Ship date", card.ship_date);
  addDate("Follow up", card.follow_up);
  addDate("ESD follow up", card.esd_follow_up);
  addDate("Delivered", card.delivery_notes);
  if (card.lead_time.trim()) {
    dated.push({ label: "Lead time", value: leadTimeLabel(card.lead_time), at: Number.MAX_SAFE_INTEGER - 2 });
  }
  if (card.tracking.trim()) {
    dated.push({ label: "Tracking", value: card.tracking.trim(), at: Number.MAX_SAFE_INTEGER - 1 });
  }
  return dated.sort((a, b) => a.at - b.at || a.label.localeCompare(b.label));
}

export function MaterialPackagePage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [card, setCard] = useState<PackageCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [imageHidden, setImageHidden] = useState(false);
  const [zoomed, setZoomed] = useState(false);

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
    setZoomed(false);
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
  const title = card ? materialTitle(card) : "Material";
  const image = httpUrl(card?.image_url ?? "");
  const showImage = Boolean(image) && !imageHidden;
  const link = httpUrl(card?.document_url ?? "");
  const status = card ? packageStatus(card) : null;
  const packageCount = card ? packageLabelCopies(card.package_qty) : 1;
  const hasPackageCount = Boolean(card?.package_qty.trim().match(/^\d+/));
  const boxNumber = Number(searchParams.get("n"));
  const box =
    hasPackageCount && Number.isFinite(boxNumber) && boxNumber >= 1
      ? Math.min(packageCount, Math.floor(boxNumber))
      : 0;
  const order = [card?.order_qty, card?.order_unit].filter(Boolean).join(" ");
  const install = card ? parseFlexibleDate(card.install_date) : null;
  const history = card ? historyItems(card) : [];
  const needsRevision = Boolean(card?.revision && !card.approved);

  return (
    <main className="pkg-page">
      <article className="pkg-sheet">
        {!card && !missing ? <p className="pkg-muted">Loading…</p> : null}
        {missing ? <h1 className="pkg-missing">This package label is no longer on the tracker.</h1> : null}
        {card && status ? (
          <>
            <header className="pkg-head">
              <div>
                <p className="pkg-kicker">Job</p>
                <h1>{job || "Material package"}</h1>
              </div>
              <p className={`pkg-status pkg-status-${status.tone}`}>{status.label}</p>
            </header>

            {showImage ? (
              <div className="pkg-photo">
                <button type="button" className="pkg-photo-open" onClick={() => setZoomed(true)}>
                  <img src={image} alt="" onError={() => setImageHidden(true)} />
                </button>
                <button type="button" className="pkg-zoom" onClick={() => setZoomed(true)}>
                  Tap to zoom
                </button>
              </div>
            ) : null}

            <section className="pkg-identity">
              <p className="pkg-identity-kicker">
                {card.label.trim() ? <span className="pkg-code">{card.label.trim()}</span> : null}
                <span>Wallcovering</span>
              </p>
              <h2>{title}</h2>
            </section>

            <section className={`pkg-stats${install ? "" : " pkg-stats-one"}`}>
              <div>
                <p className="pkg-kicker">This box</p>
                <p className="pkg-stat">
                  {box ? `Pkg ${box} of ${packageCount}` : hasPackageCount ? `${packageCount} packages` : "1 package"}
                </p>
                {order ? <p className="pkg-stat-sub">{order} ordered total</p> : null}
              </div>
              {install ? (
                <div>
                  <p className="pkg-kicker">Install</p>
                  <p className="pkg-stat">{weekdayMonthDay(install)}</p>
                  <p className="pkg-stat-sub pkg-stat-soon">{relativeDay(install)}</p>
                </div>
              ) : null}
            </section>

            {needsRevision ? (
              <section className="pkg-alert">
                <p>Needs revision</p>
                <p>{card.revision_notes.trim() || "Check with PM before installing."}</p>
              </section>
            ) : null}

            {history.length > 0 ? (
              <details className="pkg-history">
                <summary>
                  <span>Procurement history</span>
                  <span>
                    {history.length} {history.length === 1 ? "item" : "items"}
                  </span>
                </summary>
                <ol>
                  {history.map((item) => (
                    <li key={`${item.label}-${item.value}`}>
                      <span>{item.label}</span>
                      <span>{item.value}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}

            {link ? (
              <a className="pkg-docs" href={link} target="_blank" rel="noopener noreferrer">
                Product page
              </a>
            ) : null}
          </>
        ) : null}
      </article>

      {zoomed && showImage ? (
        <div className="pkg-zoom-layer" role="presentation" onClick={() => setZoomed(false)}>
          <button type="button" className="pkg-zoom-close" aria-label="Close photo" onClick={() => setZoomed(false)}>
            Close
          </button>
          <img src={image} alt={title} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </main>
  );
}
