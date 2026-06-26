import { Assets, Texture, Spritesheet } from "pixi.js";
import type { SymbolId } from "../domain";

export interface SymbolSkin {
  color: number;
  stroke: number;
  text: number;
  label: string;
  assetKey: string;
}

export const SYMBOL_ASSETS: Record<SymbolId, SymbolSkin> = {
  BRASS: { color: 0x392136, stroke: 0xfb6f52, text: 0xfb6f52, label: "BK", assetKey: "symbols/brass_knuckles.webp" },
  KNIFE: { color: 0x382036, stroke: 0xff835e, text: 0xff835e, label: "KN", assetKey: "symbols/knife.webp" },
  PISTOL: { color: 0x222346, stroke: 0x72dfff, text: 0xa9f060, label: "PI", assetKey: "symbols/pistol.webp" },
  AMMO: { color: 0x222346, stroke: 0x72dfff, text: 0xa9f060, label: "AM", assetKey: "symbols/ammo.webp" },
  DUFFEL: { color: 0x20274b, stroke: 0x72dfff, text: 0xa9f060, label: "DB", assetKey: "symbols/duffel.webp" },
  CASH: { color: 0x362615, stroke: 0xffdf65, text: 0xffdf65, label: "$$", assetKey: "symbols/cash.webp" },
  WILD: { color: 0x5f401a, stroke: 0xffdf65, text: 0xffffff, label: "WD", assetKey: "symbols/wild_symbole.webp" },
  DIAMOND: { color: 0x302719, stroke: 0xffdf65, text: 0xffdf65, label: "DM", assetKey: "symbols/diamond.webp" },
  BIKE: { color: 0x332919, stroke: 0xffdf65, text: 0xffdf65, label: "SB", assetKey: "symbols/bike.webp" },
  CAR_WILD: { color: 0x163611, stroke: 0x9ae64e, text: 0xffffff, label: "W", assetKey: "symbols/cyan_car_wild.webp" },
  PHONE_SCATTER: { color: 0x311634, stroke: 0xff4777, text: 0xff8bad, label: "BT", assetKey: "symbols/burner_phone.webp" },
  SAFE: { color: 0x5f401a, stroke: 0xffdf65, text: 0xffdf65, label: "SF", assetKey: "symbols/safe.webp" },
  MASTER_KEY: { color: 0x123a67, stroke: 0x9ae64e, text: 0xffffff, label: "KY", assetKey: "symbols/master_key.webp" },
  EMPTY: { color: 0x0d1530, stroke: 0x527a3c, text: 0xffffff, label: "", assetKey: "symbols/empty.webp" }
};

const BASE_PATH = "assets/";

/** Win sprite-sheet atlases, produced by tools/asset-pipeline/build-sheets.mjs.
 *  Optional — a symbol without one (or before art is generated) falls back to
 *  the procedural glow in SymbolView.winCelebrate. Keys match the atlas
 *  animation name (`<file>_win`). */
const ANIM_ASSETS: Partial<Record<SymbolId, string>> = {
  CAR_WILD: "anim/cyan_car_wild_win.json",
  SAFE: "anim/safe_win.json",
  MASTER_KEY: "anim/master_key_win.json",
  DIAMOND: "anim/diamond_win.json",
  PHONE_SCATTER: "anim/burner_phone_win.json",
};

export interface SymbolAnimation {
  textures: Texture[];
  fps: number;
}

const textureCache = new Map<string, Texture>();
const animCache = new Map<SymbolId, SymbolAnimation>();
let loaded = false;

/** Extra non-symbol images to preload */
const EXTRA_ASSETS: Record<string, string> = {
  "getaway_car_scene": "getaway_car_scene.webp",
  "wanted_star": "wanted_star.webp",
  "char_silhouette": "bodycharachter1/silhouette_image1.png.webp",
  "char_piece_1": "bodycharachter1/rightfoot1.png.webp",
  "char_piece_2": "bodycharachter1/leftfoot1.png.webp",
  "char_piece_3": "bodycharachter1/legs1.png.webp",
  "char_piece_4": "bodycharachter1/stomach1.png.webp",
  "char_piece_5": "bodycharachter1/phonearm1.png.webp",
  "char_piece_6": "bodycharachter1/chest1.png.webp",
  "char_piece_7": "bodycharachter1/rightarm1.png.webp",
  "char_piece_8": "bodycharachter1/head1.png.webp",
  "char_full": "bodycharachter1/full_image1.png.webp",
  "real_bill": "real_bill.png",

  "char2_silhouette": "bodycharachter2/silhouette.webp",
  "char2_piece_1": "bodycharachter2/right foot.webp",
  "char2_piece_2": "bodycharachter2/left foot.webp",
  "char2_piece_3": "bodycharachter2/legs.webp",
  "char2_piece_4": "bodycharachter2/body.webp",
  "char2_piece_5": "bodycharachter2/left arm.webp",
  "char2_piece_6": "bodycharachter2/right arm.webp",
  "char2_piece_7": "bodycharachter2/head.webp",
  "char2_full": "bodycharachter2/full image girl 2.webp",

  "char3_silhouette": "charachter3 body/silhouette.webp",
  "char3_piece_1": "charachter3 body/right foot.webp",
  "char3_piece_2": "charachter3 body/left foot.webp",
  "char3_piece_3": "charachter3 body/legs.webp",
  "char3_piece_4": "charachter3 body/body (1).webp",
  "char3_piece_5": "charachter3 body/top t shirt.webp",
  "char3_piece_6": "charachter3 body/left arm.webp",
  "char3_piece_7": "charachter3 body/right arm.webp",
  "char3_piece_8": "charachter3 body/full body and head.webp",
  "char3_full": "charachter3 body/full body and head.webp",
};

