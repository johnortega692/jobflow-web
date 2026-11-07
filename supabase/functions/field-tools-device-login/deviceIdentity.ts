type DeviceTable = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    update: (values: Record<string, string>) => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export function appSource(value: unknown): "field_tools" | "field_view" | null {
  return value === "field_tools" || value === "field_view" ? value : null;
}

export function parseOsVersion(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ios = userAgent.match(/(?:CPU (?:iPhone|iPad) OS|iPhone OS|CPU OS) ([0-9_]+)/);
  if (ios) return `iOS ${ios[1].replace(/_/g, ".")}`;
  const android = userAgent.match(/Android ([0-9.]+)/);
  if (android) return `Android ${android[1]}`;
  if (!/iPhone|iPad/.test(userAgent)) {
    const mac = userAgent.match(/Mac OS X ([0-9_]+)/);
    if (mac) return `macOS ${mac[1].replace(/_/g, ".")}`;
  }
  const windows = userAgent.match(/Windows NT ([0-9.]+)/);
  if (windows) {
    const names: Record<string, string> = { "10.0": "10", "6.3": "8.1", "6.2": "8", "6.1": "7" };
    return `Windows ${names[windows[1]] ?? windows[1]}`;
  }
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function noteDeviceIdentity(
  supabase: DeviceTable,
  token: string,
  userAgent: string | null,
  app: "field_tools" | "field_view" | null,
): Promise<void> {
  try {
    const clean = token.trim();
    const os = parseOsVersion(userAgent);
    if (!clean || (!app && !os)) return;
    const hash = await sha256Hex(clean);
    const { data, error } = await supabase.from("trusted_devices").select("id, source, os_version").eq("token_hash", hash);
    if (error || !Array.isArray(data)) return;
    for (const row of data as { id?: string; source?: string | null; os_version?: string | null }[]) {
      if (!row.id) continue;
      const update: Record<string, string> = {};
      if (!row.source && app) update.source = app;
      if (!row.os_version && os) update.os_version = os;
      if (Object.keys(update).length === 0) continue;
      await supabase.from("trusted_devices").update(update).eq("id", row.id);
    }
  } catch {
    // A missed label must not stop sign-in.
  }
}
