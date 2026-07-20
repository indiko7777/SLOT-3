/**
 * Shared DOM modals: interrupted-round resume, replay intro/finish, and the
 * RGS error toast. Styled to match the GTA V Settings Menu (full-screen pause menu
 * layout, translucent black bars, white accent lines, desaturated backdrop blur).
 * All strings are passed in by the caller so social-mode terminology stays
 * centralised in domain.ts.
 */

const FONT = `'Archivo Narrow','Arial Narrow','Helvetica Neue',Helvetica,Arial,sans-serif`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
  .hc-modal-overlay{position:fixed;inset:0;z-index:100002;display:flex;flex-direction:column;
    --gx:clamp(16px,6vw,110px);
    background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.78) 100%);
    backdrop-filter:blur(7px) saturate(.25) brightness(.8);
    -webkit-backdrop-filter:blur(7px) saturate(.25) brightness(.8);
    opacity:0;transition:opacity .15s ease-out;
    font-family:${FONT};color:#fff;user-select:none;-webkit-user-select:none;}
  .hc-modal-overlay.show{opacity:1;}
  
  .gta-modal-head{padding:clamp(12px,3.5vh,30px) var(--gx) 10px;flex-shrink:0;}
  .gta-modal-title{font-size:clamp(28px,5.5vw,46px);font-weight:700;line-height:1;
    text-transform:uppercase;letter-spacing:.5px;text-shadow:0 2px 10px rgba(0,0,0,.8);}
  
  .gta-modal-bar{display:flex;gap:clamp(16px,3.5vw,30px);border-bottom:2px solid rgba(255,255,255,.95);
    padding:0 var(--gx);flex-shrink:0;height:4px;}
  
  .gta-modal-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 0 24px;
    scrollbar-width:none;min-height:0;}
  .gta-modal-scroll::-webkit-scrollbar{display:none;}
  
  .gta-modal-sep{font-size:clamp(11.5px,2.4vw,13px);letter-spacing:2.5px;text-transform:uppercase;font-weight:600;
    color:rgba(255,255,255,.6);background:rgba(0,0,0,.72);padding:8px var(--gx);margin-top:12px;}
  .gta-modal-scroll > .gta-modal-sep:first-child{margin-top:0;}
  
  .gta-modal-row{display:flex;align-items:center;justify-content:space-between;gap:16px;
    background:rgba(0,0,0,.52);padding:12px var(--gx);margin-top:2px;
    font-size:clamp(15px,3vw,17.5px);font-weight:500;color:#e6e6e6;letter-spacing:.2px;}
  
  .gta-modal-stat{font-size:clamp(16px,3vw,20px);font-weight:700;letter-spacing:.5px;text-align:right;flex-shrink:0;}
  
  .gta-modal-text{background:rgba(0,0,0,.38);padding:14px var(--gx);margin-top:2px;
    font-size:clamp(13px,2.6vw,14.5px);line-height:1.6;color:#bcbcbc;letter-spacing:.2px;}
  
  .gta-modal-desc{background:rgba(0,0,0,.66);border-top:2px solid rgba(255,255,255,.9);
    padding:11px var(--gx);font-size:clamp(12.5px,2.6vw,14px);line-height:1.5;color:#bcbcbc;
    min-height:46px;letter-spacing:.2px;flex-shrink:0;}
  
  .gta-modal-actions{display:flex;gap:16px;padding:14px var(--gx) 16px;background:rgba(0,0,0,.52);margin-top:2px;
    border-top:1px solid rgba(255,255,255,.15);flex-shrink:0;}
  
  .hc-modal-btn{flex:1;background:rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.25);border-radius:6px;
    color:#e6e6e6;font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:1.5px;
    padding:14px 12px;cursor:pointer;text-transform:uppercase;transition:all .15s ease-out;outline:none;}
  .hc-modal-btn:hover{background:#f2f2f2;color:#000;border-color:#f2f2f2;box-shadow:0 4px 15px rgba(255,255,255,.2);}
  .hc-modal-btn.primary{border-color:#9ae64e;background:rgba(154,230,78,.2);color:#ffffff;
    box-shadow:0 0 14px rgba(154,230,78,.3);}
  .hc-modal-btn.primary:hover{background:#9ae64e;color:#000;border-color:#9ae64e;box-shadow:0 0 20px rgba(154,230,78,.6);}
  
  .gta-modal-hints{display:flex;justify-content:flex-end;gap:20px;padding:8px var(--gx) 12px;flex-shrink:0;
    font-size:clamp(11px,2.2vw,12.5px);letter-spacing:1px;color:rgba(255,255,255,.6);text-transform:uppercase;
    flex-wrap:wrap;}
  .gta-key{display:inline-block;border:1px solid rgba(255,255,255,.55);border-radius:3px;
    padding:1px 6px;margin-right:6px;font-size:11px;color:#fff;}
  
  .hc-toast{position:fixed;left:50%;bottom:118px;transform:translateX(-50%) translateY(16px);
    z-index:100003;background:rgba(0,0,0,.96);border:2px solid #ff5252;border-radius:0;
    color:#ffffff;font-family:${FONT};font-size:16px;font-weight:700;
    letter-spacing:1.2px;padding:14px 26px;text-transform:uppercase;opacity:0;
    transition:opacity .25s ease,transform .25s ease;pointer-events:none;max-width:86vw;text-align:center;
    box-shadow:0 12px 30px rgba(0,0,0,.8),0 0 24px rgba(255,82,82,.3);}
  .hc-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  `;
  document.head.appendChild(s);
}

export interface ModalButton {
  key: string;
  label: string;
  primary?: boolean;
}

export interface ModalSpec {
  title: string;
  /** Label/value rows (e.g. Base Play → 1.00 USD). */
  lines?: Array<{ label: string; value: string }>;
  /** Free-flowing explanation paragraph. */
  text?: string;
  buttons: ModalButton[];
}

/** How many choice modals are currently open (spacebar/shortcut guard). */
let openModals = 0;
export function isModalOpen(): boolean {
  return openModals > 0;
}
/** For popups managed outside this module (e.g. the feature confirm card). */
export function trackModalOpen(): void {
  openModals += 1;
}
export function trackModalClosed(): void {
  openModals = Math.max(0, openModals - 1);
}

/**
 * Determine text color for modal row values:
 * - Multiplier values (ending with 'x'): RED (#ff5252) when equal to 0, GREEN (#4ee06a) when > 0.
 * - Currency / USD values: Always GREEN (#4ee06a).
 * - Other strings (e.g. Mode names): White (#ffffff).
 */
function getValueColor(valStr: string): string {
  const trimmed = valStr.trim();
  if (/^[\d.]+\s*x$/i.test(trimmed)) {
    const num = parseFloat(trimmed);
    if (isNaN(num) || num <= 0) {
      return "#ff5252"; // RED when equal to 0
    }
    return "#4ee06a"; // GREEN when over 0
  }
  // If value contains digits (e.g. 1 USD, 0.00 USD, $100), it's a monetary/currency value -> ALWAYS GREEN
  if (/[\d.]/.test(trimmed)) {
    return "#4ee06a";
  }
  return "#ffffff";
}

/** Show a blocking choice modal in full-screen GTA V Pause Menu style; resolves with picked button key. */
export function showChoiceModal(spec: ModalSpec, playClick?: () => void): Promise<string> {
  injectStyle();
  openModals += 1;
  return new Promise<string>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "hc-modal-overlay";

    // 1) Top GTA Head & Title
    const head = document.createElement("div");
    head.className = "gta-modal-head";
    const title = document.createElement("div");
    title.className = "gta-modal-title";
    title.textContent = "Heat Chase";
    head.appendChild(title);
    overlay.appendChild(head);

    // 2) Top accent underline bar
    const bar = document.createElement("div");
    bar.className = "gta-modal-bar";
    overlay.appendChild(bar);

    // 3) Scrollable content area (GTA-style section & rows)
    const scroll = document.createElement("div");
    scroll.className = "gta-modal-scroll";

    const sep = document.createElement("div");
    sep.className = "gta-modal-sep";
    sep.textContent = spec.title;
    scroll.appendChild(sep);

    for (const line of spec.lines ?? []) {
      const row = document.createElement("div");
      row.className = "gta-modal-row";
      const label = document.createElement("span");
      label.textContent = line.label;
      const value = document.createElement("span");
      value.className = "gta-modal-stat";
      value.textContent = line.value;
      value.style.color = getValueColor(line.value);
      row.append(label, value);
      scroll.appendChild(row);
    }

    if (spec.text) {
      const textBlock = document.createElement("div");
      textBlock.className = "gta-modal-text";
      textBlock.textContent = spec.text;
      scroll.appendChild(textBlock);
    }
    overlay.appendChild(scroll);

    // 4) GTA-style description box
    const desc = document.createElement("div");
    desc.className = "gta-modal-desc";
    desc.textContent = spec.text ? spec.text : spec.title;
    overlay.appendChild(desc);

    // 5) Action buttons container
    const actions = document.createElement("div");
    actions.className = "gta-modal-actions";

    const finish = (key: string): void => {
      openModals = Math.max(0, openModals - 1);
      overlay.classList.remove("show");
      window.setTimeout(() => overlay.remove(), 160);
      resolve(key);
    };

    for (const btn of spec.buttons) {
      const b = document.createElement("button");
      b.className = `hc-modal-btn${btn.primary ? " primary" : ""}`;
      b.textContent = btn.label;
      b.addEventListener("click", () => {
        playClick?.();
        finish(btn.key);
      });
      actions.appendChild(b);
    }
    overlay.appendChild(actions);

    // 6) Keyboard hints footer
    const hints = document.createElement("div");
    hints.className = "gta-modal-hints";
    hints.innerHTML = `<span><span class="gta-key">Esc</span>Back</span>`;
    overlay.appendChild(hints);

    document.body.appendChild(overlay);
    overlay.offsetHeight; // reflow for the transition
    overlay.classList.add("show");
  });
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;

/** Non-blocking error/status toast above the control bar. */
export function showToast(message: string, ms = 3200): void {
  injectStyle();
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "hc-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove("show"), ms);
}
