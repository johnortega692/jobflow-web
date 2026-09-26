const CUSTOM_DOMAIN = "https://jobflow.ortegabuilt.com";

function trimOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function looksPublic(origin: string): boolean {
  return Boolean(origin) && !/localhost|127\.0\.0\.1/i.test(origin);
}

function withHttps(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/** Public JobFlow origin for links in emails (Field View, etc.). */
export function jobflowPublicOrigin(): string {
  const fromVite =
    typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env.VITE_APP_URL === "string"
      ? import.meta.env.VITE_APP_URL
      : "";
  const vercelHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  const candidates = [
    fromVite,
    process.env.VITE_APP_URL ?? "",
    process.env.APP_URL ?? "",
    vercelHost ? withHttps(vercelHost) : "",
  ];
  for (const raw of candidates) {
    const origin = trimOrigin(raw);
    if (looksPublic(origin)) return withHttps(origin).replace(/\/$/, "");
  }
  return CUSTOM_DOMAIN;
}

export function fieldViewWallcoveringUrl(): string {
  return `${jobflowPublicOrigin()}/field/wallcovering`;
}
