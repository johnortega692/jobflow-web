export type GcScheduleAiPage = {
  image_base64?: string;
  media_type?: string;
};

export type GcScheduleAiActivity = {
  id: string;
  name: string;
  trade: "paint" | "wallcovering";
  start: string;
  finish: string;
  hours: number;
  duration: string;
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

function parseJsonArray(text: string): Record<string, unknown>[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const attempt = (raw: string): Record<string, unknown>[] | null => {
    try {
      const parsed: unknown = JSON.parse(raw);
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

export async function runExtractGcSchedule(body: {
  pages?: GcScheduleAiPage[];
}): Promise<{ activities: GcScheduleAiActivity[] }> {
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
