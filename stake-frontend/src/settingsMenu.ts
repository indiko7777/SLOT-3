import { UI_FONT } from "./typography";
/**
 * GTA V pause-menu styled full-screen game menu. Opened by the ☰ (burger)
 * button on the GAME tab, and by the ⓘ info button directly on the PAYTABLE
 * tab — one menu, six tabs, identical styling: blurred/desaturated backdrop,
 * big condensed title, tab strip with the white underline, full-bleed
 * translucent black rows (the highlighted row inverts to solid white with
 * black text — the signature GTA V look), and a description box that follows
 * the selection.
 *
 * Tabs:
 *  GAME      — spin speed + autoplay settings. Each respects the RGS
 *              jurisdiction flags (disabledTurbo / disabledSuperTurbo /
 *              disabledAutoplay) — a disabled row is greyed out and inert.
 *              Autoplay stays two-step by design: pick a spin count with the
 *              selector, then activate Start; it must never begin from a
 *              single click.
 *  MODES     — RTP / Max Win / cost stated individually for EVERY bet mode.
 *  PAYTABLE  — the win of every cluster size per symbol, exactly the math
 *              model's PAYTABLE (domain.ts mirrors stake-math/src/model.ts; a
 *              test pins them together), the win formula, and a picture of a
 *              winning vs. a non-winning shape.
 *  FEATURES  — cascade multiplier, Wanted Level, The Getaway, special
 *              symbols, Collection & Head-Start.
 *  CONTROLS  — the user-interaction guide covering every button.
 *  INFO      — the mandatory Engine general disclaimer.
 *
 * Together the tabs satisfy the Engine approval checklist. All wording flows
 * through hooks.getUiStrings() / symbolLabel() so social casinos (stake.us)
 * never see a restricted word. No hit rates / probabilities are ever
 * displayed. A visible CLOSE button (and tappable hints) closes the menu on
 * devices without an Esc key.
 *
 * DOM overlay (same pattern as confirmPopup / RadioWheel) so it stays
 * decoupled from the Pixi scene and is cheap to mount/unmount.
 */

import {
  CASCADE_LADDER,
  clusterPay,
  GOLD_BAR_VALUES,
  MAX_CLUSTER,
  MAX_WIN_MULTIPLIER,
  MIN_CLUSTER,
  SYMBOLS,
  symbolLabel,
  type SymbolId,
  type UiStrings,
} from "./domain";
import { formatMultiplier } from "./format";
import { SYMBOL_ASSETS } from "./pixi/assets";
import { COLLECTION_RULES, GETAWAY_RULES } from "./rules";

export type TurboMode = "off" | "turbo" | "super";
export type MenuTab = "game" | "modes" | "paytable" | "features" | "controls" | "info";

const TABS: Array<{ key: MenuTab; label: (t: UiStrings) => string }> = [
  { key: "game", label: () => "Game" },
  { key: "modes", label: () => "Modes" },
  { key: "paytable", label: (t) => t.paytableTab },
  { key: "features", label: () => "Features" },
  { key: "controls", label: () => "Controls" },
  { key: "info", label: () => "Info" },
];

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
  // Game-info content sources (same ones PaytableView used via SceneRuntime).
  getUiStrings(): UiStrings;
  isSocial(): boolean;
  getBetModes(): Record<string, { costMultiplier?: number } | undefined>;
}

/** Autoplay spin-count presets (Infinity = endless until stopped/out of funds). */
const AUTOPLAY_COUNTS: number[] = [10, 25, 50, 100, Infinity];

const SPEED_LABELS: Record<TurboMode, string> = {
  off: "Normal",
  turbo: "Turbo",
  super: "Extra Turbo",
};

/** Paytable columns, premium → low (the order players scan a paytable in). */
const PAY_SYMBOLS: SymbolId[] = ["BIKE", "DIAMOND", "CASH", "DUFFEL", "AMMO", "PISTOL", "KNIFE", "BRASS"];

const TIER_COLOR: Record<string, string> = {
  premium: "#ffdf65",
  mid: "#9ae64e",
  low: "#fb6f52",
};

/** Engine's template general disclaimer (Approval Guidelines → General Disclaimer). */
const DISCLAIMER =
  "Malfunction voids all wins and plays. A consistent internet connection is required. " +
  "In the event of a disconnection, reload the game to finish any uncompleted rounds. " +
  "The expected return is calculated over many plays. The game display is not representative " +
  "of any physical device and is for illustrative purposes only. Winnings are settled according " +
  "to the amount received from the Remote Game Server and not from events within the web browser. " +
  "TM and © 2026 Engine.";

/** Cell indexes (col + row * 5) of the two example shapes on the 5x4 grid. */
const WIN_SHAPE = [1, 2, 7, 12, 13]; // every cell shares a SIDE with the next
const NO_WIN_SHAPE = [1, 7, 13, 11, 17]; // five cells touching only at corners

function num2hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

/** Bonus-only symbols are drawn by the Getaway itself and have no reel art. */
const INFO_ART: Partial<Record<SymbolId, string>> = {
  SAFE: "gold_bar.webp",
  MASTER_KEY: "dynamite.webp",
};

function symbolImgSrc(symId: SymbolId): string {
  return `assets/${INFO_ART[symId] ?? SYMBOL_ASSETS[symId].assetKey}`;
}

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

function listX(values: readonly number[]): string {
  return values.map((v) => `${formatMultiplier(v, true)}x`).join(", ");
}

