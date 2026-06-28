/**
 * Beach Girl collection — the persistent retention meta. Pure logic, no DOM.
 *
 * Design (see docs/MATH_DESIGN.md §3): the collection is COSMETIC / $0 EV. It
 * never touches RTP. ONE rare WILD symbol landing reveals ONE body part — a
 * strict 1:1 trigger (book-driven and provably fair: WILDs come from the book's
 * boards). Reveal all of a girl's parts to complete her, advance to the next,
 * grant an RTP-neutral cosmetic unlock, and persist — it NEVER resets. Three
 * girls = the gallery is mastered.
 *
 * Difficulty = WILD rarity (set in the reels) × parts per girl. To make a later
 * girl harder, give her more parts (each still one WILD). All free to tune
 * because it carries no money.
 */

export const SCHEMA_VERSION = 1;

export interface GirlConfig {
  id: number;
  name: string;
  /** Body parts to reveal = WILDs needed to complete her (1 WILD = 1 part). */
  pieces: number;
  /** Texture-key prefix: "char" (girl 1, shipped) | "char2" | "char3". */
  artPrefix: string;
  /** RTP-neutral cosmetic unlock granted on completion ($0 EV). */
  unlockId: string;
}

/**
 * 8 parts each = 8 rare WILDs per girl (24 WILDs to master the gallery). Only
 * girl 1 has shipped art (`char_*`); girls 2/3 progress in state and light up
 * when `char2_*` / `char3_*` art is added. To make a later girl harder, raise
 * her `pieces` (more body parts — each still one WILD).
 */
export const GIRLS: GirlConfig[] = [
  { id: 0, name: "Sapphire", pieces: 8, artPrefix: "char", unlockId: "skin_neon" },
  { id: 1, name: "Roxy", pieces: 7, artPrefix: "char2", unlockId: "skin_gold" },
  { id: 2, name: "Vega", pieces: 8, artPrefix: "char3", unlockId: "skin_diamond" }
];

/** Granted when all three girls are complete — the ultimate milestone. */
export const GALLERY_MASTER_UNLOCK = "gallery_master";

export interface GalleryData {
  version: number;
  /** Index into GIRLS; === GIRLS.length once the gallery is mastered. */
  currentGirl: number;
  /** Body parts revealed for the current girl (0..girl.pieces). */
  pieces: number;
  /** Completed girl ids (persistent, never cleared). */
  completed: number[];
  /** Cosmetic unlock ids earned (RTP-neutral). */
  unlocks: string[];
  /**
   * Gold WANTED-LEVEL stars armed by completing girls (1st girl → 1 star, 2nd →
   * 2, 3rd → 3). Each is a persistent, unconditional head-start that pre-lights
   * the meter and routes the spin to the matching certified `base_tierN` table.
   * Reset to 0 ONLY when the player triggers the Getaway naturally (live wanted
   * level reaches 5★ on an organic spin). Capped at 5. See docs/MATH_DESIGN.md.
   */
  getawayStars: number;
}

export interface PieceGain {
  girlId: number;
  pieceIndex: number; // 1-based — which body part this WILD revealed
  totalPieces: number;
  artPrefix: string;
  completedGirl: boolean; // this WILD finished the girl
  galleryComplete: boolean; // this WILD finished the whole gallery
  unlockId: string | null; // cosmetic unlock granted by this WILD
}

export function emptyGallery(): GalleryData {
  return { version: SCHEMA_VERSION, currentGirl: 0, pieces: 0, completed: [], unlocks: [], getawayStars: 0 };
}

/** Reset the gold WANTED stars — called once when the Getaway triggers naturally. */
export function consumeGetawayStars(data: GalleryData): GalleryData {
  if ((data.getawayStars ?? 0) === 0) return data;
  return { ...data, getawayStars: 0 };
}

export function isGalleryComplete(data: GalleryData): boolean {
  return data.currentGirl >= GIRLS.length;
}

