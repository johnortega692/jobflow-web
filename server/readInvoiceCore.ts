import { normalizeClaudeInvoice, type ClaudeInvoiceRead } from "../src/lib/invoiceReaders/claudeInvoice.js";

const PROMPT = `Read this vendor invoice PDF. The vendor name we expect is given below.

Return ONLY a JSON object, no markdown, with these keys:
- vendorName: the vendor name printed on the invoice
- invoiceNo: the invoice number
- invoiceDate: the invoice date as printed
- total: the amount due, including tax, as a number
- taxPercent: the sales tax rate as a number such as 9.75, or null when no rate is printed
- taxAmount: the sales tax dollars, or null when no tax is printed
- lines: priced lines only

Each line has:
- productId: part number or SKU, or "" when none is printed
- description: the item name, including a wrapped continuation from the next row
- color: tint or color when printed, otherwise ""
- qty: the quantity shipped or delivered when the invoice also shows ordered or backordered quantities. Otherwise the quantity billed
- unit: the printed unit, such as EA or GL
- unitPrice: the each price as a number
- extended: the line total before tax as a number
- fee: true for freight, delivery, pickup, surcharge, recovery fee, eco fee, paint fee, environmental fee, or protection. false for products

Skip zero-dollar header rows, delivery tags, legal text, subtotals, tax totals, and the invoice total. Do not invent lines.`;

type ReadInvoiceBody = {
  pdf_base64?: string;
  vendor_name?: string;
};

function parseModelJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  return JSON.parse(cleaned) as unknown;
}

export async function runReadInvoice(body: ReadInvoiceBody): Promise<ClaudeInvoiceRead> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Invoice reading is not configured. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.");
  }
  const pdf = body.pdf_base64?.trim();
  if (!pdf) throw new Error("No invoice PDF.");
  const vendorName = body.vendor_name?.trim() || "this vendor";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdf },
            },
            { type: "text", text: `${PROMPT}\n\nExpected vendor: ${vendorName}` },
          ],
        },
      ],
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

  const data = (await response.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  if (data.stop_reason === "max_tokens") {
    throw new Error("This invoice is too long to read in one pass.");
  }
  let text = "";
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) text = block.text.trim();
  }
  if (!text) throw new Error("Claude returned no invoice.");

  let parsed: unknown;
  try {
    parsed = parseModelJson(text);
  } catch {
    throw new Error("Claude did not return invoice JSON.");
  }
  const invoice = normalizeClaudeInvoice(parsed);
  if (invoice.lines.length === 0) throw new Error("No priced lines were found on this invoice.");
  return invoice;
}
