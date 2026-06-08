import { Assets, Texture } from "pixi.js";
import type { SymbolId } from "../domain";

export interface SymbolSkin {
  color: number;
  stroke: number;
  text: number;
  label: string;
  assetKey: string;
}

export const SYMBOL_ASSETS: Record<SymbolId, SymbolSkin> = {
  BRASS: { color: 0x392136, stroke: 0xfb6f52, text: 0xfb6f52, label: "BK", assetKey: "symbols/brass_knuckles.png" },
  KNIFE: { color: 0x382036, stroke: 0xff835e, text: 0xff835e, label: "KN", assetKey: "symbols/knife.png" },
  PISTOL: { color: 0x222346, stroke: 0x72dfff, text: 0xa9f060, label: "PI", assetKey: "symbols/pistol.png" },
  AMMO: { color: 0x222346, stroke: 0x72dfff, text: 0xa9f060, label: "AM", assetKey: "symbols/ammo.png" },
  DUFFEL: { color: 0x20274b, stroke: 0x72dfff, text: 0xa9f060, label: "DB", assetKey: "symbols/duffel.png" },
  CASH: { color: 0x362615, stroke: 0xffdf65, text: 0xffdf65, label: "$$", assetKey: "symbols/cash.png" },
  WATCH: { color: 0x332919, stroke: 0xffdf65, text: 0xffdf65, label: "GW", assetKey: "symbols/watch.png" },
  DIAMOND: { color: 0x302719, stroke: 0xffdf65, text: 0xffdf65, label: "DM", assetKey: "symbols/diamond.png" },
  BIKE: { color: 0x332919, stroke: 0xffdf65, text: 0xffdf65, label: "SB", assetKey: "symbols/bike.png" },
  CAR_WILD: { color: 0x063957, stroke: 0x65f8ff, text: 0xffffff, label: "W", assetKey: "symbols/cyan_car_wild.png" },
  PHONE_SCATTER: { color: 0x311634, stroke: 0xff4777, text: 0xff8bad, label: "PH", assetKey: "symbols/burner_phone.png" },
  SAFE: { color: 0x5f401a, stroke: 0xffdf65, text: 0xffdf65, label: "SF", assetKey: "symbols/safe.png" },
  MASTER_KEY: { color: 0x123a67, stroke: 0x68f7ff, text: 0xffffff, label: "KY", assetKey: "symbols/master_key.png" },
  EMPTY: { color: 0x0d1530, stroke: 0x2b6c8a, text: 0xffffff, label: "", assetKey: "symbols/empty.png" }
};

const BASE_PATH = "assets/";

const textureCache = new Map<string, Texture>();
let loaded = false;

/** Extra non-symbol images to preload */
const EXTRA_ASSETS: Record<string, string> = {
  "getaway_car_scene": "getaway_car_scene.png",
  "wanted_star": "wanted_star.png",
};

/** Optional images — loaded per-file so a missing one never blocks the game.
 *  The Getaway (POV chase) bonus renders procedural fallbacks until these exist. */
const OPTIONAL_ASSETS: Record<string, string> = {
  "highway_loop": "highway_loop.jpg",
  "brinks_truck_frame": "brinks_truck_frame.png",
  "gold_bar": "gold_bar.png",
  "dynamite": "dynamite.png",
};

/** Background images — loaded separately so a missing file doesn't block the game */
const BG_ASSETS: Record<string, string> = {
  "bg_base": "chase_base.png",
  "bg_max_heat": "chase_max_heat.png",
  "bg_bonus": "vault_bonus.png",
};

export async function loadSymbolTextures(): Promise<void> {
  if (loaded) return;

  const entries = Object.values(SYMBOL_ASSETS);
  const bundles: Record<string, string> = {};
  for (const skin of entries) {
    bundles[skin.assetKey] = BASE_PATH + skin.assetKey;
  }
  for (const [key, file] of Object.entries(EXTRA_ASSETS)) {
    bundles[key] = BASE_PATH + file;
  }

  const textures = await Assets.load(Object.values(bundles));

  for (const skin of entries) {
    const url = BASE_PATH + skin.assetKey;
    const tex = textures[url] ?? textures[skin.assetKey];
    if (tex instanceof Texture) {
      textureCache.set(skin.assetKey, tex);
    }
  }
  for (const [key, file] of Object.entries(EXTRA_ASSETS)) {
    const url = BASE_PATH + file;
    const tex = textures[url] ?? textures[key];
    if (tex instanceof Texture) {
      textureCache.set(key, tex);
    }
  }

  loaded = true;

  // Load backgrounds + optional bonus art separately — failures are ignored
  // so a missing file just falls back to procedural rendering.
  for (const [key, file] of [...Object.entries(BG_ASSETS), ...Object.entries(OPTIONAL_ASSETS)]) {
    try {
      const url = BASE_PATH + file;
      const tex = await Assets.load(url);
      if (tex instanceof Texture) {
        textureCache.set(key, tex);
      }
    } catch {
      // Missing file is fine — the procedural fallback will be used
    }
  }
}

export function getSymbolTexture(id: SymbolId): Texture | null {
  const skin = SYMBOL_ASSETS[id];
  return textureCache.get(skin.assetKey) ?? null;
}

export function getExtraTexture(key: string): Texture | null {
  return textureCache.get(key) ?? null;
}

export const IMAGE_DROP_IN_GUIDE = {
  basePath: "public/assets/",
  requiredSymbolFiles: Object.values(SYMBOL_ASSETS).map((skin) => skin.assetKey),
  backgrounds: ["chase_base.png", "chase_max_heat.png", "vault_bonus.png"],
  rightPanel: ["brand/logo.png", "characters/getaway_driver.png", "vehicles/cyan_sports_car.png"]
} as const;