// Chalet (the actual GTA V UI face) is proprietary; Archivo Narrow is the
// closest free match and is loaded from index.html, with Arial Narrow as the
// no-network fallback.
const FONT = UI_FONT;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
  #settings-overlay{position:fixed;inset:0;z-index:100001;display:flex;flex-direction:column;
    --gx:clamp(16px,6vw,110px); /* shared horizontal gutter so full-bleed bars keep aligned text */
    background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.78) 100%);
    backdrop-filter:blur(7px) saturate(.25) brightness(.8);
    -webkit-backdrop-filter:blur(7px) saturate(.25) brightness(.8);
    opacity:0;transition:opacity .15s ease-out;
    font-family:${FONT};color:#fff;user-select:none;-webkit-user-select:none;}
  #settings-overlay.show{opacity:1;}
  .gta-head{padding:clamp(12px,3.5vh,30px) var(--gx) 10px;flex-shrink:0;
    display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .gta-close{flex-shrink:0;display:flex;align-items:center;gap:8px;cursor:pointer;
    background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.45);border-radius:6px;color:#fff;
    font:700 clamp(13px,2.8vw,15px)/1 ${FONT};letter-spacing:1.5px;text-transform:uppercase;
    padding:10px 14px;min-height:44px;transition:background .12s,color .12s;}
  .gta-close b{font-size:1.25em;line-height:1;}
  .gta-close:hover,.gta-close:active{background:#fff;color:#000;}
  .gta-hint-btn{cursor:pointer;}
  .gta-title{font-size:clamp(28px,5.5vw,46px);font-weight:700;line-height:1;
    text-transform:uppercase;letter-spacing:.5px;text-shadow:0 2px 10px rgba(0,0,0,.8);}
  .gta-tabs{display:flex;gap:clamp(16px,3.5vw,30px);border-bottom:2px solid rgba(255,255,255,.95);
    padding:0 var(--gx);flex-shrink:0;overflow-x:auto;scrollbar-width:none;white-space:nowrap;}
  .gta-tabs::-webkit-scrollbar{display:none;}
  .gta-tab{font-size:clamp(13px,2.6vw,15px);letter-spacing:2.5px;text-transform:uppercase;font-weight:600;
    padding:8px 2px 9px;color:rgba(255,255,255,.42);position:relative;cursor:pointer;flex-shrink:0;
    transition:color .12s ease-out;}
  .gta-tab:hover{color:rgba(255,255,255,.75);}
  .gta-tab.active{color:#fff;}
  .gta-tab.active::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:4px;background:#fff;}
  .gta-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 0 24px;
    scrollbar-width:none;min-height:0;}
  .gta-scroll::-webkit-scrollbar{display:none;}
  .gta-scroll.anim{animation:gtaTabIn .18s ease-out;}
  @keyframes gtaTabIn{from{opacity:0;transform:translateX(-10px);}to{opacity:1;transform:none;}}
  .gta-sep{font-size:clamp(11.5px,2.4vw,13px);letter-spacing:2.5px;text-transform:uppercase;font-weight:600;
    color:rgba(255,255,255,.6);background:rgba(0,0,0,.72);padding:8px var(--gx);margin-top:22px;}
  .gta-scroll > .gta-sep:first-child{margin-top:0;}
  .gta-block{margin-top:12px;}
  .gta-block:first-of-type{margin-top:0;}
  .gta-row{display:flex;align-items:center;justify-content:space-between;gap:16px;
    background:rgba(0,0,0,.52);padding:12px var(--gx);margin-top:2px;cursor:pointer;
    font-size:clamp(15px,3vw,17.5px);font-weight:500;color:#e6e6e6;letter-spacing:.2px;}
  .gta-row.sel{background:#f2f2f2;color:#000;}
  .gta-row.disabled{color:rgba(255,255,255,.32);cursor:default;}
  .gta-row.disabled.sel{background:rgba(242,242,242,.8);color:rgba(0,0,0,.38);}
  .gta-row.danger{color:#ff5252;}
  .gta-row.danger.sel{color:#a80f0f;}
  .gta-row.static{cursor:default;}
  .gta-val{display:flex;align-items:center;gap:10px;font-weight:600;flex-shrink:0;}
  .gta-val-text{min-width:clamp(72px,18vw,96px);text-align:center;}
  .gta-arr{font-size:11px;opacity:.7;padding:4px 3px;cursor:pointer;}
  .gta-row.sel .gta-arr{opacity:.95;}
  .gta-row.disabled .gta-arr{visibility:hidden;}
  .gta-stat{font-size:clamp(12px,2.4vw,14px);font-weight:600;color:#ffdf65;text-align:right;flex-shrink:0;}
  .gta-body{background:rgba(0,0,0,.38);padding:11px var(--gx);margin-top:2px;
    font-size:clamp(12.5px,2.6vw,14px);line-height:1.6;color:#bcbcbc;letter-spacing:.2px;}
  .gta-desc{background:rgba(0,0,0,.66);border-top:2px solid rgba(255,255,255,.9);
    padding:11px var(--gx);font-size:clamp(12.5px,2.6vw,14px);line-height:1.5;color:#bcbcbc;
    min-height:46px;letter-spacing:.2px;flex-shrink:0;}
  .gta-hints{display:flex;justify-content:flex-end;gap:20px;padding:8px var(--gx) 12px;flex-shrink:0;
    font-size:clamp(11px,2.2vw,12.5px);letter-spacing:1px;color:rgba(255,255,255,.6);text-transform:uppercase;
    flex-wrap:wrap;}
  .gta-key{display:inline-block;border:1px solid rgba(255,255,255,.55);border-radius:3px;
    padding:1px 6px;margin-right:6px;font-size:11px;color:#fff;}
  /* ── info tabs ── */
  .gta-paytable{display:grid;grid-template-columns:clamp(30px,8vw,64px) repeat(8,minmax(0,1fr));
    padding:0 var(--gx);margin-top:2px;gap:2px;}
  .gta-paytable > div{background:rgba(0,0,0,.52);padding:6px 2px;text-align:center;
    font-weight:600;font-size:clamp(10.5px,2.3vw,14px);font-variant-numeric:tabular-nums;white-space:nowrap;}
  .gta-paytable > .ph{background:rgba(0,0,0,.72);display:flex;flex-direction:column;align-items:center;gap:3px;
    padding:6px 1px;color:rgba(255,255,255,.8);font-size:clamp(8.5px,1.9vw,11.5px);letter-spacing:.3px;
    white-space:normal;line-height:1.15;}
  .gta-paytable > .ph img{width:clamp(26px,6vw,46px);height:clamp(26px,6vw,46px);object-fit:contain;}
  .gta-paytable > .sz{background:rgba(0,0,0,.72);color:#fff;}
  .gta-paytable > .corner{background:rgba(0,0,0,.72);color:rgba(255,255,255,.6);font-size:clamp(8.5px,1.9vw,11.5px);
    display:flex;align-items:flex-end;justify-content:center;white-space:normal;line-height:1.15;}
  .gta-shapes{display:flex;flex-wrap:wrap;gap:clamp(14px,4vw,40px);padding:12px var(--gx);
    background:rgba(0,0,0,.38);margin-top:2px;}
  .gta-shape{display:flex;flex-direction:column;align-items:center;gap:8px;}
  .gta-shape .cap{font-weight:700;letter-spacing:1.5px;font-size:clamp(12px,2.6vw,14px);text-transform:uppercase;}
  .gta-shape.ok .cap{color:#4ee06a;}
  .gta-shape.bad .cap{color:#ff5252;}
  .gta-shape .grid{display:grid;grid-template-columns:repeat(5,clamp(20px,5vw,30px));
    grid-auto-rows:clamp(20px,5vw,30px);gap:4px;padding:8px;background:#141a26;border-radius:6px;}
  .gta-shape .grid i{display:block;border-radius:4px;background:#283247;}
  .gta-shape.ok .grid i.on{background:#2fbf55;box-shadow:0 0 8px rgba(78,224,106,.55);}
  .gta-shape.bad .grid i.on{background:#d83a3a;box-shadow:0 0 8px rgba(255,82,82,.5);}
  .gta-shape .sub{max-width:clamp(150px,40vw,230px);text-align:center;font-size:clamp(11.5px,2.4vw,13px);
    color:#bcbcbc;line-height:1.45;}
  .gta-special{display:grid;grid-template-columns:clamp(48px,10vw,68px) 1fr;gap:clamp(10px,2.2vw,18px);
    align-items:center;background:rgba(0,0,0,.52);padding:10px var(--gx);margin-top:2px;}
  .gta-special img{width:100%;max-height:clamp(44px,9vw,60px);object-fit:contain;}
  .gta-special .name{font-weight:600;font-size:clamp(13px,2.8vw,16px);letter-spacing:.4px;}
  .gta-special .txt{font-size:clamp(12px,2.5vw,13.5px);color:#c9c9c9;line-height:1.5;margin-top:3px;}
  .gta-ctl{display:grid;grid-template-columns:clamp(120px,24vw,190px) 1fr;gap:clamp(10px,2.2vw,18px);
    background:rgba(0,0,0,.52);padding:11px var(--gx);margin-top:2px;align-items:baseline;}
  .gta-ctl .name{font-weight:600;font-size:clamp(12.5px,2.6vw,15px);color:#fff;letter-spacing:.4px;}
  .gta-ctl .txt{font-size:clamp(12px,2.5vw,13.5px);color:#bcbcbc;line-height:1.55;}
  @media (max-width:520px){
    .gta-ctl{grid-template-columns:1fr;gap:3px;}
    .gta-paytable{padding:0 6px;gap:1px;}
  }
  @media (hover:none){
    .gta-hints .gta-key{display:none;}
  }
  `;
  document.head.appendChild(s);
}

/** One selectable menu row; value rows cycle with onLeft/onRight, action rows fire onActivate. */
interface MenuRow {
  el: HTMLDivElement;
  desc: string;
  disabled: boolean;
  onActivate?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
}

export class SettingsMenu {
  private overlay: HTMLDivElement | null = null;
  private scrollEl: HTMLDivElement | null = null;
  private descEl: HTMLDivElement | null = null;
  private hintsEl: HTMLDivElement | null = null;
  private tabEls: Partial<Record<MenuTab, HTMLDivElement>> = {};
  private tab: MenuTab = "game";
  /** Autoplay count picked in step 1; START (step 2) is armed only when set. */
  private selectedCount: number | null = null;
  private rows: MenuRow[] = [];
  private selIndex = 0;
  private startRow: MenuRow | null = null;

  constructor(private readonly hooks: SettingsMenuHooks) {}

  isOpen(): boolean {
    return this.overlay !== null;
  }

  toggle(tab: MenuTab = "game"): void {
    if (!this.overlay) {
      this.open(tab);
    } else if (this.tab !== tab) {
      this.switchTab(tab); // already open on another tab — jump, don't close
    } else {
      this.close();
    }
  }

  open(tab: MenuTab = "game"): void {
    if (this.overlay) {
      this.switchTab(tab);
      return;
    }
    injectStyle();
    this.tab = tab;
    this.selectedCount = null; // every open restarts the two-step confirmation

    const overlay = document.createElement("div");
    overlay.id = "settings-overlay";

    const head = document.createElement("div");
    head.className = "gta-head";
    const title = document.createElement("div");
    title.className = "gta-title";
    title.textContent = "Heat Chase";
    // Always-visible close control: phones and tablets have no Esc key.
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gta-close";
    closeBtn.setAttribute("aria-label", "Close game information");
    closeBtn.innerHTML = '<span>Close</span><b aria-hidden="true">✕</b>';
    closeBtn.addEventListener("click", () => {
      this.hooks.playClick?.();
      this.close();
    });
    head.append(title, closeBtn);
    overlay.appendChild(head);

    const tabs = document.createElement("div");
    tabs.className = "gta-tabs";
    const strings = this.hooks.getUiStrings();
    for (const { key, label } of TABS) {
      const t = document.createElement("div");
      t.className = "gta-tab";
      t.textContent = label(strings);
      t.addEventListener("click", () => {
        this.hooks.playClick?.();
        this.switchTab(key);
      });
      tabs.appendChild(t);
      this.tabEls[key] = t;
    }
    overlay.appendChild(tabs);

    const scroll = document.createElement("div");
    scroll.className = "gta-scroll";
    overlay.appendChild(scroll);
    this.scrollEl = scroll;

    const desc = document.createElement("div");
    desc.className = "gta-desc";
    overlay.appendChild(desc);
    this.descEl = desc;

    const hints = document.createElement("div");
    hints.className = "gta-hints";
    overlay.appendChild(hints);
    this.hintsEl = hints;

    document.body.appendChild(overlay);
    this.overlay = overlay;
    document.addEventListener("keydown", this.onKey);

    this.renderTab();
    overlay.offsetHeight; // reflow to trigger the transition
    overlay.classList.add("show");
  }

  close(): void {
    if (!this.overlay) return;
    document.removeEventListener("keydown", this.onKey);
    const o = this.overlay;
    this.overlay = null;
    this.scrollEl = null;
    this.descEl = null;
    this.hintsEl = null;
    this.tabEls = {};
    this.rows = [];
    this.startRow = null;
    o.classList.remove("show");
    window.setTimeout(() => o.remove(), 160);
  }

  private switchTab(tab: MenuTab): void {
    if (this.tab === tab && this.scrollEl?.hasChildNodes()) return;
    this.tab = tab;
    this.renderTab();
  }

  /** Steps to the previous/next tab in the strip (GTA's Q/E bumpers). */
  private stepTab(dir: -1 | 1): void {
    const idx = TABS.findIndex((t) => t.key === this.tab);
    const next = TABS[(idx + dir + TABS.length) % TABS.length];
    this.hooks.playClick?.();
    this.switchTab(next.key);
  }

  /** (Re)builds the active tab's content into the scroll area. */
  private renderTab(): void {
    if (!this.scrollEl || !this.descEl || !this.hintsEl) return;
    this.rows = [];
    this.selIndex = 0;
    this.startRow = null;
    this.scrollEl.replaceChildren();
    this.scrollEl.scrollTop = 0;

    for (const [key, el] of Object.entries(this.tabEls)) {
      el.classList.toggle("active", key === this.tab);
      if (key === this.tab) el.scrollIntoView({ inline: "nearest", block: "nearest" });
    }

    switch (this.tab) {
      case "game":
        this.renderGameTab(this.scrollEl);
        break;
      case "modes":
        this.renderModesTab(this.scrollEl);
        break;
      case "paytable":
        this.renderPaytableTab(this.scrollEl);
        break;
      case "features":
        this.renderFeaturesTab(this.scrollEl);
        break;
      case "controls":
        this.renderControlsTab(this.scrollEl);
        break;
      case "info":
        this.renderInfoTab(this.scrollEl);
        break;
    }

    // Selection + description box only exist on the interactive GAME tab.
    // The Tab / Back hints are buttons too, so touch players can use them.
    const tail =
      `<span class="gta-hint-btn" data-hint="tab"><span class="gta-key">Q / E</span>Next Tab</span>` +
      `<span class="gta-hint-btn" data-hint="back"><span class="gta-key">Esc</span>Back</span>`;
    if (this.tab === "game") {
      this.descEl.style.display = "";
      this.hintsEl.innerHTML =
        `<span><span class="gta-key">◄ ►</span>Change</span>` +
        `<span><span class="gta-key">⏎</span>Select</span>` + tail;
      this.updateSelection();
    } else {
      this.descEl.style.display = "none";
      this.hintsEl.innerHTML = `<span><span class="gta-key">▲ ▼</span>Scroll</span>` + tail;
    }
    this.hintsEl.querySelector('[data-hint="tab"]')?.addEventListener("click", () => this.stepTab(1));
    this.hintsEl.querySelector('[data-hint="back"]')?.addEventListener("click", () => {
      this.hooks.playClick?.();
      this.close();
    });

    // Retrigger the slide-in so switching tabs feels like GTA's page flip.
    this.scrollEl.classList.remove("anim");
    this.scrollEl.offsetWidth; // reflow
    this.scrollEl.classList.add("anim");
  }

  // ─────────────────────────── GAME tab ───────────────────────────

  private renderGameTab(parent: HTMLElement): void {
    const flags = this.hooks.getFlags();
    const autoplayActive = this.hooks.isAutoplayActive();

    // ── Spin speed: one row, ‹ › cycles through the modes the RGS allows ──
    parent.appendChild(this.sep("Settings"));
    const speedModes: TurboMode[] = ["off"];
    if (!flags.disabledTurbo) speedModes.push("turbo");
    if (!flags.disabledSuperTurbo) speedModes.push("super");
    this.addValueRow(parent, {
      label: "Spin Speed",
      desc: "Choose how fast the reels spin. Turbo modes shorten the spin animation.",
      disabled: speedModes.length === 1,
      display: () => SPEED_LABELS[this.hooks.getTurboMode()],
      cycle: (dir) => {
        const cur = speedModes.indexOf(this.hooks.getTurboMode());
        const next = speedModes[(Math.max(cur, 0) + dir + speedModes.length) % speedModes.length];
        this.hooks.setTurboMode(next);
      },
    });

    // ── Autoplay ──
    // Two-step by design: the selector starts at Off, and Start stays inert
    // until a count is picked. Autoplay must never begin from a single click.
    parent.appendChild(this.sep("Autoplay"));
    const countOptions: (number | null)[] = [null, ...AUTOPLAY_COUNTS];
    this.addValueRow(parent, {
      label: "Autoplay Spins",
      desc: flags.disabledAutoplay
        ? "Autoplay is disabled by your operator."
        : autoplayActive
          ? "Autoplay is currently running. Stop it before starting a new session."
          : "Select the number of spins to play automatically, then use Start Autoplay below.",
      disabled: flags.disabledAutoplay || autoplayActive,
      display: () => {
        if (this.selectedCount == null) return "Off";
        return Number.isFinite(this.selectedCount) ? String(this.selectedCount) : "∞";
      },
      cycle: (dir) => {
        const cur = countOptions.indexOf(this.selectedCount);
        this.selectedCount = countOptions[(cur + dir + countOptions.length) % countOptions.length];
        this.setStartArmed(this.selectedCount != null);
      },
    });

    if (!flags.disabledAutoplay && !autoplayActive) {
      this.startRow = this.addActionRow(parent, {
        label: "Start Autoplay",
        desc:
          "Begin autoplay with the selected number of spins. Autoplay stops automatically if the balance cannot cover the next spin.",
        disabled: true, // armed by picking a count
        onActivate: () => {
          if (this.selectedCount == null) return;
          this.hooks.startAutoplay(this.selectedCount);
          this.selectedCount = null;
          this.close();
        },
      });
    }

    if (autoplayActive) {
      this.addActionRow(parent, {
        label: "Stop Autoplay",
        desc: "Stop the current autoplay session after the ongoing spin finishes.",
        danger: true,
        onActivate: () => {
          this.hooks.stopAutoplay();
          this.close();
        },
      });
    }

    this.addActionRow(parent, {
      label: "Resume Game",
      desc: "Close the menu and return to the game.",
      onActivate: () => this.close(),
    });
  }

  // ─────────────────────────── MODES tab ───────────────────────────

  private renderModesTab(parent: HTMLElement): void {
    const t = this.hooks.getUiStrings();
    const social = this.hooks.isSocial();

    parent.appendChild(this.sep("Game Modes"));
    const modes = this.hooks.getBetModes();
    const modeCards: Array<{ key: string; name: string; desc: string }> = [
      { key: "base", name: "Base Game", desc: "The standard game. Every spin is played at your selected amount." },
      { key: "ante", name: "Ante Mode", desc: "Plays at 1.5x your selected amount. Wilds and Armored Trucks appear more often, so The Getaway triggers more frequently." },
      { key: "getaway", name: "The Getaway", desc: "Starts The Getaway Hold & Spin immediately. Gold bar values use an increased value table." },
      { key: "super_getaway", name: "Super Getaway", desc: "Starts The Getaway immediately with the highest gold bar value table." },
      { key: "base_tier1", name: "Head-Start I", desc: "Base game variant reached through the free Collection: The Getaway appears more often. Same play amount as the base game." },
      { key: "base_tier2", name: "Head-Start II", desc: "Second Collection level: The Getaway appears even more often. Same play amount as the base game." },
      { key: "base_tier3", name: "Head-Start III", desc: "Highest Collection level with the most frequent Getaway. Same play amount as the base game." },
    ];
    for (const card of modeCards) {
      const rgsMode = modes[card.key];
      if (!rgsMode) continue; // only document modes this session actually offers
      const mult = rgsMode.costMultiplier ?? 1;
      const block = document.createElement("div");
      block.className = "gta-block";
      const row = document.createElement("div");
      row.className = "gta-row static";
      const name = document.createElement("span");
      name.textContent = card.name;
      const stat = document.createElement("span");
      stat.className = "gta-stat";
      stat.textContent = `${t.costWord}: ${formatMultiplier(mult)}x ${t.betWord} · RTP 96.00% · MAX WIN 5,000x`;
      row.append(name, stat);
      block.appendChild(row);
      block.appendChild(this.bodyText(card.desc));
      parent.appendChild(block);
    }
    parent.appendChild(this.sep("Expected Return"));
    parent.appendChild(
      this.bodyText(
        social
          ? "Every mode returns an expected 96.00% over many plays and every mode's win is capped at 5,000x the base play amount."
          : "Every mode returns an expected 96.00% RTP over many plays and every mode's win is capped at 5,000x the base bet.",
      ),
    );
  }

  // ────────────────────────── PAYTABLE tab ──────────────────────────

  private renderPaytableTab(parent: HTMLElement): void {
    const t = this.hooks.getUiStrings();
    const social = this.hooks.isSocial();
    const unit = t.betWord.toLowerCase();

    parent.appendChild(this.sep(t.payoutsHeading));
    parent.appendChild(
      this.bodyText(
        `A cluster is ${MIN_CLUSTER} or more matching symbols connected horizontally or vertically. ` +
          `The table shows what one cluster wins for each cluster size, as a multiple of your total ${unit}, ` +
          "BEFORE the cascade multiplier. Wilds join any cluster and count toward its size; a cluster needs at least one of its own symbol.",
      ),
    );
    parent.appendChild(this.paytableGrid(social));

    parent.appendChild(this.sep("Winning Shapes"));
    parent.appendChild(this.shapesDiagram());

    parent.appendChild(this.sep("How A Win Is Calculated"));
    parent.appendChild(
      this.bodyText(
        `CLUSTER WIN = table value × cascade multiplier × your total ${unit}. ` +
          `The cascade multiplier for each tumble of a spin is ${CASCADE_LADDER.map((m, i) => `${ordinal(i + 1)} ×${m}`).join(" · ")} ` +
          "(and ×80 for every later tumble). The spin's total win is the sum of all its cluster wins plus any Getaway win.",
      ),
    );
    const cashName = symbolLabel("CASH", social);
    const example = clusterPay("CASH", 12);
    parent.appendChild(
      this.bodyText(
        `Example: a 12-symbol ${cashName} cluster on the 3rd tumble wins ${formatMultiplier(example)} × 4 = ` +
          `${formatMultiplier(example * 4)}x your ${unit}. At a 1.00 ${unit} that is ${(example * 4).toFixed(2)}; ` +
          `at a 0.01 ${unit} it is ${formatMultiplier(example * 4 * 0.01)}.`,
      ),
    );
    parent.appendChild(
      this.bodyText(
        `Every round's total win is capped at ${MAX_WIN_MULTIPLIER.toLocaleString("en-US")}x the base ${unit}; ` +
          "a round that reaches the cap ends there.",
      ),
    );
  }

  /** Symbol columns × cluster-size rows, every value straight from the math PAYTABLE. */
  private paytableGrid(social: boolean): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "gta-paytable";
    const corner = document.createElement("div");
    corner.className = "corner";
    corner.textContent = "Size";
    grid.appendChild(corner);
    for (const symId of PAY_SYMBOLS) {
      const head = document.createElement("div");
      head.className = "ph";
      const img = document.createElement("img");
      img.src = symbolImgSrc(symId);
      img.alt = symbolLabel(symId, social);
      img.draggable = false;
      const name = document.createElement("span");
      name.textContent = symbolLabel(symId, social);
      name.style.color = num2hex(SYMBOL_ASSETS[symId].text);
      head.append(img, name);
      grid.appendChild(head);
    }
    for (let size = MIN_CLUSTER; size <= MAX_CLUSTER; size++) {
      const sz = document.createElement("div");
      sz.className = "sz";
      sz.textContent = String(size);
      grid.appendChild(sz);
      for (const symId of PAY_SYMBOLS) {
        const cell = document.createElement("div");
        cell.textContent = formatMultiplier(clusterPay(symId, size));
        cell.style.color = TIER_COLOR[SYMBOLS[symId].tier] ?? "#fff";
        grid.appendChild(cell);
      }
    }
    return grid;
  }

  /** Visual rule: side-by-side connections win, corner-only touches do not. */
  private shapesDiagram(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "gta-shapes";
    const shape = (ok: boolean, cells: number[], caption: string, sub: string): HTMLDivElement => {
      const box = document.createElement("div");
      box.className = `gta-shape ${ok ? "ok" : "bad"}`;
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = caption;
      const grid = document.createElement("div");
      grid.className = "grid";
      grid.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 20; i++) {
        const cell = document.createElement("i");
        if (cells.includes(i)) cell.className = "on";
        grid.appendChild(cell);
      }
      const text = document.createElement("div");
      text.className = "sub";
      text.textContent = sub;
      box.append(cap, grid, text);
      return box;
    };
    wrap.append(
      shape(true, WIN_SHAPE, "✓ Win", "5 matching symbols, each touching the next by a side (horizontally or vertically)."),
      shape(false, NO_WIN_SHAPE, "✕ No win", "5 matching symbols that only touch at the corners (diagonally) are not connected."),
    );
    return wrap;
  }

  // ────────────────────────── FEATURES tab ──────────────────────────

  private renderFeaturesTab(parent: HTMLElement): void {
    const social = this.hooks.isSocial();
    const unit = this.hooks.getUiStrings().betWord.toLowerCase();
    const cashName = symbolLabel("CASH", social);

    parent.appendChild(this.sep("Cascade Multiplier"));
    parent.appendChild(
      this.bodyText(
        `Winning clusters are removed and new symbols tumble in. Each tumble climbs the multiplier ladder one rung: ${CASCADE_LADDER.join("x → ")}x. The current rung multiplies EVERY win of that tumble. The ladder resets at the start of each spin.`,
      ),
    );

    parent.appendChild(this.sep("Drive-By"));
    parent.appendChild(
      this.bodyText(
        "On any base game spin (including Ante and Head-Start spins) the getaway car can speed across the reels right after they land and throw " +
          "3 to 5 Body Armor wilds onto the reels. The wilds land before any wins are evaluated and substitute for every paying symbol. " +
          "Drive-By does not occur in The Getaway or Super Getaway feature plays.",
      ),
    );

    parent.appendChild(this.sep("Wanted Level (Heat)"));
    parent.appendChild(
      this.bodyText(
        "The five stars above the reels are the live Wanted Level: each winning tumble in a spin adds one star. " +
          `2★ BUST THE STASH — all Brass Knuckles and Knives on the board transform into ${cashName}. ` +
          "3★ and 4★ GETAWAY DRIVER — a 2x2 mega wild is placed on the board. " +
          "5★ — THE GETAWAY bonus triggers on that same spin. The stars reset at the start of every spin. " +
          "Gold stars shown before a spin are Head-Start stars from the Collection — they pre-fill the meter so fewer tumbles are needed.",
      ),
    );

    parent.appendChild(this.sep("The Getaway — Hold & Spin"));
    parent.appendChild(
      this.specialRow(
        "SAFE",
        "Gold Bar",
        `Sticky value symbol. Every value it can land with, as a multiple of your ${unit}: ` +
          `base game, Ante and Head-Start: ${listX(GOLD_BAR_VALUES.base)} · ` +
          `The Getaway feature: ${listX(GOLD_BAR_VALUES.getaway)} · ` +
          `Super Getaway feature: ${listX(GOLD_BAR_VALUES.super_getaway)}.`,
      ),
    );
    parent.appendChild(
      this.specialRow("MASTER_KEY", "Dynamite", "Doubles the value of every Gold Bar beside it (above, below, left, right), then clears its cell."),
    );
    parent.appendChild(this.bodyText(GETAWAY_RULES));

    parent.appendChild(this.sep("Special Symbols"));
    parent.appendChild(
      this.specialRow("CAR_WILD", "Body Armor", "WILD — substitutes for every symbol in the table (it does not trigger the bonus). At 3★/4★ Wanted Level it lands as a 2x2 mega wild; the Drive-By throws 3 to 5 of them onto the reels."),
    );
    parent.appendChild(
      this.specialRow("WILD", "Beach Girl Wild", "WILD — substitutes for every symbol in the table AND reveals one Collection gallery piece each time it lands."),
    );
    parent.appendChild(
      this.specialRow("PHONE_SCATTER", "Armored Truck", "SCATTER — has no win value of its own; 3 or more on one spin trigger The Getaway."),
    );
    parent.appendChild(
      this.bodyText(
        "Armored Trucks only trigger the bonus. " +
          "Feature plays enter The Getaway directly: their entry board is presentation only and never adds a win of its own.",
      ),
    );

    parent.appendChild(this.sep("Collection & Head-Start"));
    parent.appendChild(this.bodyText(COLLECTION_RULES));
  }

  // ────────────────────────── CONTROLS tab ──────────────────────────

  private renderControlsTab(parent: HTMLElement): void {
    const t = this.hooks.getUiStrings();
    const social = this.hooks.isSocial();
    const amount = t.betLabel.toLowerCase();

    parent.appendChild(this.sep("Controls"));
    const controls: Array<[string, string]> = [
      ["SPIN", `Plays one round at the shown ${amount} amount. On desktop the SPACEBAR also spins (only while no window is open). During autoplay this button shows STOP and halts the run.`],
      ["+ / −", `Raise or lower the ${amount} amount through the levels provided by the operator. Locked while a round or autoplay is running.`],
      ["☰ MENU", "Opens this menu on the GAME tab: spin speed (Normal / Turbo / Extra Turbo) and Autoplay. Autoplay needs a spin count selection plus a separate Start press, and stops automatically if the balance cannot cover the next spin."],
      ["📻 RADIO", "Music and sound: pick a station or OFF to mute all game audio."],
      ["i INFO", `Opens this menu on the ${t.paytableTab.toUpperCase()} tab with all game information.`],
      ["CLOSE ✕", "Closes this menu (or press Esc on a keyboard)."],
      [social ? "GETAWAY / SUPER" : "BUY GETAWAY / SUPER", `Feature plays: open a confirmation window showing the full price (100x / 500x your ${amount}) before anything is played.`],
      ["ANTE", `Toggles Ante Mode (1.5x ${amount}) with more Wilds and Armored Trucks.`],
      ["GALLERY CARD", "Shows your Collection progress. Holding SPACE during a spin gives momentary turbo."],
    ];
    for (const [name, txt] of controls) {
      const row = document.createElement("div");
      row.className = "gta-ctl";
      const n = document.createElement("span");
      n.className = "name";
      n.textContent = name;
      const d = document.createElement("span");
      d.className = "txt";
      d.textContent = txt;
      row.append(n, d);
      parent.appendChild(row);
    }
  }

  // ──────────────────────────── INFO tab ────────────────────────────

  private renderInfoTab(parent: HTMLElement): void {
    const social = this.hooks.isSocial();

    parent.appendChild(this.sep("Game Information"));
    parent.appendChild(
      this.bodyText(
        social
          ? "Heat Chase: Grand Escape — cluster game on a 5x4 grid with cascading wins, a Wanted Level meter and The Getaway Hold & Spin bonus. Every mode returns an expected 96.00% over many plays; wins are capped at 5,000x the base play amount."
          : "Heat Chase: Grand Escape — cluster-pays slot on a 5x4 grid with cascading wins, a Wanted Level meter and The Getaway Hold & Spin bonus. Every mode returns an expected 96.00% RTP over many plays; wins are capped at 5,000x the base bet.",
      ),
    );

    parent.appendChild(this.sep("Disclaimer"));
    parent.appendChild(this.bodyText(DISCLAIMER));
  }

  /** Special-symbol row: image + name + description. */
  private specialRow(symId: SymbolId, name: string, description: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "gta-special";
    const img = document.createElement("img");
    img.src = symbolImgSrc(symId);
    img.alt = name;
    img.draggable = false;
    const right = document.createElement("div");
    const n = document.createElement("div");
    n.className = "name";
    n.textContent = name.toUpperCase();
    n.style.color = num2hex(SYMBOL_ASSETS[symId].stroke);
    const d = document.createElement("div");
    d.className = "txt";
    d.textContent = description;
    right.append(n, d);
    row.append(img, right);
    return row;
  }

  private bodyText(text: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "gta-body";
    d.textContent = text;
    return d;
  }

  // ───────────────────── shared row/keyboard plumbing ─────────────────────

  private onKey = (e: KeyboardEvent): void => {
    const row = this.rows[this.selIndex];
    switch (e.key) {
      case "Escape":
        this.close();
        break;
      case "q":
      case "Q":
        this.stepTab(-1);
        break;
      case "e":
      case "E":
        this.stepTab(1);
        break;
      case "ArrowUp":
        if (this.tab === "game") this.moveSelection(-1);
        else this.scrollEl?.scrollBy({ top: -80, behavior: "smooth" });
        break;
      case "ArrowDown":
        if (this.tab === "game") this.moveSelection(1);
        else this.scrollEl?.scrollBy({ top: 80, behavior: "smooth" });
        break;
      case "ArrowLeft":
        if (row && !row.disabled && row.onLeft) {
          this.hooks.playClick?.();
          row.onLeft();
        }
        break;
      case "ArrowRight":
        if (row && !row.disabled && row.onRight) {
          this.hooks.playClick?.();
          row.onRight();
        }
        break;
      case "Enter":
        if (row && !row.disabled && row.onActivate) {
          this.hooks.playClick?.();
          row.onActivate();
        }
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  private moveSelection(dir: number): void {
    if (this.rows.length === 0) return;
    this.selIndex = (this.selIndex + dir + this.rows.length) % this.rows.length;
    this.hooks.playClick?.();
    this.updateSelection();
    this.rows[this.selIndex]?.el.scrollIntoView({ block: "nearest" });
  }

  /** Applies the white-on-black inversion to the selected row and syncs the description box. */
  private updateSelection(): void {
    for (let i = 0; i < this.rows.length; i++) {
      this.rows[i].el.classList.toggle("sel", i === this.selIndex);
    }
    const row = this.rows[this.selIndex];
    if (this.descEl && row) this.descEl.textContent = row.desc;
  }

  /** Arms/disarms the Start Autoplay row (step 2 of the confirmation). */
  private setStartArmed(armed: boolean): void {
    if (!this.startRow) return;
    this.startRow.disabled = !armed;
    this.startRow.el.classList.toggle("disabled", !armed);
  }

  private sep(text: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "gta-sep";
    d.textContent = text;
    return d;
  }

  /** Registers a row: hover selects it (GTA-style), click behavior comes from the caller. */
  private registerRow(row: MenuRow): MenuRow {
    const index = this.rows.length;
    this.rows.push(row);
    row.el.addEventListener("pointerenter", () => {
      if (this.selIndex === index) return;
      this.selIndex = index;
      this.updateSelection();
    });
    return row;
  }

  private addValueRow(
    parent: HTMLElement,
    opts: {
      label: string;
      desc: string;
      disabled: boolean;
      display: () => string;
      cycle: (dir: -1 | 1) => void;
    },
  ): MenuRow {
    const el = document.createElement("div");
    el.className = `gta-row${opts.disabled ? " disabled" : ""}`;

    const label = document.createElement("span");
    label.textContent = opts.label;
    el.appendChild(label);

    const val = document.createElement("span");
    val.className = "gta-val";
    const left = document.createElement("span");
    left.className = "gta-arr";
    left.textContent = "◄";
    const text = document.createElement("span");
    text.className = "gta-val-text";
    text.textContent = opts.display();
    const right = document.createElement("span");
    right.className = "gta-arr";
    right.textContent = "►";
    val.append(left, text, right);
    el.appendChild(val);

    const cycle = (dir: -1 | 1): void => {
      if (row.disabled) return;
      this.hooks.playClick?.();
      opts.cycle(dir);
      text.textContent = opts.display();
    };
    left.addEventListener("click", (e) => {
      e.stopPropagation();
      cycle(-1);
    });
    right.addEventListener("click", (e) => {
      e.stopPropagation();
      cycle(1);
    });
    el.addEventListener("click", () => cycle(1)); // tapping the row steps forward (touch)

    const row: MenuRow = {
      el,
      desc: opts.desc,
      disabled: opts.disabled,
      onLeft: () => cycle(-1),
      onRight: () => cycle(1),
    };
    parent.appendChild(el);
    return this.registerRow(row);
  }

  private addActionRow(
    parent: HTMLElement,
    opts: {
      label: string;
      desc: string;
      disabled?: boolean;
      danger?: boolean;
      onActivate: () => void;
    },
  ): MenuRow {
    const el = document.createElement("div");
    el.className = `gta-row${opts.disabled ? " disabled" : ""}${opts.danger ? " danger" : ""}`;
    const label = document.createElement("span");
    label.textContent = opts.label;
    el.appendChild(label);

    const row: MenuRow = {
      el,
      desc: opts.desc,
      disabled: opts.disabled ?? false,
      onActivate: opts.onActivate,
    };
    el.addEventListener("click", () => {
      if (row.disabled) return;
      this.hooks.playClick?.();
      row.onActivate?.();
    });
    parent.appendChild(el);
    return this.registerRow(row);
  }
}
