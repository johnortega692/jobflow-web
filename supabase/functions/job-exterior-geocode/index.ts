import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USER_AGENT = "(jobflow, warehouse@creativeceilingsanddrywall.com)";
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    result?: { addressMatches?: { coordinates?: { x?: number; y?: number } }[] };
  };
  const point = body.result?.addressMatches?.[0]?.coordinates;
  if (typeof point?.y !== "number" || typeof point?.x !== "number") return null;
  if (!Number.isFinite(point.y) || !Number.isFinite(point.x)) return null;
  if (point.y < -90 || point.y > 90 || point.x < -180 || point.x > 180) return null;
  return { lat: point.y, lng: point.x };
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
    let projectId = "";
    try {
      const body = (await req.json()) as { secret?: string; project_id?: string };
      secret = (body.secret ?? "").trim();
      projectId = (body.project_id ?? "").trim();
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
    if (!PROJECT_ID.test(projectId)) return jsonResponse({ error: "project_id required" }, 400);

    const { data: address, error: addressError } = await supabase.rpc("project_exterior_geocode_target", {
      p_project_id: projectId,
    });
    if (addressError) return jsonResponse({ error: addressError.message }, 500);
    if (typeof address !== "string" || !address.trim()) {
      return jsonResponse({ ok: true, geocoded: false, reason: "no_address" });
    }

    let point: { lat: number; lng: number } | null = null;
    try {
      point = await geocode(address);
    } catch {
      point = null;
    }
    if (!point) return jsonResponse({ ok: true, geocoded: false, reason: "no_match" });

    const { data: saved, error: saveError } = await supabase.rpc("project_set_weather_coords", {
      p_project_id: projectId,
      p_lat: point.lat,
      p_lng: point.lng,
      p_address: address,
    });
    if (saveError) return jsonResponse({ error: saveError.message }, 500);
    return jsonResponse({ ok: true, geocoded: saved === true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Geocode failed";
    return jsonResponse({ error: message }, 500);
  }
});
