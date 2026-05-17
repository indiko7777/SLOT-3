/**
 * Reads the Stake game-launch query string. In production the RGS injects
 * these into the game iframe URL; nothing here is ever hardcoded.
 *
 *   ?sessionID=...&rgs_url=<host>&lang=en&device=desktop&currency=USD
 *
 * `rgs_url` is a HOST (no scheme) — the client builds https://<host><path>.
 * For local development (Vite dev with no real params) we fall back to the
 * local mock-RGS host so the exact same RGS code path runs offline.
 */
export interface GameSession {
  sessionID: string;
  rgsUrl: string;
  /** Built base, e.g. https://rgs.example.com or http://127.0.0.1:8787 */
  rgsBase: string;
  lang: string;
  device: "desktop" | "mobile";
  /** Currency hint only; the authoritative currency comes from authenticate. */
  currencyHint: string;
  isLocal: boolean;
}

export const LOCAL_RGS_PORT = 8787;

/** Pure launch parser (unit-testable; no DOM). */
export function parseLaunch(
  q: URLSearchParams,
  hostname: string,
  isDev: boolean
): GameSession {
  let sessionID = q.get("sessionID") ?? "";
  let rgsUrl = q.get("rgs_url") ?? "";
  const lang = remapLang(q.get("lang") ?? "en");
  const device = q.get("device") === "mobile" ? "mobile" : "desktop";
  const currencyHint = (q.get("currency") ?? "USD").toUpperCase();

  let isLocal = false;
  if (!sessionID || !rgsUrl) {
    if (!isDev) {
      throw new Error(
        "Missing sessionID / rgs_url — the game must be launched by the RGS."
      );
    }
    isLocal = true;
    sessionID =
      sessionID ||
      `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    rgsUrl = rgsUrl || `${hostname}:${LOCAL_RGS_PORT}`;
  } else {
    isLocal = /^(localhost|127\.0\.0\.1)/.test(rgsUrl);
  }

  const scheme = isLocal || rgsUrl.startsWith("localhost") ? "http" : "https";
  const rgsBase = `${scheme}://${rgsUrl.replace(/\/+$/, "")}`;

  return { sessionID, rgsUrl, rgsBase, lang, device, currencyHint, isLocal };
}

export function readSession(): GameSession {
  const isDev = Boolean((import.meta as ImportMeta).env?.DEV);
  return parseLaunch(
    new URLSearchParams(window.location.search),
    window.location.hostname,
    isDev
  );
}

function remapLang(lang: string): string {
  const l = lang.toLowerCase();
  return l === "br" ? "pt" : l;
}
