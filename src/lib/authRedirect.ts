/** Live JobFlow URL used for auth email redirects when Site URL would otherwise be localhost. */
export const DEFAULT_APP_URL = "https://jobflow-web-kappa.vercel.app";

/**
 * Where signup / recovery emails should send the user after they click the link.
 * Prefer VITE_APP_URL, then the current non-localhost origin, else production.
 */
export function authEmailRedirectTo(): string {
  const fromEnv = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return `${fromEnv}/`;

  if (typeof window !== "undefined") {
    const origin = window.location.origin.replace(/\/$/, "");
    if (origin && !/localhost|127\.0\.0\.1/i.test(origin)) {
      return `${origin}/`;
    }
  }

  return `${DEFAULT_APP_URL}/`;
}
