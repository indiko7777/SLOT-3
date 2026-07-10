/**
 * Shared DOM modals: interrupted-round resume, replay intro/finish, and the
 * RGS error toast. Styled to match the settings menu. All strings are passed
 * in by the caller so social-mode terminology stays centralised in domain.ts.
 */

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
  .hc-modal-overlay{position:fixed;inset:0;z-index:100002;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at center, rgba(16,20,36,.85) 0%, rgba(5,7,16,.98) 100%);
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    opacity:0;transition:opacity .22s cubic-bezier(.16,1,.3,1);
    font-family:'Impact','Arial Black','Helvetica Neue',sans-serif;color:#fff;user-select:none;}
  .hc-modal-overlay.show{opacity:1;}
  .hc-modal-card{width:90%;max-width:440px;background:linear-gradient(135deg,#0e111a 0%,#05060b 100%);
    border:4px solid #1f2538;border-radius:16px;overflow:hidden;position:relative;
    box-shadow:0 25px 60px rgba(0,0,0,.85),0 0 35px rgba(154,230,78,.10);
    transform:scale(.86) translateY(28px);transition:transform .3s cubic-bezier(.34,1.56,.64,1);}
  .hc-modal-overlay.show .hc-modal-card{transform:scale(1) translateY(0);}
  .hc-modal-header{padding:16px 24px;text-transform:uppercase;font-size:22px;font-weight:900;letter-spacing:3px;
    background:repeating-linear-gradient(-45deg,#121727,#121727 12px,#1d243c 12px,#1d243c 24px);
    border-bottom:4px solid #9ae64e;text-align:center;text-shadow:0 2px 4px rgba(0,0,0,.5);}
  .hc-modal-body{padding:20px 26px;display:flex;flex-direction:column;gap:10px;}
  .hc-modal-line{display:flex;justify-content:space-between;gap:16px;align-items:baseline;
    font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#cdd8ea;}
  .hc-modal-line b{font-family:'Impact','Arial Black',sans-serif;font-size:18px;color:#ffdf65;
    font-weight:900;letter-spacing:.5px;}
  .hc-modal-text{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.55;
    color:#b9c4d6;text-align:center;}
  .hc-modal-actions{display:flex;gap:10px;padding:0 26px 22px;}
  .hc-modal-btn{flex:1;background:rgba(0,0,0,.55);border:2px solid #303b58;border-radius:10px;color:#cdd8ea;
    font-family:'Impact','Arial Black',sans-serif;font-size:17px;font-weight:900;letter-spacing:1.5px;
    padding:15px 10px;cursor:pointer;text-transform:uppercase;transition:all .15s;outline:none;}
  .hc-modal-btn:hover{border-color:#9ae64e;color:#fff;box-shadow:0 0 14px rgba(154,230,78,.25);}
  .hc-modal-btn.primary{border-color:#9ae64e;background:rgba(154,230,78,.16);color:#fff;
    box-shadow:0 0 16px rgba(154,230,78,.35);}
  .hc-toast{position:fixed;left:50%;bottom:118px;transform:translateX(-50%) translateY(16px);
    z-index:100003;background:rgba(10,6,8,.96);border:2px solid #ff5555;border-radius:12px;
    color:#ffdddd;font-family:'Impact','Arial Black',sans-serif;font-size:16px;font-weight:900;
    letter-spacing:1.2px;padding:14px 26px;text-transform:uppercase;opacity:0;
    transition:opacity .25s ease,transform .25s ease;pointer-events:none;max-width:86vw;text-align:center;
    box-shadow:0 12px 30px rgba(0,0,0,.7),0 0 24px rgba(255,85,85,.25);}
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

/** Show a blocking choice modal; resolves with the picked button's key. */
export function showChoiceModal(spec: ModalSpec, playClick?: () => void): Promise<string> {
  injectStyle();
  openModals += 1;
  return new Promise<string>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "hc-modal-overlay";

    const card = document.createElement("div");
    card.className = "hc-modal-card";

    const header = document.createElement("div");
    header.className = "hc-modal-header";
    header.textContent = spec.title;
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "hc-modal-body";
    for (const line of spec.lines ?? []) {
      const row = document.createElement("div");
      row.className = "hc-modal-line";
      const label = document.createElement("span");
      label.textContent = line.label;
      const value = document.createElement("b");
      value.textContent = line.value;
      row.append(label, value);
      body.appendChild(row);
    }
    if (spec.text) {
      const p = document.createElement("div");
      p.className = "hc-modal-text";
      p.textContent = spec.text;
      body.appendChild(p);
    }
    card.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "hc-modal-actions";
    const finish = (key: string): void => {
      openModals = Math.max(0, openModals - 1);
      overlay.classList.remove("show");
      window.setTimeout(() => overlay.remove(), 220);
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
    card.appendChild(actions);
    overlay.appendChild(card);
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
