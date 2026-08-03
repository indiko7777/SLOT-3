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
  /** Index into GIRLS (0..GIRLS.length - 1). Loops back to 0 on prestige rank up. */
  currentGirl: number;
  /** Body parts revealed for the current girl (0..girl.pieces). */
  pieces: number;
  /** Completed girl ids in the current loop. */
  completed: number[];
  /** Cosmetic unlock ids earned (RTP-neutral, persistent across prestiges). */
  unlocks: string[];
  /**
   * Gold WANTED-LEVEL stars armed by completing girls (1st girl → 1 star, 2nd →
   * 2, 3rd → 3). Reset to 0 ONLY when the player triggers the Getaway naturally.
   */
  getawayStars: number;
  /**
   * Prestige level (0 = initial run, 1 = Prestige I, 2 = Prestige II, etc.).
   * Increments each time the entire gallery of 3 girls is mastered.
   */
  prestige: number;
}

export interface PieceGain {
  girlId: number;
  pieceIndex: number; // 1-based — which body part this WILD revealed
  totalPieces: number;
  artPrefix: string;
  completedGirl: boolean; // this WILD finished the girl
  galleryComplete: boolean; // this WILD finished the whole gallery loop
  unlockId: string | null; // cosmetic unlock granted by this WILD
  prestige: number; // current prestige rank after this gain
  prestigeAdvanced: boolean; // true if this gain completed the gallery and ranked up prestige
}

export function emptyGallery(): GalleryData {
  return { version: SCHEMA_VERSION, currentGirl: 0, pieces: 0, completed: [], unlocks: [], getawayStars: 0, prestige: 0 };
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
  const idx = data.currentGirl >= GIRLS.length ? 0 : data.currentGirl;
  return GIRLS[idx] ?? GIRLS[0]!;
}

/** Pieces shown for whatever the gallery is currently on. */
export function displayedPieces(data: GalleryData): number {
  const girl = currentGirl(data);
  if (!girl) return 0;
  return Math.min(girl.pieces, Math.max(0, data.pieces));
}

/** Convert a integer (1..3999) to a Roman numeral. */
export function toRomanNumeral(num: number): string {
  if (num <= 0) return "";
  const val = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syb = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let roman = "";
  let n = Math.min(3999, Math.max(1, Math.floor(num)));
  for (let i = 0; i < val.length; i++) {
    while (n >= val[i]!) {
      roman += syb[i]!;
      n -= val[i]!;
    }
  }
  return roman || "I";
}

/** Formatted title for prestige rank (e.g. "PRESTIGE I", "PRESTIGE II"). */
export function getPrestigeTitle(prestige: number): string {
  if (prestige <= 0) return "";
  return `PRESTIGE ${toRomanNumeral(prestige)}`;
}

/**
 * Reveal ONE body part — called once per rare WILD that lands (1 WILD = 1 part).
 * Returns the new (immutable) gallery and the gain to animate.
 * Automatically loops back to Girl 1 and ranks up Prestige when all 3 girls are finished!
 */
export function collectWild(data: GalleryData): { data: GalleryData; gain: PieceGain | null } {
  let activeGirlIdx = data.currentGirl;
  let activePrestige = data.prestige ?? 0;
  if (activeGirlIdx >= GIRLS.length) {
    activeGirlIdx = 0;
    activePrestige += 1;
  }

  const girl = GIRLS[activeGirlIdx]!;
  const next: GalleryData = {
    version: SCHEMA_VERSION,
    currentGirl: activeGirlIdx,
    pieces: data.pieces + 1,
    completed: [...data.completed],
    unlocks: [...data.unlocks],
    getawayStars: data.getawayStars ?? 0,
    prestige: activePrestige
  };

  const pieceIndex = next.pieces; // 1-based
  const completedGirl = next.pieces >= girl.pieces;
  let galleryComplete = false;
  let prestigeAdvanced = false;
  let unlockId: string | null = null;

  if (completedGirl) {
    if (!next.completed.includes(girl.id)) next.completed.push(girl.id);
    if (!next.unlocks.includes(girl.unlockId)) next.unlocks.push(girl.unlockId);
    unlockId = girl.unlockId;
    next.getawayStars = Math.min(5, next.getawayStars + 1);
    next.currentGirl += 1;
    next.pieces = 0;

    // When the entire gallery loop is completed: RANK UP PRESTIGE and LOOP BACK!
    if (next.currentGirl >= GIRLS.length) {
      galleryComplete = true;
      prestigeAdvanced = true;
      next.prestige += 1;
      next.currentGirl = 0; // Loop back to Girl 0 (Sapphire)
      next.completed = []; // Reset completed for the next loop
      next.getawayStars = 0; // Reset gold head-start stars back to 0 for fresh Prestige loop
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
    unlockId,
    prestige: next.prestige,
    prestigeAdvanced
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
  let currentGirlIdx = clampInt(data.currentGirl, 0, GIRLS.length);
  let prestige = clampInt(data.prestige, 0, 9999);
  if (currentGirlIdx >= GIRLS.length) {
    currentGirlIdx = 0;
    prestige = Math.max(1, prestige);
  }
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
    getawayStars: clampInt(data.getawayStars, 0, 5),
    prestige
  };
}

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

