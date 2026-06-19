type BrushoutsBody = { url?: string; payload?: unknown };

type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

function parseBody(raw: unknown): BrushoutsBody {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as BrushoutsBody;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as BrushoutsBody;
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as BrushoutsBody;
  return {};
}

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { url, payload } = parseBody(req.body);
    const target = (url || "").trim();
    if (!target) return res.status(400).json({ error: "Missing BrushOuts URL" });

    const upstream = await fetch(`${target}?sheet=brushouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(502).json({ error: `BrushOuts tracker returned ${upstream.status}`, body: text });
    }
    return res.status(200).json({ ok: true, body: text });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : "BrushOuts proxy failed" });
  }
}

export = handler;
