import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_IMAGE_CHARS = 2_000_000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanName(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.slice(0, 80);
}

function cleanSerial(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/. ]{2,39}$/.test(text)) return "";
  return text;
}

function matchCategory(value: unknown, names: string[]): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  const found = names.find((name) => name.toLowerCase() === text);
  if (found) return found;
  return names.find((name) => name.toLowerCase() === "other") ?? names[0] ?? "";
}

function parseGuess(text: string, names: string[]): { name: string; category: string; serial: string } {
  const trimmed = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Could not read that photo.");
  const raw = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  return {
    name: cleanName(raw.name),
    category: matchCategory(raw.category, names),
    serial: cleanSerial(raw.serial),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
    if (!apiKey) return jsonResponse({ ok: false, error: "Photo identification is not configured." }, 500);

    const body = (await req.json()) as {
      caller_id?: string;
      session_token?: string;
      image_base64?: string;
      media_type?: string;
    };
    const callerId = body.caller_id?.trim();
    const sessionToken = body.session_token?.trim();
    const image = body.image_base64?.replace(/^data:image\/[a-zA-Z+]+;base64,/, "").replace(/\s/g, "") ?? "";
    if (!callerId || !sessionToken) {
      return jsonResponse({ ok: false, error: "caller_id and session_token are required" }, 401);
    }
    if (!image || image.length > MAX_IMAGE_CHARS) {
      return jsonResponse({ ok: false, error: "That photo is too large. Try another." }, 400);
    }
    let mediaType = body.media_type?.trim() || "image/jpeg";
    if (!mediaType.startsWith("image/")) mediaType = "image/jpeg";

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: sessionProfile, error: sessionErr } = await supabase.rpc("field_tools_get_session_profile", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
    });
    if (sessionErr) {
      const msg = /SESSION|INVALID/i.test(sessionErr.message) ? "Invalid or expired session. Log in again." : sessionErr.message;
      return jsonResponse({ ok: false, error: msg }, 403);
    }
    const profileResult = sessionProfile as { ok?: boolean; error?: string } | null;
    if (!profileResult?.ok) return jsonResponse({ ok: false, error: profileResult?.error ?? "Invalid session" }, 403);

    const { data: permissions, error: permErr } = await supabase.rpc("field_tools_inventory_my_permissions", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
    });
    if (permErr) return jsonResponse({ ok: false, error: permErr.message }, 403);
    const access = permissions as { ok?: boolean; can_add_edit?: boolean; error?: string } | null;
    if (!access?.ok || access.can_add_edit !== true) {
      return jsonResponse({ ok: false, error: "You can't add tools." }, 403);
    }

    const { data: listed } = await supabase.rpc("field_tools_inventory_list_categories", {
      p_caller_id: callerId,
      p_session_token: sessionToken,
    });
    const categoryNames = ((listed as { categories?: { name?: string }[] } | null)?.categories ?? [])
      .map((row) => row.name?.trim() ?? "")
      .filter(Boolean);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              {
                type: "text",
                text: `This photo is for a construction-tool inventory. Identify the tool.
Return ONLY JSON with these keys:
- name: short name a crew would say, including brand and model when they are visible. Empty string if you cannot tell.
- category: exactly one of: ${categoryNames.join(", ") || "Other"}.
- serial: the serial number only when it is clearly readable. Otherwise "".
Do not invent a brand, model, or serial.
Spray Equipment is sprayers and pumps. Wallcovering is wallcovering tools. Ladders are ladders. Access & Lifts are lifts, scaffolds, and access gear. Power Tools are drills, saws, and other powered tools. Lighting & Power is lights and temporary power. Measuring & Inspection is lasers, levels, and meters. Safety is PPE and safety gear. Other is anything else.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const err = (await response.json()) as { error?: { message?: string } };
        detail = err.error?.message ?? detail;
      } catch {
        /* ignore */
      }
      return jsonResponse({ ok: false, error: `Couldn't read that photo. ${detail}`.slice(0, 240) }, 502);
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).find((block) => block.type === "text")?.text?.trim() ?? "";
    if (!text) return jsonResponse({ ok: false, error: "Couldn't read that photo." }, 502);
    const guess = parseGuess(text, categoryNames);
    return jsonResponse({ ok: true, ...guess });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't read that photo.";
    return jsonResponse({ ok: false, error: message.slice(0, 240) }, 500);
  }
});
