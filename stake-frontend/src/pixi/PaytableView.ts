import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import {
  CASCADE_LADDER,
  CLUSTER_PAY_X,
  CLUSTER_SIZE_FACTORS,
  SYMBOLS,
  type SymbolId
} from "../domain";
import { getSymbolTexture, SYMBOL_ASSETS } from "./assets";
import type { SceneRuntime } from "./types";

/**
 * GAME INFO / paytable overlay. Contents satisfy the Stake approval checklist:
 *  - RTP, Max Win and cost stated individually for EVERY bet mode
 *  - per-symbol payouts that EXACTLY match the math model (domain.ts mirrors
 *    stake-math/src/model.ts; a test pins them together)
 *  - win-combination rules (cluster sizes + size factors + cascade ladder)
 *  - feature trigger/retrigger conditions, scatter clarification
 *  - a user-interaction guide covering every button
 *  - the mandatory Stake Engine disclaimer
 * All wording flows through runtime.getUiStrings() so social casinos
 * (Stake.US) never see a restricted word. No hit rates / probabilities are
 * ever displayed.
 */

/** Representative cluster sizes shown as paytable columns. */
const SHOWN_SIZES = [5, 8, 12, 15, 20];

interface SymbolGroup {
  title: string;
  titleColor: number;
  symbols: SymbolId[];
}

const SYMBOL_GROUPS: SymbolGroup[] = [
  { title: "PREMIUM", titleColor: 0xffdf65, symbols: ["BIKE", "DIAMOND", "CASH"] },
  { title: "MID", titleColor: 0x9ae64e, symbols: ["DUFFEL", "AMMO", "PISTOL"] },
  { title: "LOW", titleColor: 0xfb6f52, symbols: ["KNIFE", "BRASS"] }
];

const GOLD = 0xffdf65;
const CYAN = 0x9ae64e;
const PANEL_BG = 0x0a0f24;
const OVERLAY_BG = 0x000000;
const BORDER_GOLD = 0xb8962e;
const TEXT_WHITE = 0xffffff;
const TEXT_DIM = 0x8a9cbf;

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

export class PaytableView extends Container {
  private bg = new Graphics();
  private panel = new Graphics();
  private contentContainer = new Container();
  private scrollMask = new Graphics();
  private scrollY = 0;
  private contentHeight = 0;
  private panelRect = { x: 0, y: 0, w: 0, h: 0 };
  private isVisible = false;
  private screenW = 0;
  private screenH = 0;
  private title: Text | null = null;
  private closeBtn: Container | null = null;

  constructor(private readonly runtime: SceneRuntime) {
    super();
    this.visible = false;
    this.eventMode = "static";
    this.interactiveChildren = true;

    this.addChild(this.bg);
    this.addChild(this.panel);
    this.addChild(this.contentContainer);
    this.contentContainer.mask = this.scrollMask;
    this.addChild(this.scrollMask);

    // Block clicks from propagating through overlay
    this.bg.eventMode = "static";
    this.bg.on("pointertap", () => { /* absorb */ });

    // Scroll handling
    this.on("wheel", (e: WheelEvent) => {
      this.scrollContent(-e.deltaY);
    });

    // Touch drag scrolling
    let dragStartY = 0;
    let dragScrollStart = 0;
    let isDragging = false;

    this.on("pointerdown", (e) => {
      dragStartY = e.globalY ?? e.clientY ?? 0;
      dragScrollStart = this.scrollY;
      isDragging = true;
    });
    this.on("pointermove", (e) => {
      if (!isDragging) return;
      const currentY = e.globalY ?? e.clientY ?? 0;
      const delta = currentY - dragStartY;
      this.scrollY = dragScrollStart + delta;
      this.clampScroll();
      this.contentContainer.y = this.panelRect.y + 60 + this.scrollY;
    });
    this.on("pointerup", () => { isDragging = false; });
    this.on("pointerupoutside", () => { isDragging = false; });
  }

  show(screenWidth: number, screenHeight: number): void {
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    this.scrollY = 0;
    this.rebuild();
    this.visible = true;
    this.isVisible = true;
  }

  hide(): void {
    this.visible = false;
    this.isVisible = false;
  }

