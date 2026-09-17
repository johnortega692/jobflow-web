/** Vercel serverless — AI RFI assist (single file, no sibling imports). */

type RfiAssistRequest = {
  project_name?: string;
  subject?: string;
  question?: string;
  solution_text?: string;
  generate_solution?: boolean;
};

type RfiAssistResult = {
  subject: string;
  question: string;
  solution_text?: string;
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

const ASSISTANT_PREFILL = "SUBJECT:";

function buildPrompt(body: RfiAssistRequest, wantSolution: boolean): string {
  const proj = body.project_name?.trim() || "Unknown";
  const existingSubj = body.subject?.trim() || "(none)";
  const existingReq = body.question?.trim() ?? "";
  const existingSol = body.solution_text?.trim() ?? "";

  let solutionBlock = "";
  if (wantSolution) {
    solutionBlock = existingSol
      ? `
Also add:
SOLUTION: [one sentence, tighten this contractor solution, introduce no new asks]
"${existingSol}"`
      : `
Also add:
SOLUTION: [one sentence, the most likely resolution, introduce no new asks]`;
  }

  return `You rewrite a contractor's rough RFI into clean field-RFI wording.
Keep their facts and their ask. Do not add scope.

Project: ${proj}

RULES
- REQUEST = exactly two sentences, about 20–40 words total.
  Sentence 1: what the documents show and the conflict.
  Sentence 2: the specific ask, matching the draft's ask.
- "Improve" means tighten and clarify, never expand. Rephrase the
  draft's wording; a good result may be the same length. Don't copy
  its sentences verbatim, and don't pad them.
- Do NOT add manufacturer, product, sheen, spec section, or any ask
  they did not make.
- No filler: "however", "it is unclear", "so that work may proceed
  accordingly", "please be advised".
- SUBJECT: under 80 characters, names the conflict, replaces generic
  titles like "New RFI".

EXAMPLE 1 — clean draft, comes back barely changed
DRAFT: The finish schedule shows eggshell for the corridor walls but the paint spec says flat. Please confirm which sheen governs.
CURRENT SUBJECT: New RFI

SUBJECT: Corridor Wall Sheen Conflict — Finish Schedule vs Paint Spec
REQUEST: The finish schedule lists eggshell for the corridor walls while the paint spec calls for flat. Please confirm which sheen governs.

EXAMPLE 2 — bloated draft, gets cut down
DRAFT: We wanted to reach out because upon reviewing the documents it has come to our attention that the wallcovering schedule appears to indicate WC-3 for the lobby, however the interior elevations seem to show WC-5 in that same location, and it is currently unclear to us which one is actually correct, so we would kindly request that you please advise which wallcovering pattern is intended for the lobby so that we are able to proceed with our work accordingly.
CURRENT SUBJECT: New RFI

SUBJECT: Lobby Wallcovering Conflict — Schedule WC-3 vs Elevations WC-5
REQUEST: The wallcovering schedule specifies WC-3 for the lobby while the interior elevations show WC-5 in the same location. Please confirm which pattern is intended.

DRAFT: ${existingReq}
CURRENT SUBJECT: ${existingSubj}
${solutionBlock}

Respond in exactly this format:
SUBJECT: [subject line]
REQUEST: [two sentences]${wantSolution ? "\nSOLUTION: [one sentence]" : ""}`;
}

function parseRfiAssistResponse(raw: string, wantSolution: boolean): RfiAssistResult {
  let text = raw.trim();
  if (!/^SUBJECT:/im.test(text)) {
    text = `${ASSISTANT_PREFILL}${text.startsWith(":") ? "" : " "}${text}`.trim();
  }

  let subject = "";
  if (/^SUBJECT:/im.test(text)) {
    const afterSubject = text.replace(/^SUBJECT:\s*/im, "");
    const nextLabel = afterSubject.search(/\n\s*(?:REQUEST|SOLUTION):/i);
    if (nextLabel >= 0) {
      subject = afterSubject.slice(0, nextLabel).trim();
      text = afterSubject.slice(nextLabel + 1).trim();
    } else {
      subject = afterSubject.trim();
      text = "";
    }
  }

  if (wantSolution && /SOLUTION:/i.test(text)) {
    const parts = text.split(/SOLUTION:/i, 2);
    return {
      subject,
      question: parts[0]!.replace(/^REQUEST:\s*/i, "").trim(),
      solution_text: parts[1]?.trim() || undefined,
    };
  }

  return {
    subject,
    question: text.replace(/^REQUEST:\s*/i, "").trim(),
  };
}

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

async function runRfiAssist(body: RfiAssistRequest): Promise<RfiAssistResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI assist is not configured. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.",
    );
  }

  const question = body.question?.trim();
  if (!question) throw new Error("Enter a question before using AI Assist.");

  const existingSol = body.solution_text?.trim() ?? "";
  const wantSolution = Boolean(body.generate_solution || existingSol);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      temperature: 0.2,
      messages: [{ role: "user", content: buildPrompt(body, wantSolution) }],
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

  const parsed = parseRfiAssistResponse(text, wantSolution);
  if (!parsed.question) throw new Error("Claude returned an empty request.");
  return parsed;
}

async function verifySupabaseUser(authHeader: string | undefined): Promise<void> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in required to use AI assist.");

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
    const result = await runRfiAssist(parseBody(req.body));
    return res.status(200).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI assist failed";
    const status = message.includes("Sign in") || message.includes("session") ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}

export default handler;
