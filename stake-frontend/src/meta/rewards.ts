/**
 * RTP-neutral rewards for the collection. These are COSMETIC / $0 EV — they
 * grant a skin, a badge, or bragging rights, NEVER money or free spins (that
 * would break the per-mode 96% verification, see docs/MATH_DESIGN.md §3, §6).
 *
 * The unlock ids are recorded in the persistent gallery (`GalleryData.unlocks`);
 * this module maps them to display copy. Hook `applyCosmetic` to actually swap a
 * theme/skin when you build those assets — it must stay purely visual.
 */

export interface Reward {
  id: string;
  name: string;
  description: string;
  /** "skin" cosmetics re-theme the game; "badge" is status only. Both $0 EV. */
  kind: "skin" | "badge";
}

export const REWARDS: Record<string, Reward> = {
  skin_neon: {
    id: "skin_neon",
    name: "Neon Nights",
    description: "Sapphire collected — unlocks the Neon Nights cosmetic theme.",
    kind: "skin"
  },
  skin_gold: {
    id: "skin_gold",
    name: "Gold Rush",
    description: "Roxy collected — unlocks the Gold Rush cosmetic theme.",
    kind: "skin"
  },
  skin_diamond: {
    id: "skin_diamond",
    name: "Diamond Elite",
    description: "Vega collected — unlocks the Diamond Elite cosmetic theme.",
    kind: "skin"
  },
  gallery_master: {
    id: "gallery_master",
    name: "Gallery Master",
    description: "All three girls collected. The ultimate VIP status.",
    kind: "badge"
  }
};

export function rewardFor(id: string | null | undefined): Reward | null {
  if (!id) return null;
  return REWARDS[id] ?? null;
}

/**
 * Apply a cosmetic unlock. Intentionally a no-op stub for now — wire it to a
 * theme swap when skin assets exist. MUST remain purely visual ($0 EV).
 */
export function applyCosmetic(_id: string): void {
  /* no visual themes wired yet — unlocks are recorded + surfaced via banners */
}
