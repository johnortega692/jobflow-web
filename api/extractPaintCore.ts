const MANUFACTURERS = [
  "BENJAMIN MOORE & CO",
  "BENJAMIN MOORE",
  "SHERWIN-WILLIAMS",
  "SHERWIN WILLIAMS",
  "KELLY-MOORE",
  "KELLY MOORE",
  "DUNN-EDWARDS",
  "DUNN EDWARDS",
  "VISTA PAINTS",
  "SCUFFMASTER",
  "PPG",
  "BEHR",
];

const MANUFACTURER_ABBREV: Record<string, string> = {
  "BENJAMIN MOORE & CO": "BM",
  "BENJAMIN MOORE": "BM",
  "SHERWIN-WILLIAMS": "SW",
  "SHERWIN WILLIAMS": "SW",
  "KELLY-MOORE": "KM",
  "KELLY MOORE": "KM",
  "DUNN-EDWARDS": "DE",
  "DUNN EDWARDS": "DE",
  PPG: "PPG",
  BEHR: "BEHR",
  "VISTA PAINTS": "Vista Paints",
  SCUFFMASTER: "SCUFFMASTER",
};

export type ExtractedPaintRow = {
  label: string;
  manufacturer: string;
  color: string;
  product: string;
  sheen: string;
  floor: string;
};

function abbreviateManufacturer(name: string): string {
  const upper = name.toUpperCase().trim();
  for (const mfr of MANUFACTURERS) {
    if (upper.includes(mfr)) return MANUFACTURER_ABBREV[mfr] ?? mfr;
  }
  return name.trim();
}

function normalizeRow(raw: Record<string, unknown>): ExtractedPaintRow | null {
  const label = String(raw.label ?? "").trim();
  if (!label) return null;
  let manufacturer = String(raw.manufacturer ?? "").trim();
  let color = String(raw.color ?? "").trim();
  const product = String(raw.product ?? "").trim();
  const sheen = String(raw.sheen ?? "").trim();
  const floor = String(raw.floor ?? "").trim();

  if (!manufacturer && color) {
    const upper = color.toUpperCase();
    for (const mfr of MANUFACTURERS) {
      if (upper.startsWith(mfr) || upper.includes(mfr)) {
        manufacturer = MANUFACTURER_ABBREV[mfr] ?? mfr;
        color = color.replace(new RegExp(mfr, "i"), "").trim();
        break;
      }
    }
  }
  if (manufacturer) manufacturer = abbreviateManufacturer(manufacturer);

  return { label, manufacturer, color, product, sheen, floor };
}

const PROMPT = `Look at this image of a paint schedule or paint color table. Extract every paint item you can see.

For each item return:
- label: item ID (e.g. PT-1, P-15, PT-02)
- manufacturer: paint manufacturer if visible (e.g. Benjamin Moore, Sherwin-Williams, Dunn-Edwards, Kelly Moore, PPG, Behr)
- color: color name and/or code WITHOUT the manufacturer prefix (e.g. "Simply White 2143-70", "Dark & Stormy DET572")
- product: product line if shown (e.g. Regal Select, Duration, Ultra Spec)
- sheen: finish/sheen if shown (e.g. Flat, Eggshell, Semi-Gloss)
- floor: floor/location if shown (e.g. 1st Floor)

Return ONLY a JSON array of objects with those keys. No markdown. Example:
[{"label":"PT-1","manufacturer":"Kelly Moore","color":"Whitest White KMW43","product":"","sheen":"Flat","floor":""}]`;

export async function runExtractPaint(body: {
  image_base64?: string;
  media_type?: string;
}): Promise<{ items: ExtractedPaintRow[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI import is not configured. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.",
    );
  }
  const b64 = body.image_base64?.trim();
  if (!b64) throw new Error("No image data.");

  let mediaType = body.media_type?.trim() || "image/jpeg";
  if (!mediaType.startsWith("image/")) mediaType = "image/jpeg";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: b64 },
            },
            { type: "text", text: PROMPT },
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

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  let text = "";
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) text = block.text.trim();
  }
  if (!text) throw new Error("Claude returned no text.");

  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const arr = JSON.parse(text) as Record<string, unknown>[];
  if (!Array.isArray(arr)) throw new Error("Claude did not return a JSON array.");

  const items = arr
    .map((row) => normalizeRow(row))
    .filter((row): row is ExtractedPaintRow => row !== null);

  if (!items.length) throw new Error("No paint items found in the image.");
  return { items };
}
