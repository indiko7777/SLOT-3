import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { getExtraTexture } from "./assets";
import { makeText } from "./text";
import type { LayoutMetrics, Rect } from "./types";
import { tween } from "./tween";

const GOLD = 0xffdf65;
const CYAN = 0x9ae64e;
const PANEL_BG = 0x0a0f24;
const OVERLAY_BG = 0x000000;
const BORDER_GOLD = 0xb8962e;
const TEXT_WHITE = 0xffffff;
const TEXT_DIM = 0x8a9cbf;

export class GalleryView extends Container {
  private bg = new Graphics();
  private panel = new Graphics();
  private contentContainer = new Container();
  private isVisible = false;
  private screenW = 0;
  private screenH = 0;

  // Colors mapping matching CardPeekView
  private themeColors = [
    0xff00b8, // Sapphire
    0xffdf65, // Roxy
    0x00ffff  // Vega
  ];

  constructor(private readonly runtime: any) {
    super();
    this.visible = false;
    this.eventMode = "static";
    this.interactiveChildren = true;

    this.addChild(this.bg);
    this.addChild(this.panel);
    this.addChild(this.contentContainer);

    // Block pointer propagation
    this.bg.eventMode = "static";
    this.bg.on("pointertap", (e) => {
      e.stopPropagation();
    });
  }

  show(screenWidth: number, screenHeight: number): void {
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    this.rebuild();
    this.visible = true;
    this.isVisible = true;

    // Smooth fade in
    this.alpha = 0;
    void tween(200, (p) => {
      this.alpha = p;
    });
  }

  hide(): void {
    // Smooth fade out
    void tween(150, (p) => {
      this.alpha = 1 - p;
    }).then(() => {
      this.visible = false;
      this.isVisible = false;
    });
  }

