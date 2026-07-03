type BrushoutsBody = { url?: string; payload?: unknown };

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

function parseBody(raw: unknown): BrushoutsBody {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw as BrushoutsBody;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw) as BrushoutsBody;
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8")) as BrushoutsBody;
  return {};
}

async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required.");

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

    const { url, payload } = parseBody(req.body);
    const target = (url || "").trim().replace(/\?.*$/, "");
    if (!target) return res.status(400).json({ error: "Missing BrushOuts URL" });
    if (!target.startsWith("https://script.google.com/macros/s/")) {
      return res.status(400).json({ error: "Invalid Google Apps Script URL" });
    }

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
    const message = e instanceof Error ? e.message : "BrushOuts proxy failed";
    const status = message.includes("Sign in") || message.includes("session") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}

export default handler;
