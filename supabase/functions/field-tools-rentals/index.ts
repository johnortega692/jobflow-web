import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FUEL_LEVELS = ["full", "3/4", "1/2", "1/4", "low"] as const;

type Body = {
  action?: string;
  caller_id?: string;
  session_token?: string;
  rental_id?: string;
  rental_ids?: string[];
  ready_date?: string;
  site_location?: string;
  fuel_level?: string | null;
  notes?: string;
};

type SessionProfile = { id: string; name: string; email: string; role: string };

type RentalJson = {
  id: string;
  project_id: string;
  job_number: string;
  job_name: string;
  job_address: string;
  pm_email: string;
  super_email: string;
  calloff: { requested_by_email?: string | null } | null;
  vendor_name: string;
  vendor_email: string;
  vendor_calloff_email: string;
  contract_no: string | null;
  model: string;
  unit_no: string | null;
  status: string;
};

type CalloffRow = {
  id: string;
  ready_date: string;
  site_location: string;
  fuel_level: string | null;
  notes: string;
  email_to: string | null;
  email_sent_at: string | null;
};

type CalloffDetails = Pick<CalloffRow, "ready_date" | "site_location" | "fuel_level" | "notes">;

type Supabase = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function emailList(raw: string): string[] {
  return raw.split(/[,;]/).map((part) => part.trim()).filter(isEmail);
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function fuelLabel(value: string | null): string {
  if (!value) return "Not noted";
  return value === "full" ? "Full" : value === "low" ? "Low" : value;
}

function calloffSubject(rental: RentalJson): string {
  const unit = rental.unit_no?.trim();
  return `Call-off: ${rental.model}${unit ? ` \u00B7 Unit ${unit}` : ""}`;
}

function detailRows(rental: RentalJson, calloff: CalloffDetails): [string, string][] {
  const job = [rental.job_number, rental.job_name].filter(Boolean).join(" ");
  const rows: [string, string][] = [
    ["Job", job || "\u2014"],
    ["Job address", rental.job_address || "\u2014"],
    ["Equipment", rental.model],
    ["Unit #", rental.unit_no?.trim() || "\u2014"],
    ["Ready for pickup", formatDate(calloff.ready_date)],
    ["Where it is on site", calloff.site_location],
    ["Fuel / charge", fuelLabel(calloff.fuel_level)],
  ];
  if (calloff.notes.trim()) rows.push(["Notes", calloff.notes.trim()]);
  return rows;
}

function calloffHtml(opts: {
  rental: RentalJson;
  calloff: CalloffDetails;
  requestedBy: SessionProfile;
  companyName: string;
  followUpOf?: string;
}): string {
  const table = detailRows(opts.rental, opts.calloff)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const intro = opts.followUpOf
    ? `<p style="margin:0 0 12px;">Following up on the call-off we emailed on ${escapeHtml(opts.followUpOf)}. Please reply with the call-off number.</p>`
    : `<p style="margin:0 0 12px;">Please pick up this unit and reply with the call-off number.</p>`;
  const requester = [opts.requestedBy.name, opts.requestedBy.email].filter(Boolean).join(" \u00B7 ");
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
  <h2 style="margin:0 0 12px;color:#1a3a5c;">${opts.followUpOf ? "Follow-up: rental call-off" : "Rental call-off"}</h2>
  ${intro}
  <table style="border-collapse:collapse;font-size:14px;">${table}</table>
  ${requester ? `<p style="margin:16px 0 0;color:#666;font-size:13px;">Requested by ${escapeHtml(requester)}</p>` : ""}
  ${opts.companyName ? `<p style="color:#666;font-size:13px;">${escapeHtml(opts.companyName)}</p>` : ""}
</body>
</html>`;
}

/** One email to one vendor covering every selected unit on the job. */
function bulkCalloffHtml(opts: {
  rentals: RentalJson[];
  calloff: CalloffDetails;
  requestedBy: SessionProfile;
  companyName: string;
}): string {
  const head = opts.rentals[0]!;
  const job = [head.job_number, head.job_name].filter(Boolean).join(" ");
  const shared: [string, string][] = [
    ["Job", job || "\u2014"],
    ["Job address", head.job_address || "\u2014"],
    ["Ready for pickup", formatDate(opts.calloff.ready_date)],
    ["Where it is on site", opts.calloff.site_location],
  ];
  if (opts.calloff.fuel_level) shared.push(["Fuel / charge", fuelLabel(opts.calloff.fuel_level)]);
  if (opts.calloff.notes.trim()) shared.push(["Notes", opts.calloff.notes.trim()]);
  const details = shared
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const units = opts.rentals
    .map((rental) => {
      const unit = rental.unit_no?.trim();
      return `<li style="margin:0 0 4px;"><strong>${escapeHtml(rental.model)}</strong> \u00B7 ${unit ? `Unit ${escapeHtml(unit)}` : "unit # not recorded"}</li>`;
    })
    .join("");
  const requester = [opts.requestedBy.name, opts.requestedBy.email].filter(Boolean).join(" \u00B7 ");
  const count = opts.rentals.length;
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
  <h2 style="margin:0 0 12px;color:#1a3a5c;">Rental call-off \u00B7 ${count} unit${count === 1 ? "" : "s"}</h2>
  <p style="margin:0 0 12px;">Please pick up the ${count === 1 ? "unit" : `${count} units`} below and reply with the call-off number${count === 1 ? "" : "s"}.</p>
  <table style="border-collapse:collapse;font-size:14px;">${details}</table>
  <p style="margin:16px 0 4px;font-weight:bold;">Units</p>
  <ul style="margin:0;padding:0 0 0 20px;font-size:14px;">${units}</ul>
  ${requester ? `<p style="margin:16px 0 0;color:#666;font-size:13px;">Requested by ${escapeHtml(requester)}</p>` : ""}
  ${opts.companyName ? `<p style="color:#666;font-size:13px;">${escapeHtml(opts.companyName)}</p>` : ""}
</body>
</html>`;
}

/** Same Gmail account as order emails; the HTML-only action needs no attachment. */
async function sendGasEmail(params: {
  to: string;
  cc: string;
  subject: string;
  htmlBody: string;
  senderName: string;
}): Promise<{ ok: boolean; message: string }> {
  const base = Deno.env.get("GAS_SEND_EMAIL_URL")?.trim();
  if (!base) return { ok: false, message: "GAS_SEND_EMAIL_URL not configured on edge function" };
  const url = `${base}${base.includes("?") ? "&" : "?"}action=sendJobFlowEmail`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { success?: boolean; error?: string; message?: string };
    if (!res.ok || data.success !== true) {
      return { ok: false, message: data.error ?? data.message ?? `GAS HTTP ${res.status}` };
    }
    return { ok: true, message: data.message ?? "Email sent" };
  } catch {
    const looksHtml = text.trim().startsWith("<");
    return { ok: false, message: looksHtml ? "Email service was busy. Try again." : text.slice(0, 200) };
  }
}

