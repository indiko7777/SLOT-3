/** Miami night-chase feature briefing. Prices still come from the RGS mode config. */
import { trackModalClosed, trackModalOpen } from "./modals";
import { attachDialog } from "./dialog";
import { BET_MODES, BONUS_START_RESPINS, MAX_WIN_MULTIPLIER } from "./domain";
import "./confirmPopup.css";

export function showConfirmPopup(
  action: "getaway" | "super_getaway",
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
  const existing = document.querySelector(".hc-buy-overlay");
  if (existing) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const multiplier = costMultiplier ?? BET_MODES[action].priceMultiplier;
    const totalCost = betAmount * multiplier;

    const formattedCost = totalCost.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const isSuper = action === "super_getaway";
    const cardClass = isSuper ? "hc-buy-card super" : "hc-buy-card";
    const titleLead = isSuper ? "SUPER" : "THE";
    const titleMain = "GETAWAY";
    const unitWord = social ? "PLAY" : "BET";
    const confirmLabel = social ? "Confirm" : "Confirm Buy";

    const variant = isSuper ? "HIGHEST GOLD BAR VALUE TABLE" : "INCREASED GOLD BAR VALUES";
    const maxWin = MAX_WIN_MULTIPLIER.toLocaleString("en-US");
    const rtp = (BET_MODES[action].rtpTarget * 100).toFixed(0);

    const overlay = document.createElement("div");
    overlay.className = "hc-buy-overlay";

    overlay.innerHTML = `
      <div class="${cardClass}">
        <div class="hc-buy-scroll">
          <div class="hc-buy-hero">
            <button class="hc-buy-close" id="hc-btn-close" aria-label="Close"><span class="hc-buy-esc-tag">Esc</span> ✕</button>
            <img class="hc-buy-art" src="assets/miami_daylight_gameplay_v2.webp" alt="" draggable="false" />
            <div class="hc-buy-truck" aria-hidden="true">
              <div class="hc-buy-cargo"><img src="assets/gold_bar.webp" alt="" draggable="false" /></div>
              <img class="hc-buy-truck-frame" src="assets/brinks_truck_frame.webp" alt="" draggable="false" />
              <div class="hc-buy-police-light"></div>
            </div>
            <div class="hc-buy-scrim"></div>
            <div class="hc-buy-brand">
              <img class="hc-buy-logo" src="assets/Heat%20Chase%20Logo.webp" alt="Heat Chase" draggable="false" />
              <span class="hc-buy-edition">GRAND<br />ESCAPE</span>
            </div>
            <div class="hc-buy-heading">
              <div class="hc-buy-kicker">ARMORED TRUCK CHASE</div>
              <h2 class="hc-buy-title"><span class="lead">${titleLead} </span>${titleMain}</h2>
            </div>
          </div>
          <div class="hc-buy-body">
            <div class="hc-buy-intro">
              <p class="hc-buy-desc"><strong>The chase starts here.</strong>Enter the Hold &amp; Spin feature directly. Lock the loot as the police close in.</p>
              <div class="hc-buy-variant">${variant}</div>
            </div>
            <ul class="hc-buy-facts">
              <li><span class="hc-buy-number">${BONUS_START_RESPINS}</span><div><strong>STARTING SPINS</strong><p>Only an empty spin uses one.</p></div></li>
              <li><img src="assets/gold_bar.webp" alt="" draggable="false" /><div><strong>LOCK THE GOLD</strong><p>Gold Bars stay in place until the chase ends.</p></div></li>
              <li><img src="assets/dynamite.webp" alt="" draggable="false" /><div><strong>DYNAMITE DOUBLES</strong><p>Doubles adjacent Gold Bars, then clears its cell.</p></div></li>
            </ul>
            <p class="hc-buy-finish">At zero spins, all locked Gold Bar values are paid. Fill all 20 cells for the ${maxWin}× maximum win.</p>
          </div>
        </div>
        <div class="hc-buy-footer">
          <div class="hc-buy-cost">
            <div><span class="hc-buy-cost-label">TOTAL COST</span><span class="hc-buy-cost-val">${formattedCost} ${currency}</span></div>
            <span class="hc-buy-cost-mult">${multiplier.toLocaleString("en-US")}× BASE ${unitWord}</span>
          </div>
          <div class="hc-buy-actions">
            <button class="hc-buy-btn cancel" id="hc-btn-cancel">Cancel</button>
            <button class="hc-buy-btn confirm" id="hc-btn-confirm">${isSuper ? "Confirm Super" : confirmLabel}</button>
          </div>
          <div class="hc-buy-disclosure">
            <span><b>${rtp}%</b> RTP</span><span>MAX WIN <b>${maxWin}×</b> BASE ${unitWord}</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    trackModalOpen(); // spacebar must not spin behind the confirmation card

    // Trigger reflow to start transition
    void overlay.offsetHeight;
    overlay.classList.add("show");

    // Play initial prompt audio
    playAudio();

    let closed = false;
    let releaseFocus = () => {};
    const cleanup = (value: boolean): void => {
      if (closed) return;
      closed = true;
      releaseFocus();
      trackModalClosed();
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        resolve(value);
      }, 300);

      // Clean up key listeners

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

    btnClose?.addEventListener("click", () => {
      playAudio();
      cleanup(false);
    });

    btnCancel.addEventListener("click", () => {
      playAudio();
      cleanup(false);
    });

    btnConfirm.addEventListener("click", () => {
      playAudio();
      cleanup(true);
    });

    btnCancel.addEventListener("mouseenter", () => {
      playAudio();
    });

    btnConfirm.addEventListener("mouseenter", () => {
      playAudio();
    });
  });
}