  toggle(screenWidth: number, screenHeight: number): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show(screenWidth, screenHeight);
    }
  }

  private scrollContent(delta: number): void {
    this.scrollY += delta * 0.5;
    this.clampScroll();
    this.contentContainer.y = this.panelRect.y + 60 + this.scrollY;
  }

  private clampScroll(): void {
    const viewportH = this.panelRect.h - 120; // leave room for title + footer
    const maxScroll = 0;
    const minScroll = Math.min(0, viewportH - this.contentHeight);
    this.scrollY = Math.max(minScroll, Math.min(maxScroll, this.scrollY));
  }

  private rebuild(): void {
    const w = this.screenW;
    const h = this.screenH;
    const t = this.runtime.getUiStrings();
    const social = this.runtime.isSocial();

    // --- Fullscreen dark overlay ---
    this.bg.clear();
    this.bg.rect(0, 0, w, h).fill({ color: OVERLAY_BG, alpha: 0.95 });

    // --- Centered panel ---
    const pw = Math.min(w * 0.9, 820);
    const ph = Math.min(h * 0.9, 940);
    const px = (w - pw) / 2;
    const py = (h - ph) / 2;
    this.panelRect = { x: px, y: py, w: pw, h: ph };

    this.panel.clear();
    this.panel.roundRect(px - 2, py - 2, pw + 4, ph + 4, 16).stroke({ color: CYAN, width: 1, alpha: 0.25 });
    this.panel.roundRect(px, py, pw, ph, 14).fill({ color: PANEL_BG, alpha: 0.97 });
    this.panel.roundRect(px, py, pw, ph, 14).stroke({ color: BORDER_GOLD, width: 3, alpha: 0.85 });
    this.panel.roundRect(px + 4, py + 4, pw - 8, ph - 8, 10).stroke({ color: GOLD, width: 1, alpha: 0.2 });
    this.panel.roundRect(px + 20, py + 2, pw - 40, 4, 2).fill({ color: GOLD, alpha: 0.25 });

    // --- Scroll mask ---
    this.scrollMask.clear();
    const maskTop = py + 56;
    const maskH = ph - 116;
    this.scrollMask.rect(px, maskTop, pw, maskH).fill(0xffffff);

    // --- Build content ---
    this.contentContainer.removeChildren();
    if (this.title) { this.title.destroy(); this.title = null; }
    if (this.closeBtn) { this.closeBtn.destroy({ children: true }); this.closeBtn = null; }

    let y = 4;
    const innerW = pw - 40;
    const leftPad = px + 20;

    this.title = new Text({
      text: "GAME INFO",
      style: new TextStyle({
        fill: GOLD,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 34,
        fontWeight: "900",
        letterSpacing: 4,
        dropShadow: { color: CYAN, alpha: 0.4, blur: 10, distance: 0 }
      })
    });
    this.title.anchor.set(0.5, 0);
    this.title.position.set(px + pw / 2, py + 14);
    this.addChild(this.title);

    // ════ 1. GAME MODES — RTP / Max Win / cost for every mode offered ════
    y = this.section("GAME MODES", GOLD, y);
    const costWord = t.costWord;
    const betWord = t.betWord;
    const modes = this.runtime.getBetModes();
    const modeCards: Array<{ key: string; name: string; desc: string }> = [
      { key: "base", name: "BASE GAME", desc: "The standard game. Every spin is played at your selected amount." },
      { key: "ante", name: "ANTE MODE", desc: "Plays at 1.5x your selected amount. Wilds and Armored Trucks appear more often, so The Getaway triggers more frequently." },
      { key: "getaway", name: "THE GETAWAY", desc: "Starts The Getaway Hold & Spin immediately. Gold bar values use an increased value table." },
      { key: "super_getaway", name: "SUPER GETAWAY", desc: "Starts The Getaway immediately with the highest gold bar value table." },
      { key: "base_tier1", name: "HEAD-START I", desc: "Base game variant reached through the free Collection: The Getaway appears more often. Same cost as the base game." },
      { key: "base_tier2", name: "HEAD-START II", desc: "Second Collection level: The Getaway appears even more often. Same cost as the base game." },
      { key: "base_tier3", name: "HEAD-START III", desc: "Highest Collection level with the most frequent Getaway. Same cost as the base game." }
    ];
    for (const card of modeCards) {
      const rgsMode = modes[card.key];
      if (!rgsMode) continue; // only document modes this session actually offers
      const mult = rgsMode.costMultiplier ?? 1;
      const costLine = `${costWord}: ${Number(mult.toFixed(2))}x ${betWord}`;
      y = this.modeCard(card.name, card.desc, `${costLine}   ·   RTP 96.00%   ·   MAX WIN 5,000x`, innerW, y);
    }
    y = this.body(
      social
        ? "Every mode returns an expected 96.00% over many plays and every mode's win is capped at 5,000x the base play amount."
        : "Every mode returns an expected 96.00% RTP over many plays and every mode's win is capped at 5,000x the base bet.",
      innerW, y) + 6;

    // ════ 2. SYMBOL PAYOUTS — exact engine values ════
    y = this.section("SYMBOL PAYOUTS", GOLD, y);
    y = this.body(
      `Symbols pay in CLUSTERS of 5 or more matching symbols connected horizontally or vertically. Values below are multiples of your total ${betWord.toLowerCase()} and show the cluster's base pay BEFORE the cascade multiplier is applied.`,
      innerW, y);

    const headerRow = this.buildClusterHeader(innerW);
    headerRow.y = y;
    this.contentContainer.addChild(headerRow);
    y += 26;
    y += this.addSeparator(innerW, y, GOLD, 0.3);

    for (const group of SYMBOL_GROUPS) {
      y += 6;
      const groupLabel = this.makeImpactText(group.title, 18, group.titleColor);
      groupLabel.position.set(0, y);
      this.contentContainer.addChild(groupLabel);
      y += 26;

      for (const symId of group.symbols) {
        const row = this.buildSymbolRow(symId, innerW);
        row.position.set(0, y);
        this.contentContainer.addChild(row);
        y += this.getRowHeight(innerW) + 4;
      }
      y += this.addSeparator(innerW, y, group.titleColor, 0.15);
    }

    y = this.body(
      "Cluster size factor — the symbol value scales with the size of the cluster: " +
      "5: ×0.4 · 6: ×0.7 · 7: ×1 · 8: ×1.4 · 9: ×1.9 · 10: ×2.5 · 11: ×3.2 · 12: ×4 · " +
      "13: ×5 · 14: ×6.2 · 15: ×7.6 · 16: ×9.2 · 17: ×11 · 18: ×13 · 19: ×15.5 · 20: ×18.",
      innerW, y);
    y = this.body(
      `CLUSTER WIN = symbol value × size factor × cascade multiplier. Example: a 12-symbol Cash cluster on the 3rd cascade pays 0.8 × 4 × 4 = 12.8x your ${betWord.toLowerCase()}.`,
      innerW, y) + 6;

    // ════ 3. CASCADE MULTIPLIER ════
    y = this.section("CASCADE MULTIPLIER", CYAN, y);
    y = this.body(
      `Winning clusters are removed and new symbols tumble in. Each tumble climbs the multiplier ladder one rung: ${CASCADE_LADDER.join("x → ")}x. The current rung multiplies EVERY win of that tumble. The ladder resets at the start of each spin.`,
      innerW, y) + 6;

    // ════ 4. WANTED LEVEL ════
    y = this.section("WANTED LEVEL (HEAT)", CYAN, y);
    y = this.body(
      "The five stars above the reels are the live Wanted Level: each winning tumble in a spin adds one star. " +
      "2★ BUST THE STASH — all Brass Knuckles and Knives on the board transform into Cash. " +
      "3★ and 4★ GETAWAY DRIVER — a 2x2 mega wild car is placed on the board. " +
      "5★ — THE GETAWAY bonus triggers on that same spin. The stars reset at the start of every spin. " +
      "Gold stars shown before a spin are Head-Start stars from the Collection — they pre-fill the meter so fewer tumbles are needed.",
      innerW, y) + 6;

    // ════ 5. THE GETAWAY (HOLD & SPIN) ════
    y = this.section("THE GETAWAY — HOLD & SPIN", GOLD, y);
    y = this.specialRow("SAFE", "Gold Bar", `Sticky value symbol worth 1x–750x your ${betWord.toLowerCase()} (higher value tables in feature plays).`, innerW, y);
    y = this.specialRow("MASTER_KEY", "Dynamite", "Doubles the value of every adjacent Gold Bar, then clears its cell.", innerW, y);
    y = this.body(
      "Triggered by reaching a 5★ Wanted Level or by landing 3 or more Armored Trucks on one paid spin. " +
      "The bonus starts with 4 respins on an empty 5x4 grid. Every spin that locks at least one new symbol grants +1 respin; " +
      "a spin that locks nothing uses one respin. The bonus ends when no respins remain — all locked Gold Bar values are then paid out — " +
      "or instantly when all 20 cells are filled, which awards the 5,000x MAX WIN.",
      innerW, y) + 6;

    // ════ 6. SPECIAL SYMBOLS ════
    y = this.section("SPECIAL SYMBOLS", CYAN, y);
    y = this.specialRow("CAR_WILD", "Cyan Sports Car", "WILD — substitutes for every paying symbol. At 3★/4★ Wanted Level it lands as a 2x2 mega wild.", innerW, y);
    y = this.specialRow("WILD", "Beach Girl Wild", "WILD — substitutes for every paying symbol AND reveals one Collection gallery piece each time it lands.", innerW, y);
    y = this.specialRow("PHONE_SCATTER", "Armored Truck", "SCATTER — pays no prize of its own; 3 or more on one paid spin trigger The Getaway.", innerW, y);
    y = this.body(
      "Armored Trucks award no coin prize — their only function is triggering the bonus. " +
      "Feature plays enter The Getaway directly: the entry board is presentation only and never awards a scatter prize of its own.",
      innerW, y) + 6;

    // ════ 7. COLLECTION & HEAD-START ════
    y = this.section("COLLECTION & HEAD-START", CYAN, y);
    y = this.body(
      "Every Beach Girl Wild that lands reveals one gallery piece (tap the card next to the reels to view the gallery). " +
      "Completing a gallery girl arms one gold Wanted star for future spins; collecting points unlocks Head-Start levels " +
      "that route standard spins to the Head-Start modes listed above. Head-Start modes cost the same as the base game and " +
      "return the same 96.00% — The Getaway simply appears more often in them. The Collection is a free extra: it never " +
      "changes the price of a spin and never adds extra value beyond the listed modes. A natural 5★ Getaway consumes the " +
      "armed gold stars; the highest Head-Start level resets the gallery when used.",
      innerW, y) + 6;

    // ════ 8. CONTROLS ════
    y = this.section("CONTROLS", GOLD, y);
    const controls: Array<[string, string]> = [
      ["SPIN", `Plays one round at the shown ${t.betLabel.toLowerCase()} amount. On desktop the SPACEBAR also spins (only while no window is open). During autoplay this button shows STOP and halts the run.`],
      ["+ / −", `Raise or lower the ${t.betLabel.toLowerCase()} amount through the levels provided by the operator. Locked while a round or autoplay is running.`],
      ["☰ MENU", "Spin speed (Normal / Turbo / Extra Turbo) and Autoplay. Autoplay needs a spin count selection plus a separate Start press, and stops automatically if the balance cannot cover the next spin."],
      ["📻 RADIO", "Music and sound: pick a station or OFF to mute all game audio."],
      ["i INFO", "Opens and closes this Game Info screen."],
      [social ? "GETAWAY / SUPER" : "BUY GETAWAY / SUPER", `Feature plays: open a confirmation window showing the full price (100x / 500x your ${t.betLabel.toLowerCase()}) before anything is played.`],
      ["ANTE", `Toggles Ante Mode (1.5x ${t.betLabel.toLowerCase()}) with more Wilds and Armored Trucks.`],
      ["GALLERY CARD", "Shows your Collection progress. Holding SPACE during a spin gives momentary turbo."]
    ];
    for (const [name, desc] of controls) {
      y = this.controlRow(name, desc, innerW, y);
    }
    y += 6;

    // ════ 9. DISCLAIMER ════
    y = this.section("DISCLAIMER", TEXT_DIM, y);
    y = this.body(DISCLAIMER, innerW, y) + 16;

    this.contentHeight = y;
    this.contentContainer.position.set(leftPad, py + 60);

    // --- Close button ---
    this.buildCloseButton(px, py, pw, ph);
  }

  /** Section heading with separator; returns the new y. */
  private section(label: string, color: number, y: number): number {
    y += 10;
    const textNode = this.makeImpactText(label, 20, color);
    textNode.position.set(0, y);
    this.contentContainer.addChild(textNode);
    y += 30;
    return y;
  }

  /** Wrapped body paragraph; returns the new y. */
  private body(text: string, innerW: number, y: number): number {
    const node = new Text({
      text,
      style: new TextStyle({
        fill: 0xc7d2e2,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: Math.min(14, Math.max(12, innerW * 0.02)),
        fontWeight: "500",
        lineHeight: Math.min(20, Math.max(17, innerW * 0.028)),
        wordWrap: true,
        wordWrapWidth: innerW
      })
    });
    node.position.set(0, y);
    this.contentContainer.addChild(node);
    return y + node.height + 8;
  }

  /** One bet-mode card: name, description, cost/RTP/max-win line. */
  private modeCard(name: string, desc: string, statLine: string, innerW: number, y: number): number {
    const pad = 10;
    const nameText = this.makeImpactText(name, 17, TEXT_WHITE);
    const descText = new Text({
      text: desc,
      style: new TextStyle({
        fill: 0xb9c4d6,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "500",
        lineHeight: 17,
        wordWrap: true,
        wordWrapWidth: innerW - pad * 2
      })
    });
    const statText = this.makeImpactText(statLine, 14, GOLD);

    const cardH = pad + 22 + descText.height + 6 + 20 + pad;
    const bg = new Graphics();
    bg.roundRect(0, y, innerW, cardH, 8).fill({ color: 0x000000, alpha: 0.45 });
    bg.roundRect(0, y, innerW, cardH, 8).stroke({ color: GOLD, width: 1, alpha: 0.25 });
    this.contentContainer.addChild(bg);

    nameText.position.set(pad, y + pad);
    descText.position.set(pad, y + pad + 22);
    statText.position.set(pad, y + pad + 22 + descText.height + 6);
    this.contentContainer.addChild(nameText, descText, statText);
    return y + cardH + 8;
  }

  /** Interaction-guide row: control name + explanation. */
  private controlRow(name: string, desc: string, innerW: number, y: number): number {
    const nameW = Math.max(150, innerW * 0.24);
    const nameText = this.makeImpactText(name, 14, CYAN);
    nameText.position.set(0, y + 2);
    const descText = new Text({
      text: desc,
      style: new TextStyle({
        fill: 0xc7d2e2,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "500",
        lineHeight: 17,
        wordWrap: true,
        wordWrapWidth: innerW - nameW - 8
      })
    });
    descText.position.set(nameW, y);
    this.contentContainer.addChild(nameText, descText);
    return y + Math.max(24, descText.height) + 8;
  }

  private buildClusterHeader(innerW: number): Container {
    const row = new Container();
    const symColW = this.getSymColWidth(innerW);
    const payAreaW = innerW - symColW;
    const colW = payAreaW / SHOWN_SIZES.length;

    for (let i = 0; i < SHOWN_SIZES.length; i++) {
      const size = SHOWN_SIZES[i]!;
      const label = this.makeImpactText(size === 20 ? "20" : `${size}+`, 14, TEXT_DIM);
      label.anchor.set(0.5, 0);
      label.position.set(symColW + colW * i + colW / 2, 0);
      row.addChild(label);
    }
    return row;
  }

  private buildSymbolRow(symId: SymbolId, innerW: number): Container {
    const row = new Container();
    const def = SYMBOLS[symId];
    const skin = SYMBOL_ASSETS[symId];
    const rowH = this.getRowHeight(innerW);
    const symColW = this.getSymColWidth(innerW);

    // Symbol icon
    const tex = getSymbolTexture(symId);
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const iconSize = Math.min(rowH - 6, symColW * 0.45);
      const scale = iconSize / Math.max(tex.width, tex.height);
      sprite.scale.set(scale);
      sprite.position.set(rowH / 2 + 2, rowH / 2);
      row.addChild(sprite);
    }

    // Symbol name
    const nameText = this.makeImpactText(def.label.toUpperCase(), Math.min(14, innerW * 0.022), skin.text);
    nameText.anchor.set(0, 0.5);
    nameText.position.set(rowH + 8, rowH / 2);
    row.addChild(nameText);

    // Payout columns — EXACT engine values (symbol value × size factor).
    const payAreaW = innerW - symColW;
    const colW = payAreaW / SHOWN_SIZES.length;
    for (let i = 0; i < SHOWN_SIZES.length; i++) {
      const value = payAt(symId, SHOWN_SIZES[i]!);
      const color = def.tier === "premium" ? GOLD : def.tier === "mid" ? CYAN : 0xfb6f52;
      const payText = this.makeImpactText(fmtX(value), Math.min(13, innerW * 0.02), color);
      payText.anchor.set(0.5, 0.5);
      payText.position.set(symColW + colW * i + colW / 2, rowH / 2);
      row.addChild(payText);
    }

    // Subtle row background
    const rowBg = new Graphics();
    rowBg.roundRect(0, 0, innerW, rowH, 6).fill({ color: 0x000000, alpha: 0.5 });
    row.addChildAt(rowBg, 0);

    return row;
  }

  /** Special-symbol row (icon + name + description); returns the new y. */
  private specialRow(symId: SymbolId, name: string, description: string, innerW: number, y: number): number {
    const row = new Container();
    const rowH = 64;

    const rowBg = new Graphics();
    rowBg.roundRect(0, 0, innerW, rowH, 6).fill({ color: 0x000000, alpha: 0.5 });
    rowBg.roundRect(0, 0, innerW, rowH, 6).stroke({ color: SYMBOL_ASSETS[symId].stroke, width: 1, alpha: 0.25 });
    row.addChild(rowBg);

    const tex = getSymbolTexture(symId);
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const iconSize = Math.min(rowH - 10, 54);
      const scale = iconSize / Math.max(tex.width, tex.height);
      sprite.scale.set(scale);
      sprite.position.set(rowH / 2 + 4, rowH / 2);
      row.addChild(sprite);
    }

    const nameText = this.makeImpactText(name.toUpperCase(), Math.min(16, innerW * 0.025), SYMBOL_ASSETS[symId].stroke);
    nameText.anchor.set(0, 0.5);
    nameText.position.set(rowH + 12, rowH * 0.3);
    row.addChild(nameText);

    const descText = new Text({
      text: description,
      style: new TextStyle({
        fill: TEXT_WHITE,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: Math.min(13, innerW * 0.02),
        fontWeight: "700",
        wordWrap: true,
        wordWrapWidth: innerW - rowH - 24
      })
    });
    descText.anchor.set(0, 0.5);
    descText.position.set(rowH + 12, rowH * 0.66);
    row.addChild(descText);

    row.position.set(0, y);
    this.contentContainer.addChild(row);
    return y + rowH + 6;
  }

  private buildCloseButton(px: number, py: number, pw: number, ph: number): void {
    const btn = new Container();
    const btnW = 160;
    const btnH = 40;
    const bx = px + pw / 2 - btnW / 2;
    const by = py + ph - 52;

    const bg = new Graphics();
    bg.roundRect(0, 0, btnW, btnH, 8).fill({ color: 0x12192f, alpha: 0.95 });
    bg.roundRect(0, 0, btnW, btnH, 8).stroke({ color: GOLD, width: 2, alpha: 0.7 });
    btn.addChild(bg);

    const label = this.makeImpactText("CLOSE", 20, GOLD);
    label.anchor.set(0.5, 0.5);
    label.position.set(btnW / 2, btnH / 2);
    btn.addChild(label);

    btn.position.set(bx, by);
    btn.eventMode = "static";
    btn.cursor = "pointer";

    btn.on("pointerover", () => {
      btn.scale.set(1.06);
      bg.tint = 0xccddff;
    });
    btn.on("pointerout", () => {
      btn.scale.set(1);
      bg.tint = 0xffffff;
    });
    btn.on("pointertap", (e) => {
      e.stopPropagation();
      this.hide();
    });

    this.addChild(btn);
    this.closeBtn = btn;
  }

  private addSeparator(innerW: number, yOffset: number, color: number, alpha: number): number {
    const sep = new Graphics();
    sep.rect(0, yOffset + 2, innerW, 4).fill({ color, alpha: alpha * 0.15 });
    sep.moveTo(0, yOffset + 4).lineTo(innerW, yOffset + 4);
    sep.stroke({ color, width: 1.5, alpha });
    this.contentContainer.addChild(sep);
    return 10;
  }

  private getRowHeight(innerW: number): number {
    return Math.max(44, Math.min(58, innerW * 0.085));
  }

  private getSymColWidth(innerW: number): number {
    return Math.max(140, innerW * 0.28);
  }

  private makeImpactText(value: string, size: number, color: number): Text {
    return new Text({
      text: value,
      style: new TextStyle({
        fill: color,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: size,
        fontWeight: "900"
      })
    });
  }
}