/** Optional images — loaded per-file so a missing one never blocks the game.
 *  The Getaway (POV chase) bonus renders procedural fallbacks until these exist. */
const OPTIONAL_ASSETS: Record<string, string> = {
  "highway_loop": "highway_loop.jpg",
  "brinks_truck_frame": "brinks_truck_frame.webp",
  "gold_bar": "gold_bar.webp",
  "dynamite": "dynamite.webp",
  "heat_chase_logo": "Heat Chase Logo.webp",
};

/** Background images — loaded separately so a missing file doesn't block the game */
const BG_ASSETS: Record<string, string> = {
  "bg_base": "slot3_bg.webp",
  "bg_max_heat": "chase_max_heat.webp",
  "bg_bonus": "vault_bonus.webp",
  "bg_slot3": "slot3_bg.webp",
};

export async function loadSymbolTextures(): Promise<void> {
  if (loaded) return;

  // All symbol PNGs have been pre-processed by tools/asset-pipeline/strip-bg.mjs —
  // black backgrounds removed at build time. Just load them directly.
  await Promise.all(
    Object.values(SYMBOL_ASSETS).map(async (skin) => {
      try {
        const tex = await Assets.load<Texture>(BASE_PATH + skin.assetKey);
        if (tex instanceof Texture) textureCache.set(skin.assetKey, tex);
      } catch (err) {
        console.warn(`[assets] Failed to load symbol texture: ${skin.assetKey}`, err);
      }
    })
  );

  // Extra images (silhouette, character pieces, etc.) — also isolated.
  await Promise.all(
    Object.entries(EXTRA_ASSETS).map(async ([key, file]) => {
      try {
        const url = BASE_PATH + file;
        const tex = await Assets.load<Texture>(url);
        if (tex instanceof Texture) textureCache.set(key, tex);
      } catch (err) {
        console.warn(`[assets] Failed to load extra texture: ${file}`, err);
      }
    })
  );

  loaded = true;

  // Backgrounds + optional bonus art — failures are silently ignored.
  for (const [key, file] of [...Object.entries(BG_ASSETS), ...Object.entries(OPTIONAL_ASSETS)]) {
    try {
      const url = BASE_PATH + file;
      const tex = await Assets.load<Texture>(url);
      if (tex instanceof Texture) textureCache.set(key, tex);
    } catch {
      // Missing file — procedural fallback will be used
    }
  }

  // Win sprite-sheet atlases — missing ones just use procedural glow.
  for (const [id, file] of Object.entries(ANIM_ASSETS) as [SymbolId, string][]) {
    try {
      const sheet = await Assets.load<Spritesheet>(BASE_PATH + file);
      const animName = file.replace("anim/", "").replace(".json", "");
      const textures = sheet.animations?.[animName];
      if (textures && textures.length) {
        const fps = (sheet.data?.meta as { fps?: number } | undefined)?.fps ?? 16;
        animCache.set(id, { textures, fps });
      }
    } catch {
      // No atlas yet — procedural fallback will be used
    }
  }
}

export function getSymbolTexture(id: SymbolId): Texture | null {
  const skin = SYMBOL_ASSETS[id];
  if (!skin) return null; // unknown / undefined id → caller falls back, never throws
  return textureCache.get(skin.assetKey) ?? null;
}

export function getExtraTexture(key: string): Texture | null {
  return textureCache.get(key) ?? null;
}

/** Win animation frames for a symbol, if a sprite-sheet atlas was loaded. */
export function getSymbolAnimation(id: SymbolId): SymbolAnimation | null {
  return animCache.get(id) ?? null;
}

export const IMAGE_DROP_IN_GUIDE = {
  basePath: "public/assets/",
  requiredSymbolFiles: Object.values(SYMBOL_ASSETS).map((skin) => skin.assetKey),
  backgrounds: ["chase_base.webp", "chase_max_heat.webp", "vault_bonus.webp"],
  rightPanel: ["brand/logo.webp", "characters/getaway_driver.webp", "vehicles/cyan_sports_car.webp"]
} as const;
