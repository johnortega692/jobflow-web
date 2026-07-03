/** Vercel serverless — AI RFI assist (single file, no sibling imports). */

type RfiAssistRequest = {
  project_name?: string;
  subject?: string;
  question?: string;
  solution_text?: string;
  generate_solution?: boolean;
};

type RfiAssistResult = {
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

function buildPrompt(body: RfiAssistRequest, wantSolution: boolean): string {
  const proj = body.project_name?.trim() || "Unknown";
  const subj = body.subject?.trim() || "Unknown";
  const existingReq = body.question?.trim() ?? "";
  const existingSol = body.solution_text?.trim() ?? "";

  let solutionInstruction = "";
  let formatInstruction = "Respond with only the request text. No labels or headers.";

  if (wantSolution) {
    if (existingSol) {
      solutionInstruction = `
The contractor already has this proposed solution — refine it to match the rewritten request, keeping the same intent:
"${existingSol}"`;
    } else {
      solutionInstruction = `
Also write a PROPOSED SOLUTION — a brief contractor recommendation based on the request above.`;
    }
    formatInstruction =
      "Respond in this exact format:\nREQUEST:\n[request text]\n\nSOLUTION:\n[solution text]";
  }

  return `You are helping a painting/drywall subcontractor write RFI documents on commercial construction projects.

Project: ${proj}
Subject: ${subj}

The contractor has entered this request:
---
${existingReq}
---

Rewrite this as the REQUEST section of an RFI. Use professional construction industry language — clear, concise, and complete. Write 2–4 sentences. State what the drawings or finish schedule show, describe the conflict or question, and ask for a specific confirmation or direction. Do not use overly legal phrases. Do not over-simplify. Reference drawing or spec numbers if mentioned.${solutionInstruction}

${formatInstruction}`;
}

function parseRfiAssistResponse(raw: string, wantSolution: boolean): RfiAssistResult {
  const result = raw.trim();
  if (wantSolution && result.includes("SOLUTION:")) {
    const parts = result.split("SOLUTION:", 2);
    return {
      question: parts[0]!.replace("REQUEST:", "").trim(),
      solution_text: parts[1]?.trim() || undefined,
    };
  }
  return { question: result.replace("REQUEST:", "").trim() };
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
      max_tokens: 1024,
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
