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
 *  PAYTABLE  — per-symbol payouts that exactly match the math model
 *              (domain.ts mirrors stake-math/src/model.ts; a test pins them
 *              together) + win-combination rules.
 *  FEATURES  — cascade multiplier, Wanted Level, The Getaway, special
 *              symbols, Collection & Head-Start.
 *  CONTROLS  — the user-interaction guide covering every button.
 *  INFO      — the mandatory Stake Engine disclaimer.
 *
 * Together the tabs satisfy the Stake approval checklist (previously the Pixi
 * PaytableView). All wording flows through hooks.getUiStrings() so social
 * casinos (Stake.US) never see a restricted word. No hit rates /
 * probabilities are ever displayed.
 *
 * DOM overlay (same pattern as confirmPopup / RadioWheel) so it stays
 * decoupled from the Pixi scene and is cheap to mount/unmount.
 */

import {
  CASCADE_LADDER,
  CLUSTER_PAY_X,
  CLUSTER_SIZE_FACTORS,
  SYMBOLS,
  type SymbolId,
} from "./domain";
import { SYMBOL_ASSETS } from "./pixi/assets";

export type TurboMode = "off" | "turbo" | "super";
export type MenuTab = "game" | "modes" | "paytable" | "features" | "controls" | "info";

const TABS: Array<{ key: MenuTab; label: string }> = [
  { key: "game", label: "Game" },
  { key: "modes", label: "Modes" },
  { key: "paytable", label: "Paytable" },
  { key: "features", label: "Features" },
  { key: "controls", label: "Controls" },
  { key: "info", label: "Info" },
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
  getUiStrings(): { betLabel: string; costWord: string; betWord: string };
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

/** Representative cluster sizes shown as paytable columns. */
const SHOWN_SIZES = [5, 8, 12, 15, 20];

const SYMBOL_GROUPS: Array<{ title: string; color: string; symbols: SymbolId[] }> = [
  { title: "Premium", color: "#ffdf65", symbols: ["BIKE", "DIAMOND", "CASH"] },
  { title: "Mid", color: "#9ae64e", symbols: ["DUFFEL", "AMMO", "PISTOL"] },
  { title: "Low", color: "#fb6f52", symbols: ["KNIFE", "BRASS"] },
];

const TIER_COLOR: Record<string, string> = {
  premium: "#ffdf65",
  mid: "#9ae64e",
  low: "#fb6f52",
};

const DISCLAIMER =
  "Malfunction voids all wins and plays. A consistent internet connection is required. " +
  "In the event of a disconnection, reload the game to finish any uncompleted rounds. " +
  "The expected return is calculated over many plays. The game display is not representative " +
  "of any physical device and is for illustrative purposes only. Winnings are settled according " +
  "to the amount received from the Remote Game Server and not from events within the web browser. " +
  "TM and © 2026 Stake Engine.";

/** Exact pay value for a symbol at a cluster size, matching the engine. */
function payAt(symId: SymbolId, size: number): number {
  const base = CLUSTER_PAY_X[symId] ?? 0;
  const factor = CLUSTER_SIZE_FACTORS[Math.min(size, 20) - 5] ?? 0;
  return Number((base * factor).toFixed(4));
}

/** Trim trailing zeros but keep full precision (0.048 stays 0.048). */
function fmtX(v: number): string {
  return `${Number(v.toFixed(4))}x`;
}

function num2hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

function symbolImgSrc(symId: SymbolId): string {
  return `assets/${SYMBOL_ASSETS[symId].assetKey}`;
}

// Chalet (the actual GTA V UI face) is proprietary; Archivo Narrow is the
// closest free match and is loaded from index.html, with Arial Narrow as the
// no-network fallback.
const FONT = `'Archivo Narrow','Arial Narrow','Helvetica Neue',Helvetica,Arial,sans-serif`;

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
  .gta-head{padding:clamp(12px,3.5vh,30px) var(--gx) 10px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;}
  .gta-close-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);border-radius:6px;
    color:#fff;font-family:${FONT};font-size:clamp(12px,2.4vw,15px);font-weight:700;letter-spacing:1px;
    padding:6px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .15s ease-out;outline:none;}
  .gta-close-btn:hover, .gta-close-btn:active{background:#fff;color:#000;border-color:#fff;}
  .gta-hints{display:flex;justify-content:flex-end;gap:20px;padding:8px var(--gx) 12px;flex-shrink:0;
    font-size:clamp(11px,2.2vw,12.5px);letter-spacing:1px;color:rgba(255,255,255,.6);text-transform:uppercase;
    flex-wrap:wrap;align-items:center;}
  .gta-key{display:inline-block;border:1px solid rgba(255,255,255,.55);border-radius:3px;
    padding:1px 6px;margin-right:6px;font-size:11px;color:#fff;}
  .gta-esc-btn{cursor:pointer;display:inline-flex;align-items:center;padding:3px 10px;border-radius:5px;
    background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;transition:all .15s ease-out;}
  .gta-esc-btn:hover, .gta-esc-btn:active{background:#fff;color:#000;border-color:#fff;}
  .gta-esc-btn:hover .gta-key, .gta-esc-btn:active .gta-key{border-color:#000;color:#000;}
  /* ── info tabs ── */
  .gta-payhead,.gta-symrow{display:grid;align-items:center;
    grid-template-columns:minmax(clamp(110px,30vw,220px),1.6fr) repeat(5,1fr);
    padding:7px var(--gx);margin-top:2px;}
  .gta-payhead{background:rgba(0,0,0,.72);color:rgba(255,255,255,.55);font-weight:600;
    font-size:clamp(11px,2.2vw,13px);letter-spacing:1px;}
  .gta-payhead span{text-align:center;}
  .gta-symrow{background:rgba(0,0,0,.52);}
  .gta-symcell{display:flex;align-items:center;gap:clamp(6px,1.6vw,12px);min-width:0;}
  .gta-symcell img{width:clamp(28px,6vw,42px);height:clamp(28px,6vw,42px);object-fit:contain;flex-shrink:0;}
  .gta-symcell span{font-weight:600;font-size:clamp(12px,2.6vw,15.5px);letter-spacing:.3px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .gta-pay{text-align:center;font-weight:600;font-size:clamp(11px,2.4vw,14px);}
  .gta-tier{padding:14px var(--gx) 4px;font-size:clamp(11px,2.2vw,12.5px);font-weight:600;
    letter-spacing:2px;text-transform:uppercase;}
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

    const closeBtn = document.createElement("button");
    closeBtn.className = "gta-close-btn";
    closeBtn.innerHTML = `<span class="gta-key" style="margin:0">Esc</span> Back ✕`;
    closeBtn.addEventListener("click", () => {
      this.hooks.playClick?.();
      this.close();
    });

    head.append(title, closeBtn);
    overlay.appendChild(head);

    const tabs = document.createElement("div");
    tabs.className = "gta-tabs";
    for (const { key, label } of TABS) {
      const t = document.createElement("div");
      t.className = "gta-tab";
      t.textContent = label;
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

    const escMarkup = `<span class="gta-esc-btn" id="gta-esc-hint"><span class="gta-key">Esc</span>Back</span>`;

    // Selection + description box only exist on the interactive GAME tab.
    if (this.tab === "game") {
      this.descEl.style.display = "";
      this.hintsEl.innerHTML =
        `<span><span class="gta-key">◄ ►</span>Change</span>` +
        `<span><span class="gta-key">⏎</span>Select</span>` +
        `<span><span class="gta-key">Q / E</span>Tab</span>` +
        escMarkup;
      this.updateSelection();
    } else {
      this.descEl.style.display = "none";
      this.hintsEl.innerHTML =
        `<span><span class="gta-key">▲ ▼</span>Scroll</span>` +
        `<span><span class="gta-key">Q / E</span>Tab</span>` +
        escMarkup;
    }

    const escBtn = this.hintsEl.querySelector("#gta-esc-hint");
    escBtn?.addEventListener("click", () => {
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
      { key: "base_tier1", name: "Head-Start I", desc: "Base game variant reached through the free Collection: The Getaway appears more often. Same cost as the base game." },
      { key: "base_tier2", name: "Head-Start II", desc: "Second Collection level: The Getaway appears even more often. Same cost as the base game." },
      { key: "base_tier3", name: "Head-Start III", desc: "Highest Collection level with the most frequent Getaway. Same cost as the base game." },
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
      stat.textContent = `${t.costWord}: ${Number(mult.toFixed(2))}x ${t.betWord} · RTP 96.00% · MAX WIN 5,000x`;
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
    const betWord = this.hooks.getUiStrings().betWord;

    parent.appendChild(this.sep("Symbol Payouts"));
    parent.appendChild(
      this.bodyText(
        `Symbols pay in CLUSTERS of 5 or more matching symbols connected horizontally or vertically. Values below are multiples of your total ${betWord.toLowerCase()} and show the cluster's base pay BEFORE the cascade multiplier is applied.`,
      ),
    );
    const head = document.createElement("div");
    head.className = "gta-payhead";
    const spacer = document.createElement("span");
    spacer.style.textAlign = "left";
    spacer.textContent = "Symbol";
    head.appendChild(spacer);
    for (const size of SHOWN_SIZES) {
      const c = document.createElement("span");
      c.textContent = size === 20 ? "20" : `${size}+`;
      head.appendChild(c);
    }
    parent.appendChild(head);

    for (const group of SYMBOL_GROUPS) {
      const tier = document.createElement("div");
      tier.className = "gta-tier";
      tier.textContent = group.title;
      tier.style.color = group.color;
      parent.appendChild(tier);
      for (const symId of group.symbols) {
        parent.appendChild(this.symbolRow(symId));
      }
    }

    parent.appendChild(this.sep("Cluster Size Factor"));
    parent.appendChild(
      this.bodyText(
        "The symbol value scales with the size of the cluster: " +
          "5: ×0.4 · 6: ×0.7 · 7: ×1 · 8: ×1.4 · 9: ×1.9 · 10: ×2.5 · 11: ×3.2 · 12: ×4 · " +
          "13: ×5 · 14: ×6.2 · 15: ×7.6 · 16: ×9.2 · 17: ×11 · 18: ×13 · 19: ×15.5 · 20: ×18.",
      ),
    );
    parent.appendChild(this.sep("How A Win Is Calculated"));
    parent.appendChild(
      this.bodyText(
        `CLUSTER WIN = symbol value × size factor × cascade multiplier. Example: a 12-symbol Cash cluster on the 3rd cascade pays 0.8 × 4 × 4 = 12.8x your ${betWord.toLowerCase()}.`,
      ),
    );
  }

  // ────────────────────────── FEATURES tab ──────────────────────────

  private renderFeaturesTab(parent: HTMLElement): void {
    const betWord = this.hooks.getUiStrings().betWord;

    parent.appendChild(this.sep("Cascade Multiplier"));
    parent.appendChild(
      this.bodyText(
        `Winning clusters are removed and new symbols tumble in. Each tumble climbs the multiplier ladder one rung: ${CASCADE_LADDER.join("x → ")}x. The current rung multiplies EVERY win of that tumble. The ladder resets at the start of each spin.`,
      ),
    );

    parent.appendChild(this.sep("Wanted Level (Heat)"));
    parent.appendChild(
      this.bodyText(
        "The five stars above the reels are the live Wanted Level: each winning tumble in a spin adds one star. " +
          "2★ BUST THE STASH — all Brass Knuckles and Knives on the board transform into Cash. " +
          "3★ and 4★ GETAWAY DRIVER — a 2x2 mega wild car is placed on the board. " +
          "5★ — THE GETAWAY bonus triggers on that same spin. The stars reset at the start of every spin. " +
          "Gold stars shown before a spin are Head-Start stars from the Collection — they pre-fill the meter so fewer tumbles are needed.",
      ),
    );

    parent.appendChild(this.sep("The Getaway — Hold & Spin"));
    parent.appendChild(
      this.specialRow("SAFE", "Gold Bar", `Sticky value symbol worth 1x–750x your ${betWord.toLowerCase()} (higher value tables in feature plays).`),
    );
    parent.appendChild(
      this.specialRow("MASTER_KEY", "Dynamite", "Doubles the value of every adjacent Gold Bar, then clears its cell."),
    );
    parent.appendChild(
      this.bodyText(
        "Triggered by reaching a 5★ Wanted Level or by landing 3 or more Armored Trucks on one paid spin. " +
          "The bonus starts with 4 respins on an empty 5x4 grid. Every spin that locks at least one new symbol grants +1 respin; " +
          "a spin that locks nothing uses one respin. The bonus ends when no respins remain — all locked Gold Bar values are then paid out — " +
          "or instantly when all 20 cells are filled, which awards the 5,000x MAX WIN.",
      ),
    );

    parent.appendChild(this.sep("Special Symbols"));
    parent.appendChild(
      this.specialRow("CAR_WILD", "Cyan Sports Car", "WILD — substitutes for every paying symbol. At 3★/4★ Wanted Level it lands as a 2x2 mega wild."),
    );
    parent.appendChild(
      this.specialRow("WILD", "Beach Girl Wild", "WILD — substitutes for every paying symbol AND reveals one Collection gallery piece each time it lands."),
    );
    parent.appendChild(
      this.specialRow("PHONE_SCATTER", "Armored Truck", "SCATTER — pays no prize of its own; 3 or more on one paid spin trigger The Getaway."),
    );
    parent.appendChild(
      this.bodyText(
        "Armored Trucks award no coin prize — their only function is triggering the bonus. " +
          "Feature plays enter The Getaway directly: the entry board is presentation only and never awards a scatter prize of its own.",
      ),
    );

    parent.appendChild(this.sep("Collection & Head-Start"));
    parent.appendChild(
      this.bodyText(
        "Every Beach Girl Wild that lands reveals one gallery piece (tap the card next to the reels to view the gallery). " +
          "Completing a gallery girl arms one gold Wanted star for future spins; collecting points unlocks Head-Start levels " +
          "that route standard spins to the Head-Start modes listed on the MODES tab. Head-Start modes cost the same as the base game and " +
          "return the same 96.00% — The Getaway simply appears more often in them. The Collection is a free extra: it never " +
          "changes the price of a spin and never adds extra value beyond the listed modes. A natural 5★ Getaway consumes the " +
          "armed gold stars; the highest Head-Start level resets the gallery when used.",
      ),
    );
  }

  // ────────────────────────── CONTROLS tab ──────────────────────────

  private renderControlsTab(parent: HTMLElement): void {
    const t = this.hooks.getUiStrings();
    const social = this.hooks.isSocial();

    parent.appendChild(this.sep("Controls"));
    const controls: Array<[string, string]> = [
      ["SPIN", `Plays one round at the shown ${t.betLabel.toLowerCase()} amount. On desktop the SPACEBAR also spins (only while no window is open). During autoplay this button shows STOP and halts the run.`],
      ["+ / −", `Raise or lower the ${t.betLabel.toLowerCase()} amount through the levels provided by the operator. Locked while a round or autoplay is running.`],
      ["☰ MENU", "Opens this menu on the GAME tab: spin speed (Normal / Turbo / Extra Turbo) and Autoplay. Autoplay needs a spin count selection plus a separate Start press, and stops automatically if the balance cannot cover the next spin."],
      ["📻 RADIO", "Music and sound: pick a station or OFF to mute all game audio."],
      ["i INFO", "Opens this menu on the PAYTABLE tab with all game information."],
      [social ? "GETAWAY / SUPER" : "BUY GETAWAY / SUPER", `Feature plays: open a confirmation window showing the full price (100x / 500x your ${t.betLabel.toLowerCase()}) before anything is played.`],
      ["ANTE", `Toggles Ante Mode (1.5x ${t.betLabel.toLowerCase()}) with more Wilds and Armored Trucks.`],
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
          ? "Heat Chase: Grand Escape — cluster-pays game on a 6x5 grid with cascading wins, a Wanted Level meter and The Getaway Hold & Spin bonus. Every mode returns an expected 96.00% over many plays; wins are capped at 5,000x the base play amount."
          : "Heat Chase: Grand Escape — cluster-pays slot on a 6x5 grid with cascading wins, a Wanted Level meter and The Getaway Hold & Spin bonus. Every mode returns an expected 96.00% RTP over many plays; wins are capped at 5,000x the base bet.",
      ),
    );

    parent.appendChild(this.sep("Disclaimer"));
    parent.appendChild(this.bodyText(DISCLAIMER));
  }

  /** Paytable row: symbol image + name + exact pay columns (engine values). */
  private symbolRow(symId: SymbolId): HTMLDivElement {
    const def = SYMBOLS[symId];
    const row = document.createElement("div");
    row.className = "gta-symrow";

    const cell = document.createElement("div");
    cell.className = "gta-symcell";
    const img = document.createElement("img");
    img.src = symbolImgSrc(symId);
    img.alt = def.label;
    img.draggable = false;
    const name = document.createElement("span");
    name.textContent = def.label.toUpperCase();
    name.style.color = num2hex(SYMBOL_ASSETS[symId].text);
    cell.append(img, name);
    row.appendChild(cell);

    const color = TIER_COLOR[def.tier] ?? "#fff";
    for (const size of SHOWN_SIZES) {
      const pay = document.createElement("span");
      pay.className = "gta-pay";
      pay.textContent = fmtX(payAt(symId, size));
      pay.style.color = color;
      row.appendChild(pay);
    }
    return row;
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
