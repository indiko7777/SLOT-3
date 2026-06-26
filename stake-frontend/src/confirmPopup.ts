/**
 * GTA-themed confirmation popup dialog for feature buys.
 * Appends a highly stylized HTML/CSS modal onto the page.
 */

// Inject CSS styles once
let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .gta-confirm-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, rgba(16, 20, 36, 0.85) 0%, rgba(5, 7, 16, 0.98) 100%);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 999999;
      opacity: 0;
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: 'Impact', 'Arial Black', 'Helvetica Neue', sans-serif;
      color: #ffffff;
      user-select: none;
    }
    
    .gta-confirm-overlay.show {
      opacity: 1;
    }
    
    .gta-confirm-card {
      width: 90%;
      max-width: 500px;
      background: linear-gradient(135deg, #0e111a 0%, #05060b 100%);
      border: 4px solid #1f2538;
      border-radius: 16px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(255, 106, 0, 0.12);
      overflow: hidden;
      position: relative;
      transform: scale(0.85) translateY(30px);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      text-align: center;
    }
    
    .gta-confirm-overlay.show .gta-confirm-card {
      transform: scale(1) translateY(0);
    }
    
    .gta-confirm-header {
      padding: 20px 24px;
      text-transform: uppercase;
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 4px;
      background: repeating-linear-gradient(
        -45deg,
        #121727,
        #121727 12px,
        #1d243c 12px,
        #1d243c 24px
      );
      border-bottom: 4px solid #ffd95c;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
    }
    
    .gta-confirm-header.super {
      border-bottom-color: #ff6a00;
      text-shadow: 0 0 15px rgba(255, 106, 0, 0.6);
    }
    
    .gta-confirm-header .strobe-light {
      width: 14px;
      height: 14px;
      background: #ff1f2e;
      border-radius: 50%;
      box-shadow: 0 0 12px #ff1f2e;
      animation: gta-strobe-pulse 0.4s infinite alternate;
    }
    
    @keyframes gta-strobe-pulse {
      from { opacity: 0.3; transform: scale(0.85); }
      to { opacity: 1; transform: scale(1.1); }
    }
    
    .gta-confirm-content {
      padding: 36px 30px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }
    
    .gta-confirm-title {
      font-size: 34px;
      margin: 0;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 3px;
      color: #ffffff;
      text-shadow: 0 3px 6px rgba(0, 0, 0, 0.6);
    }
    
    .gta-confirm-cost-box {
      background: rgba(0, 0, 0, 0.6);
      border: 2px dashed #303b58;
      padding: 16px 28px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 85%;
      box-sizing: border-box;
      box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
    }
    
    .gta-confirm-cost-mult {
      font-size: 15px;
      color: #9fb4d0;
      text-transform: uppercase;
      letter-spacing: 2px;
      font-family: system-ui, -apple-system, sans-serif;
      font-weight: 600;
    }
    
    .gta-confirm-cost-val {
      font-size: 46px;
      color: #52e034;
      text-shadow: 0 0 16px rgba(82, 224, 52, 0.5);
      font-weight: 900;
      letter-spacing: 1.5px;
    }
    
    .gta-confirm-stars {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin: 8px 0;
    }
    
    .gta-confirm-stars span {
      font-size: 30px;
      color: #ffd95c;
      text-shadow: 0 0 10px rgba(255, 217, 92, 0.8);
      animation: gta-star-glow 1.5s infinite alternate;
    }
    
    .gta-confirm-stars span.empty {
      color: #1f2538;
      text-shadow: none;
      animation: none;
    }
    
    @keyframes gta-star-glow {
      from { transform: scale(1); filter: brightness(1); }
      to { transform: scale(1.1); filter: brightness(1.3); }
    }
    
    .gta-confirm-msg {
      font-size: 14px;
      font-family: system-ui, -apple-system, sans-serif;
      color: #8c9cb3;
      line-height: 1.6;
      margin: 0;
      letter-spacing: 0.5px;
      max-width: 90%;
    }
    
    .gta-confirm-actions {
      display: flex;
      width: 100%;
      border-top: 4px solid #1f2538;
    }
    
    .gta-confirm-btn {
      flex: 1;
      background: transparent;
      border: none;
      color: #ffffff;
      font-family: 'Impact', 'Arial Black', sans-serif;
      font-size: 22px;
      font-weight: 900;
      padding: 22px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 4px;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      outline: none;
    }
    
    .gta-confirm-btn.cancel {
      border-right: 4px solid #1f2538;
      color: #ff5555;
    }
    
    .gta-confirm-btn.cancel:hover {
      background: rgba(255, 85, 85, 0.12);
      color: #ff3333;
      text-shadow: 0 0 10px rgba(255, 85, 85, 0.4);
    }
    
    .gta-confirm-btn.confirm {
      color: #52e034;
    }
    
    .gta-confirm-btn.confirm:hover {
      background: rgba(82, 224, 52, 0.18);
      color: #66f048;
      text-shadow: 0 0 15px rgba(82, 224, 52, 0.6);
    }
  `;
  document.head.appendChild(style);
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
    const headerClass = isSuper ? "gta-confirm-header super" : "gta-confirm-header";
    const titleText = isSuper ? "SUPER GETAWAY BUY" : "GETAWAY BUY";
    
    const description = isSuper
      ? "LAUNCH MAXIMUM FORCE HEIST. INTEL INDICATES HIGHEST MULTIPLIERS FOR MAXIMUM ESCAPE VELOCITY."
      : "INITIATE TACTICAL GETAWAY CHASE. SECURE THE TRUCK'S CARGO BEFORE POLICE INTERCEPT.";

    // Stars rating visualization
    const starCount = isSuper ? 5 : 3;
    let starsHtml = "";
    for (let i = 0; i < 5; i++) {
      if (i < starCount) {
        starsHtml += "<span>★</span>";
      } else {
        starsHtml += "<span class='empty'>★</span>";
      }
    }

    const overlay = document.createElement("div");
    overlay.className = "gta-confirm-overlay";

    overlay.innerHTML = `
      <div class="gta-confirm-card">
        <div class="${headerClass}">
          <div class="strobe-light"></div>
          CONFIRM TRANSACTION
          <div class="strobe-light"></div>
        </div>
        <div class="gta-confirm-content">
          <h2 class="gta-confirm-title">${titleText}</h2>
          <div class="gta-confirm-stars">
            ${starsHtml}
          </div>
          <div class="gta-confirm-cost-box">
            <span class="gta-confirm-cost-mult">${multiplier}.00x Bet</span>
            <span class="gta-confirm-cost-val">$${formattedCost} ${currency}</span>
          </div>
          <p class="gta-confirm-msg">${description}</p>
        </div>
        <div class="gta-confirm-actions">
          <button class="gta-confirm-btn cancel" id="gta-btn-cancel">Cancel</button>
          <button class="gta-confirm-btn confirm" id="gta-btn-confirm">Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger reflow to start transition
    overlay.offsetHeight;
    overlay.classList.add("show");

    // Play initial prompt audio
    playAudio();

    const cleanup = (value: boolean): void => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        resolve(value);
      }, 250);
      
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

    const btnCancel = overlay.querySelector("#gta-btn-cancel") as HTMLButtonElement;
    const btnConfirm = overlay.querySelector("#gta-btn-confirm") as HTMLButtonElement;

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
