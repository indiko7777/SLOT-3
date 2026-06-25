/**
 * Persistence for the Power-Level player_state (points, unlocked cards, consumed
 * head-starts, and the per-tier average-bet thresholds).
 *
 * Stake's RGS is stateless across rounds and exposes only an ephemeral
 * sessionID (no stable account id), so the only in-game persistence is the
 * browser. `LocalStoragePlayerStateStore` is device+browser-bound; this
 * interface is the ONE swap point for an operator-hosted, account-bound store
 * if Stake ever exposes a stable player id (see docs/MATH_DESIGN.md §0, §8).
 *
 * In production this load is performed during /wallet/authenticate init, and a
 * save fires whenever the player_state changes. Stores ONLY cosmetic/progress
 * fields — never balance or payout.
 */
import { type PowerState, emptyPowerState, sanitizePower } from "./powerLevel";

export interface PlayerStateStore {
  load(): PowerState;
  save(data: PowerState): void;
}

const STORAGE_KEY = "heatchase.power.v1";

export class LocalStoragePlayerStateStore implements PlayerStateStore {
  load(): PowerState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyPowerState();
      return sanitizePower(JSON.parse(raw) as Partial<PowerState>);
    } catch {
      return emptyPowerState(); // corrupt/blocked storage must never crash the game
    }
  }

  save(data: PowerState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private-mode / quota / SSR — progress just isn't persisted this session */
    }
  }
}

/** In-memory fallback for tests and any environment without localStorage. */
export class MemoryPlayerStateStore implements PlayerStateStore {
  private data: PowerState = emptyPowerState();
  load(): PowerState {
    return sanitizePower(this.data);
  }
  save(data: PowerState): void {
    this.data = data;
  }
}

export function createPlayerStateStore(): PlayerStateStore {
  try {
    if (typeof localStorage !== "undefined") return new LocalStoragePlayerStateStore();
  } catch {
    /* accessing localStorage can throw in sandboxed iframes */
  }
  return new MemoryPlayerStateStore();
}
