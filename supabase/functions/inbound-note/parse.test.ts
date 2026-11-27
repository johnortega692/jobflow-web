import assert from "node:assert/strict";
import test from "node:test";
import { buildInboundNote, signResendWebhook, unwrapForward, verifyResendWebhook } from "./parse.ts";

const DOMAIN = "notes.ortegabuilt.com";
const OPTIONS = { domain: DOMAIN, allowedEmails: ["john@ortegabuilt.com"] };

const GMAIL_FORWARD = `---------- Forwarded message ---------
From: Maria Lopez <maria@turner.com>
Date: Thu, Nov 26, 2026 at 6:00 PM
Subject: COR 04 — Added primer at level 4
To: john@ortegabuilt.com

Please price the added primer on level 4. We need this by Friday.

--
Maria Lopez
Project Engineer
`;

test("a forwarded change order becomes a COR note on the job", () => {
  const result = buildInboundNote(
    {
      from: "John Ortega <john@ortegabuilt.com>",
      to: ["1129@notes.ortegabuilt.com"],
      subject: "Fwd: COR 04 — Added primer at level 4",
      text: GMAIL_FORWARD,
    },
    OPTIONS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.note.jobKey, "1129");
  assert.equal(result.note.cor, true);
  assert.equal(result.note.senderEmail, "john@ortegabuilt.com");
  assert.match(result.note.body, /^COR 04 — Added primer at level 4\nFrom Maria Lopez\nPlease price the added primer/);
  assert.doesNotMatch(result.note.body, /Project Engineer/);
});

test("a plain email stays a note without the COR flag", () => {
  const result = buildInboundNote(
    {
      from: "john@ortegabuilt.com",
      to: ["someone@gmail.com"],
      cc: ["1087@notes.ortegabuilt.com"],
      subject: "Site walk tomorrow",
      text: "Meet at the trailer at 7.",
    },
    OPTIONS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.note.jobKey, "1087");
  assert.equal(result.note.cor, false);
  assert.match(result.note.body, /^Site walk tomorrow\nFrom john\nMeet at the trailer at 7\./);
});

test("an Outlook signature and legal footer are left off the note", () => {
  const text = `sldfsaldfasldjfsalfdsafsadffdssdf

*John Ortega*

Project Manager/Estimator | Paint Division

Mobile (925) 507-1130

Office (925) 609-8356

*3953 Industrial Way, Suite E, Concord, CA 94520*

License #895364, UEI #NFGMIQG62UL6

This email, and any attachments, is intended only for use by the
addressee(s) named and may contain legally privileged or confidential
information.`;
  const result = buildInboundNote(
    {
      from: "John Ortega <jortega@ironwoodcb.com>",
      to: ["1087@notes.ortegabuilt.com"],
      subject: "COR 001 Teste",
      text,
    },
    { domain: DOMAIN, allowedEmails: ["jortega@ironwoodcb.com"] },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.note.cor, true);
  assert.equal(
    result.note.body,
    "COR 001 Teste\nFrom John Ortega\nsldfsaldfasldjfsalfdsafsadffdssdf",
  );
});

test("a phone number in the message stays in the note", () => {
  const result = buildInboundNote(
    {
      from: "John Ortega <john@ortegabuilt.com>",
      to: ["1087@notes.ortegabuilt.com"],
      subject: "Call me",
      text: "Call me at (925) 507-1130 before Friday.",
    },
    OPTIONS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.note.body, /Call me at \(925\) 507-1130 before Friday\./);
});

test("mail from an address that is not a JobFlow account is ignored", () => {
  const result = buildInboundNote(
    {
      from: "maria@turner.com",
      to: ["1129@notes.ortegabuilt.com"],
      subject: "COR 04",
      text: "Please price this.",
    },
    OPTIONS,
  );
  assert.deepEqual(result, { ok: false, reason: "sender-not-allowed" });
});

test("mail that is not addressed to a job is ignored", () => {
  const result = buildInboundNote(
    {
      from: "john@ortegabuilt.com",
      to: ["john@ortegabuilt.com"],
      subject: "Hello",
      text: "Hi",
    },
    OPTIONS,
  );
  assert.deepEqual(result, { ok: false, reason: "no-job-address" });
});

test("an Outlook original-message block is unwrapped", () => {
  const text = `-----Original Message-----
From: Maria Lopez <maria@turner.com>
Sent: Thursday, November 26, 2026 6:00 PM
To: John <john@ortegabuilt.com>
Subject: Added primer

Please price the added primer.
`;
  const unwrapped = unwrapForward("FW: Added primer", text);
  assert.equal(unwrapped.subject, "Added primer");
  assert.equal(unwrapped.from, "Maria Lopez <maria@turner.com>");
  assert.equal(unwrapped.message, "Please price the added primer.");
});

test("a signed webhook is accepted and a bad signature is rejected", async () => {
  const secret = `whsec_${btoa("jobflow-inbound-note-secret")}`;
  const body = '{"type":"email.received"}';
  const timestamp = "1700000000";
  const signature = await signResendWebhook("msg_1", timestamp, body, secret);
  const headers = { id: "msg_1", timestamp, signature };
  assert.equal(await verifyResendWebhook(body, headers, secret, 1_700_000_000_000), true);
  assert.equal(
    await verifyResendWebhook(body, { ...headers, signature: "v1,bm90LXRoZS1zaWduYXR1cmU" }, secret, 1_700_000_000_000),
    false,
  );
  assert.equal(await verifyResendWebhook(body, headers, secret, 1_700_000_000_000 + 6 * 60 * 1000), false);
});
