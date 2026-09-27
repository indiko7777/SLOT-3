/**
 * Which skeletal clip a symbol plays next — pure, so the win → destroy flow can
 * be unit-tested without Pixi.
 *
 * Two rig generations ship side by side:
 *   legacy   — idle / win / destroy (+ drive_off). Win returns to idle; destroy
 *              was authored at half speed and is played 2x. WILD and CAR_WILD
 *              stay on this path untouched.
 *   semantic — adds `hold` (a presented pose the win settles into) and `land`
 *              (object-specific touchdown). Clips are authored at real time.
 *
 * Semantic flow for a symbol that wins and is removed:
 *     win (anticipation → signature action) → hold → destroy
 * and for one that wins but survives the cascade:
 *     win → hold → release → idle   (released by the board, or a safety timer)
 * so a winner is never dumped back to idle for a beat and then destroyed.
 */

export type SkelFlowState = "idle" | "land" | "win" | "hold" | "destroy";

export interface ClipPlan {
  clip: string;
  speed: number;
  loop: boolean;
  /** cross-fade seconds, in clip time */
  mix: number;
  /** 0..1 clip strength */
  weight: number;
  /** forward clip events (sound cues) */
  events: boolean;
}

export interface RigCaps {
  hasHold: boolean;
  hasLand: boolean;
}

export type LandSource = "tumble" | "reel";

/** Semantic rigs: speed multipliers per context (clips are real-time). */
const SEMANTIC_SPEED = { normal: 1, turbo: 1.8 };
/** Legacy rigs: win 1x/2x, destroy authored at half speed → 2x/4x. */
const LEGACY_WIN = { normal: 1, turbo: 2 };
const LEGACY_DESTROY = { normal: 2, turbo: 4 };

/** Reel stops reuse the tumble `land` at reduced strength and stay silent
 *  (the reel-stop sound already covers them; 20 cues at once is noise). */
export const REEL_LAND_WEIGHT = 0.5;

export function isSemantic(caps: RigCaps): boolean {
  return caps.hasHold;
}

export function winPlan(caps: RigCaps, turbo: boolean, timeScale: number): ClipPlan {
  const base = isSemantic(caps) ? SEMANTIC_SPEED : LEGACY_WIN;
  return {
    clip: "win",
    speed: (turbo ? base.turbo : base.normal) * timeScale,
    loop: false,
    mix: isSemantic(caps) ? 0.08 : 0,
    weight: 1,
    events: true,
  };
}

export function holdPlan(timeScale: number): ClipPlan {
  return { clip: "hold", speed: timeScale, loop: true, mix: 0.1, weight: 1, events: false };
}

export function destroyPlan(caps: RigCaps, turbo: boolean, timeScale: number): ClipPlan {
  const base = isSemantic(caps) ? SEMANTIC_SPEED : LEGACY_DESTROY;
  return {
    clip: "destroy",
    speed: (turbo ? base.turbo : base.normal) * timeScale,
    loop: false,
    mix: isSemantic(caps) ? 0.05 : 0,
    weight: 1,
    events: true,
  };
}

export function landPlan(caps: RigCaps, source: LandSource, turbo: boolean, timeScale: number): ClipPlan | null {
  if (!caps.hasLand) return null;
  const base = turbo ? SEMANTIC_SPEED.turbo : SEMANTIC_SPEED.normal;
  return {
    clip: "land",
    speed: base * timeScale,
    loop: false,
    mix: 0.03,
    weight: source === "reel" ? REEL_LAND_WEIGHT : 1,
    events: source === "tumble",
  };
}

export function idlePlan(mix: number): ClipPlan {
  return { clip: "idle", speed: 1, loop: true, mix, weight: 1, events: false };
}

/** Clip-flow state machine. SymbolView executes the ClipPlans it returns. */
export class SymbolFlow {
  state: SkelFlowState = "idle";
  /** release() arrived while the win was still playing — skip the hold. */
  private releaseAfterWin = false;
  constructor(readonly caps: RigCaps) {}

  /** A touchdown reaction may only replace idle (or a previous landing). */
  land(source: LandSource, turbo: boolean, timeScale: number): ClipPlan | null {
    if (this.state !== "idle" && this.state !== "land") return null;
    const plan = landPlan(this.caps, source, turbo, timeScale);
    if (plan) this.state = "land";
    return plan;
  }

  landEnded(): ClipPlan | null {
    if (this.state !== "land") return null;
    this.state = "idle";
    return idlePlan(0.12);
  }

  win(turbo: boolean, timeScale: number): ClipPlan | null {
    if (this.state === "destroy") return null;
    this.state = "win";
    this.releaseAfterWin = false;
    return winPlan(this.caps, turbo, timeScale);
  }

  /** The win clip finished: semantic rigs hold the presented pose; legacy
   *  rigs go straight back to idle exactly as before. */
  winEnded(timeScale: number): ClipPlan | null {
    if (this.state !== "win") return null;
    if (isSemantic(this.caps) && !this.releaseAfterWin) {
      this.state = "hold";
      return holdPlan(timeScale);
    }
    const mix = isSemantic(this.caps) ? 0.25 : 0;
    this.releaseAfterWin = false;
    this.state = "idle";
    return idlePlan(mix);
  }

  /** The symbol survived its win (or nothing removed it): back to idle. */
  release(): ClipPlan | null {
    if (this.state === "win") {
      this.releaseAfterWin = true;
      return null;
    }
    if (this.state !== "hold") return null;
    this.state = "idle";
    return idlePlan(0.25);
  }

  vanish(turbo: boolean, timeScale: number): ClipPlan | null {
    if (this.state === "destroy") return null;
    this.state = "destroy";
    return destroyPlan(this.caps, turbo, timeScale);
  }
}
