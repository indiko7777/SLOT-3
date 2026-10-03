/** Feature-buy briefing — a cinematic poster card. Prices still come from the RGS mode config. */
import { trackModalClosed, trackModalOpen } from "./modals";
import { attachDialog } from "./dialog";
import { BET_MODES, BONUS_START_RESPINS, MAX_WIN_MULTIPLIER } from "./domain";
import "./confirmPopup.css";

type FeatureAction = "getaway" | "super_getaway";

/**
 * The card is authored at a fixed design size and SCALED to fit the viewport
 * (like the game canvas), so every word, the price and both buttons are always
 * on screen at once — no inner scrolling at any window size. Portrait screens
 * get their own stacked layout.
 */
const DESIGN = {
  landscape: { w: 980, h: 600 },
  portrait: { w: 400, h: 800 },
} as const;

interface PopupCopy {
  isSuper: boolean;
  formattedCost: string;
  currency: string;
  multiplier: number;
  social: boolean;
  rtp: string;
  maxWin: string;
}

const ICON = {
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/><path d="M12 14.4v2.6"/></svg>',
  blast: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.7 4.4 4.1-2.2-1.3 4.6 4.6 1.7-4.4 1.8 2 4.6-4.6-1.9-2.1 4.5-1.8-4.6-4.7 1.6 1.9-4.5L2.9 11l4.6-1.6-1.3-4.6 4.1 2.1z"/></svg>',
};

/** Miami Art Deco corner: stepped gold brackets with a small diamond. */
const DECO_CORNER = '<svg viewBox="0 0 60 60" aria-hidden="true"><path d="M2 58V2h56"/><path d="M8 58V8h50" class="thin"/><path d="M14 30V14h16" class="thin"/><path d="M20 2v6M2 20h6" class="thin"/><rect x="11" y="11" width="6" height="6" transform="rotate(45 14 14)" class="gem"/></svg>';

function letters(word: string): string {
  return [...word].map((c, i) => `<span class="ch" style="--i:${i}" data-c="${c}">${c}</span>`).join("");
}

function motes(n: number): string {
  return Array.from({ length: n }, (_, i) =>
    `<i style="--x:${(i * 41 + 13) % 96 + 2}%;--d:${(i % 7) * 0.9}s;--s:${7 + (i % 5) * 1.6}s;--z:${1 + (i % 3)}px"></i>`
  ).join("");
}

function popupMarkup(c: PopupCopy): string {
  const unitWord = c.social ? "PLAY" : "BET";
  const kicker = c.social ? "FEATURE" : "BONUS BUY";
  const confirmLabel = c.isSuper ? "Confirm Super" : c.social ? "Confirm" : "Confirm Buy";
  const art = c.isSuper ? "assets/popup/super_keyart_v5.webp" : "assets/popup/getaway_keyart_v5.webp";
  const stars = c.isSuper
    ? `<div class="hc-pop-stars" aria-hidden="true">${Array.from({ length: 5 }, (_, i) =>
        `<svg viewBox="0 0 24 24" style="--i:${i}"><path d="m12 1.5 3.3 6.8 7.4 1-5.4 5.3 1.3 7.4L12 18.5 5.4 22l1.3-7.4L1.3 9.3l7.4-1z"/></svg>`).join("")}</div>`
    : "";
  return `
    <div class="hc-pop" role="document">
      <div class="hc-pop-art-wrap" aria-hidden="true">
        <img class="hc-pop-art" src="${art}" alt="" draggable="false" />
      </div>
      <div class="hc-pop-grade" aria-hidden="true"></div>
      <div class="hc-pop-motes" aria-hidden="true">${motes(16)}</div>
      <div class="hc-pop-flare" aria-hidden="true"><i></i></div>
      <div class="hc-pop-grain" aria-hidden="true"></div>
      <div class="hc-pop-flash" aria-hidden="true"></div>
      <div class="hc-pop-frame" aria-hidden="true">
        <span class="tl">${DECO_CORNER}</span><span class="tr">${DECO_CORNER}</span>
        <span class="bl">${DECO_CORNER}</span><span class="br">${DECO_CORNER}</span>
      </div>
      <button class="hc-pop-close" id="hc-btn-close" aria-label="Close"><span>ESC</span><b>✕</b></button>

      <div class="hc-pop-info">
        <div class="hc-pop-kicker"><i></i>${kicker}<i></i></div>
        ${stars}
        <h2 class="hc-pop-title" aria-label="${c.isSuper ? "Super" : "The"} Getaway">
          <span class="lead${c.isSuper ? " hot" : ""}" aria-hidden="true">${c.isSuper ? letters("SUPER") : "THE"}</span>
          <span class="word" aria-hidden="true">${letters("GETAWAY")}</span>
        </h2>
        <div class="hc-pop-tag">WIN UP TO <b>${c.maxWin}×</b> YOUR ${unitWord}</div>
        <p class="hc-pop-desc">${c.isSuper ? "Maximum heat. The richest Gold Bars in the game." : "Skip the chase. Go straight to the Hold &amp; Spin heist."}</p>
        <ul class="hc-pop-feats">
          <li style="--i:0"><span class="hc-pop-medal num">${BONUS_START_RESPINS}</span><div><strong>STARTING SPINS</strong><p>Only an empty spin uses one</p></div></li>
          <li style="--i:1"><span class="hc-pop-medal">${ICON.lock}</span><div><strong>GOLD LOCKS IN</strong><p>${c.isSuper ? "Highest Gold Bar values" : "Boosted Gold Bar values"}</p></div></li>
          <li style="--i:2"><span class="hc-pop-medal">${ICON.blast}</span><div><strong>DYNAMITE ×2</strong><p>Doubles the Gold Bars beside it</p></div></li>
        </ul>
        <p class="hc-pop-rule">At zero spins every locked Gold Bar pays. Fill all 20 cells for the ${c.maxWin}× max win.</p>
      </div>

      <div class="hc-pop-foot">
        <div class="hc-pop-cost">
          <span class="lbl">TOTAL COST</span>
          <span class="val">${c.formattedCost}<small>${c.currency}</small></span>
          <span class="sub">${c.multiplier.toLocaleString("en-US")}× BASE ${unitWord}</span>
        </div>
        <div class="hc-pop-stats">
          <span><small>RTP</small><b>${c.rtp}%</b></span>
          <i></i>
          <span><small>MAX WIN</small><b>${c.maxWin}×</b></span>
        </div>
        <div class="hc-pop-actions">
          <button class="hc-pop-btn cancel" id="hc-btn-cancel">Cancel</button>
          <button class="hc-pop-btn confirm" id="hc-btn-confirm"><span>${confirmLabel}</span></button>
        </div>
      </div>
      <div class="hc-pop-seam" aria-hidden="true"></div>
    </div>`;
}