export function currentGirl(data: GalleryData): GirlConfig | null {
  return GIRLS[data.currentGirl] ?? null;
}

/** Pieces shown for whatever the gallery is currently on (full if mastered). */
export function displayedPieces(data: GalleryData): number {
  const girl = currentGirl(data);
  if (!girl) return GIRLS[GIRLS.length - 1]?.pieces ?? 0; // mastered: show full
  return Math.min(girl.pieces, Math.max(0, data.pieces));
}

/**
 * Reveal ONE body part — called once per rare WILD that lands (1 WILD = 1 part).
 * Returns the new (immutable) gallery and the gain to animate, or a null gain if
 * there's nothing left to collect (gallery already mastered). Pure — the caller
 * persists the returned data.
 */
export function collectWild(data: GalleryData): { data: GalleryData; gain: PieceGain | null } {
  if (data.currentGirl >= GIRLS.length) return { data, gain: null };
  const girl = GIRLS[data.currentGirl]!;
  const next: GalleryData = {
    version: SCHEMA_VERSION,
    currentGirl: data.currentGirl,
    pieces: data.pieces + 1,
    completed: [...data.completed],
    unlocks: [...data.unlocks],
    getawayStars: data.getawayStars ?? 0
  };

  const pieceIndex = next.pieces; // 1-based
  const completedGirl = next.pieces >= girl.pieces;
  let galleryComplete = false;
  let unlockId: string | null = null;

  if (completedGirl) {
    next.completed.push(girl.id);
    if (!next.unlocks.includes(girl.unlockId)) next.unlocks.push(girl.unlockId);
    unlockId = girl.unlockId;
    // Arm one more gold WANTED star (the head-start). Persistent until a natural
    // Getaway consumes them; capped at the 5-star meter.
    next.getawayStars = Math.min(5, next.getawayStars + 1);
    next.currentGirl += 1;
    next.pieces = 0;
    if (next.currentGirl >= GIRLS.length) {
      galleryComplete = true;
      if (!next.unlocks.includes(GALLERY_MASTER_UNLOCK)) next.unlocks.push(GALLERY_MASTER_UNLOCK);
    }
  }

  const gain: PieceGain = {
    girlId: girl.id,
    pieceIndex,
    totalPieces: girl.pieces,
    artPrefix: girl.artPrefix,
    completedGirl,
    galleryComplete,
    unlockId
  };
  return { data: next, gain };
}

/** Convenience: collect `count` WILDs in one go (tests / batch). */
export function addWilds(data: GalleryData, count: number): { data: GalleryData; gains: PieceGain[] } {
  let d = data;
  const gains: PieceGain[] = [];
  if (!Number.isFinite(count)) return { data: d, gains };
  for (let i = 0; i < count; i++) {
    const { data: nd, gain } = collectWild(d);
    d = nd;
    if (gain) gains.push(gain);
    else break;
  }
  return { data: d, gains };
}

/** Clamp/repair any loaded gallery so bad storage never crashes the game. */
export function sanitize(data: Partial<GalleryData> | null | undefined): GalleryData {
  if (!data || typeof data !== "object") return emptyGallery();
  const currentGirlIdx = clampInt(data.currentGirl, 0, GIRLS.length);
  const girl = GIRLS[currentGirlIdx];
  const maxPieces = girl ? girl.pieces : 0;
  const completed = Array.isArray(data.completed)
    ? data.completed.filter((n) => Number.isInteger(n) && n >= 0 && n < GIRLS.length)
    : [];
  const unlocks = Array.isArray(data.unlocks) ? data.unlocks.filter((u) => typeof u === "string") : [];
  return {
    version: SCHEMA_VERSION,
    currentGirl: currentGirlIdx,
    pieces: clampInt(data.pieces, 0, maxPieces),
    completed,
    unlocks,
    getawayStars: clampInt(data.getawayStars, 0, 5)
  };
}

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
