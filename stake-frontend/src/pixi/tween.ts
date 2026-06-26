export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic: Ease = (t) => t * t * t;
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInQuad: Ease = (t) => t * t;
export const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t);

export const easeOutElastic: Ease = (t) => {
  if (t === 0 || t === 1) return t;
  const p = 0.35;
  return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
};

export const easeOutBounce: Ease = (t) => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) { const u = t - 1.5 / 2.75; return 7.5625 * u * u + 0.75; }
  if (t < 2.5 / 2.75) { const u = t - 2.25 / 2.75; return 7.5625 * u * u + 0.9375; }
  const u = t - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
};

export const easeOutBack: Ease = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/**
 * Global animation speed multiplier. 1 = normal; >1 runs every tween/wait faster.
 * "Extra Turbo" sets this above 1 to compress the whole playback uniformly,
 * stacking on top of the per-animation turbo branches. Never <=0.
 */
let timeScale = 1;
export function setTimeScale(scale: number): void {
  timeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
}
export function getTimeScale(): number {
  return timeScale;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms / timeScale));
}

export function tween(duration: number, update: (progress: number) => void, ease: Ease = easeOutCubic): Promise<void> {
  duration = duration / timeScale;
  if (duration <= 0) {
    update(1);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const start = performance.now();

    function frame(now: number): void {
      const raw = Math.min(1, (now - start) / duration);
      update(ease(raw));
      if (raw < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

export class AmbientTicker {
  private running = false;
  private callbacks: Array<(dt: number, elapsed: number) => void> = [];
  private startTime = 0;
  private lastTime = 0;

  add(cb: (dt: number, elapsed: number) => void): void {
    this.callbacks.push(cb);
    if (!this.running) this.start();
  }

  remove(cb: (dt: number, elapsed: number) => void): void {
    this.callbacks = this.callbacks.filter((c) => c !== cb);
    if (!this.callbacks.length) this.running = false;
  }

  clear(): void {
    this.callbacks = [];
    this.running = false;
  }

  private start(): void {
    this.running = true;
    this.startTime = performance.now();
    this.lastTime = this.startTime;
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = (now - this.lastTime) / 1000;
      const elapsed = (now - this.startTime) / 1000;
      this.lastTime = now;
      for (const cb of this.callbacks) cb(dt, elapsed);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

export const ambientTicker = new AmbientTicker();
