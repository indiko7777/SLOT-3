import { formatWin } from "../rgs/client";
import { createWinCount } from "./winCount";
import { getTimeScale } from "./tween";
import { runGetawayExit } from "./getawayExit";
import "./getawayResult.css";

export interface GetawayResultAudio {
  open(): void;
  start(): void;
  progress(value: number): void;
  end(): void;
  cancel(): void;
}

/** Getaway-only payout and exit surface. It remains mounted until the regular
 * game has been restored beneath an opaque veil, including resize/key-up. */
export class GetawayResult {
  private readonly root = document.createElement("section");
  private readonly previousFocus = document.activeElement as HTMLElement | null;
  private readonly veil: HTMLElement;
  private readonly card: HTMLElement;
  private disposed = false;

  constructor() {
    this.root.className = "getaway-result";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Getaway total win");
    this.root.innerHTML = `
      <div class="getaway-result__aura" aria-hidden="true"></div>
      <div class="getaway-result__rays" aria-hidden="true"></div>
      <div class="getaway-result__sparks" aria-hidden="true"></div>
      <div class="getaway-result__card">
        <div class="getaway-result__kicker"><span></span> THE GETAWAY <span></span></div>
        <div class="getaway-result__emblem" aria-hidden="true">
          <div class="getaway-result__halo"></div>
          <img src="assets/gold_bar.webp" alt="" />
          <span class="getaway-result__glint">✦</span>
        </div>
        <h1 class="getaway-result__title"></h1>
        <div class="getaway-result__caption">THE CHASE IS OVER. THE TAKE IS YOURS.</div>
        <div class="getaway-result__payout">
          <div class="getaway-result__label">TOTAL WIN</div>
          <div class="getaway-result__amount"><span class="getaway-result__value">0</span><span class="getaway-result__currency"></span></div>
          <div class="getaway-result__track"><span></span></div>
        </div>
        <div class="getaway-result__receipt"><span class="getaway-result__multiplier"></span><span>BASE BET</span></div>
        <button class="getaway-result__action" type="button">REVEAL TOTAL <span>↗</span></button>
        <div class="getaway-result__shortcut">SPACE / ENTER</div>
      </div>
      <div class="getaway-result__veil" aria-hidden="true"></div>`;
    this.veil = this.find("veil");
    this.card = this.find("card");
    const sparks = this.find("sparks");
    for (let i = 0; i < 26; i++) {
      const spark = document.createElement("i");
      spark.style.cssText = `--x:${(i * 37 + 9) % 100}%;--delay:${-(i % 9) * 0.47}s;--speed:${4 + i % 5}s;--size:${i % 4 === 0 ? 5 : 2}px`;
      sparks.append(spark);
    }
    document.body.append(this.root);
  }

  private find(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`.getaway-result__${name}`)!;
  }

  async present(options: { filled: boolean; totalX: number; bet: number; currency: string; turbo: boolean; autoDismiss: boolean; audio?: GetawayResultAudio }): Promise<void> {
    const { totalX, filled, bet, currency, turbo, autoDismiss, audio } = options;
    const value = this.find("value");
    const action = this.find("action") as HTMLButtonElement;
    const title = filled ? "GRAND ESCAPE" : totalX >= 500 ? "GRAND TAKE" : totalX >= 100 ? "MEGA TAKE" : "GETAWAY WIN";
    this.find("title").textContent = title;
    this.find("currency").textContent = bet > 0 ? currency : "×";
    this.find("multiplier").textContent = `${formatWin(totalX)}×`;
    this.root.dataset.tier = filled || totalX >= 500 ? "grand" : "gold";
    const amount = totalX * (bet > 0 ? bet : 1);
    const finalText = formatWin(amount);
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
      if (event.code === "Tab") { event.preventDefault(); action.focus(); return; }
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) activate();
    };
    action.addEventListener("click", activate);
    // Clicking the payout itself also reveals it; continue is an explicit button.
    const onPayoutClick = (): void => { if (!settled) activate(); };
    this.find("payout").addEventListener("click", onPayoutClick);
    window.addEventListener("keydown", onKey, true);
    action.focus({ preventScroll: true });
    const resize = (): void => {
      const saved = value.textContent;
      value.textContent = finalText;
      value.style.fontSize = "";
      const max = this.find("amount").clientWidth - this.find("currency").offsetWidth - 18;
      if (value.offsetWidth > max && max > 0) {
        value.style.fontSize = `${parseFloat(getComputedStyle(value).fontSize) * max / value.offsetWidth}px`;
      }
      value.textContent = saved;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(this.card);
    resize();
    audio?.open();
    try {
      await this.card.animate([
        { opacity: 0, transform: "translateY(28px) scale(.94)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ], { duration: turbo ? 260 : 520, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }).finished;
      this.root.dataset.phase = "counting";
      action.setAttribute("aria-label", "Counting win. Reveal total win");
      const instant = turbo || skipRequested || amount <= 0;
      counter = createWinCount({
        duration: instant ? 0 : Math.min(4400, 1900 + Math.log10(Math.max(1, totalX)) * 580) / getTimeScale(),
        update: (p) => {
          value.textContent = formatWin(amount * p);
          this.root.style.setProperty("--progress", String(p));
        },
        start: () => audio?.start(),
        progress: (p) => audio?.progress(p),
        end: () => audio?.end(),
        cancel: () => audio?.cancel(),
      });
      await counter.done;
      settled = true;
      if (instant && !dismissed && amount > 0) audio?.end();
      this.root.dataset.phase = "settled";
      action.innerHTML = "BACK TO GAME <span>→</span>";
      action.setAttribute("aria-label", `Total win ${finalText} ${currency}. Back to game`);
      this.find("amount").setAttribute("aria-label", `${finalText} ${currency}`);
      if (autoDismiss && !dismissed) timer = window.setTimeout(dismiss, turbo ? 1300 : 2500);
      await done;
    } finally {
      window.clearTimeout(timer);
      observer.disconnect();
      counter?.cancel();
      window.removeEventListener("keydown", onKey, true);
      action.removeEventListener("click", activate);
      this.find("payout").removeEventListener("click", onPayoutClick);
      action.disabled = true;
      audio?.cancel();
    }
  }

  async exit(turbo: boolean, restore: () => void): Promise<void> {
    this.root.dataset.phase = "leaving";
    await runGetawayExit({
      cover: async () => {
        await Promise.all([
          this.card.animate([{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(-14px) scale(.97)" }], { duration: turbo ? 150 : 280, fill: "forwards", easing: "ease-in" }).finished,
          this.veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: turbo ? 180 : 320, fill: "forwards", easing: "ease-in-out" }).finished,
        ]);
      },
      restore,
      reveal: async () => {
        await this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: turbo ? 280 : 540, fill: "forwards", easing: "cubic-bezier(.22,1,.36,1)" }).finished;
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
