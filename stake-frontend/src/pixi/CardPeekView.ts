import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { LayoutMetrics, Rect } from "./types";
import { getExtraTexture, silhouetteOffset } from "./assets";
import { pieceBounds } from "./girlReveal";
import { makeText } from "./text";
import { ambientTicker } from "./tween";
import { GIRLS, toRomanNumeral } from "../meta/collection";
import { GIRL_ACCENT } from "./girlReveal";

const portraitCache = new Map<string, Texture>();

/** Head-and-shoulders crop of a full-body art (canvas, cached per size). */
function portraitTexture(tex: Texture, w: number, h: number, key: string): Texture | null {
  const k = `${key}:${Math.round(w)}x${Math.round(h)}`;
  const hit = portraitCache.get(k);
  if (hit) return hit;
  const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src || typeof document === "undefined") return null;
  const res = 2;
  const W = Math.max(4, Math.round(w * res)), H = Math.max(4, Math.round(h * res));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  // the figure's own alpha box, then its top ~38% (head, shoulders)
  const b = pieceBounds(tex);
  const bx = tex.width / 2 + b.ox - b.w / 2, by = tex.height / 2 + b.oy - b.h / 2;
  const cropW = b.w * 0.8, cropH = cropW * (H / W);
  const sx = bx + (b.w - cropW) / 2, sy = by - cropH * 0.04;
  const r = 7 * res;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath(); g.clip();
  g.drawImage(src, sx, sy, cropW, cropH, 0, 0, W, H);
  const t = Texture.from(c);
  portraitCache.set(k, t);
  return t;
}

export class CardPeekView extends Container {
  private cards: Container[] = [];
  private cardBgs: Graphics[] = [];
  private currentXPositions: number[] = [];
  private targetXPositions: number[] = [];
  private hoveredStates: boolean[] = [false, false, false];
  private cardWidth = 90;
  private cardHeight = 135;
  private gap = 12;

  // Tilts for each of the 3 cards (Sapphire, Roxy, Vega)
  // Tilted counter-clockwise so that only the top-left corner/edge pokes out from the screen
  private tilts = [-0.40, -0.32, -0.36];

  // Glow colors for active/completed states
  private themeColors = [
    0xff00b8, // Sapphire: Neon Pink/Magenta
    0xffdf65, // Roxy: Gold
    0x00ffff  // Vega: Cyan/Diamond
  ];

  private screenWidth = 1024;
  private readonly compact = new Container();
  private readonly strip = new Container();
  private readonly tickPositions = this.updatePositions.bind(this);

  constructor(
    private readonly runtime: any,
    private readonly onCardTapped: () => void
  ) {
    super();
    this.eventMode = "passive"; // let children receive mouse inputs
    this.createCards();
    this.compact.eventMode = "static";
    this.compact.cursor = "pointer";
    this.compact.on("pointertap", () => this.onCardTapped());
    this.addChild(this.compact);
    this.strip.eventMode = "passive";
    this.addChild(this.strip);

    // Register smooth slider animation in the ambient ticker
    ambientTicker.add(this.tickPositions);
  }

  private getCollapsedX(index: number, parentWidth: number, isPortrait: boolean): number {
    const bottomOffset = isPortrait ? 15 : 5;
    const tilt = this.tilts[index]!;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    return parentWidth + bottomOffset + (this.cardWidth / 2) * cosT + (this.cardHeight / 2) * sinT;
  }

  private getExpandedX(index: number, parentWidth: number, isPortrait: boolean): number {
    const margin = isPortrait ? 12 : 8;
    const tilt = this.tilts[index]!;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    return parentWidth - margin - (this.cardWidth / 2) * cosT + (this.cardHeight / 2) * sinT;
  }

  private createCards(): void {
    for (let i = 0; i < 3; i++) {
      const card = new Container();
      card.eventMode = "static";
      card.cursor = "pointer";
      
      this.currentXPositions.push(0);
      this.targetXPositions.push(0);

      const bg = new Graphics();
      card.addChild(bg);
      this.cardBgs.push(bg);

      card.on("pointerover", () => {
        this.setCardFocused(i, true);
      });
      card.on("pointerout", () => {
        this.setCardFocused(i, false);
      });
      card.on("pointertap", (e) => {
        e.stopPropagation();
        this.onCardTapped();
      });

      this.addChild(card);
      this.cards.push(card);
    }
  }

