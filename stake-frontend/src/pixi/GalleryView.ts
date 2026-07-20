import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { getExtraTexture } from "./assets";
import { tween } from "./tween";

// ── Theme palette ────────────────────────────────────────────────────────────
const WHITE  = 0xffffff;
const BLACK  = 0x000000;
const PINK   = 0xff00b8;
const GOLD   = 0xffdf65;
const CYAN   = 0x00ffff;
const GREEN  = 0x4ee06a;
const RED    = 0xff5252;

const IMPACT = "Impact,'Arial Black',sans-serif";
const FONT   = "'Archivo Narrow','Arial Narrow','Helvetica Neue',Helvetica,Arial,sans-serif";

const THEME   = [PINK, GOLD, CYAN];
const NAMES   = ["SAPPHIRE", "ROXY", "VEGA"];
const REWARDS = ["NEON NIGHTS SKIN", "GOLD RUSH SKIN", "DIAMOND ELITE SKIN"];
const PIECES  = [8, 7, 8];
const PREFIX  = ["char", "char2", "char3"];

export class GalleryView extends Container {
  private bg = new Graphics();
  private ct = new Container();
  private deckContainer = new Container();
  private isVisible = false;
  private screenW = 0;
  private screenH = 0;

  private activeIndex = 0;
  private cards: Container[] = [];
  private isAnimating = false;

  // Drag / Swipe tracking
  private isDragging = false;
  private dragStartX = 0;
  private dragCurrentX = 0;

  constructor(private readonly runtime: any) {
    super();
    this.visible = false;
    this.eventMode = "static";
    this.interactiveChildren = true;
    this.addChild(this.bg);
    this.addChild(this.ct);
    this.bg.eventMode = "static";
    this.bg.on("pointertap", (e) => e.stopPropagation());
  }

  show(screenWidth: number, screenHeight: number): void {
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    const prog = this.runtime.getGalleryProgress();
    this.activeIndex = Math.min(2, Math.max(0, prog.completedGirls));

    this.rebuild();
    this.visible = true;
    this.isVisible = true;
    this.alpha = 0;
    void tween(250, (p) => { this.alpha = p; });
  }

  hide(): void {
    void tween(150, (p) => { this.alpha = 1 - p; }).then(() => {
      this.visible = false;
      this.isVisible = false;
    });
  }

  toggle(screenWidth: number, screenHeight: number): void {
    if (this.isVisible) this.hide();
    else this.show(screenWidth, screenHeight);
  }

  isOpen(): boolean { return this.isVisible; }

