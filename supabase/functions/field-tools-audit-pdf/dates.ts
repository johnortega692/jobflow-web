/** Display date as MM-DD-YYYY for orders (accepts ISO YYYY-MM-DD or US-style input). */
export function formatDateNeeded(raw: string): string {
  const s = raw.trim();
  if (!s) return "";

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;

  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (us) {
    return `${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}-${us[3]}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const yyyy = String(parsed.getFullYear());
    return `${mm}-${dd}-${yyyy}`;
  }

  return s;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
