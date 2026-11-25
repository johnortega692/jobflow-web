import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildWeatherSnapshot,
  coordinateBucket,
  dailyForecastUrl,
  hourlyForecastUrl,
  parseAlertText,
  parseDailyForecast,
  parseHourlyForecast,
} from "./forecast.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": "(jobflow, warehouse@creativeceilingsanddrywall.com)",
};

type LocatedProject = {
  id: string;
  lat: number;
  lng: number;
};

type WeatherGroup = {
  lat: string;
  lng: string;
  ids: string[];
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function mapPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  if (!items.length) return;
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

async function readJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { headers: NWS_HEADERS, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadActiveExteriorProjects(supabase: SupabaseClient): Promise<LocatedProject[]> {
  const rows: LocatedProject[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, lat, lng")
      .eq("is_exterior", true)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!row.id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      rows.push({ id: row.id, lat, lng });
    }
    if (!data || data.length < pageSize) break;
  }
  if (!rows.length) return [];

  const done = new Set<string>();
  for (let index = 0; index < rows.length; index += 200) {
    const ids = rows.slice(index, index + 200).map((row) => row.id);
    const { data, error } = await supabase
      .from("manpower_project_status")
      .select("project_id")
      .eq("is_done", true)
      .in("project_id", ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.project_id) done.add(row.project_id);
    }
  }
  return rows.filter((row) => !done.has(row.id));
}

async function refreshGroup(supabase: SupabaseClient, group: WeatherGroup): Promise<"updated" | "failed"> {
  const points = await readJson(`https://api.weather.gov/points/${group.lat},${group.lng}`);
  const hourlyUrl = points ? hourlyForecastUrl(points) : null;
  const forecastUrl = points ? dailyForecastUrl(points) : null;
  if (!hourlyUrl || !forecastUrl) return "failed";

  const hourlyBody = await readJson(hourlyUrl);
  const periods = hourlyBody ? parseHourlyForecast(hourlyBody) : null;
  if (!periods) return "failed";

  const forecastBody = await readJson(forecastUrl);
  const daily = forecastBody ? parseDailyForecast(forecastBody) : null;
  if (!daily?.length) return "failed";

  const alertsBody = await readJson(`https://api.weather.gov/alerts/active?point=${group.lat},${group.lng}`);
  const alerts = alertsBody ? parseAlertText(alertsBody) : { ok: false as const };
  if (!alerts.ok) return "failed";

  const snapshot = buildWeatherSnapshot(periods, daily, alerts.text, new Date());
  if (!snapshot) return "failed";

  const fetchedAt = new Date().toISOString();
  const { error } = await supabase.from("job_weather").upsert(
    group.ids.map((projectId) => ({
      project_id: projectId,
      fetched_at: fetchedAt,
      raining_now: snapshot.raining_now,
      precip_prob_next_hours: snapshot.precip_prob_next_hours,
      next_rain_at: snapshot.next_rain_at,
      temp_now: snapshot.temp_now,
      wind_mph: snapshot.wind_mph,
      wind_dir: snapshot.wind_dir,
      condition_now: snapshot.condition_now,
      hourly_times: snapshot.hourly_times,
      daily: snapshot.daily,
      alert_text: snapshot.alert_text,
      source: snapshot.source,
    })),
    { onConflict: "project_id" },
  );
  return error ? "failed" : "updated";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Missing server config" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    let secret = "";
    try {
      const body = (await req.json()) as { secret?: string };
      secret = (body.secret ?? "").trim();
    } catch {
      secret = "";
    }
    const { data: settings } = await supabase
      .from("field_tools_link_settings")
      .select("cron_secret")
      .eq("id", 1)
      .maybeSingle();
    const expected = String(settings?.cron_secret ?? "").trim();
    if (!expected || secret !== expected) return jsonResponse({ error: "Unauthorized" }, 401);

    const projects = await loadActiveExteriorProjects(supabase);
    const groups = new Map<string, WeatherGroup>();
    for (const project of projects) {
      const bucket = coordinateBucket(project.lat, project.lng);
      const group = groups.get(bucket.key) ?? { lat: bucket.lat, lng: bucket.lng, ids: [] };
      group.ids.push(project.id);
      groups.set(bucket.key, group);
    }

    let updated = 0;
    let failed = 0;
    await mapPool([...groups.values()], 4, async (group) => {
      const result = await refreshGroup(supabase, group);
      if (result === "updated") updated += group.ids.length;
      else failed += 1;
    });

    return jsonResponse({ ok: true, groups: groups.size, updated, failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Weather refresh failed";
    return jsonResponse({ error: message }, 500);
  }
});
