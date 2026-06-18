export function orEmpty(value: string | null | undefined): string {
  return value ?? "";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}
