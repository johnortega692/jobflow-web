import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIMEZONE = "America/Los_Angeles";
const RAIN_PROBABILITY = 40;
const CACHE_MS = 60 * 60 * 1000;
const FAILED_GEOCODE_MS = 24 * 60 * 60 * 1000;

type Lines = Record<string, Record<string, string>>;

type GeocodeRow = {
  project_id: string;
  address_key: string;
  lat: number | null;
  lng: number | null;
  geocoded_at: string;
};

type ProjectRow = {
  id: string;
  job_address: string | null;
  job_address2: string | null;
  site_address_override: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function addressKey(address: string): string {
  return address.trim().replace(/\s+/g, " ").toLowerCase();
}

function siteAddress(project: ProjectRow): string {
  const override = (project.site_address_override ?? "").trim();
  if (override) return override;
  const street = (project.job_address ?? "").trim();
  const extra = (project.job_address2 ?? "").trim();
  if (!street) return extra;
  if (!extra || street.toLowerCase().includes(extra.toLowerCase())) return street;
  return `${street}, ${extra}`;
}

function bucket(value: number): number {
  return Math.round(value * 100) / 100;
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const face = hour % 12 === 0 ? 12 : hour % 12;
  return `${face}${suffix}`;
}

/** Rain during 6am–3pm, collapsed into spans. Hours 6 through 14 are the work window. */
export function workWindowSummary(times: string[], probabilities: Array<number | null>, day: string): string | null {
  const rainy: number[] = [];
  let sawDay = false;
  for (let i = 0; i < times.length; i++) {
    const stamp = times[i] ?? "";
    if (!stamp.startsWith(day)) continue;
    sawDay = true;
    const hour = Number(stamp.slice(11, 13));
    if (hour < 6 || hour > 14) continue;
    if ((probabilities[i] ?? 0) >= RAIN_PROBABILITY) rainy.push(hour);
  }
  if (!sawDay) return null;
  if (!rainy.length) return "Dry 6am–3pm";
  const spans: string[] = [];
  let start = rainy[0] ?? 6;
  let prev = start;
  for (const hour of rainy.slice(1)) {
    if (hour === prev + 1) {
      prev = hour;
      continue;
    }
    spans.push(`${hourLabel(start)}\u2013${hourLabel(prev + 1)}`);
    start = hour;
    prev = hour;
  }
  spans.push(`${hourLabel(start)}\u2013${hourLabel(prev + 1)}`);
  return `Rain likely ${spans.join(" and ")}`;
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

async function mapPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index] as T);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "manpower-cal" } });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    result?: { addressMatches?: { coordinates?: { x?: number; y?: number } }[] };
  };
  const point = body.result?.addressMatches?.[0]?.coordinates;
  if (typeof point?.y !== "number" || typeof point?.x !== "number") return null;
  return { lat: point.y, lng: point.x };
}

async function forecast(lat: number, lng: number, start: string, end: string) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("timezone", TIMEZONE);
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    hourly?: { time?: string[]; precipitation_probability?: Array<number | null> };
  };
  const times = body.hourly?.time ?? [];
  const probabilities = body.hourly?.precipitation_probability ?? [];
  if (!times.length || times.length !== probabilities.length) return null;
  return { times, probabilities };
}