  private setCardFocused(index: number, focused: boolean): void {
    this.hoveredStates[index] = focused;
    const parentWidth = this.screenWidth;
    const isPortrait = parentWidth < 980;

    if (focused) {
      this.targetXPositions[index] = this.getExpandedX(index, parentWidth, isPortrait);
      this.cards[index]!.scale.set(1.08);
      this.addChild(this.cards[index]!);
    } else {
      this.targetXPositions[index] = this.getCollapsedX(index, parentWidth, isPortrait);
      this.cards[index]!.scale.set(1.0);
    }
  }

  private updatePositions(_dt: number, _elapsed: number): void {
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]!;
      const targetX = this.targetXPositions[i]!;
      this.currentXPositions[i] += (targetX - this.currentXPositions[i]!) * 0.15;
      card.x = this.currentXPositions[i]!;
    }
  }

  /** One quiet line under the character: "SAPPHIRE  3/8" over a hairline bar.
   *  Tapping it (or her) opens the gallery. */
  private drawStrip(rect: Rect, prog: { girlId: number; girlName: string; pieces: number; totalPieces: number }): void {
    for (const child of this.strip.removeChildren()) child.destroy({ children: true });
    const accent = GIRL_ACCENT[prog.girlId] ?? 0xffcf6b;
    const w = Math.min(190, rect.width - 40);
    const x = rect.x + (rect.width - w) / 2;
    const y = rect.y + rect.height - 34;
    const name = makeText(prog.girlName.toUpperCase(), 13, 0xfff4f8, x, y, "left");
    name.style.fontWeight = "700";
    name.style.letterSpacing = 2.4;
    name.style.dropShadow = { color: 0x0b0716, alpha: 0.8, blur: 4, distance: 1, angle: Math.PI / 2 };
    const count = makeText(`${prog.pieces}/${prog.totalPieces}`, 13, accent, x + w, y, "right");
    count.style.fontWeight = "700";
    count.style.dropShadow = name.style.dropShadow;
    const bar = new Graphics();
    bar.roundRect(x, y + 21, w, 3, 1.5).fill({ color: 0xffffff, alpha: 0.18 });
    const frac = Math.min(1, prog.pieces / Math.max(1, prog.totalPieces));
    if (frac > 0) bar.roundRect(x, y + 21, Math.max(3, w * frac), 3, 1.5).fill(accent);
    const hit = new Graphics();
    hit.rect(rect.x, rect.y, rect.width, rect.height).fill({ color: 0x000000, alpha: 0.001 });
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointertap", (e) => { e.stopPropagation(); this.onCardTapped(); });
    this.strip.addChild(hit, bar, name, count);
  }

  /** Redraw / refresh the cards with current layout and gallery progress */
  layout(layout: LayoutMetrics): void {
    this.screenWidth = layout.width;
    const prog = this.runtime.getGalleryProgress();
    const currentGirlIdx = prog.completedGirls;
    const isPortrait = layout.portrait;
    this.compact.visible = isPortrait;
    this.strip.visible = !isPortrait;
    for (const card of this.cards) card.visible = !isPortrait;
    if (isPortrait && layout.collectionBar) {
      const rect = layout.collectionBar;
      for (const child of this.compact.removeChildren()) child.destroy({ children: true });
      this.compact.position.set(rect.x, rect.y);
      const accent = this.themeColors[prog.girlId] ?? 0xffdf65;
      const bg = new Graphics().roundRect(0, 0, rect.width, rect.height, 6)
        .fill({ color: 0x070c1e, alpha: 0.9 }).stroke({ color: accent, width: 1.5 });
      bg.rect(8, rect.height - 5, (rect.width - 16) * Math.min(1, prog.pieces / prog.totalPieces), 2)
        .fill({ color: accent });
      const title = makeText(`COLLECTION · ${prog.girlName.toUpperCase()}`, 14, 0xffffff, 12, 11);
      const progress = makeText(`${prog.pieces}/${prog.totalPieces}  ›`, 16, 0xffdf65, rect.width - 12, 9, "right");
      this.compact.addChild(bg, title, progress);
      return;
    }

    // Landscape: the crew strip sits INSIDE the art panel, under the character.
    // (The old tilted cards peeked in from past the screen edge and read as UI
    // cut off by the viewport.)
    for (const card of this.cards) card.visible = false;
    if (layout.artPanel) this.drawStrip(layout.artPanel, prog);
  }

  destroy(options?: any): void {
    ambientTicker.remove(this.tickPositions);
    super.destroy(options);
  }
}
