export type RfiAssistRequest = {
  project_name: string;
  subject: string;
  question: string;
  solution_text?: string;
  generate_solution: boolean;
};

export type RfiAssistResult = {
  subject: string;
  question: string;
  solution_text?: string;
};

async function readApiJson(res: Response): Promise<RfiAssistResult & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as RfiAssistResult & { error?: string };
  } catch {
    const snippet = text.trim().slice(0, 160);
    throw new Error(snippet || `AI assist failed (${res.status})`);
  }
}

import { authFetch } from "./apiAuth";

export async function requestRfiAssist(input: RfiAssistRequest): Promise<RfiAssistResult> {
  const res = await authFetch("/api/rfi-assist", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const body = await readApiJson(res);
  if (!res.ok) {
    throw new Error(body.error ?? `AI assist failed (${res.status})`);
  }
  if (!body.question?.trim()) throw new Error("AI returned an empty request.");
  return body;
}
