/** Vercel serverless — AI GC schedule import (single file, no sibling imports). */

type GcScheduleAiPage = {
  image_base64?: string;
  media_type?: string;
};

type GcScheduleAiActivity = {
  id: string;
  name: string;
  trade: "paint" | "wallcovering";
  start: string;
  finish: string;
  hours: number;
  duration: string;
};

type VercelRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

const PROMPT = `These images are pages from a general contractor construction schedule. The file may be a scan or a DocuSign image with no selectable text.

Extract every activity that is paint work or wallcovering work. Include priming, painting, coatings, touch-up paint, and wall covering / wallpaper. Skip unrelated work such as drywall, flooring, doors, electrical, and concrete unless the activity name itself is paint or wallcovering.

For each activity return:
- id: the activity or task id printed on the row. Use "" if none is shown.
- name: the full activity name.
- trade: "paint" or "wallcovering".
- start: the start date exactly as printed. Use "" if no date is shown.
- finish: the finish date exactly as printed. Use "" if it is not shown.
- hours: a labor or manhour number only when that column is printed. Otherwise 0. Do not invent hours and do not convert days into hours.
- duration: the printed duration such as "2 days" or "16 hours". Use "" if none is shown.

Return ONLY a JSON array. No markdown. Example:
[{"id":"128","name":"Painting - Prime + 2 Coat Finish","trade":"paint","start":"10/1/26","finish":"10/2/26","hours":0,"duration":"2 days"}]`;

function parseBody(raw: unknown): { pages?: GcScheduleAiPage[] } {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as { pages?: GcScheduleAiPage[] };
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as { pages?: GcScheduleAiPage[] };
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as { pages?: GcScheduleAiPage[] };
  return {};
}

function parseJsonArray(text: string): Record<string, unknown>[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const attempt = (value: string): Record<string, unknown>[] | null => {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const sliced = attempt(cleaned.slice(start, end + 1));
    if (sliced) return sliced;
  }
  throw new Error("AI did not return a schedule list.");
}

function normalizeActivity(raw: Record<string, unknown>): GcScheduleAiActivity | null {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 3) return null;
  const tradeRaw = String(raw.trade ?? "").toLowerCase();
  const trade = tradeRaw.includes("wall") ? "wallcovering" : tradeRaw.includes("paint") ? "paint" : null;
  if (!trade) return null;
  const hours = Number(raw.hours);
  return {
    id: String(raw.id ?? "").trim(),
    name,
    trade,
    start: String(raw.start ?? "").trim(),
    finish: String(raw.finish ?? "").trim(),
    hours: Number.isFinite(hours) && hours > 0 ? hours : 0,
    duration: String(raw.duration ?? "").trim(),
  };
}

async function runExtractGcSchedule(body: { pages?: GcScheduleAiPage[] }): Promise<{ activities: GcScheduleAiActivity[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI import is not configured. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.",
    );
  }
  const pages = (body.pages ?? []).filter((page) => page.image_base64?.trim());
  if (!pages.length) throw new Error("No schedule pages to read.");

  const content: unknown[] = pages.slice(0, 4).map((page) => {
    let mediaType = page.media_type?.trim() || "image/jpeg";
    if (!mediaType.startsWith("image/")) mediaType = "image/jpeg";
    return {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: page.image_base64!.trim() },
    };
  });
  content.push({ type: "text", text: PROMPT });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content }],
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
    throw new Error(`Claude API error (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  let text = "";
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) text = block.text.trim();
  }
  if (!text) throw new Error("Claude returned no text.");

  const activities = parseJsonArray(text)
    .map((row) => normalizeActivity(row))
    .filter((row): row is GcScheduleAiActivity => row !== null);
  return { activities };
}

async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required to use AI import.");

  const url = process.env.VITE_SUPABASE_URL?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });
  if (!response.ok) throw new Error("Invalid or expired session. Sign in again.");
}

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = req.headers?.authorization;
    const authStr = Array.isArray(auth) ? auth[0] : auth;
    await verifySupabaseUser(authStr);
    const result = await runExtractGcSchedule(parseBody(req.body));
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    const status = message.includes("Sign in") || message.includes("session") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}

export default handler;
