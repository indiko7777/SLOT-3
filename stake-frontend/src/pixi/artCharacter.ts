import { getExtraTexture } from "./assets";
import type { Rect } from "./types";

/**
 * THE landscape art-panel placement of a girl: where her shared canvas centre
 * sits and how big she is drawn. HudView.drawCharacter draws her with it and
 * every collection animation (the piece reveal's scan + seat, her intro, the
 * next-girl lock-on) stages on it — so a revealed piece always lands exactly
 * on her. Never duplicate this maths: a drifted copy is what made the reveal
 * scan and seat pieces in the wrong place.
 */
export function artCharTransform(rect: Rect, prefix: string): { cx: number; cy: number; scale: number } | null {
  const silTex = getExtraTexture(`${prefix}_silhouette`);
  if (!silTex) return null;
  const boxW = rect.width - 24;
  const boxH = rect.height - 84;
  const raw = Math.min(boxW / silTex.width, boxH / silTex.height);
  // girls 2 and 3 were exported on roomier canvases than girl 1
  const scale = prefix !== "char" ? raw * 1.25 : raw;
  return { cx: rect.x + rect.width / 2, cy: rect.y + 60 + (rect.height - 60) / 2, scale };
}
