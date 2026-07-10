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
  isReplayMode: boolean;
  replayEvent: string;
  replayAmount: number;
  /** Bet mode of the replayed event (?mode=...), defaults to base. */
  replayMode: string;
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

  const isReplayMode = q.has("replay") || q.has("event") || q.has("eventId") || q.has("replayId") || q.has("roundId");
  const replayEvent = q.get("event") ?? q.get("eventId") ?? q.get("replayId") ?? q.get("roundId") ?? "";
  const replayAmount = parseFloat(q.get("amount") ?? "0");
  const replayMode = q.get("mode") ?? "base";

  let isLocal = false;
  if (!sessionID || !rgsUrl) {
    if (!isDev && !isReplayMode) {
      throw new Error(
        "Missing sessionID / rgs_url — the game must be launched by the RGS."
      );
    }
    isLocal = true;
    // DEV convenience only: keep the generated local sessionID stable across
    // reloads so the mock-RGS active-round resume path can be exercised.
    // Production sessions always come from the launch URL, never storage.
    sessionID = sessionID || (isDev ? devStableSessionID() : "") ||
      `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    rgsUrl = rgsUrl || `${hostname}:${LOCAL_RGS_PORT}`;
  } else {
    isLocal = /^(localhost|127\.0\.0\.1)/.test(rgsUrl);
  }

  const scheme = isLocal || rgsUrl.startsWith("localhost") ? "http" : "https";
  const rgsBase = `${scheme}://${rgsUrl.replace(/\/+$/, "")}`;

  return { sessionID, rgsUrl, rgsBase, lang, device, currencyHint, isLocal, isReplayMode, replayEvent, replayAmount, replayMode };
}

function devStableSessionID(): string {
  try {
    const KEY = "heatchase.dev.sessionID";
    let id = window.sessionStorage.getItem(KEY);
    if (!id) {
      id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      window.sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function readSession(): GameSession {
  const isDev = import.meta.env.DEV;
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
