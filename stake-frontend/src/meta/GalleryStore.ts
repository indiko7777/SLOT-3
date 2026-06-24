/**
 * Persistence for the Beach Girl gallery.
 *
 * Stake Engine is stateless across rounds and exposes only an ephemeral
 * sessionID (no stable account id), so the only in-game persistence available is
 * the browser. `LocalStorageGalleryStore` is device+browser-bound; this
 * interface is the ONE swap point for an operator-hosted, account-bound store if
 * Stake ever exposes a stable player id (see docs/MATH_DESIGN.md §0, §4).
 *
 * Stores ONLY cosmetic progress — never balance or payout.
 */
import { type GalleryData, emptyGallery, sanitize } from "./collection";

export interface GalleryStore {
  load(): GalleryData;
  save(data: GalleryData): void;
}

const STORAGE_KEY = "heatchase.gallery.v1";

export class LocalStorageGalleryStore implements GalleryStore {
  load(): GalleryData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyGallery();
      return sanitize(JSON.parse(raw) as Partial<GalleryData>);
    } catch {
      return emptyGallery(); // corrupt/blocked storage must never crash the game
    }
  }

  save(data: GalleryData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private-mode / quota / SSR — progress just isn't persisted this session */
    }
  }
}

/** In-memory fallback for tests and any environment without localStorage. */
export class MemoryGalleryStore implements GalleryStore {
  private data: GalleryData = emptyGallery();
  load(): GalleryData {
    return sanitize(this.data);
  }
  save(data: GalleryData): void {
    this.data = data;
  }
}

export function createGalleryStore(): GalleryStore {
  try {
    if (typeof localStorage !== "undefined") return new LocalStorageGalleryStore();
  } catch {
    /* accessing localStorage can throw in sandboxed iframes */
  }
  return new MemoryGalleryStore();
}