async function sessionIsActive(supabase: SupabaseClient, token: string): Promise<boolean> {
  const { data: session, error } = await supabase
    .from("manpower_sessions")
    .select("super_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !session) return false;
  if (new Date(session.expires_at).getTime() <= Date.now()) return false;
  const { data: superRow } = await supabase
    .from("manpower_supers")
    .select("active")
    .eq("id", session.super_id)
    .maybeSingle();
  return Boolean(superRow?.active);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Missing server config" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as { token?: string; week_start?: string };
    const token = (body.token ?? "").trim();
    const weekStart = (body.week_start ?? "").slice(0, 10);
    if (!token || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return jsonResponse({ lines: {} satisfies Lines });
    if (!(await sessionIsActive(supabase, token))) return jsonResponse({ error: "Invalid session" }, 401);

    const { data: week } = await supabase
      .from("manpower_weeks")
      .select("id")
      .eq("week_start", weekStart)
      .maybeSingle();
    if (!week?.id) return jsonResponse({ lines: {} satisfies Lines });

    const { data: jobs } = await supabase
      .from("manpower_jobs")
      .select("name, project_id")
      .eq("week_id", week.id);
    const named = (jobs ?? []).filter((job) => job.project_id && (job.name ?? "").trim());
    const projectIds = [...new Set(named.map((job) => job.project_id as string))];
    if (!projectIds.length) return jsonResponse({ lines: {} satisfies Lines });

    const { data: projects } = await supabase
      .from("projects")
      .select("id, job_address, job_address2, site_address_override")
      .in("id", projectIds);
    const { data: storedGeocodes } = await supabase
      .from("manpower_site_geocodes")
      .select("project_id, address_key, lat, lng, geocoded_at")
      .in("project_id", projectIds);
    const geocodeByProject = new Map<string, GeocodeRow>(
      ((storedGeocodes ?? []) as GeocodeRow[]).map((row) => [row.project_id, row]),
    );

    const located = new Map<string, { lat: number; lng: number }>();
    const needsGeocode = new Map<string, { address: string; projectIds: string[] }>();
    for (const project of (projects ?? []) as ProjectRow[]) {
      const address = siteAddress(project);
      if (!address) continue;
      const key = addressKey(address);
      const stored = geocodeByProject.get(project.id);
      const freshFail =
        stored &&
        stored.address_key === key &&
        stored.lat == null &&
        Date.now() - new Date(stored.geocoded_at).getTime() < FAILED_GEOCODE_MS;
      if (freshFail) continue;
      if (stored && stored.address_key === key && stored.lat != null && stored.lng != null) {
        located.set(project.id, { lat: Number(stored.lat), lng: Number(stored.lng) });
        continue;
      }
      const group = needsGeocode.get(key) ?? { address, projectIds: [] };
      group.projectIds.push(project.id);
      needsGeocode.set(key, group);
    }

    await mapPool([...needsGeocode.values()], 4, async (group) => {
      let point: { lat: number; lng: number } | null = null;
      try {
        point = await geocode(group.address);
      } catch {
        point = null;
      }
      const key = addressKey(group.address);
      const rows = group.projectIds.map((projectId) => ({
        project_id: projectId,
        address_key: key,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        geocoded_at: new Date().toISOString(),
      }));
      await supabase.from("manpower_site_geocodes").upsert(rows, { onConflict: "project_id" });
      if (!point) return;
      for (const projectId of group.projectIds) located.set(projectId, point);
    });

    const dates = weekDates(weekStart);
    const byBucket = new Map<string, { lat: number; lng: number; summaries: Record<string, string> }>();
    for (const point of located.values()) {
      const lat = Number(bucket(point.lat).toFixed(2));
      const lng = Number(bucket(point.lng).toFixed(2));
      const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
      if (!byBucket.has(key)) byBucket.set(key, { lat, lng, summaries: {} });
    }

    const rangeStart = dates[0] ?? weekStart;
    const rangeEnd = dates[6] ?? weekStart;
    await mapPool([...byBucket.values()], 4, async (site) => {
      const { data: cached } = await supabase
        .from("manpower_weather_cache")
        .select("forecast_date, summary, fetched_at")
        .eq("lat_bucket", site.lat)
        .eq("lng_bucket", site.lng)
        .gte("forecast_date", rangeStart)
        .lte("forecast_date", rangeEnd);
      let newest = 0;
      const saved = new Map<string, string>();
      for (const row of cached ?? []) {
        const date = String(row.forecast_date).slice(0, 10);
        const at = new Date(row.fetched_at).getTime();
        if (at > newest) newest = at;
        saved.set(date, row.summary);
      }
      if (newest && Date.now() - newest < CACHE_MS) {
        for (const [date, summary] of saved) site.summaries[date] = summary;
        return;
      }
      let hourly: { times: string[]; probabilities: Array<number | null> } | null = null;
      try {
        hourly = await forecast(site.lat, site.lng, rangeStart, rangeEnd);
      } catch {
        hourly = null;
      }
      if (!hourly) {
        for (const [date, summary] of saved) site.summaries[date] = summary;
        return;
      }
      const rows: { lat_bucket: number; lng_bucket: number; forecast_date: string; summary: string; fetched_at: string }[] = [];
      const fetchedAt = new Date().toISOString();
      for (const date of dates) {
        const summary = workWindowSummary(hourly.times, hourly.probabilities, date);
        if (!summary) continue;
        site.summaries[date] = summary;
        rows.push({
          lat_bucket: site.lat,
          lng_bucket: site.lng,
          forecast_date: date,
          summary,
          fetched_at: fetchedAt,
        });
      }
      if (rows.length) {
        await supabase.from("manpower_weather_cache").upsert(rows, {
          onConflict: "lat_bucket,lng_bucket,forecast_date",
        });
      }
    });

    const lines: Lines = {};
    for (const job of named) {
      const point = located.get(job.project_id as string);
      if (!point) continue;
      const key = `${bucket(point.lat).toFixed(2)},${bucket(point.lng).toFixed(2)}`;
      const summaries = byBucket.get(key)?.summaries ?? {};
      const days: Record<string, string> = {};
      for (const date of dates) {
        const summary = summaries[date];
        if (summary) days[date] = summary;
      }
      if (Object.keys(days).length) lines[(job.name as string).trim()] = days;
    }

    return jsonResponse({ lines });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Weather lookup failed";
    return jsonResponse({ error: message }, 500);
  }
});
