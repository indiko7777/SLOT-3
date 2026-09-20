/**
 * RTP-neutral rewards for the collection. These are COSMETIC / $0 EV — they
 * grant a skin, a badge, or bragging rights, NEVER money or free spins (that
 * would break the per-mode 96% verification, see docs/MATH_DESIGN.md §3, §6).
 *
 * The unlock ids are recorded in the persistent gallery (`GalleryData.unlocks`);
 * this module maps them to display copy and the HUD frame palette. These
 * cosmetic rewards are separate from the collection's earned star modes.
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
 * Select the highest earned frame theme. This changes presentation only.
 */
export function cosmeticThemeFor(unlocks: readonly string[]): "neon" | "gold" | "diamond" | null {
  if (unlocks.includes("skin_diamond")) return "diamond";
  if (unlocks.includes("skin_gold")) return "gold";
  if (unlocks.includes("skin_neon")) return "neon";
  return null;
}
