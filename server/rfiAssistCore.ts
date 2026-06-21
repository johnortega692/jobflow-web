export type RfiAssistRequest = {
  project_name?: string;
  subject?: string;
  question?: string;
  solution_text?: string;
  generate_solution?: boolean;
};

export type RfiAssistResult = {
  question: string;
  solution_text?: string;
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

export function parseRfiAssistResponse(
  raw: string,
  wantSolution: boolean,
): RfiAssistResult {
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

export async function runRfiAssist(body: RfiAssistRequest): Promise<RfiAssistResult> {
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