async function requireSession(
  supabase: Supabase,
  callerId: string,
  sessionToken: string,
): Promise<{ profile: SessionProfile } | { error: string; status: number }> {
  const { data, error } = await supabase.rpc("field_tools_get_session_profile", {
    p_caller_id: callerId,
    p_session_token: sessionToken,
  });
  if (error) {
    return {
      error: /SESSION|INVALID/i.test(error.message) ? "Invalid or expired session. Log in again." : error.message,
      status: 403,
    };
  }
  const result = data as { ok?: boolean; error?: string; profile?: SessionProfile };
  if (!result?.ok || !result.profile) return { error: result?.error ?? "Invalid session", status: 403 };
  return { profile: result.profile };
}

async function loadRental(
  supabase: Supabase,
  profile: SessionProfile,
  rentalId: string,
): Promise<{ rental: RentalJson } | { error: string; status: number }> {
  const { data, error } = await supabase.rpc("field_tools_rental_json", { p_rental_id: rentalId });
  if (error) return { error: error.message, status: 500 };
  const rental = data as RentalJson | null;
  if (!rental?.id) return { error: "Rental not found", status: 404 };
  const { data: allowed, error: accessErr } = await supabase.rpc("field_tools_can_manage_project_rentals", {
    p_profile_id: profile.id,
    p_project_id: rental.project_id,
  });
  if (accessErr) return { error: accessErr.message, status: 500 };
  if (allowed !== true) return { error: "You do not have access to this project", status: 403 };
  return { rental };
}

