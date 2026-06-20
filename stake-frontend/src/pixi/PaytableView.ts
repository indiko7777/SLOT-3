import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { SYMBOLS, type SymbolId } from "../domain";
import { getSymbolTexture, SYMBOL_ASSETS } from "./assets";

/** Cluster size labels mapped to multiplier scaling factors for display */
const CLUSTER_SIZES = [
  { count: 5, label: "5+", factor: 1 },
  { count: 8, label: "8+", factor: 2.5 },
  { count: 12, label: "12+", factor: 6 },
  { count: 15, label: "15+", factor: 15 },
  { count: 20, label: "20", factor: 50 },
];

interface SymbolGroup {
  title: string;
  titleColor: number;
  symbols: SymbolId[];
}

const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    title: "PREMIUM",
    titleColor: 0xffdf65,
    symbols: ["BIKE", "DIAMOND", "CASH"],
  },
  {
    title: "MID",
    titleColor: 0x48e5ff,
    symbols: ["DUFFEL", "AMMO", "PISTOL"],
  },
  {
    title: "LOW",
    titleColor: 0xfb6f52,
    symbols: ["KNIFE", "BRASS"],
  },
];

const GOLD = 0xffdf65;
const CYAN = 0x48e5ff;
const PANEL_BG = 0x0a0f24;
const OVERLAY_BG = 0x050816;
const BORDER_GOLD = 0xb8962e;
const TEXT_WHITE = 0xffffff;
const TEXT_DIM = 0x8a9cbf;

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

  constructor() {
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

    // --- Fullscreen dark overlay ---
    this.bg.clear();
    this.bg.rect(0, 0, w, h).fill({ color: OVERLAY_BG, alpha: 0.95 });

    // --- Centered panel ---
    const pw = Math.min(w * 0.82, 820);
    const ph = Math.min(h * 0.87, 900);
    const px = (w - pw) / 2;
    const py = (h - ph) / 2;
    this.panelRect = { x: px, y: py, w: pw, h: ph };

    this.panel.clear();
    // Outer cyan ghost border
    this.panel.roundRect(px - 2, py - 2, pw + 4, ph + 4, 16).stroke({ color: CYAN, width: 1, alpha: 0.25 });
    // Panel fill
    this.panel.roundRect(px, py, pw, ph, 14).fill({ color: PANEL_BG, alpha: 0.97 });
    // Gold outer border
    this.panel.roundRect(px, py, pw, ph, 14).stroke({ color: BORDER_GOLD, width: 3, alpha: 0.85 });
    // Inner subtle border
    this.panel.roundRect(px + 4, py + 4, pw - 8, ph - 8, 10).stroke({ color: GOLD, width: 1, alpha: 0.2 });
    // Top highlight bar
    this.panel.roundRect(px + 20, py + 2, pw - 40, 4, 2).fill({ color: GOLD, alpha: 0.25 });

    // --- Scroll mask ---
    this.scrollMask.clear();
    const maskTop = py + 56;
    const maskH = ph - 116;
    this.scrollMask.rect(px, maskTop, pw, maskH).fill(0xffffff);

    // --- Build content ---
    this.contentContainer.removeChildren();

    let yOffset = 0;
    const innerW = pw - 40;
    const leftPad = px + 20;

    // --- Title with cyan drop shadow ---
    const title = new Text({
      text: "PAYTABLE",
      style: new TextStyle({
        fill: GOLD,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 34,
        fontWeight: "900",
        letterSpacing: 4,
        dropShadow: { color: CYAN, alpha: 0.4, blur: 10, distance: 0 }
      })
    });
    title.anchor.set(0.5, 0);
    title.position.set(px + pw / 2, py + 14);
    this.addChild(title);

    // --- Cluster size header row ---
    yOffset += 4;
    const headerRow = this.buildClusterHeader(innerW, leftPad);
    headerRow.y = yOffset;
    this.contentContainer.addChild(headerRow);
    yOffset += 30;

    // --- Separator ---
    yOffset += this.addSeparator(innerW, leftPad, yOffset, GOLD, 0.3);

    // --- Symbol groups ---
    for (const group of SYMBOL_GROUPS) {
      yOffset += 6;
      const groupLabel = this.makeImpactText(group.title, 18, group.titleColor);
      groupLabel.anchor.set(0, 0);
      groupLabel.position.set(0, yOffset);
      this.contentContainer.addChild(groupLabel);
      yOffset += 26;

      for (const symId of group.symbols) {
        const row = this.buildSymbolRow(symId, innerW);
        row.position.set(0, yOffset);
        this.contentContainer.addChild(row);
        yOffset += this.getRowHeight(innerW) + 4;
      }

      yOffset += this.addSeparator(innerW, 0, yOffset, group.titleColor, 0.15);
    }

    // --- Special symbols section ---
    yOffset += 8;
    const specialTitle = this.makeImpactText("SPECIAL SYMBOLS", 18, CYAN);
    specialTitle.anchor.set(0, 0);
    specialTitle.position.set(0, yOffset);
    this.contentContainer.addChild(specialTitle);
    yOffset += 28;

    // WILD
    const wildRow = this.buildSpecialRow("CAR_WILD", "Cyan Sports Car", "WILD - Substitutes for all symbols", innerW);
    wildRow.position.set(0, yOffset);
    this.contentContainer.addChild(wildRow);
    yOffset += this.getSpecialRowHeight(innerW) + 6;

    // BEACH GIRL WILD
    const collectionWildRow = this.buildSpecialRow("WILD", "Beach Girl Wild", "WILD - Substitutes and triggers Visual Collection", innerW);
    collectionWildRow.position.set(0, yOffset);
    this.contentContainer.addChild(collectionWildRow);
    yOffset += this.getSpecialRowHeight(innerW) + 6;

    // SCATTER
    const scatterRow = this.buildSpecialRow("PHONE_SCATTER", "Burner Phone", "SCATTER - 3+ trigger The Getaway", innerW);
    scatterRow.position.set(0, yOffset);
    this.contentContainer.addChild(scatterRow);
    yOffset += this.getSpecialRowHeight(innerW) + 6;

    // Bonus symbols
    yOffset += this.addSeparator(innerW, 0, yOffset, CYAN, 0.15);
    yOffset += 4;

    const bonusTitle = this.makeImpactText("BONUS SYMBOLS", 18, GOLD);
    bonusTitle.anchor.set(0, 0);
    bonusTitle.position.set(0, yOffset);
    this.contentContainer.addChild(bonusTitle);
    yOffset += 28;

    const safeRow = this.buildSpecialRow("SAFE", "Locked Safe", "Hold & Spin - Awards multiplier value", innerW);
    safeRow.position.set(0, yOffset);
    this.contentContainer.addChild(safeRow);
    yOffset += this.getSpecialRowHeight(innerW) + 6;

    const keyRow = this.buildSpecialRow("MASTER_KEY", "Master Key", "Doubles adjacent Safe values", innerW);
    keyRow.position.set(0, yOffset);
    this.contentContainer.addChild(keyRow);
    yOffset += this.getSpecialRowHeight(innerW) + 6;

    yOffset += 12;
    this.contentHeight = yOffset;

    // Position content container
    this.contentContainer.position.set(leftPad, py + 60);

    // --- Close button ---
    this.buildCloseButton(px, py, pw, ph);
  }

  private buildClusterHeader(innerW: number, _leftPad: number): Container {
    const row = new Container();
    const symColW = this.getSymColWidth(innerW);
    const payAreaW = innerW - symColW;
    const colW = payAreaW / CLUSTER_SIZES.length;

    for (let i = 0; i < CLUSTER_SIZES.length; i++) {
      const cs = CLUSTER_SIZES[i];
      const label = this.makeImpactText(cs.label, 14, TEXT_DIM);
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

    // Payout columns
    if (def.baseClusterPay) {
      const payAreaW = innerW - symColW;
      const colW = payAreaW / CLUSTER_SIZES.length;

      for (let i = 0; i < CLUSTER_SIZES.length; i++) {
        const cs = CLUSTER_SIZES[i];
        const value = (def.baseClusterPay * cs.factor).toFixed(2);
        const color = def.tier === "premium" ? GOLD : def.tier === "mid" ? CYAN : 0xfb6f52;
        const payText = this.makeImpactText(`${value}x`, Math.min(13, innerW * 0.02), color);
        payText.anchor.set(0.5, 0.5);
        payText.position.set(symColW + colW * i + colW / 2, rowH / 2);
        row.addChild(payText);
      }
    }

    // Subtle row background
    const rowBg = new Graphics();
    rowBg.roundRect(0, 0, innerW, rowH, 6).fill({ color: 0x0e1530, alpha: 0.5 });
    row.addChildAt(rowBg, 0);

    return row;
  }

  private buildSpecialRow(symId: SymbolId, name: string, description: string, innerW: number): Container {
    const row = new Container();
    const rowH = this.getSpecialRowHeight(innerW);

    // Row background
    const rowBg = new Graphics();
    rowBg.roundRect(0, 0, innerW, rowH, 6).fill({ color: 0x0e1530, alpha: 0.5 });
    rowBg.roundRect(0, 0, innerW, rowH, 6).stroke({ color: SYMBOL_ASSETS[symId].stroke, width: 1, alpha: 0.25 });
    row.addChild(rowBg);

    // Icon
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

    // Name
    const nameText = this.makeImpactText(name.toUpperCase(), Math.min(16, innerW * 0.025), SYMBOL_ASSETS[symId].stroke);
    nameText.anchor.set(0, 0.5);
    nameText.position.set(rowH + 12, rowH * 0.35);
    row.addChild(nameText);

    // Description
    const descText = new Text({
      text: description,
      style: new TextStyle({
        fill: TEXT_WHITE,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: Math.min(13, innerW * 0.02),
        fontWeight: "700",
        wordWrap: true,
        wordWrapWidth: innerW - rowH - 24,
      }),
    });
    descText.anchor.set(0, 0.5);
    descText.position.set(rowH + 12, rowH * 0.68);
    row.addChild(descText);

    return row;
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
  }

  private addSeparator(innerW: number, _leftPad: number, yOffset: number, color: number, alpha: number): number {
    const sep = new Graphics();
    // Glow line behind
    sep.rect(0, yOffset + 2, innerW, 4).fill({ color, alpha: alpha * 0.15 });
    // Sharp line on top
    sep.moveTo(0, yOffset + 4).lineTo(innerW, yOffset + 4);
    sep.stroke({ color, width: 1.5, alpha });
    this.contentContainer.addChild(sep);
    return 10;
  }

  private getRowHeight(innerW: number): number {
    return Math.max(44, Math.min(58, innerW * 0.085));
  }

  private getSpecialRowHeight(_innerW: number): number {
    return 64;
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
        fontWeight: "900",
      }),
    });
  }
}
