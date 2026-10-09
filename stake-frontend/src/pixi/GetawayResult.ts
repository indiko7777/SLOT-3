import { formatAmount, formatMultiplier } from "../format";
import { exactDecimals, money as currencyMoney } from "../currency";
import { MAX_WIN_MULTIPLIER } from "../domain";
import { createWinCount } from "./winCount";
import { getTimeScale } from "./tween";
import { runGetawayExit } from "./getawayExit";
import "./getawayResult.css";

export interface GetawayResultAudio {
  open(): void;
  start(): void;
  progress(value: number): void;
  tier(level: number): void;
  end(): void;
  exit(): void;
  cancel(): void;
}

/** The win ladder the counter climbs. The total is not simply revealed: it is
 *  PROMOTED through these tiers while it counts, and every promotion fires a
 *  burst, a title change and its own audio stinger. That escalation is the whole
 *  point of this screen — a single settled number has no arc. */
const TIERS = [
  { at: 0, title: "CLEAN GETAWAY" },
  { at: 20, title: "BIG SCORE" },
  { at: 100, title: "MEGA SCORE" },
  { at: 500, title: "GRAND ESCAPE" },
] as const;

/** Every cell filled is the rarest outcome in the feature, so it gets a title of
 *  its own rather than sharing the top tier's — held back until the total lands
 *  so it reads as the last beat rather than as one more promotion. */
const PERFECT = "PERFECT HEIST";
/** The capped jackpot gets its own title at settle, above every tier. */
const MAX_TITLE = "MAX WIN";

const tierFor = (multiplier: number): number => {
  for (let level = TIERS.length - 1; level > 0; level--) {
    if (multiplier >= TIERS[level]!.at) return level;
  }
  return 0;
};

/** The win is MONEY: thousands separators and at least two decimals, but never
 *  rounded — a 0.0115 win shows 0.0115. `decimals` pins the precision for the
 *  whole count-up so the digits don't flicker between 2 and 4 places. */
const money = (amount: number, decimals = exactDecimals(amount, 2)): string =>
  formatAmount(amount, true, decimals);

/** Getaway-only payout and exit surface. It stays mounted until the regular game
 *  has been restored behind an opaque wipe, including across resize and key-up. */
export class GetawayResult {
  private readonly root = document.createElement("section");
  private readonly previousFocus = document.activeElement as HTMLElement | null;
  private level = -1;
  private disposed = false;
  /** Kept from present() so the exit whoosh comes from the same stage that
   *  played the count, and is cancelled by the same cancel(). */
  private audio?: GetawayResultAudio;

  constructor() {
    this.root.className = "getaway-result";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Getaway total win");
    this.root.dataset.phase = "intro";
    this.root.innerHTML = `
      <div class="getaway-result__sky" aria-hidden="true">
        <img class="getaway-result__art" src="assets/popup/payout_keyart_v8.webp" alt="" draggable="false" />
        <div class="getaway-result__grade"></div>
        <div class="getaway-result__streaks"><i></i><i></i><i></i></div>
        <div class="getaway-result__ring"></div>
      </div>
      <div class="getaway-result__loot" aria-hidden="true"></div>
      <div class="getaway-result__stage">
        <div class="getaway-result__kicker"><i></i>THE GETAWAY<i></i></div>
        <div class="getaway-result__band">
          <h1 class="getaway-result__tier"></h1>
          <div class="getaway-result__flash" aria-hidden="true"></div>
        </div>
        <div class="getaway-result__label">TOTAL WIN</div>
        <div class="getaway-result__amount">
          <span class="getaway-result__value">0.00</span><span class="getaway-result__currency"></span>
        </div>
        <div class="getaway-result__rule"><span></span></div>
        <dl class="getaway-result__stats">
          <div class="getaway-result__stat" style="--i:0"><dt>GOLD BARS SECURED</dt><dd data-stat="bars">0</dd></div>
          <div class="getaway-result__stat" style="--i:1"><dt>DYNAMITE DETONATED</dt><dd data-stat="blasts">0</dd></div>
          <div class="getaway-result__stat" style="--i:2"><dt>SPINS SURVIVED</dt><dd data-stat="spins">0</dd></div>
          <div class="getaway-result__stat chip" style="--i:3"><dt>TOTAL MULTIPLIER</dt><dd><b></b></dd></div>
        </dl>
        <button class="getaway-result__cta" type="button"><span>COLLECT</span></button>
        <div class="getaway-result__hint">SPACE / ENTER</div>
      </div>
      <div class="getaway-result__wipe" aria-hidden="true"></div>`;
    this.buildLoot();
    document.body.append(this.root);
  }