  // ════════════════════════════════════════════════════════════════════════
  private rebuild(): void {
    const W = this.screenW;
    const H = this.screenH;
    const isP = W < 700 || H > W * 1.15;
    this.ct.removeChildren();
    this.deckContainer.removeChildren();
    this.cards = [];

    // ── Fullscreen Backdrop ─────────────────────────────────────────────
    this.bg.clear();
    this.bg.rect(0, 0, W, H).fill({ color: BLACK, alpha: 0.93 });

    // ── Centered Backdrop Panel ──────────────────────────────────────────
    const pw = isP ? Math.min(W * 0.95, 440) : Math.min(W * 0.88, 860);
    const ph = isP ? Math.min(H * 0.92, 720) : Math.min(H * 0.88, 560);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    const panelBg = new Graphics();
    panelBg.roundRect(px, py, pw, ph, 8).fill({ color: 0x070707, alpha: 0.96 });
    panelBg.rect(px, py, pw, 3).fill({ color: GOLD, alpha: 0.9 });
    panelBg.roundRect(px, py, pw, ph, 8).stroke({ color: GOLD, width: 1.5, alpha: 0.35 });
    this.ct.addChild(panelBg);

    // ── Title Header ────────────────────────────────────────────────────
    const titleH = isP ? 44 : 52;
    const title = this.txt("BEACH GIRL DECK", isP ? 22 : 28, GOLD, IMPACT, 3);
    title.anchor.set(0.5, 0.5);
    title.position.set(px + pw / 2, py + titleH / 2 + 4);
    this.ct.addChild(title);

    const titleLine = new Graphics();
    titleLine.rect(px + 24, py + titleH + 2, pw - 48, 1).fill({ color: GOLD, alpha: 0.4 });
    this.ct.addChild(titleLine);

    // Sub-title prompt
    const subTitle = this.txt("SWIPE OR TAP TO CYCLE DECK", isP ? 10 : 12, 0x888888, FONT, 1.5);
    subTitle.anchor.set(0.5, 0.5);
    subTitle.position.set(px + pw / 2, py + titleH + 16);
    this.ct.addChild(subTitle);

    // ── Deck Dimensions ─────────────────────────────────────────────────
    const footerH = isP ? 90 : 80;
    const deckTop = py + titleH + 28;
    const deckAvailH = ph - titleH - footerH - 40;

    let cardW: number, cardH: number;
    if (isP) {
      cardW = Math.min(pw - 60, 310);
      cardH = Math.min(deckAvailH, 440);
    } else {
      cardW = Math.min(pw * 0.38, 320);
      cardH = Math.min(deckAvailH, 420);
    }

    const deckCenterX = px + pw / 2;
    const deckCenterY = deckTop + cardH / 2;

    // ── Create 3 Stacked Cards ──────────────────────────────────────────
    const prog = this.runtime.getGalleryProgress();
    const curGirl = prog.completedGirls;

    for (let i = 0; i < 3; i++) {
      const done = i < curGirl;
      const active = i === curGirl && !prog.mastered;
      const locked = i > curGirl || (prog.mastered && i >= 3);
      const theme = locked ? 0x444444 : THEME[i]!;

      const card = this.buildCard(cardW, cardH, i, done, active, locked, theme, prog);
      this.cards.push(card);
      this.deckContainer.addChild(card);
    }

    this.deckContainer.eventMode = "static";
    this.deckContainer.cursor = "grab";

    // Setup drag/swipe handlers
    this.setupSwipeHandlers(this.deckContainer);

    this.ct.addChild(this.deckContainer);

    // Arrange initial stacked positions
    this.updateStackPositions(false, deckCenterX, deckCenterY);

    // ── Side Navigation Chevrons ────────────────────────────────────────
    const arrowY = deckCenterY;
    const arrowPad = isP ? 12 : 24;

    // Left Arrow
    const btnLeft = this.buildArrow(px + arrowPad, arrowY, "◄", () => this.prevCard(deckCenterX, deckCenterY));
    this.ct.addChild(btnLeft);

    // Right Arrow
    const btnRight = this.buildArrow(px + pw - arrowPad, arrowY, "►", () => this.nextCard(deckCenterX, deckCenterY));
    this.ct.addChild(btnRight);

    // ── Pagination Dots & Footer ────────────────────────────────────────
    const footerY = py + ph - footerH;

    // Dots
    this.renderPagination(px + pw / 2, footerY + 12);

    // Mastered / Next Hint
    if (prog.mastered) {
      const masterLabel = this.txt("★  GALLERY MASTERED  ·  VIP BADGE UNLOCKED  ★", isP ? 11 : 13, GREEN, IMPACT, 1.5);
      masterLabel.anchor.set(0.5, 0.5);
      masterLabel.position.set(px + pw / 2, footerY + 34);
      this.ct.addChild(masterLabel);
    } else {
      const nName = NAMES[curGirl] ?? "VEGA";
      const rem = (PIECES[curGirl] ?? 8) - prog.pieces;
      const hint = this.txt(`NEXT: ${nName} THEME · ${rem} WILDS NEEDED`, isP ? 11 : 13, GOLD, FONT, 1);
      hint.anchor.set(0.5, 0.5);
      hint.position.set(px + pw / 2, footerY + 34);
      this.ct.addChild(hint);
    }

    // ── Close Button ────────────────────────────────────────────────────
    const closeY = py + ph - 38;
    const btnW = isP ? 140 : 160;
    const btnH = 32;
    const btnX = px + (pw - btnW) / 2;

    const closeBg = new Graphics();
    closeBg.roundRect(btnX, closeY, btnW, btnH, 4)
      .fill({ color: 0x111111 })
      .stroke({ color: GOLD, width: 1.5, alpha: 0.6 });
    this.ct.addChild(closeBg);

    const closeText = this.txt("CLOSE", 14, GOLD, FONT, 3);
    closeText.anchor.set(0.5, 0.5);
    closeText.position.set(btnX + btnW / 2, closeY + btnH / 2);
    this.ct.addChild(closeText);

    const closeHit = new Graphics();
    closeHit.roundRect(btnX, closeY, btnW, btnH, 4).fill({ color: BLACK, alpha: 0.001 });
    closeHit.eventMode = "static";
    closeHit.cursor = "pointer";
    closeHit.on("pointerover", () => {
      closeBg.clear();
      closeBg.roundRect(btnX, closeY, btnW, btnH, 4).fill({ color: GOLD }).stroke({ color: GOLD, width: 1.5 });
      closeText.style.fill = BLACK;
    });
    closeHit.on("pointerout", () => {
      closeBg.clear();
      closeBg.roundRect(btnX, closeY, btnW, btnH, 4).fill({ color: 0x111111 }).stroke({ color: GOLD, width: 1.5, alpha: 0.6 });
      closeText.style.fill = GOLD;
    });
    closeHit.on("pointertap", (e) => { e.stopPropagation(); this.hide(); });
    this.ct.addChild(closeHit);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  STACK PHYSICS & LAYERING
  // ════════════════════════════════════════════════════════════════════════
  private updateStackPositions(animate = true, cx = this.screenW / 2, cy = this.screenH / 2): void {
    const offsets = [
      { dx: 0,   dy: 0,   scale: 1.0,  alpha: 1.0,  rotation: 0,      zIndex: 10 },
      { dx: 22,  dy: 16,  scale: 0.93, alpha: 0.85, rotation: 0.04,   zIndex: 5 },
      { dx: 44,  dy: 32,  scale: 0.86, alpha: 0.65, rotation: -0.04,  zIndex: 1 }
    ];

    this.cards.forEach((card, idx) => {
      const stackPos = (idx - this.activeIndex + 3) % 3;
      const target = offsets[stackPos]!;

      const targetX = cx + target.dx - 22; // Center offset compensation
      const targetY = cy + target.dy - 16;

      card.zIndex = target.zIndex;

      if (!animate) {
        card.position.set(targetX, targetY);
        card.scale.set(target.scale);
        card.alpha = target.alpha;
        card.rotation = target.rotation;
      } else {
        const startX = card.x;
        const startY = card.y;
        const startScale = card.scale.x;
        const startAlpha = card.alpha;
        const startRot = card.rotation;

        this.isAnimating = true;
        void tween(280, (p) => {
          // Ease out cubic
          const ep = 1 - Math.pow(1 - p, 3);
          card.position.set(
            startX + (targetX - startX) * ep,
            startY + (targetY - startY) * ep
          );
          card.scale.set(startScale + (target.scale - startScale) * ep);
          card.alpha = startAlpha + (target.alpha - startAlpha) * ep;
          card.rotation = startRot + (target.rotation - startRot) * ep;
        }).then(() => {
          this.isAnimating = false;
        });
      }
    });

    // Sort z-index so front card renders on top
    this.deckContainer.sortChildren();
  }

  private nextCard(cx?: number, cy?: number): void {
    if (this.isAnimating) return;
    this.activeIndex = (this.activeIndex + 1) % 3;
    this.rebuildPagination();
    this.updateStackPositions(true, cx, cy);
  }

  private prevCard(cx?: number, cy?: number): void {
    if (this.isAnimating) return;
    this.activeIndex = (this.activeIndex + 2) % 3;
    this.rebuildPagination();
    this.updateStackPositions(true, cx, cy);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SWIPE & DRAG HANDLERS
  // ════════════════════════════════════════════════════════════════════════
  private setupSwipeHandlers(target: Container): void {
    target.on("pointerdown", (e) => {
      this.isDragging = true;
      this.dragStartX = e.global.x;
      this.dragCurrentX = e.global.x;
    });

    target.on("pointermove", (e) => {
      if (!this.isDragging) return;
      this.dragCurrentX = e.global.x;
    });

    const endDrag = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      const dx = this.dragCurrentX - this.dragStartX;
      if (dx < -35) {
        this.nextCard();
      } else if (dx > 35) {
        this.prevCard();
      }
    };

    target.on("pointerup", endDrag);
    target.on("pointerupoutside", endDrag);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BUILD INDIVIDUAL CARD
  // ════════════════════════════════════════════════════════════════════════
  private buildCard(
    w: number, h: number, idx: number,
    done: boolean, active: boolean, locked: boolean,
    theme: number, prog: any
  ): Container {
    const card = new Container();
    card.pivot.set(w / 2, h / 2);

    const radius = 12;

    // ── Outer Neon Glow ──────────────────────────────────────────────────
    const glow = new Graphics();
    glow.roundRect(-4, -4, w + 8, h + 8, radius + 4)
      .fill({ color: theme, alpha: locked ? 0.05 : 0.22 });
    card.addChild(glow);

    // ── Black Card Body ──────────────────────────────────────────────────
    const body = new Graphics();
    body.roundRect(0, 0, w, h, radius)
      .fill({ color: 0x0b0b0b })
      .stroke({ color: theme, width: 2.5, alpha: locked ? 0.25 : 0.85 });
    body.roundRect(3, 3, w - 6, h - 6, radius - 2)
      .stroke({ color: theme, width: 0.5, alpha: locked ? 0.05 : 0.15 });
    card.addChild(body);

    // ── Card Header (Girl Name) ───────────────────────────────────────────
    const nameH = 34;
    const nameBg = new Graphics();
    nameBg.roundRect(4, 4, w - 8, nameH, 6).fill({ color: theme, alpha: locked ? 0.06 : 0.14 });
    card.addChild(nameBg);

    const nameText = this.txt(NAMES[idx]!, 18, locked ? 0x555555 : WHITE, IMPACT, 2);
    nameText.anchor.set(0.5, 0.5);
    nameText.position.set(w / 2, 4 + nameH / 2);
    card.addChild(nameText);

    // ── Character Art Viewport ───────────────────────────────────────────
    const artPad = 10;
    const progressZoneH = 68; // height reserved for bar + badge + reward
    const artX = artPad;
    const artY = 4 + nameH + 6;
    const artW = w - artPad * 2;
    const artH = h - (4 + nameH + 6) - progressZoneH - 8;

    const artContainer = new Container();
    artContainer.position.set(artX, artY);

    const artMask = new Graphics();
    artMask.roundRect(0, 0, artW, artH, 8).fill({ color: WHITE });
    artContainer.addChild(artMask);
    artContainer.mask = artMask;

    const artBg = new Graphics();
    artBg.roundRect(0, 0, artW, artH, 8).fill({ color: 0x050505 });
    artContainer.addChild(artBg);

    if (locked) {
      // Frosted Locked State
      const frost = new Graphics();
      frost.rect(0, 0, artW, artH).fill({ color: 0x0a0a0a, alpha: 0.92 });
      artContainer.addChild(frost);

      // Lock Icon
      const lx = artW / 2, ly = artH / 2 - 6;
      const lSize = Math.min(artW, artH) * 0.22;
      const lock = new Graphics();
      lock.roundRect(lx - lSize * 0.55, ly + lSize * 0.1, lSize * 1.1, lSize * 0.85, lSize * 0.12)
        .fill({ color: 0x222222 }).stroke({ color: 0x444444, width: 1.5 });
      lock.arc(lx, ly + lSize * 0.1, lSize * 0.35, Math.PI, 0)
        .stroke({ color: 0x444444, width: lSize * 0.12 });
      lock.circle(lx, ly + lSize * 0.45, lSize * 0.08).fill({ color: 0x555555 });
      artContainer.addChild(lock);

      const lockText = this.txt("LOCKED", 11, 0x666666, FONT, 2);
      lockText.anchor.set(0.5, 0.5);
      lockText.position.set(artW / 2, ly + lSize * 0.9 + 12);
      artContainer.addChild(lockText);

    } else if (done) {
      // Completed Girl Art
      const texKey = `${PREFIX[idx]!}_full`;
      const tex = getExtraTexture(texKey);
      if (tex) {
        const spr = new Sprite(tex);
        spr.anchor.set(0.5, 0.5);
        const scale = Math.max(artW / tex.width, artH / tex.height);
        spr.scale.set(scale);
        spr.position.set(artW / 2, artH / 2);
        artContainer.addChild(spr);
      }

      // Bottom subtle gradient
      const grad = new Graphics();
      grad.rect(0, artH * 0.75, artW, artH * 0.25).fill({ color: BLACK, alpha: 0.4 });
      artContainer.addChild(grad);

    } else if (active) {
      // Active In-Progress Girl Art (Silhouette + Pieces)
      const prefix = PREFIX[idx]!;
      const silTex = getExtraTexture(`${prefix}_silhouette`);
      if (silTex) {
        const assembly = new Container();

        const sil = new Sprite(silTex);
        sil.anchor.set(0.5, 0.5);
        sil.tint = 0x0a0a0a;
        sil.alpha = 0.5;
        assembly.addChild(sil);

        const collected = prog.pieces;
        const maxP = PIECES[idx]!;
        for (let p = 1; p <= Math.min(maxP, collected); p++) {
          const pTex = getExtraTexture(`${prefix}_piece_${p}`);
          if (pTex) {
            const piece = new Sprite(pTex);
            piece.anchor.set(0.5, 0.5);
            assembly.addChild(piece);
          }
        }

        const scale = Math.max((artW - 4) / silTex.width, (artH - 4) / silTex.height) * 0.9;
        assembly.scale.set(scale);
        assembly.position.set(artW / 2, artH / 2);
        artContainer.addChild(assembly);
      }
    }

    // Inner Border Frame around Art Viewport
    const artFrame = new Graphics();
    artFrame.roundRect(0, 0, artW, artH, 8).stroke({ color: theme, width: 1, alpha: locked ? 0.12 : 0.35 });
    artContainer.addChild(artFrame);

    card.addChild(artContainer);

    // ── Progress Bar & Parts Badge ───────────────────────────────────────
    const pY = artY + artH + 10;
    const barW = w - 28;
    const barX = 14;
    const barH = 8;

    // Track
    const track = new Graphics();
    track.roundRect(barX, pY, barW, barH, barH / 2).fill({ color: WHITE, alpha: 0.08 });
    track.roundRect(barX, pY, barW, barH, barH / 2).stroke({ color: WHITE, width: 0.5, alpha: 0.1 });
    card.addChild(track);

    // Green Fill
    const total = PIECES[idx]!;
    let frac = 0;
    if (done) frac = 1;
    else if (active) frac = Math.min(1, prog.pieces / total);

    if (frac > 0) {
      const fillW = Math.max(barH, barW * frac);
      const fill = new Graphics();
      fill.roundRect(barX, pY, fillW, barH, barH / 2).fill({ color: GREEN });
      card.addChild(fill);
    }

    // Pieces Badge Text (e.g. "3 / 8 PARTS UNLOCKED")
    const totalPieces = PIECES[idx]!;
    const curPieces = done ? totalPieces : active ? prog.pieces : 0;
    const statusStr = done ? "★ UNLOCKED" : locked ? "LOCKED" : `${curPieces} / ${totalPieces} PARTS UNLOCKED`;
    const statusCol = done ? GREEN : locked ? 0x666666 : WHITE;

    const statusBadge = this.txt(statusStr, 12, statusCol, FONT, 1.5);
    statusBadge.anchor.set(0.5, 0);
    statusBadge.position.set(w / 2, pY + 14);
    card.addChild(statusBadge);

    // Reward Text
    const rewardText = this.txt(REWARDS[idx]!, 10, locked ? 0x444444 : theme, FONT, 0.8);
    rewardText.anchor.set(0.5, 0);
    rewardText.position.set(w / 2, pY + 32);
    card.addChild(rewardText);

    return card;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ARROWS & PAGINATION
  // ════════════════════════════════════════════════════════════════════════
  private buildArrow(x: number, y: number, label: string, onClick: () => void): Container {
    const btn = new Container();
    const size = 36;
    const g = new Graphics();
    g.circle(0, 0, size / 2).fill({ color: 0x111111, alpha: 0.9 }).stroke({ color: GOLD, width: 1.5, alpha: 0.7 });
    btn.addChild(g);

    const txt = this.txt(label, 16, GOLD, IMPACT, 0);
    txt.anchor.set(0.5, 0.5);
    btn.addChild(txt);

    btn.position.set(x, y);
    btn.eventMode = "static";
    btn.cursor = "pointer";

    btn.on("pointerover", () => { g.tint = GOLD; txt.style.fill = BLACK; });
    btn.on("pointerout", () => { g.tint = WHITE; txt.style.fill = GOLD; });
    btn.on("pointertap", (e) => { e.stopPropagation(); onClick(); });

    return btn;
  }

  private paginationContainer = new Container();

  private renderPagination(x: number, y: number): void {
    this.ct.addChild(this.paginationContainer);
    this.paginationContainer.position.set(x, y);
    this.rebuildPagination();
  }

  private rebuildPagination(): void {
    this.paginationContainer.removeChildren();
    const dotCount = 3;
    const gap = 14;
    const startX = -((dotCount - 1) * gap) / 2;

    for (let i = 0; i < dotCount; i++) {
      const active = i === this.activeIndex;
      const dot = new Graphics();
      if (active) {
        dot.circle(startX + i * gap, 0, 5).fill({ color: GOLD });
        dot.circle(startX + i * gap, 0, 7).stroke({ color: GOLD, width: 1, alpha: 0.5 });
      } else {
        dot.circle(startX + i * gap, 0, 4).fill({ color: WHITE, alpha: 0.3 });
      }
      this.paginationContainer.addChild(dot);
    }
  }

  private txt(s: string, sz: number, col: number, fam: string, ls: number): Text {
    return new Text({
      text: s,
      style: new TextStyle({ fill: col, fontFamily: fam, fontSize: sz, fontWeight: "700", letterSpacing: ls })
    });
  }
}