/** Company name from JobFlow org settings. */
async function jobflowCompanyName(supabase: Supabase): Promise<string> {
  const { data } = await supabase.from("org_settings").select("settings").eq("id", 1).maybeSingle();
  const settings = ((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>;
  return String(settings.company_name ?? "").trim();
}

/** Cc the job's PM and super, plus whoever is sending (and, on follow-ups, who first called it off). */
function recipients(rental: RentalJson, senders: string[]): { to: string; cc: string } {
  const to = (rental.vendor_calloff_email || rental.vendor_email || "").trim();
  const seen = new Set(emailList(to).map((e) => e.toLowerCase()));
  const cc: string[] = [];
  for (const email of [
    ...emailList(rental.pm_email),
    ...emailList(rental.super_email),
    ...senders.flatMap((sender) => emailList(sender)),
  ]) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cc.push(email);
  }
  return { to, cc: cc.join(",") };
}

async function rentalResult(supabase: Supabase, rentalId: string) {
  const { data } = await supabase.rpc("field_tools_rental_json", { p_rental_id: rentalId });
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const companyName = await jobflowCompanyName(supabase);
    const senderName = Deno.env.get("EMAIL_SENDER_NAME")?.trim() || companyName || "Field Tools";

    const body = (await req.json()) as Body;
    const callerId = body.caller_id?.trim() ?? "";
    const sessionToken = body.session_token?.trim() ?? "";
    if (!callerId || !sessionToken) {
      return jsonResponse({ ok: false, error: "caller_id and session_token are required" }, 401);
    }
    const session = await requireSession(supabase, callerId, sessionToken);
    if ("error" in session) return jsonResponse({ ok: false, error: session.error }, session.status);
    const profile = session.profile;

    if (body.action === "send_calloff_bulk") {
      const ids = [...new Set((Array.isArray(body.rental_ids) ? body.rental_ids : []).map((id) => String(id).trim()).filter(Boolean))];
      if (!ids.length) return jsonResponse({ ok: false, error: "Pick at least one unit" }, 400);
      if (ids.length > 50) return jsonResponse({ ok: false, error: "Call off up to 50 units at a time" }, 400);
      const readyDate = body.ready_date?.trim() ?? "";
      const siteLocation = body.site_location?.trim() ?? "";
      const fuelLevel = body.fuel_level?.trim() || null;
      const notes = body.notes?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(readyDate)) {
        return jsonResponse({ ok: false, error: "Ready-for-pickup date is required" }, 400);
      }
      if (!siteLocation) return jsonResponse({ ok: false, error: "Where it is on site is required" }, 400);
      if (fuelLevel && !(FUEL_LEVELS as readonly string[]).includes(fuelLevel)) {
        return jsonResponse({ ok: false, error: "Fuel / charge level is not valid" }, 400);
      }

      const rentals: RentalJson[] = [];
      for (const id of ids) {
        const loadedOne = await loadRental(supabase, profile, id);
        if ("error" in loadedOne) return jsonResponse({ ok: false, error: loadedOne.error }, loadedOne.status);
        if (loadedOne.rental.status !== "on_rent") {
          return jsonResponse({ ok: false, error: `${loadedOne.rental.model} already has a call-off` }, 400);
        }
        rentals.push(loadedOne.rental);
      }
      if (new Set(rentals.map((r) => r.project_id)).size > 1) {
        return jsonResponse({ ok: false, error: "Call off units from one job at a time" }, 400);
      }
      if (new Set(rentals.map((r) => r.vendor_name)).size > 1) {
        return jsonResponse({ ok: false, error: "Call off units from one vendor at a time" }, 400);
      }

      const head = rentals[0]!;
      const { to: vendorTo, cc: vendorCc } = recipients(head, [profile.email ?? ""]);
      if (!isEmail(vendorTo.split(/[,;]/)[0]?.trim() ?? "")) {
        return jsonResponse({ ok: false, error: `${head.vendor_name} has no call-off email. Ask an admin to add one.` }, 400);
      }

      const details: CalloffDetails = { ready_date: readyDate, site_location: siteLocation, fuel_level: fuelLevel, notes };
      const project = [head.job_number, head.job_name].filter(Boolean).join(" ");
      const count = rentals.length;
      const result = await sendGasEmail({
        to: vendorTo,
        cc: vendorCc,
        subject: `Call-off: ${count} unit${count === 1 ? "" : "s"}${project ? ` \u00B7 ${project}` : ""}`,
        htmlBody: bulkCalloffHtml({ rentals, calloff: details, requestedBy: profile, companyName }),
        senderName,
      });
      if (!result.ok) return jsonResponse({ ok: false, error: result.message }, 502);

      const sentAt = new Date().toISOString();
      const batchId = crypto.randomUUID();
      const { error: insertErr } = await supabase.from("rental_calloffs").insert(
        rentals.map((rental) => ({
          rental_id: rental.id,
          requested_by: profile.id,
          ...details,
          email_to: vendorTo,
          email_sent_at: sentAt,
          email_message_id: result.message,
          calloff_batch_id: batchId,
        })),
      );
      if (insertErr) {
        return jsonResponse({ ok: false, error: `The email was sent, but saving the call-offs failed: ${insertErr.message}` }, 500);
      }
      await supabase
        .from("rentals")
        .update({ status: "awaiting_calloff", updated_at: sentAt })
        .in("id", rentals.map((rental) => rental.id));
      return jsonResponse({
        ok: true,
        batch_id: batchId,
        vendor: head.vendor_name,
        to: vendorTo,
        count,
        job_number: head.job_number,
      });
    }

    const rentalId = body.rental_id?.trim() ?? "";
    if (!rentalId) return jsonResponse({ ok: false, error: "rental_id is required" }, 400);
    const loaded = await loadRental(supabase, profile, rentalId);
    if ("error" in loaded) return jsonResponse({ ok: false, error: loaded.error }, loaded.status);
    const rental = loaded.rental;
    const { to, cc } = recipients(rental, [
      profile.email ?? "",
      body.action === "follow_up" ? rental.calloff?.requested_by_email ?? "" : "",
    ]);
    if (!isEmail(to.split(/[,;]/)[0]?.trim() ?? "")) {
      return jsonResponse({ ok: false, error: `${rental.vendor_name} has no call-off email. Ask an admin to add one.` }, 400);
    }

    if (body.action === "send_calloff") {
      if (rental.status !== "on_rent") {
        return jsonResponse({ ok: false, error: "This rental already has a call-off" }, 400);
      }
      const readyDate = body.ready_date?.trim() ?? "";
      const siteLocation = body.site_location?.trim() ?? "";
      const fuelLevel = body.fuel_level?.trim() || null;
      const notes = body.notes?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(readyDate)) {
        return jsonResponse({ ok: false, error: "Ready-for-pickup date is required" }, 400);
      }
      if (!siteLocation) return jsonResponse({ ok: false, error: "Where it is on site is required" }, 400);
      if (fuelLevel && !(FUEL_LEVELS as readonly string[]).includes(fuelLevel)) {
        return jsonResponse({ ok: false, error: "Fuel / charge level is not valid" }, 400);
      }
      const details: CalloffDetails = { ready_date: readyDate, site_location: siteLocation, fuel_level: fuelLevel, notes };

      const sent = await sendGasEmail({
        to,
        cc,
        subject: calloffSubject(rental),
        htmlBody: calloffHtml({ rental, calloff: details, requestedBy: profile, companyName }),
        senderName,
      });
      if (!sent.ok) return jsonResponse({ ok: false, error: sent.message }, 502);

      const sentAt = new Date().toISOString();
      const { error: insertErr } = await supabase.from("rental_calloffs").insert({
        rental_id: rental.id,
        requested_by: profile.id,
        ...details,
        email_to: to,
        email_sent_at: sentAt,
        email_message_id: sent.message,
      });
      if (insertErr) {
        return jsonResponse({ ok: false, error: `The email was sent, but saving the call-off failed: ${insertErr.message}` }, 500);
      }
      await supabase.from("rentals").update({ status: "awaiting_calloff", updated_at: sentAt }).eq("id", rental.id);
      return jsonResponse({ ok: true, rental: await rentalResult(supabase, rental.id) });
    }

    if (body.action === "follow_up") {
      if (rental.status !== "awaiting_calloff") {
        return jsonResponse({ ok: false, error: "This rental is not waiting for a call-off number" }, 400);
      }
      const { data: calloffData } = await supabase
        .from("rental_calloffs")
        .select("id, ready_date, site_location, fuel_level, notes, email_to, email_sent_at")
        .eq("rental_id", rental.id)
        .not("email_sent_at", "is", null)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const calloff = calloffData as CalloffRow | null;
      if (!calloff?.email_sent_at) {
        return jsonResponse({ ok: false, error: "No call-off email was sent for this rental" }, 400);
      }
      const sent = await sendGasEmail({
        to: calloff.email_to?.trim() || to,
        cc,
        subject: `Follow-up: ${calloffSubject(rental)}`,
        htmlBody: calloffHtml({
          rental,
          calloff,
          requestedBy: profile,
          companyName,
          followUpOf: formatDate(calloff.email_sent_at.slice(0, 10)),
        }),
        senderName,
      });
      if (!sent.ok) return jsonResponse({ ok: false, error: sent.message }, 502);
      const now = new Date().toISOString();
      await supabase.from("rental_calloffs").update({ last_followup_at: now, updated_at: now }).eq("id", calloff.id);
      return jsonResponse({ ok: true, rental: await rentalResult(supabase, rental.id) });
    }

    return jsonResponse({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Request failed" }, 500);
  }
});
