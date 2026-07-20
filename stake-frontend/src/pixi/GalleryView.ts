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
    void tween(220, (p) => { this.alpha = p; });
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

    // ── Pure Fullscreen Transparent Dark Backdrop (No Outer Panel/Borders!) ──
    this.bg.clear();
    this.bg.rect(0, 0, W, H).fill({ color: BLACK, alpha: 0.88 });

    // ── Standard Playing Card Aspect Ratio (1 : 1.4) ──────────────────────
    const maxW = isP ? Math.min(W * 0.82, 300) : Math.min(W * 0.38, 300);
    const maxH = Math.min(H * 0.72, maxW * 1.4);
    const cardW = Math.min(maxW, maxH / 1.4);
    const cardH = cardW * 1.4;

    const deckCenterX = W / 2;
    const deckCenterY = H / 2 - 10;

    // ── Floating Close Button (Top-Right ✕) ──────────────────────────────
    const closeBtn = new Container();
    const cSize = 40;
    const cG = new Graphics();
    cG.circle(0, 0, cSize / 2).fill({ color: 0x111111, alpha: 0.9 }).stroke({ color: WHITE, width: 1.5, alpha: 0.6 });
    closeBtn.addChild(cG);

    const cTxt = this.txt("✕", 18, WHITE, FONT, 0);
    cTxt.anchor.set(0.5, 0.5);
    closeBtn.addChild(cTxt);

    closeBtn.position.set(W - 30, 30);
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";
    closeBtn.on("pointerover", () => { cG.tint = GOLD; cTxt.style.fill = BLACK; });
    closeBtn.on("pointerout", () => { cG.tint = WHITE; cTxt.style.fill = WHITE; });
    closeBtn.on("pointertap", (e) => { e.stopPropagation(); this.hide(); });
    this.ct.addChild(closeBtn);

    // ── Header Prompt ────────────────────────────────────────────────────
    const headerText = this.txt("BEACH GIRL DECK", isP ? 20 : 26, WHITE, IMPACT, 3);
    headerText.anchor.set(0.5, 0.5);
    headerText.position.set(W / 2, deckCenterY - cardH / 2 - (isP ? 26 : 34));
    this.ct.addChild(headerText);

    // ── Create 3 Stacked Cards (Exact Same Size & 1:1.4 Ratio) ────────────
    const prog = this.runtime.getGalleryProgress();
    const curGirl = prog.completedGirls;

    for (let i = 0; i < 3; i++) {
      const done = i < curGirl;
      const active = i === curGirl && !prog.mastered;
      const locked = i > curGirl || (prog.mastered && i >= 3);
      const theme = locked ? 0x333333 : THEME[i]!;

      const card = this.buildCard(cardW, cardH, i, done, active, locked, theme, prog);
      this.cards.push(card);
      this.deckContainer.addChild(card);
    }

    this.deckContainer.eventMode = "static";
    this.deckContainer.cursor = "grab";

    this.setupSwipeHandlers(this.deckContainer);
    this.ct.addChild(this.deckContainer);

    // Initial Stack Arrangement
    this.updateStackPositions(false, deckCenterX, deckCenterY);

    // ── Side Navigation Chevrons ────────────────────────────────────────
    const arrowDist = cardW / 2 + (isP ? 28 : 42);
    const btnLeft = this.buildArrow(deckCenterX - arrowDist, deckCenterY, "◄", () => this.prevCard(deckCenterX, deckCenterY));
    this.ct.addChild(btnLeft);

    const btnRight = this.buildArrow(deckCenterX + arrowDist, deckCenterY, "►", () => this.nextCard(deckCenterX, deckCenterY));
    this.ct.addChild(btnRight);

    // ── Pagination Dots & Status Hint ────────────────────────────────────
    const paginationY = deckCenterY + cardH / 2 + 24;
    this.renderPagination(deckCenterX, paginationY);

    if (prog.mastered) {
      const masterLabel = this.txt("★  GALLERY MASTERED  ★", isP ? 11 : 13, GREEN, IMPACT, 1.5);
      masterLabel.anchor.set(0.5, 0.5);
      masterLabel.position.set(deckCenterX, paginationY + 22);
      this.ct.addChild(masterLabel);
    } else {
      const nName = NAMES[curGirl] ?? "VEGA";
      const rem = (PIECES[curGirl] ?? 8) - prog.pieces;
      const hint = this.txt(`NEXT: ${nName} THEME · ${rem} WILDS NEEDED`, isP ? 11 : 12, GOLD, FONT, 1);
      hint.anchor.set(0.5, 0.5);
      hint.position.set(deckCenterX, paginationY + 22);
      this.ct.addChild(hint);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  STACK PHYSICS & LAYERING
  // ════════════════════════════════════════════════════════════════════════
  private updateStackPositions(animate = true, cx = this.screenW / 2, cy = this.screenH / 2): void {
    const offsets = [
      { dx: 0,   dy: 0,   scale: 1.0,  alpha: 1.0,  rotation: 0,      zIndex: 10 },
      { dx: 18,  dy: 14,  scale: 0.93, alpha: 0.85, rotation: 0.04,   zIndex: 5 },
      { dx: 36,  dy: 28,  scale: 0.86, alpha: 0.65, rotation: -0.04,  zIndex: 1 }
    ];

    this.cards.forEach((card, idx) => {
      const stackPos = (idx - this.activeIndex + 3) % 3;
      const target = offsets[stackPos]!;

      const targetX = cx + target.dx - 18;
      const targetY = cy + target.dy - 14;

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
        void tween(250, (p) => {
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
      if (dx < -30) {
        this.nextCard();
      } else if (dx > 30) {
        this.prevCard();
      }
    };

    target.on("pointerup", endDrag);
    target.on("pointerupoutside", endDrag);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BUILD INDIVIDUAL PLAYING CARD
  // ════════════════════════════════════════════════════════════════════════
  private buildCard(
    w: number, h: number, idx: number,
    done: boolean, active: boolean, locked: boolean,
    theme: number, prog: any
  ): Container {
    const card = new Container();
    card.pivot.set(w / 2, h / 2);

    const radius = 12;

    // ── Outer Neon Edge Glow ─────────────────────────────────────────────
    const glow = new Graphics();
    glow.roundRect(-3, -3, w + 6, h + 6, radius + 3)
      .fill({ color: theme, alpha: locked ? 0.04 : 0.25 });
    card.addChild(glow);

    // ── Pure Black Card Body ──────────────────────────────────────────────
    const body = new Graphics();
    body.roundRect(0, 0, w, h, radius)
      .fill({ color: 0x0a0a0a })
      .stroke({ color: theme, width: 2.5, alpha: locked ? 0.2 : 0.9 });
    body.roundRect(3, 3, w - 6, h - 6, radius - 2)
      .stroke({ color: theme, width: 0.5, alpha: locked ? 0.04 : 0.15 });
    card.addChild(body);

    // ── Card Header (Girl Name) ───────────────────────────────────────────
    const nameH = 34;
    const nameBg = new Graphics();
    nameBg.roundRect(4, 4, w - 8, nameH, 6).fill({ color: theme, alpha: locked ? 0.05 : 0.14 });
    card.addChild(nameBg);

    const nameText = this.txt(NAMES[idx]!, 18, locked ? 0x555555 : WHITE, IMPACT, 2);
    nameText.anchor.set(0.5, 0.5);
    nameText.position.set(w / 2, 4 + nameH / 2);
    card.addChild(nameText);

    // ── Character Art Viewport (CONTAIN FIT — ZERO CLIPPING!) ───────────
    const artPad = 10;
    const progressZoneH = 66; // reserved for progress bar + badge + reward
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
    artBg.roundRect(0, 0, artW, artH, 8).fill({ color: 0x040404 });
    artContainer.addChild(artBg);

    if (locked) {
      // Frosted Locked Viewport
      const frost = new Graphics();
      frost.rect(0, 0, artW, artH).fill({ color: 0x0a0a0a, alpha: 0.92 });
      artContainer.addChild(frost);

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
      // Completed Girl Art — CONTAIN FIT (Math.min) so NO part of girl is cut off!
      const texKey = `${PREFIX[idx]!}_full`;
      const tex = getExtraTexture(texKey);
      if (tex) {
        const spr = new Sprite(tex);
        spr.anchor.set(0.5, 0.5);
        // Contain fit scaling so full body image fits inside viewport with ZERO clipping!
        const scale = Math.min((artW - 6) / tex.width, (artH - 6) / tex.height);
        spr.scale.set(scale);
        spr.position.set(artW / 2, artH / 2);
        artContainer.addChild(spr);
      }

    } else if (active) {
      // Active In-Progress Girl Art (Silhouette + Pieces) — CONTAIN FIT!
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

        // Contain fit scaling so full silhouette & pieces fit inside viewport!
        const scale = Math.min((artW - 6) / silTex.width, (artH - 6) / silTex.height);
        assembly.scale.set(scale);
        assembly.position.set(artW / 2, artH / 2);
        artContainer.addChild(assembly);
      }
    }

    // Inner Border Frame around Art Viewport
    const artFrame = new Graphics();
    artFrame.roundRect(0, 0, artW, artH, 8).stroke({ color: theme, width: 1, alpha: locked ? 0.1 : 0.3 });
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

    // Status / Pieces Badge
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
    g.circle(0, 0, size / 2).fill({ color: 0x111111, alpha: 0.9 }).stroke({ color: WHITE, width: 1.5, alpha: 0.6 });
    btn.addChild(g);

    const txt = this.txt(label, 16, WHITE, IMPACT, 0);
    txt.anchor.set(0.5, 0.5);
    btn.addChild(txt);

    btn.position.set(x, y);
    btn.eventMode = "static";
    btn.cursor = "pointer";

    btn.on("pointerover", () => { g.tint = GOLD; txt.style.fill = BLACK; });
    btn.on("pointerout", () => { g.tint = WHITE; txt.style.fill = WHITE; });
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