  toggle(screenWidth: number, screenHeight: number): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show(screenWidth, screenHeight);
    }
  }

  private rebuild(): void {
    const w = this.screenW;
    const h = this.screenH;
    const isPortrait = w < 980 || h > w;

    // 1. Dark fullscreen background
    this.bg.clear();
    this.bg.rect(0, 0, w, h).fill({ color: OVERLAY_BG, alpha: 0.94 });

    // 2. Main panel bounds (smaller/centered in screen)
    const pw = isPortrait ? Math.min(w * 0.90, 420) : Math.min(w * 0.85, 840);
    const ph = isPortrait ? Math.min(h * 0.88, 760) : Math.min(h * 0.84, 520);
    const px = (w - pw) / 2;
    const py = (h - ph) / 2;

    this.panel.clear();
    // Ghost neon border
    this.panel.roundRect(px - 2, py - 2, pw + 4, ph + 4, 16).stroke({ color: CYAN, width: 1, alpha: 0.25 });
    // Body fill
    this.panel.roundRect(px, py, pw, ph, 14).fill({ color: PANEL_BG, alpha: 0.96 });
    // Gold border
    this.panel.roundRect(px, py, pw, ph, 14).stroke({ color: BORDER_GOLD, width: 3, alpha: 0.85 });
    // Inner border
    this.panel.roundRect(px + 4, py + 4, pw - 8, ph - 8, 10).stroke({ color: GOLD, width: 1, alpha: 0.18 });

    // 3. Rebuild gallery content
    this.contentContainer.removeChildren();
    this.contentContainer.position.set(px, py);

    // --- Title ---
    const title = new Text({
      text: "BEACH GIRL GALLERY",
      style: new TextStyle({
        fill: GOLD,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: isPortrait ? 24 : 32,
        fontWeight: "900",
        letterSpacing: 3,
        dropShadow: { color: CYAN, alpha: 0.4, blur: 8, distance: 0 }
      })
    });
    title.anchor.set(0.5, 0);
    title.position.set(pw / 2, 16);
    this.contentContainer.addChild(title);

    // --- Get Progress State ---
    const prog = this.runtime.getGalleryProgress();
    const currentGirlIdx = prog.completedGirls;

    // --- Card containers lay out ---
    const cardsRow = new Container();
    this.contentContainer.addChild(cardsRow);

    const cardW = isPortrait ? 96 : 140;
    const cardH = isPortrait ? 144 : 210;
    const cardGap = isPortrait ? 12 : 28;

    for (let i = 0; i < 3; i++) {
      const isCompleted = i < currentGirlIdx;
      const isActive = i === currentGirlIdx && !prog.mastered;
      const isLocked = i > currentGirlIdx || (prog.mastered && i >= 3);

      const card = new Container();
      const cardBg = new Graphics();
      card.addChild(cardBg);

      let themeColor = isLocked ? 0x2b3b5e : this.themeColors[i]!;

      // Outer glow
      cardBg.roundRect(-cardW / 2 - 2, -cardH / 2 - 2, cardW + 4, cardH + 4, 10).fill({ color: themeColor, alpha: 0.15 });
      // Card body
      cardBg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 8)
        .fill({ color: 0x050a1b, alpha: 0.95 })
        .stroke({ color: themeColor, width: isActive || isCompleted ? 3 : 2 });
      // Card inner edge
      cardBg.roundRect(-cardW / 2 + 4, -cardH / 2 + 4, cardW - 8, cardH - 8, 6).stroke({ color: themeColor, width: 1, alpha: 0.2 });

      // Name label
      const nameStr = i === 0 ? "SAPPHIRE" : i === 1 ? "ROXY" : "VEGA";
      const nameLabel = new Text({
        text: nameStr,
        style: new TextStyle({
          fill: isLocked ? 0x5e6e8a : TEXT_WHITE,
          fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
          fontSize: isPortrait ? 11 : 14,
          fontWeight: "900",
          letterSpacing: 1
        })
      });
      nameLabel.anchor.set(0.5, 0);
      nameLabel.position.set(0, -cardH / 2 + 10);
      card.addChild(nameLabel);

      // Card Art / Silhouette
      if (isLocked) {
        // Muted Lock icon
        const lockIcon = new Graphics();
        lockIcon.roundRect(-10, 4, 20, 15, 3).fill(0x313e56);
        lockIcon.arc(0, 4, 7, Math.PI, 0).stroke({ color: 0x313e56, width: 2 });
        lockIcon.y = -12;
        card.addChild(lockIcon);

        const statusLbl = makeText("LOCKED", 11, 0x5e6e8a, 0, cardH / 2 - 24, "center");
        card.addChild(statusLbl);
      } else if (isCompleted) {
        // Complete state
        if (i === 0) {
          const fullTex = getExtraTexture("char_full");
          if (fullTex) {
            const artSprite = new Sprite(fullTex);
            artSprite.anchor.set(0.5);
            const scale = Math.min((cardW - 14) / fullTex.width, (cardH - 50) / fullTex.height);
            artSprite.scale.set(scale);
            artSprite.y = 4;
            card.addChild(artSprite);
          }
        } else {
          // Placeholder completed mark
          const completeIcon = new Graphics();
          completeIcon.circle(0, 0, 22).fill({ color: themeColor, alpha: 0.2 }).stroke({ color: themeColor, width: 2 });
          completeIcon.moveTo(-8, -2).lineTo(-2, 5).lineTo(10, -6).stroke({ color: themeColor, width: 3.5 });
          completeIcon.y = -6;
          card.addChild(completeIcon);
        }

        const statusLbl = makeText("UNLOCKED", 11, themeColor, 0, cardH / 2 - 24, "center");
        card.addChild(statusLbl);
      } else if (isActive) {
        // Active in progress state
        if (i === 0) {
          const assembly = new Container();
          const silTex = getExtraTexture("char_silhouette");
          if (silTex) {
            const silSprite = new Sprite(silTex);
            silSprite.anchor.set(0.5);
            silSprite.x = 10;
            silSprite.y = 5;
            silSprite.tint = 0x000000;
            silSprite.alpha = 0.8;
            assembly.addChild(silSprite);

            const collectedPieces = prog.pieces;
            for (let p = 1; p <= Math.min(8, collectedPieces); p++) {
              const pieceTex = getExtraTexture(`char_piece_${p}`);
              if (pieceTex) {
                const pieceSprite = new Sprite(pieceTex);
                pieceSprite.anchor.set(0.5);
                assembly.addChild(pieceSprite);
              }
            }

            const scale = Math.min((cardW - 16) / silTex.width, (cardH - 56) / silTex.height);
            assembly.scale.set(scale * 1.05);
            assembly.y = 4;
            card.addChild(assembly);
          }
        } else {
          // Progress placeholder spinner
          const spinIcon = new Graphics();
          spinIcon.circle(0, 0, 20).stroke({ color: themeColor, width: 2.5, alpha: 0.4 });
          spinIcon.arc(0, 0, 20, 0, Math.PI * 1.3).stroke({ color: themeColor, width: 2.5 });
          spinIcon.circle(0, 0, 8).fill(themeColor);
          spinIcon.y = -6;
          card.addChild(spinIcon);
        }

        const statusLbl = makeText(`${prog.pieces} / 8 PARTS`, 11, TEXT_WHITE, 0, cardH / 2 - 24, "center");
        card.addChild(statusLbl);
      }

      // Add description of reward below card
      const rewardStr = i === 0 
        ? "Neon Nights Skin" 
        : i === 1 
        ? "Gold Rush Skin" 
        : "Diamond Elite Skin";
      const rewardText = new Text({
        text: rewardStr.toUpperCase(),
        style: new TextStyle({
          fill: isLocked ? 0x4e5e7a : themeColor,
          fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
          fontSize: isPortrait ? 9 : 11,
          fontWeight: "900",
          letterSpacing: 0.5
        })
      });
      rewardText.anchor.set(0.5, 0);
      rewardText.position.set(0, cardH / 2 + 8);
      card.addChild(rewardText);

      // Card positioning in Row / Column
      if (isPortrait) {
        card.x = pw / 2;
        card.y = 70 + cardH / 2 + i * (cardH + cardGap + 18);
      } else {
        card.x = pw / 2 + (i - 1) * (cardW + cardGap);
        card.y = 60 + cardH / 2 + 10;
      }
      
      cardsRow.addChild(card);
    }

    // --- Footer rewards descriptions & info ---
    const footer = new Container();
    this.contentContainer.addChild(footer);

    const infoTextStr = "All collection rewards are purely cosmetic ($0 EV) and do not affect the 96% RTP.";
    const infoText = new Text({
      text: infoTextStr,
      style: new TextStyle({
        fill: TEXT_DIM,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: isPortrait ? 10 : 12,
        fontWeight: "700",
        align: "center"
      })
    });
    infoText.anchor.set(0.5, 0.5);
    footer.addChild(infoText);

    // If Gallery Mastered, show the badge!
    if (prog.mastered) {
      const badgeText = new Text({
        text: "🏆 GALLERY MASTER - VIP BADGE EARNED",
        style: new TextStyle({
          fill: GOLD,
          fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
          fontSize: isPortrait ? 12 : 15,
          fontWeight: "900",
          letterSpacing: 1
        })
      });
      badgeText.anchor.set(0.5, 0.5);
      badgeText.position.set(0, -22);
      footer.addChild(badgeText);
    } else {
      // Show next target hint
      const nextTargetName = prog.mastered ? "Vega" : (currentGirlIdx === 0 ? "Sapphire" : currentGirlIdx === 1 ? "Roxy" : "Vega");
      const piecesRemaining = 8 - prog.pieces;
      const targetHint = `Next Unlocks: ${nextTargetName} Theme (${piecesRemaining} Wilds needed)`;
      const hintText = makeText(targetHint, isPortrait ? 10 : 12, GOLD, 0, -22, "center");
      footer.addChild(hintText);
    }

    // Position footer at bottom
    if (isPortrait) {
      footer.position.set(pw / 2, ph - 92);
    } else {
      footer.position.set(pw / 2, ph - 74);
    }

    // --- Close Button ---
    const btn = new Container();
    const btnW = isPortrait ? 130 : 150;
    const btnH = 34;
    
    const btnBg = new Graphics();
    btnBg.roundRect(0, 0, btnW, btnH, 8).fill({ color: 0x12192f, alpha: 0.95 });
    btnBg.roundRect(0, 0, btnW, btnH, 8).stroke({ color: GOLD, width: 1.5, alpha: 0.7 });
    btn.addChild(btnBg);

    const btnLabel = new Text({
      text: "CLOSE",
      style: new TextStyle({
        fill: GOLD,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 16,
        fontWeight: "900",
      })
    });
    btnLabel.anchor.set(0.5, 0.5);
    btnLabel.position.set(btnW / 2, btnH / 2);
    btn.addChild(btnLabel);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerover", () => {
      btn.scale.set(1.04);
      btnBg.tint = 0xccddff;
    });
    btn.on("pointerout", () => {
      btn.scale.set(1);
      btnBg.tint = 0xffffff;
    });
    btn.on("pointertap", (e) => {
      e.stopPropagation();
      this.hide();
    });

    if (isPortrait) {
      btn.position.set(pw / 2 - btnW / 2, ph - 48);
    } else {
      btn.position.set(pw / 2 - btnW / 2, ph - 42);
    }
    this.contentContainer.addChild(btn);
  }

  isOpen(): boolean {
    return this.isVisible;
  }
}
