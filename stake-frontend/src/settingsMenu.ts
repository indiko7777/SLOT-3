/**
 * GTA-themed game menu opened from the ☰ (burger) button. Lets the player pick a
 * spin speed (Normal / Turbo / Extra Turbo) and start/stop Autoplay. Each option
 * respects the RGS jurisdiction flags (disabledTurbo / disabledSuperTurbo /
 * disabledAutoplay) — a disabled option is shown greyed-out and is unclickable.
 *
 * DOM overlay (same pattern as confirmPopup / RadioWheel) so it stays decoupled
 * from the Pixi scene and is cheap to mount/unmount.
 */

export type TurboMode = "off" | "turbo" | "super";

export interface SettingsMenuFlags {
  disabledTurbo: boolean;
  disabledSuperTurbo: boolean;
  disabledAutoplay: boolean;
}

export interface SettingsMenuHooks {
  getTurboMode(): TurboMode;
  setTurboMode(mode: TurboMode): void;
  isAutoplayActive(): boolean;
  startAutoplay(count: number): void; // Infinity for endless
  stopAutoplay(): void;
  getFlags(): SettingsMenuFlags;
  playClick?(): void;
}

/** Autoplay spin-count presets (Infinity = endless until stopped/out of funds). */
const AUTOPLAY_COUNTS: number[] = [10, 25, 50, 100, Infinity];

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
  #settings-overlay{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at center, rgba(16,20,36,.85) 0%, rgba(5,7,16,.98) 100%);
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    opacity:0;transition:opacity .22s cubic-bezier(.16,1,.3,1);
    font-family:'Impact','Arial Black','Helvetica Neue',sans-serif;color:#fff;user-select:none;}
  #settings-overlay.show{opacity:1;}
  .sm-card{width:90%;max-width:460px;background:linear-gradient(135deg,#0e111a 0%,#05060b 100%);
    border:4px solid #1f2538;border-radius:16px;overflow:hidden;position:relative;
    box-shadow:0 25px 60px rgba(0,0,0,.85),0 0 35px rgba(154,230,78,.10);
    transform:scale(.86) translateY(28px);transition:transform .3s cubic-bezier(.34,1.56,.64,1);}
  #settings-overlay.show .sm-card{transform:scale(1) translateY(0);}
  .sm-header{padding:18px 24px;text-transform:uppercase;font-size:24px;font-weight:900;letter-spacing:4px;
    background:repeating-linear-gradient(-45deg,#121727,#121727 12px,#1d243c 12px,#1d243c 24px);
    border-bottom:4px solid #9ae64e;text-align:center;text-shadow:0 2px 4px rgba(0,0,0,.5);}
  .sm-content{padding:24px 26px;display:flex;flex-direction:column;gap:22px;}
  .sm-section-label{font-size:13px;letter-spacing:2px;color:#9fb4d0;text-transform:uppercase;
    font-family:system-ui,-apple-system,sans-serif;font-weight:700;margin-bottom:10px;}
  .sm-row{display:flex;gap:10px;}
  .sm-btn{flex:1;background:rgba(0,0,0,.55);border:2px solid #303b58;border-radius:10px;color:#cdd8ea;
    font-family:'Impact','Arial Black',sans-serif;font-size:16px;font-weight:900;letter-spacing:1px;
    padding:14px 6px;cursor:pointer;text-transform:uppercase;transition:all .15s cubic-bezier(.16,1,.3,1);outline:none;}
  .sm-btn:hover:not(.disabled){border-color:#9ae64e;color:#fff;box-shadow:0 0 14px rgba(154,230,78,.25);}
  .sm-btn.active{border-color:#9ae64e;background:rgba(154,230,78,.16);color:#fff;
    box-shadow:0 0 16px rgba(154,230,78,.35);text-shadow:0 0 8px rgba(154,230,78,.6);}
  .sm-btn.disabled{opacity:.32;cursor:not-allowed;filter:grayscale(.6);}
  .sm-btn.stop{border-color:#ff5555;color:#ff7676;}
  .sm-btn.stop:hover{background:rgba(255,85,85,.16);color:#ff3333;box-shadow:0 0 14px rgba(255,85,85,.3);}
  .sm-note{font-size:12px;color:#6b7a92;font-family:system-ui,-apple-system,sans-serif;
    letter-spacing:.4px;margin-top:8px;line-height:1.5;}
  .sm-close{width:100%;border:none;border-top:4px solid #1f2538;background:transparent;color:#fff;
    font-family:'Impact','Arial Black',sans-serif;font-size:20px;font-weight:900;letter-spacing:4px;
    padding:18px;cursor:pointer;text-transform:uppercase;transition:all .2s;outline:none;}
  .sm-close:hover{background:rgba(154,230,78,.12);color:#9ae64e;text-shadow:0 0 12px rgba(154,230,78,.5);}
  `;
  document.head.appendChild(s);
}

export class SettingsMenu {
  private overlay: HTMLDivElement | null = null;

  constructor(private readonly hooks: SettingsMenuHooks) {}

  isOpen(): boolean {
    return this.overlay !== null;
  }

  toggle(): void {
    this.overlay ? this.close() : this.open();
  }

  open(): void {
    if (this.overlay) return;
    injectStyle();
    const flags = this.hooks.getFlags();

    const overlay = document.createElement("div");
    overlay.id = "settings-overlay";
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) this.close();
    });

    const card = document.createElement("div");
    card.className = "sm-card";

    const header = document.createElement("div");
    header.className = "sm-header";
    header.textContent = "Game Menu";
    card.appendChild(header);

    const content = document.createElement("div");
    content.className = "sm-content";

    // ── Spin speed ──
    content.appendChild(this.label("Spin Speed"));
    const speedRow = document.createElement("div");
    speedRow.className = "sm-row";
    speedRow.appendChild(this.speedBtn("Normal", "off", false));
    speedRow.appendChild(this.speedBtn("Turbo", "turbo", flags.disabledTurbo));
    speedRow.appendChild(this.speedBtn("Extra Turbo", "super", flags.disabledSuperTurbo));
    content.appendChild(speedRow);

    // ── Autoplay ──
    content.appendChild(this.label("Autoplay"));
    const autoRow = document.createElement("div");
    autoRow.className = "sm-row";
    for (const count of AUTOPLAY_COUNTS) {
      autoRow.appendChild(this.autoBtn(count, flags.disabledAutoplay));
    }
    content.appendChild(autoRow);

    if (this.hooks.isAutoplayActive()) {
      const stopRow = document.createElement("div");
      stopRow.className = "sm-row";
      const stop = document.createElement("button");
      stop.className = "sm-btn stop";
      stop.textContent = "■ Stop Autoplay";
      stop.addEventListener("click", () => {
        this.hooks.playClick?.();
        this.hooks.stopAutoplay();
        this.close();
      });
      stopRow.appendChild(stop);
      content.appendChild(stopRow);
    }

    if (flags.disabledAutoplay) {
      const note = document.createElement("div");
      note.className = "sm-note";
      note.textContent = "Autoplay is disabled by your operator.";
      content.appendChild(note);
    }

    card.appendChild(content);

    const close = document.createElement("button");
    close.className = "sm-close";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      this.hooks.playClick?.();
      this.close();
    });
    card.appendChild(close);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    document.addEventListener("keydown", this.onKey);

    overlay.offsetHeight; // reflow to trigger the transition
    overlay.classList.add("show");
  }

  close(): void {
    if (!this.overlay) return;
    document.removeEventListener("keydown", this.onKey);
    const o = this.overlay;
    this.overlay = null;
    o.classList.remove("show");
    window.setTimeout(() => o.remove(), 220);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private label(text: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "sm-section-label";
    d.textContent = text;
    return d;
  }

  private speedBtn(text: string, mode: TurboMode, disabled: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    const active = this.hooks.getTurboMode() === mode;
    btn.className = `sm-btn${active ? " active" : ""}${disabled ? " disabled" : ""}`;
    btn.textContent = text;
    if (!disabled) {
      btn.addEventListener("click", () => {
        this.hooks.playClick?.();
        this.hooks.setTurboMode(mode);
        // Re-render the speed row's active state in place.
        const row = btn.parentElement;
        if (row) {
          for (const child of Array.from(row.children)) child.classList.remove("active");
          btn.classList.add("active");
        }
      });
    }
    return btn;
  }

  private autoBtn(count: number, disabled: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `sm-btn${disabled ? " disabled" : ""}`;
    btn.textContent = Number.isFinite(count) ? String(count) : "∞";
    if (!disabled) {
      btn.addEventListener("click", () => {
        this.hooks.playClick?.();
        this.hooks.startAutoplay(count);
        this.close();
      });
    }
    return btn;
  }
}
