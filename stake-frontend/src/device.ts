/**
 * Device class for memory budgeting.
 *
 * Phones and tablets get the low-memory path: downscaled textures (assets.ts)
 * and streamed rather than fully decoded music (audio.ts). iOS Safari kills a tab long before
 * a desktop browser would — an iPhone 12 (4 GB, iOS 18) crashed while loading
 * the full-resolution build — and Android WebViews behave the same on 3–4 GB
 * handsets. Their screens cannot show the extra pixels anyway.
 *
 * `?quality=low` / `?quality=high` in the launch URL forces either path (QA).
 */
let cached: boolean | null = null;

export function isLowMemoryDevice(): boolean {
  if (cached !== null) return cached;
  cached = detect();
  return cached;
}

function detect(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  try {
    const forced = new URLSearchParams(window.location.search).get("quality");
    if (forced === "low") return true;
    if (forced === "high") return false;
  } catch { /* no URL — fall through to detection */ }
  const ua = navigator.userAgent || "";
  // iPadOS reports a desktop Mac user agent; touch points give it away.
  const iOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  if (iOS || /Android|Mobile/i.test(ua)) return true;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === "number" && memory <= 4;
}
