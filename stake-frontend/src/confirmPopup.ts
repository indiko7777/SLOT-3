/**
 * GTA loading-screen styled confirmation popup for the Getaway / Super Getaway
 * feature buys. Renders a cinematic "heist briefing" card that matches the
 * in-game Vice-neon aesthetic (Heat Chase logo, wanted stars, magenta/cyan +
 * max-heat orange palette, Impact typography) rather than a generic modal.
 */

// Inject CSS styles once
let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .hc-buy-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      background:
        radial-gradient(ellipse at 50% 38%, rgba(40, 10, 60, 0.55) 0%, rgba(4, 4, 12, 0.92) 60%, rgba(2, 2, 6, 0.97) 100%);
      backdrop-filter: blur(14px) saturate(120%);
      -webkit-backdrop-filter: blur(14px) saturate(120%);
      z-index: 999999;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: 'Impact', 'Arial Narrow', 'Arial Black', 'Helvetica Neue', sans-serif;
      color: #ffffff;
      user-select: none;
    }
    .hc-buy-overlay.show { opacity: 1; }

    /* ── The briefing card ─────────────────────────────────────────────── */
    .hc-buy-card {
      position: relative;
      width: 100%;
      max-width: 700px;
      min-height: 372px;
      border-radius: 18px;
      overflow: hidden;
      isolation: isolate;
      background:
        linear-gradient(155deg, #1a0e33 0%, #120a26 38%, #0a0718 72%, #060410 100%);
      box-shadow:
        0 30px 80px rgba(0, 0, 0, 0.85),
        0 0 0 1px rgba(255, 255, 255, 0.05) inset,
        0 0 60px rgba(255, 45, 149, 0.18);
      transform: scale(0.9) translateY(26px);
      opacity: 0.4;
      transition: transform 0.42s cubic-bezier(0.34, 1.4, 0.5, 1), opacity 0.42s ease;
    }
    .hc-buy-overlay.show .hc-buy-card { transform: scale(1) translateY(0); opacity: 1; }

    .hc-buy-card.super {
      background:
        linear-gradient(155deg, #330f0f 0%, #260a0e 38%, #16060a 72%, #0a0306 100%);
      box-shadow:
        0 30px 80px rgba(0, 0, 0, 0.88),
        0 0 0 1px rgba(255, 255, 255, 0.05) inset,
        0 0 70px rgba(255, 90, 20, 0.26);
    }

    /* Neon edge frame */
    .hc-buy-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 18px;
      padding: 2px;
      background: linear-gradient(135deg, #ff2d95 0%, #b026ff 28%, #16e0ff 60%, #ff2d95 100%);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      mask-composite: exclude;
      opacity: 0.9;
      pointer-events: none;
      z-index: 8;
    }
    .hc-buy-card.super::before {
      background: linear-gradient(135deg, #ff8a1a 0%, #ff3b2f 35%, #ffd23f 65%, #ff3b2f 100%);
    }

    /* Faint perspective city-grid + scanlines for depth */
    .hc-buy-bg {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background-image:
        radial-gradient(circle at 82% 92%, rgba(22, 224, 255, 0.16) 0%, rgba(22, 224, 255, 0) 45%),
        radial-gradient(circle at 12% 8%, rgba(255, 45, 149, 0.18) 0%, rgba(255, 45, 149, 0) 45%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px);
    }
    .hc-buy-card.super .hc-buy-bg {
      background-image:
        radial-gradient(circle at 82% 92%, rgba(255, 210, 63, 0.18) 0%, rgba(255, 210, 63, 0) 45%),
        radial-gradient(circle at 12% 8%, rgba(255, 59, 47, 0.22) 0%, rgba(255, 59, 47, 0) 48%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px);
    }

    /* Slow diagonal light glare sweeping across the card */
    .hc-buy-glare {
      position: absolute;
      top: -60%;
      left: -30%;
      width: 50%;
      height: 220%;
      transform: rotate(18deg);
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent);
      z-index: 6;
      pointer-events: none;
      animation: hc-buy-sweep 5.5s ease-in-out infinite;
    }
    @keyframes hc-buy-sweep {
      0%, 100% { left: -40%; opacity: 0; }
      45% { opacity: 1; }
      90% { left: 130%; opacity: 0; }
    }

    /* Colored backlight behind the character — gives the cut-out a stage glow
       like a GTA loading screen rather than a flat sticker. */
    .hc-buy-rim {
      position: absolute;
      right: -6%;
      bottom: -10%;
      width: 52%;
      height: 120%;
      z-index: 1;
      pointer-events: none;
      background: radial-gradient(ellipse 60% 55% at 60% 45%, rgba(255, 45, 149, 0.4) 0%, rgba(177, 38, 255, 0.22) 38%, rgba(22, 224, 255, 0.06) 62%, transparent 78%);
      filter: blur(6px);
    }
    .hc-buy-card.super .hc-buy-rim {
      background: radial-gradient(ellipse 60% 55% at 60% 45%, rgba(255, 120, 26, 0.45) 0%, rgba(255, 59, 47, 0.26) 40%, rgba(255, 210, 63, 0.08) 64%, transparent 80%);
    }

    /* Character render — GTA loading-screen style, faded and pushed to the
       right edge so it sits behind the art, never crowding the text column. */
    .hc-buy-art {
      position: absolute;
      right: -52%;
      bottom: -3%;
      height: 110%;
      z-index: 3;
      opacity: 0.55;
      pointer-events: none;
      filter: drop-shadow(-8px 12px 26px rgba(0,0,0,0.75)) brightness(1.05) contrast(1.03);
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, transparent 16%, #000 38%);
      mask-image: linear-gradient(90deg, transparent 0%, transparent 16%, #000 38%);
    }
    .hc-buy-card.super .hc-buy-art {
      /* warm the render toward max-heat embers */
      filter: drop-shadow(-8px 12px 26px rgba(0,0,0,0.75)) hue-rotate(-16deg) saturate(118%) brightness(1.06) contrast(1.04);
    }

    /* Legibility scrim behind the text column */
    .hc-buy-scrim {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      background: linear-gradient(90deg, rgba(6,4,16,0.94) 0%, rgba(6,4,16,0.8) 38%, rgba(6,4,16,0.18) 60%, rgba(6,4,16,0) 76%);
    }
    .hc-buy-card.super .hc-buy-scrim {
      background: linear-gradient(90deg, rgba(10,3,6,0.95) 0%, rgba(10,3,6,0.82) 38%, rgba(10,3,6,0.18) 60%, rgba(10,3,6,0) 76%);
    }

    /* Police-light scan strip across the very top */
    .hc-buy-siren {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      z-index: 7;
      background: linear-gradient(90deg, #1453ff 0%, #1453ff 18%, transparent 32%, transparent 68%, #ff1f3a 82%, #ff1f3a 100%);
      opacity: 0.85;
      animation: hc-buy-siren 1.1s steps(2) infinite;
    }
    @keyframes hc-buy-siren { 0% { filter: hue-rotate(0deg); } 50% { transform: scaleX(-1); } 100% { filter: hue-rotate(0deg); } }

    /* ── Content column ────────────────────────────────────────────────── */
    .hc-buy-content {
      position: relative;
      z-index: 5;
      padding: 16px 34px 24px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 13px;
      max-width: 64%;
    }

    .hc-buy-logo {
      height: 102px;
      width: auto;
      margin: 0 0 2px;
      filter: drop-shadow(0 3px 10px rgba(0,0,0,0.7));
      opacity: 0.98;
    }

    .hc-buy-kicker {
      display: flex;
      align-items: center;
      gap: 9px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 3.5px;
      text-transform: uppercase;
      color: #16e0ff;
      text-shadow: 0 0 12px rgba(22, 224, 255, 0.55);
    }
    .hc-buy-card.super .hc-buy-kicker {
      color: #ffb43f;
      text-shadow: 0 0 12px rgba(255, 150, 30, 0.6);
    }
    .hc-buy-kicker::before {
      content: "";
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #ff1f3a;
      box-shadow: 0 0 10px #ff1f3a;
      animation: hc-buy-blip 0.85s ease-in-out infinite alternate;
    }
    @keyframes hc-buy-blip { from { opacity: 0.35; } to { opacity: 1; } }

    .hc-buy-title {
      margin: -4px 0 0;
      font-family: 'Impact', 'Arial Black', sans-serif;
      font-size: clamp(40px, 8vw, 64px);
      line-height: 0.92;
      font-weight: 900;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #ffffff;
      -webkit-text-stroke: 1px rgba(0,0,0,0.35);
      text-shadow:
        0 2px 0 rgba(0,0,0,0.5),
        0 0 22px rgba(255, 45, 149, 0.55),
        0 0 44px rgba(177, 38, 255, 0.35);
    }
    .hc-buy-title .lead { display: block; font-size: 0.46em; letter-spacing: 6px; color: #ff2d95; text-shadow: 0 0 16px rgba(255,45,149,0.7); }
    .hc-buy-card.super .hc-buy-title {
      text-shadow:
        0 2px 0 rgba(0,0,0,0.5),
        0 0 24px rgba(255, 90, 20, 0.65),
        0 0 50px rgba(255, 40, 40, 0.4);
    }
    .hc-buy-card.super .hc-buy-title .lead { color: #ff7a1a; text-shadow: 0 0 16px rgba(255,122,26,0.75); }

    /* Wanted stars */
    .hc-buy-stars { display: flex; gap: 7px; margin: 2px 0 2px; }
    .hc-buy-stars svg { width: 26px; height: 26px; display: block; }
    .hc-buy-stars .lit path {
      fill: #ffcf40;
      stroke: #fff0b8;
      stroke-width: 6;
      filter: drop-shadow(0 0 6px rgba(255, 199, 64, 0.85));
      animation: hc-buy-star 1.6s ease-in-out infinite alternate;
    }
    .hc-buy-stars .dim path { fill: rgba(255,255,255,0.06); stroke: rgba(255,255,255,0.2); stroke-width: 6; }
    @keyframes hc-buy-star { from { transform: scale(0.94); } to { transform: scale(1.06); } }
    .hc-buy-stars .lit { transform-origin: center; transform-box: fill-box; }

    /* Cost block */
    .hc-buy-cost {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 12px 18px;
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(0,0,0,0.5), rgba(0,0,0,0.28));
      border: 1px solid rgba(255,255,255,0.1);
      border-left: 3px solid #4ee06a;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    }
    .hc-buy-card.super .hc-buy-cost { border-left-color: #ff9a2a; }
    .hc-buy-cost-mult {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #9fb4d0;
      white-space: nowrap;
    }
    .hc-buy-cost-val {
      font-family: 'Impact', 'Arial Black', sans-serif;
      font-size: clamp(26px, 5vw, 36px);
      font-weight: 900;
      letter-spacing: 0.5px;
      color: #4ee06a;
      text-shadow: 0 0 18px rgba(78, 224, 106, 0.5);
      white-space: nowrap;
    }

    .hc-buy-desc {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.55;
      letter-spacing: 0.3px;
      color: #b9c4d6;
      max-width: 340px;
    }

    /* ── Actions ───────────────────────────────────────────────────────── */
    .hc-buy-actions {
      position: relative;
      z-index: 5;
      display: flex;
      gap: 12px;
      padding: 0 34px 30px;
      max-width: 72%;
    }
    .hc-buy-btn {
      flex: 1;
      border: none;
      border-radius: 11px;
      padding: 16px 18px;
      cursor: pointer;
      font-family: 'Impact', 'Arial Black', sans-serif;
      font-size: 19px;
      font-weight: 900;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      transition: transform 0.14s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s ease, filter 0.2s ease;
      outline: none;
    }
    .hc-buy-btn:active { transform: translateY(1px) scale(0.985); }

    .hc-buy-btn.cancel {
      flex: 0 0 34%;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.16);
      color: #c7d2e2;
    }
    .hc-buy-btn.cancel:hover {
      background: rgba(255,255,255,0.09);
      color: #ffffff;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.22) inset;
    }

    .hc-buy-btn.confirm {
      color: #ffffff;
      background: linear-gradient(120deg, #ff2d95 0%, #b026ff 52%, #16e0ff 100%);
      box-shadow: 0 8px 22px rgba(255, 45, 149, 0.35), 0 0 0 1px rgba(255,255,255,0.12) inset;
      text-shadow: 0 1px 3px rgba(0,0,0,0.4);
    }
    .hc-buy-btn.confirm:hover {
      filter: brightness(1.12) saturate(1.1);
      box-shadow: 0 10px 30px rgba(255, 45, 149, 0.5), 0 0 0 1px rgba(255,255,255,0.2) inset;
    }
    .hc-buy-card.super .hc-buy-btn.confirm {
      background: linear-gradient(120deg, #ff7a1a 0%, #ff3b2f 55%, #ffd23f 100%);
      box-shadow: 0 8px 22px rgba(255, 90, 20, 0.4), 0 0 0 1px rgba(255,255,255,0.12) inset;
    }
    .hc-buy-card.super .hc-buy-btn.confirm:hover {
      box-shadow: 0 10px 30px rgba(255, 90, 20, 0.55), 0 0 0 1px rgba(255,255,255,0.2) inset;
    }

    @media (max-width: 540px) {
      .hc-buy-content { max-width: 84%; padding: 24px 24px 20px; }
      .hc-buy-actions { max-width: 100%; padding: 0 24px 24px; }
      .hc-buy-art { opacity: 0.45; height: 96%; }
      .hc-buy-desc { max-width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

/** Sharp 5-point GTA wanted star as inline SVG (lit or dim). */
function starSvg(lit: boolean): string {
  const cls = lit ? "lit" : "dim";
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><g class="${cls}"><path d="M50 4 L61 38 L97 38 L68 60 L79 95 L50 73 L21 95 L32 60 L3 38 L39 38 Z"/></g></svg>`;
}

export function showConfirmPopup(
  action: "buy" | "super_buy",
  betAmount: number,
  currency: string,
  playAudio: () => void,
  /** Cost multiplier sourced from the RGS bet-mode config (never hardcoded). */
  costMultiplier?: number
): Promise<boolean> {
  injectStyles();

  return new Promise<boolean>((resolve) => {
    const multiplier = costMultiplier ?? (action === "super_buy" ? 500 : 100);
    const totalCost = betAmount * multiplier;

    const formattedCost = totalCost.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const isSuper = action === "super_buy";
    const cardClass = isSuper ? "hc-buy-card super" : "hc-buy-card";
    const kicker = isSuper ? "MAXIMUM HEAT · ALL-IN" : "HEIST BRIEFING · BUY FEATURE";
    const titleLead = isSuper ? "SUPER" : "BUY";
    const titleMain = "GETAWAY";

    const description = isSuper
      ? "Skip the chase and force the highest-heat Getaway — the richest escape routes and top multipliers are locked in from the first spin."
      : "Skip the build-up and drop straight into the Getaway bonus. The heist triggers instantly the moment you confirm.";

    // Wanted-level rating — 3 stars for a standard buy, 5 for the super.
    const litCount = isSuper ? 5 : 3;
    let starsHtml = "";
    for (let i = 0; i < 5; i++) starsHtml += starSvg(i < litCount);

    const overlay = document.createElement("div");
    overlay.className = "hc-buy-overlay";

    overlay.innerHTML = `
      <div class="${cardClass}">
        <div class="hc-buy-bg"></div>
        <div class="hc-buy-rim"></div>
        <img class="hc-buy-art" src="/assets/getaway_car_scene.webp" alt="" draggable="false" />
        <div class="hc-buy-scrim"></div>
        <div class="hc-buy-glare"></div>
        <div class="hc-buy-siren"></div>
        <div class="hc-buy-content">
          <img class="hc-buy-logo" src="/assets/Heat%20Chase%20Logo.webp" alt="Heat Chase" draggable="false" />
          <div class="hc-buy-kicker">${kicker}</div>
          <h2 class="hc-buy-title"><span class="lead">${titleLead}</span>${titleMain}</h2>
          <div class="hc-buy-stars">${starsHtml}</div>
          <div class="hc-buy-cost">
            <span class="hc-buy-cost-mult">${multiplier.toLocaleString("en-US")}× BET</span>
            <span class="hc-buy-cost-val">$${formattedCost} ${currency}</span>
          </div>
          <p class="hc-buy-desc">${description}</p>
        </div>
        <div class="hc-buy-actions">
          <button class="hc-buy-btn cancel" id="hc-btn-cancel">Cancel</button>
          <button class="hc-buy-btn confirm" id="hc-btn-confirm">${isSuper ? "Go All-In" : "Confirm Buy"}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger reflow to start transition
    void overlay.offsetHeight;
    overlay.classList.add("show");

    // Play initial prompt audio
    playAudio();

    const cleanup = (value: boolean): void => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        resolve(value);
      }, 300);

      // Clean up key listeners
      window.removeEventListener("keydown", handleKeyDown);
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        playAudio();
        cleanup(false);
      } else if (e.key === "Enter") {
        playAudio();
        cleanup(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const btnCancel = overlay.querySelector("#hc-btn-cancel") as HTMLButtonElement;
    const btnConfirm = overlay.querySelector("#hc-btn-confirm") as HTMLButtonElement;

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