/** Scale the fixed-size card to the window; switch layout on portrait screens. */
function fitPopup(overlay: HTMLElement): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const portrait = vw < 640 || vh > vw * 1.1;
  const d = portrait ? DESIGN.portrait : DESIGN.landscape;
  const fit = Math.min((vw - 16) / d.w, (vh - 16) / d.h, portrait ? 1.6 : 1.35);
  overlay.classList.toggle("portrait", portrait);
  overlay.style.setProperty("--fit", String(Math.max(0.2, fit)));
}

function copyFor(action: FeatureAction, betAmount: number, currency: string, costMultiplier: number | undefined, social: boolean): PopupCopy {
  const multiplier = costMultiplier ?? BET_MODES[action].priceMultiplier;
  return {
    isSuper: action === "super_getaway",
    formattedCost: (betAmount * multiplier).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    currency,
    multiplier,
    social,
    rtp: (BET_MODES[action].rtpTarget * 100).toFixed(0),
    maxWin: MAX_WIN_MULTIPLIER.toLocaleString("en-US"),
  };
}

/**
 * Draw both cards once, invisibly, while the loader is up. The first time a
 * browser decodes the key art and rasterises these gradients and the display
 * font costs a visible stall — that would otherwise land on the first BUY tap.
 */
export function prewarmConfirmPopups(): void {
  for (const action of ["getaway", "super_getaway"] as const) {
    const el = document.createElement("div");
    el.className = `hc-buy-overlay hc-prewarm show${action === "super_getaway" ? " super" : ""}`;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = popupMarkup(copyFor(action, 1, "USD", undefined, false));
    fitPopup(el);
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2500);
  }
}

export function showConfirmPopup(
  action: FeatureAction,
  betAmount: number,
  /** DISPLAY currency code (already GC/SC-mapped for social casinos). */
  currency: string,
  playAudio: () => void,
  /** Cost multiplier sourced from the RGS bet-mode config (never hardcoded). */
  costMultiplier?: number,
  /** Stake.US social casino — strips every restricted word (buy/bet). */
  social = false
): Promise<boolean> {
  // Single instance: a second confirmation can never stack on an open one.
  const existing = document.querySelector(".hc-buy-overlay:not(.hc-prewarm)");
  if (existing) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const copy = copyFor(action, betAmount, currency, costMultiplier, social);
    const overlay = document.createElement("div");
    overlay.className = `hc-buy-overlay${copy.isSuper ? " super" : ""}`;
    overlay.innerHTML = popupMarkup(copy);
    fitPopup(overlay);
    const onResize = (): void => fitPopup(overlay);
    window.addEventListener("resize", onResize);

    document.body.appendChild(overlay);
    trackModalOpen(); // spacebar must not spin behind the confirmation card

    // Trigger reflow to start transition
    void overlay.offsetHeight;
    overlay.classList.add("show");

    playAudio();

    let closed = false;
    let releaseFocus = () => {};
    const cleanup = (value: boolean): void => {
      if (closed) return;
      closed = true;
      releaseFocus();
      trackModalClosed();
      window.removeEventListener("resize", onResize);
      overlay.classList.remove("show");
      overlay.classList.add(value ? "confirmed" : "leaving");
      setTimeout(() => {
        overlay.remove();
        resolve(value);
      }, value ? 420 : 320);
    };

    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) {
        playAudio();
        cleanup(false);
      }
    });

    releaseFocus = attachDialog(overlay, "Confirm feature play", () => cleanup(false));

    const btnClose = overlay.querySelector("#hc-btn-close") as HTMLButtonElement | null;
    const btnCancel = overlay.querySelector("#hc-btn-cancel") as HTMLButtonElement;
    const btnConfirm = overlay.querySelector("#hc-btn-confirm") as HTMLButtonElement;

    btnClose?.addEventListener("click", () => { playAudio(); cleanup(false); });
    btnCancel.addEventListener("click", () => { playAudio(); cleanup(false); });
    btnConfirm.addEventListener("click", () => { playAudio(); cleanup(true); });
    btnCancel.addEventListener("mouseenter", () => playAudio());
    btnConfirm.addEventListener("mouseenter", () => playAudio());
  });
}
