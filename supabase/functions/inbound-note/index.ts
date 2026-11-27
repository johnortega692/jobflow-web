import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildInboundNote, htmlToText, verifyResendWebhook } from "./parse.ts";

const DOMAIN = Deno.env.get("NOTES_INBOX_DOMAIN")?.trim() || "notes.ortegabuilt.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function approvedAccountEmails(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const emails: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data.users ?? [];
    if (!users.length) break;
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .in("id", users.map((user) => user.id))
      .not("approved_at", "is", null);
    if (profileError) throw new Error(profileError.message);
    const approved = new Set((profiles ?? []).map((row) => row.id));
    for (const user of users) {
      const email = user.email?.trim().toLowerCase();
      if (email && approved.has(user.id)) emails.push(email);
    }
    if (users.length < 200) break;
  }
  return emails;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET")?.trim();
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!secret || !apiKey || !supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "inbound note is not configured" }, 500);
  }

  const raw = await req.text();
  const verified = await verifyResendWebhook(raw, {
    id: req.headers.get("svix-id") ?? "",
    timestamp: req.headers.get("svix-timestamp") ?? "",
    signature: req.headers.get("svix-signature") ?? "",
  }, secret);
  if (!verified) return json({ ok: false, error: "bad signature" }, 401);

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw) as { type?: string; data?: Record<string, unknown> };
  } catch {
    return json({ ok: false }, 400);
  }
  if (event.type !== "email.received") return json({ ok: true, ignored: "not-inbound" });

  const data = event.data ?? {};
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  if (!emailId) return json({ ok: true, ignored: "missing-email" });

  const received = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!received.ok) return json({ ok: false, error: "could not read the email" }, 502);
  const email = (await received.json()) as {
    from?: string;
    to?: string[];
    cc?: string[];
    received_for?: string[];
    subject?: string;
    text?: string | null;
    html?: string | null;
    headers?: { from?: string };
  };

  const text = (email.text ?? "").trim() || htmlToText(email.html ?? "");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let allowedEmails: string[];
  try {
    allowedEmails = await approvedAccountEmails(supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read accounts";
    return json({ ok: false, error: message }, 500);
  }
  const draft = buildInboundNote(
    {
      from: email.headers?.from || email.from || String(data.from ?? ""),
      to: email.to ?? stringList(data.to),
      cc: email.cc ?? stringList(data.cc),
      receivedFor: email.received_for ?? stringList(data.received_for),
      subject: email.subject || String(data.subject ?? ""),
      text,
    },
    { domain: DOMAIN, allowedEmails },
  );
  if (!draft.ok) return json({ ok: true, ignored: draft.reason });
  const { data: projects, error: findError } = await supabase
    .from("projects")
    .select("id")
    .eq("job_number_key", draft.note.jobKey)
    .limit(2);
  if (findError) return json({ ok: false, error: findError.message }, 500);
  if (!projects || projects.length !== 1) return json({ ok: true, ignored: projects?.length ? "ambiguous-job" : "unknown-job" });

  const { error: insertError } = await supabase.from("project_notes").insert({
    project_id: projects[0].id,
    body: draft.note.body,
    type: "note",
    status: "open",
    cor: draft.note.cor,
    email_message_id: emailId,
    updated_by_name: "Email",
  });
  if (insertError) {
    if (insertError.code === "23505") return json({ ok: true, ignored: "duplicate" });
    return json({ ok: false, error: insertError.message }, 500);
  }

  return json({ ok: true, filed: true, cor: draft.note.cor });
});
