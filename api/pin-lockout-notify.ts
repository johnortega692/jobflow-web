import { runPinLockoutNotify } from "../src/lib/pinLockoutNotifyCore";

type VercelRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  end: () => void;
};

function readAuthHeader(req: VercelRequest): string {
  const auth = req.headers?.authorization;
  return (Array.isArray(auth) ? auth[0] : auth) ?? "";
}

function verifyCronSecret(req: VercelRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  return readAuthHeader(req) === `Bearer ${secret}`;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runPinLockoutNotify();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : "PIN lockout notify failed",
    });
  }
}

export default handler;
