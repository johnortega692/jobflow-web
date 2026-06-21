import { runRfiAssist, type RfiAssistRequest } from "../server/rfiAssistCore";

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

function parseBody(raw: unknown): RfiAssistRequest {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
    return raw as RfiAssistRequest;
  }
  if (typeof raw === "string" && raw.trim()) {
    return JSON.parse(raw) as RfiAssistRequest;
  }
  if (Buffer.isBuffer(raw)) {
    return JSON.parse(raw.toString("utf8")) as RfiAssistRequest;
  }
  return {};
}

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const result = await runRfiAssist(parseBody(req.body));
    return res.status(200).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI assist failed";
    return res.status(500).json({ error: message });
  }
}

export default handler;
