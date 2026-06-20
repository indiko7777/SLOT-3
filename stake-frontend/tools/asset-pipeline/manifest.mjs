/**
 * ASSET MANIFEST — single source of truth for "The Getaway" symbol art.
 *
 * Symbol IDs / filenames MUST match src/pixi/assets.ts (SYMBOL_ASSETS), because
 * those keys are wired into the math model + paytable. We regenerate the ART for
 * each existing symbol; we never rename a symbol.
 *
 * For each symbol:
 *   id        – engine SymbolId (matches domain.ts)
 *   file      – output filename under public/assets/symbols/ (matches assets.ts)
 *   subject   – the Higgsfield image prompt subject (premium 3D look)
 *   animated  – if set, this symbol also gets a win sprite-sheet (see anim/)
 *
 * The shared STYLE suffix encodes the AAA pre-rendered look from the spec.
 */

/** Premium pre-rendered look. Generated on a flat dark stage, then bg-removed. */
export const STYLE =
  "Pre-rendered 3D isometric game icon, Octane Render, Unreal Engine 5 style, " +
  "volumetric lighting, physically based rendering, ray-traced reflections, " +
  "subtle rim light, centered single object, no text, no logo, no watermark, " +
  "plain flat dark charcoal background, high detail, crisp edges, product render.";

/** Square symbols read best on a slot reel. */
export const IMAGE_PARAMS = { aspect_ratio: "1:1", resolution: "1k" };

/**
 * Target on-disk budget per static symbol after compression (KB).
 * Heavy heroes (wild/safe) get a slightly larger budget; pips stay tiny.
 */
export const SIZE_BUDGET_KB = { hero: 120, mid: 70, pip: 45 };

/**
 * Animation spec. A "win" animation is a short seamless loop we render from a
 * generated video (video-to-frames) then pack into a Pixi atlas (build-sheets).
 * frames/fps are targets; the packer trims to whatever frames actually exist.
 */
const winAnim = (frames, fps, motion) => ({ kind: "win", frames, fps, motion });

export const SYMBOLS = [
  // ── High-pay heroes ───────────────────────────────────────────────
  {
    id: "CAR_WILD", file: "cyan_car_wild.png", tier: "hero",
    subject:
      "a sleek cyan neon-trimmed getaway sports car, three-quarter front view, " +
      "glossy paint, glowing headlights, wet asphalt reflection",
    animated: winAnim(16, 18, "headlights pulse and neon underglow shimmer, gentle bob, seamless loop"),
  },
  {
    id: "SAFE", file: "safe.png", tier: "hero",
    subject:
      "a heavy gold bank vault safe with a brass combination dial, stacks of gold " +
      "bars faintly visible, opulent heist treasure",
    animated: winAnim(14, 16, "vault dial spins and door cracks with a burst of golden light, seamless loop"),
  },
  {
    id: "MASTER_KEY", file: "master_key.png", tier: "hero",
    subject:
      "an ornate glowing master skeleton key made of chrome and neon cyan energy, " +
      "floating, magical heist artifact",
    animated: winAnim(14, 16, "key rotates slowly with a cyan energy glow pulse, seamless loop"),
  },

  // ── Mid-pay ───────────────────────────────────────────────────────
  { id: "DIAMOND", file: "diamond.png", tier: "mid",
    subject: "a brilliant-cut blue diamond on a dark stage, faceted, sparkling caustics",
    animated: winAnim(12, 16, "facets catch light, a sparkle highlight sweeps across, seamless loop") },
  { id: "WILD", file: "wild symbole.png", tier: "hero",
    subject: "a large glowing neon 3D 'WILD' symbol with cyan and pink highlights" },
  { id: "BIKE", file: "bike.png", tier: "mid",
    subject: "a chromed superbike motorcycle, three-quarter view, aggressive stance" },
  { id: "CASH", file: "cash.png", tier: "mid",
    subject: "a thick banded stack of cash bundles, green bills, gold money band" },

  // ── Low-pay pips ──────────────────────────────────────────────────
  { id: "DUFFEL", file: "duffel.png", tier: "pip",
    subject: "a black duffel bag overflowing with cash, heist loot bag" },
  { id: "AMMO", file: "ammo.png", tier: "pip",
    subject: "a stack of brass bullet cartridges and an ammo box" },
  { id: "PISTOL", file: "pistol.png", tier: "pip",
    subject: "a sleek matte-black semi-automatic pistol, side profile" },
  { id: "BRASS", file: "brass_knuckles.png", tier: "pip",
    subject: "polished chrome brass knuckles, dramatic studio lighting" },
  { id: "KNIFE", file: "knife.png", tier: "pip",
    subject: "a tactical combat knife with a black handle and steel blade" },

  // ── Special ───────────────────────────────────────────────────────
  {
    id: "PHONE_SCATTER", file: "burner_phone.png", tier: "mid",
    subject:
      "a burner flip phone with a glowing screen showing an incoming call, " +
      "pink and cyan neon glow, scatter symbol",
    animated: winAnim(12, 14, "screen flashes and phone vibrates with neon ring pulses, seamless loop"),
  },

  // EMPTY is a UI tile (bonus grid hole), not a themed symbol — keep it featherweight.
  { id: "EMPTY", file: "empty.png", tier: "pip",
    subject: "a dark empty recessed slot cell frame, subtle inner shadow, minimal" },
];

/** Symbols that get a win sprite-sheet, in priority order. */
export const ANIMATED = SYMBOLS.filter((s) => s.animated);

/** Build the full image prompt for one symbol. */
export const imagePrompt = (s) => `${s.subject}. ${STYLE}`;

/** Build the video (animation) prompt for one animated symbol. */
export const videoPrompt = (s) =>
  `${s.subject}. ${s.animated.motion}. ${STYLE} The object stays centered; ` +
  `camera locked; loopable.`;
