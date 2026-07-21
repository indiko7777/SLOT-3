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

    // Chamfered "collectible plate" silhouette — the same language as the buy
    // panels, so the deck reads as part of the same HUD instead of a generic
    // rounded rectangle.
    const notch = Math.round(Math.min(22, w * 0.09));
    const plateAt = (pad: number): number[] => [
      -pad, -pad,
      w + pad - notch, -pad,
      w + pad, notch,
      w + pad, h + pad,
      notch, h + pad,
      -pad, h + pad - notch,
    ];
    const dim = locked ? 0.18 : 1;

    // ── Outer neon bloom ─────────────────────────────────────────────────
    const glow = new Graphics();
    glow.poly(plateAt(4)).fill({ color: theme, alpha: 0.26 * dim });
    card.addChild(glow);

    // ── Body: smoked plate + accent wash falling off toward the base ─────
    const body = new Graphics();
    body.poly(plateAt(0)).fill({ color: 0x07080d, alpha: 0.96 });
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      body.rect(1, (h / bands) * i, w - 2, h / bands)
        .fill({ color: theme, alpha: (0.13 - i * 0.021) * dim });
    }
    // Neon tube: soft wide pass under a bright hairline.
    body.poly(plateAt(0)).stroke({ color: theme, width: 3.2, alpha: 0.3 * dim });
    body.poly(plateAt(0)).stroke({ color: theme, width: 1.3, alpha: 0.95 * dim });
    // Lit chamfer + specular top edge.
    body.moveTo(w - notch, 0).lineTo(w, notch).stroke({ color: WHITE, width: 1.4, alpha: 0.5 * dim });
    body.rect(2, 1, w - notch - 4, 1.3).fill({ color: WHITE, alpha: 0.22 * dim });
    card.addChild(body);

    // ── Header: a rule + letterspaced name, not a filled bar ─────────────
    const nameH = 34;
    const nameText = this.txt(NAMES[idx]!, 19, locked ? 0x4a4a52 : WHITE, IMPACT, 3);
    nameText.anchor.set(0.5, 0.5);
    nameText.position.set(w / 2, 4 + nameH / 2 - 2);
    card.addChild(nameText);

    const rule = new Graphics();
    // hairline that fades out toward both ends
    for (let i = 0; i < 3; i++) {
      const inset = 14 + i * 26;
      rule.rect(inset, 4 + nameH - 4, w - inset * 2, 1)
        .fill({ color: theme, alpha: (0.5 - i * 0.14) * dim });
    }
    card.addChild(rule);

    // ── Character Art Viewport (CONTAIN FIT — ZERO CLIPPING!) ───────────
    const artPad = 10;
    // segments + status + how-to + "1 WILD = 1 PART" + reward label/value
    const progressZoneH = 96;
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

    // ── Segmented progress: one cell PER PART ────────────────────────────
    // A continuous bar hid the one number that matters — how many WILDs are
    // still needed. Discrete cells can be counted at a glance.
    const total = PIECES[idx]!;
    const curPieces = done ? total : active ? Math.min(total, prog.pieces) : 0;

    const pY = artY + artH + 10;
    const barX = 14;
    const barW = w - 28;
    const segGap = 3;
    const segW = (barW - segGap * (total - 1)) / total;
    const segH = 7;

    const segs = new Graphics();
    for (let s = 0; s < total; s++) {
      const sx = barX + s * (segW + segGap);
      const litSeg = s < curPieces;
      segs.roundRect(sx, pY, segW, segH, 2)
        .fill({ color: litSeg ? (done ? GREEN : theme) : WHITE, alpha: litSeg ? 0.95 : 0.09 });
      if (litSeg) {
        // bloom under the lit cell
        segs.roundRect(sx - 1, pY - 1, segW + 2, segH + 2, 3)
          .fill({ color: done ? GREEN : theme, alpha: 0.22 });
      }
    }
    card.addChild(segs);

    // ── Status ───────────────────────────────────────────────────────────
    const statusStr = done ? "★ COMPLETE" : locked ? "LOCKED" : `${curPieces} / ${total} PARTS`;
    const statusCol = done ? GREEN : locked ? 0x5a5a62 : WHITE;
    const statusBadge = this.txt(statusStr, 13, statusCol, IMPACT, 2);
    statusBadge.anchor.set(0.5, 0);
    statusBadge.position.set(w / 2, pY + 15);
    card.addChild(statusBadge);

    // ── What the player actually has to DO ───────────────────────────────
    // The deck previously showed only a bar and a reward name, never explaining
    // where parts come from or what completing her grants.
    const howStr = done ? "REWARD UNLOCKED — KEPT FOREVER"
                 : locked ? `COMPLETE ${NAMES[idx - 1] ?? "THE PREVIOUS GIRL"} TO UNLOCK`
                 : `LAND ${total - curPieces} MORE WILD${total - curPieces === 1 ? "" : "S"} TO COMPLETE`;
    const how = this.txt(howStr, 10, locked ? 0x4a4a52 : 0xc9d3e4, FONT, 0.8);
    how.anchor.set(0.5, 0);
    how.position.set(w / 2, pY + 34);
    card.addChild(how);

    const sub = this.txt(done ? "" : "1 WILD = 1 PART", 9, locked ? 0x3c3c44 : 0x7d8798, FONT, 1.4);
    sub.anchor.set(0.5, 0);
    sub.position.set(w / 2, pY + 48);
    card.addChild(sub);

    // ── Reward, presented as a prize line ────────────────────────────────
    const rewardLabel = this.txt("REWARD", 8, locked ? 0x3c3c44 : 0x6f7889, FONT, 2);
    rewardLabel.anchor.set(0.5, 0);
    rewardLabel.position.set(w / 2, pY + 63);
    card.addChild(rewardLabel);

    const rewardText = this.txt(REWARDS[idx]!, 11, locked ? 0x44444c : theme, IMPACT, 1);
    rewardText.anchor.set(0.5, 0);
    rewardText.position.set(w / 2, pY + 74);
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