  /**
   * Draw the payout screen once, invisibly, at boot. Its first appearance
   * costs the browser a one-off GPU setup (gradient/filter shaders, glyphs)
   * that measured 0.3–1 s of frozen screen right as the Getaway paid out; a
   * second appearance costs nothing. This pays it behind the loader instead.
   */
  static prewarm(): void {
    const r = new GetawayResult();
    Object.assign(r.root.style, { opacity: "0.004", pointerEvents: "none", zIndex: "100000" });
    r.root.setAttribute("aria-hidden", "true");
    r.root.dataset.phase = "counting";
    r.root.dataset.tier = "3";
    r.find("tier").textContent = TIERS[3].title;
    r.find("tier").dataset.text = TIERS[3].title;
    r.find("value").textContent = money(1234.56);
    r.find("currency").textContent = "USD";
    window.setTimeout(() => r.destroy(), 1500);
  }

  private find(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`.getaway-result__${name}`)!;
  }

  /** Bills raining down, tumbling in 3D, with a few neon sparks. Transform /
   *  opacity only, so they keep running on the compositor even while the main
   *  thread rebuilds the base scene. */
  private buildLoot(): void {
    const loot = this.find("loot");
    for (let i = 0; i < 26; i++) {
      const bill = i % 4 !== 3;
      const piece = document.createElement("i");
      piece.className = bill ? "getaway-result__bill" : "getaway-result__spark";
      piece.style.cssText =
        `--x:${(i * 37 + 11) % 100}%;--delay:${-(i % 13) * 0.55}s;` +
        `--speed:${(bill ? 4.6 : 3.4) + (i % 5) * 0.6}s;--size:${bill ? 38 + (i % 4) * 9 : 6 + (i % 3) * 2}px;` +
        `--spin:${i % 2 ? 1 : -1};--drift:${((i * 29) % 90) - 45}px;--hue:${i % 2 ? "#ff4fa8" : "#3fe3ff"}`;
      if (bill) piece.style.backgroundImage = "url(assets/real_bill.webp)";
      loot.append(piece);
    }
  }

  /** Raise the screen to `level`. Only ever moves up: a count never demotes. */
  private promote(level: number, audio?: GetawayResultAudio): void {
    if (level <= this.level) return;
    const opening = this.level < 0;
    this.level = level;
    const tier = this.find("tier");
    this.root.dataset.tier = String(level);
    tier.textContent = TIERS[level]!.title;
    tier.dataset.text = TIERS[level]!.title;
    if (opening) return; // the first title is the screen arriving, not a promotion
    audio?.tier(level);
    tier.animate([
      { transform: "scale(.72)", opacity: 0, filter: "brightness(2.4)" },
      { transform: "scale(1.09)", opacity: 1, offset: 0.55 },
      { transform: "scale(1)", opacity: 1 },
    ], { duration: 460, easing: "cubic-bezier(.16,1,.3,1)" });
    this.burst();
    this.find("flash").animate([
      { transform: "translateX(-120%) skewX(-18deg)", opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: "translateX(120%) skewX(-18deg)", opacity: 0 },
    ], { duration: 520, easing: "cubic-bezier(.3,0,.2,1)" });
    this.find("amount").animate([
      { transform: "scale(1)" }, { transform: "scale(1.085)", offset: 0.3 }, { transform: "scale(1)" },
    ], { duration: 420, easing: "ease-out" });
  }

  /** A shockwave ring out of the centre — fired on promotions and on the total. */
  private burst(): void {
    this.find("ring").animate([
      { transform: "scale(.2)", opacity: 0.9 },
      { transform: "scale(2.1)", opacity: 0 },
    ], { duration: 760, easing: "cubic-bezier(.12,.75,.3,1)" });
  }

  async present(options: {
    filled: boolean; totalX: number; bet: number; currency: string;
    turbo: boolean; autoDismiss: boolean; audio?: GetawayResultAudio;
    /** The heist readout: bars locked, blasts, spins played. */
    stats?: { bars: number; blasts: number; spins: number };
  }): Promise<void> {
    const { totalX, filled, bet, turbo, autoDismiss, audio, stats } = options;
    if (stats) {
      for (const [key, v] of Object.entries(stats)) {
        const el = this.root.querySelector<HTMLElement>(`[data-stat="${key}"]`);
        if (el) el.textContent = String(v);
      }
    } else {
      this.root.querySelectorAll<HTMLElement>(".getaway-result__stat:not(.chip)").forEach((el) => el.remove());
    }
    this.audio = audio;
    const value = this.find("value");
    const chip = this.root.querySelector<HTMLElement>(".getaway-result__stat.chip b")!;
    const cta = this.find("cta") as HTMLButtonElement;
    const stage = this.find("stage");
    const ruleBar = this.find("rule").querySelector("span") as HTMLElement;
    // A zero bet means the screen is showing bare multipliers (replay/preview).
    const asMoney = bet > 0;
    const amount = totalX * (asMoney ? bet : 1);
    // Money carries its own symbol in the active currency's format ("$46.00",
    // "¥4,600", "46.00 SC"); bare multipliers keep the small "×" mark.
    const decimals = asMoney ? exactDecimals(amount) : exactDecimals(amount, 2);
    const fmt = (v: number): string => (asMoney ? currencyMoney(v, decimals) : money(v, decimals));
    const finalText = fmt(amount);
    this.find("currency").textContent = asMoney ? "" : "×";
    this.promote(tierFor(0), audio);

    let counter: ReturnType<typeof createWinCount> | undefined;
    let skipRequested = false;
    let settled = false;
    let dismissed = false;
    let timer = 0;
    let acknowledge!: () => void;
    const done = new Promise<void>((resolve) => { acknowledge = resolve; });
    const dismiss = (): void => {
      if (dismissed) return;
      dismissed = true;
      audio?.cancel();
      acknowledge();
    };
    const activate = (): void => {
      if (settled || skipRequested) { dismiss(); return; }
      skipRequested = true;
      counter?.finish();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === "Tab") { event.preventDefault(); cta.focus(); return; }
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) activate();
    };
    cta.addEventListener("click", activate);
    // Clicking the total reveals it too; COLLECT stays the explicit way out.
    const amountEl = this.find("amount");
    const onAmountClick = (): void => { if (!settled) activate(); };
    amountEl.addEventListener("click", onAmountClick);
    window.addEventListener("keydown", onKey, true);
    cta.focus({ preventScroll: true });

    // Keep the biggest totals inside the stage instead of letting them overflow.
    const fit = (): void => {
      const saved = value.textContent;
      value.textContent = finalText;
      value.style.fontSize = "";
      const room = amountEl.clientWidth - this.find("currency").offsetWidth - 20;
      if (value.offsetWidth > room && room > 0) {
        value.style.fontSize = `${parseFloat(getComputedStyle(value).fontSize) * room / value.offsetWidth}px`;
      }
      value.textContent = saved;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    fit();

    audio?.open();
    try {
      await stage.animate([
        { opacity: 0, transform: "translateY(26px) scale(.93)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ], { duration: turbo ? 240 : 480, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }).finished;

      this.root.dataset.phase = "counting";
      cta.setAttribute("aria-label", "Counting win. Reveal total win");
      const instant = turbo || skipRequested || amount <= 0;
      counter = createWinCount({
        duration: instant ? 0 : Math.min(4600, 2000 + Math.log10(Math.max(1, totalX)) * 620) / getTimeScale(),
        update: (p) => {
          const shownX = totalX * p;
          value.textContent = fmt(amount * p);
          chip.textContent = `${formatMultiplier(Math.round(shownX * 100) / 100, true)}×`;
          // Set on the bar itself: a custom property changed on the ROOT every
          // frame re-styled (and re-rasterised) the whole full-screen backdrop.
          ruleBar.style.transform = `scaleX(${p})`;
          // Promotions land silently when the count was skipped or never ran —
          // end() is already about to play, and four stingers at once is noise.
          this.promote(tierFor(shownX), instant ? undefined : audio);
        },
        start: () => audio?.start(),
        progress: (p) => audio?.progress(p),
        end: () => audio?.end(),
        cancel: () => audio?.cancel(),
      });
      await counter.done;

      settled = true;
      if (instant && !dismissed && amount > 0) audio?.end();
      // The perfect-heist title is held back for the total, so the rarest result
      // gets its own beat instead of arriving partway through the count.
      const maxWin = totalX >= MAX_WIN_MULTIPLIER;
      if (filled || maxWin) {
        const title = maxWin ? MAX_TITLE : PERFECT;
        this.find("tier").textContent = title;
        this.find("tier").dataset.text = title;
        this.root.dataset.perfect = "true";
      }
      this.root.dataset.phase = "settled";
      this.burst();
      cta.innerHTML = "<span>COLLECT</span>";
      cta.setAttribute("aria-label", `Total win ${finalText}${asMoney ? "" : " times"}. Collect and return to the game`);
      amountEl.setAttribute("aria-label", `${finalText}${asMoney ? "" : " times"}`);
      if (autoDismiss && !dismissed) timer = window.setTimeout(dismiss, turbo ? 1400 : 2600);
      await done;
    } finally {
      window.clearTimeout(timer);
      observer.disconnect();
      counter?.cancel();
      window.removeEventListener("keydown", onKey, true);
      cta.removeEventListener("click", activate);
      amountEl.removeEventListener("click", onAmountClick);
      cta.disabled = true;
      audio?.cancel();
    }
  }

  /**
   * Cut back to the street with a wipe rather than a crossfade.
   *
   * A fade has to dissolve two full scenes through each other, which is exactly
   * where the old exit looked cheap — and it happens over the same frames in
   * which the base scene is being rebuilt, so any hitch there showed. The wipe
   * panel is animated with transform only, so it runs on the compositor and
   * stays smooth even if restore() stalls the main thread for a frame.
   */
  async exit(turbo: boolean, restore: () => void): Promise<void> {
    const wipe = this.find("wipe");
    const stage = this.find("stage");
    const cover = turbo ? 230 : 330;
    const reveal = turbo ? 260 : 360;
    this.root.dataset.phase = "leaving";
    this.audio?.exit();
    await runGetawayExit({
      cover: async () => {
        stage.animate([
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(-10px) scale(1.06)" },
        ], { duration: Math.round(cover * 0.62), fill: "forwards", easing: "ease-in" });
        await wipe.animate(
          [{ transform: "translateX(-118%) skewX(-9deg)" }, { transform: "translateX(0) skewX(-9deg)" }],
          { duration: cover, fill: "forwards", easing: "cubic-bezier(.5,0,.35,1)" },
        ).finished;
        // The wipe now covers everything, so the payout's own backdrop can go
        // before the base scene is put back. Anything less leaves the restored
        // game showing through a still-tinted, still-blurred overlay.
        this.root.dataset.phase = "covered";
      },
      restore,
      reveal: async () => {
        await wipe.animate(
          [{ transform: "translateX(0) skewX(-9deg)" }, { transform: "translateX(118%) skewX(-9deg)" }],
          { duration: reveal, fill: "forwards", easing: "cubic-bezier(.4,0,.2,1)" },
        ).finished;
      },
      cleanup: () => this.destroy(),
    });
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}
