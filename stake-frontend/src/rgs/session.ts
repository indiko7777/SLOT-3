/**
 * Reads the Stake game-launch query string. In production the RGS injects
 * these into the game iframe URL; nothing here is ever hardcoded.
 *
 *   ?sessionID=...&rgs_url=<host>&lang=en&device=desktop&currency=USD
 *
 * `rgs_url` is a HOST (no scheme) — the client builds https://<host><path>.
 * For local development (Vite dev with no real params) we fall back to:
 *   1. The local mock-RGS Node server (http://127.0.0.1:8787) when running
 *      under `npm run dev:local`.
 *   2. The in-browser mock RGS (/__mock_rgs__) on any static host
 *      (GitHub Pages, Netlify, etc.) — no backend required.
 */
import { MOCK_BASE } from "../browser-mock-rgs";

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
  /** True when using the in-browser fetch-interceptor mock (no Node server). */
  isBrowserMock: boolean;
}

export const LOCAL_RGS_PORT = 8787;

/** Pure launch parser (unit-testable; no DOM). */
export function parseLaunch(
  q: URLSearchParams,
  hostname: string,
  isDev: boolean,
  nodeServerReachable = false
): GameSession {
  let sessionID = q.get("sessionID") ?? "";
  let rgsUrl = q.get("rgs_url") ?? "";
  const lang = remapLang(q.get("lang") ?? "en");
  const device = q.get("device") === "mobile" ? "mobile" : "desktop";
  const currencyHint = (q.get("currency") ?? "USD").toUpperCase();

  let isLocal = false;
  let isBrowserMock = false;

  if (!sessionID || !rgsUrl) {
    isLocal = true;
    sessionID =
      sessionID ||
      `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (isDev && nodeServerReachable) {
      rgsUrl = rgsUrl || `${hostname}:${LOCAL_RGS_PORT}`;
    } else {
      isBrowserMock = true;
      rgsUrl = MOCK_BASE;
    }
  } else {
    isLocal = /^(localhost|127\.0\.0\.1)/.test(rgsUrl);
  }

  let rgsBase: string;
  if (isBrowserMock) {
    rgsBase = MOCK_BASE;
  } else {
    const scheme =
      isLocal || rgsUrl.startsWith("localhost") ? "http" : "https";
    rgsBase = `${scheme}://${rgsUrl.replace(/\/+$/, "")}`;
  }

  return {
    sessionID,
    rgsUrl,
    rgsBase,
    lang,
    device,
    currencyHint,
    isLocal,
    isBrowserMock
  };
}

export async function readSession(): Promise<GameSession> {
  const isDev = Boolean((import.meta as ImportMeta).env?.DEV);
  const q = new URLSearchParams(window.location.search);
  const hasRealParams = q.has("sessionID") && q.has("rgs_url");

  let nodeReachable = false;
  if (isDev && !hasRealParams) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      await fetch(`http://127.0.0.1:${LOCAL_RGS_PORT}/wallet/authenticate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: ctrl.signal
      });
      clearTimeout(t);
      nodeReachable = true;
    } catch { /* not running — fall through to browser mock */ }
  }

  return parseLaunch(q, window.location.hostname, isDev, nodeReachable);
}

function remapLang(lang: string): string {
  const l = lang.toLowerCase();
  return l === "br" ? "pt" : l;
}
