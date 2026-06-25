import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { LayoutMetrics, Rect } from "./types";
import { getExtraTexture } from "./assets";
import { makeText } from "./text";
import { ambientTicker } from "./tween";

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

  constructor(
    private readonly runtime: any,
    private readonly onCardTapped: () => void
  ) {
    super();
    this.eventMode = "passive"; // let children receive mouse inputs
    this.createCards();

    // Register smooth slider animation in the ambient ticker
    ambientTicker.add(this.updatePositions.bind(this));
  }

  private getCollapsedX(index: number, parentWidth: number, isPortrait: boolean): number {
    // We want the bottom-left corner of the card to be off-screen by a safe margin.
    // That means x_bottom_left >= parentWidth + bottomOffset.
    const bottomOffset = isPortrait ? 15 : 5;
    const tilt = this.tilts[index]!;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    // Derived from bottom-left corner position:
    // x_bottom_left = X_c - (W/2)*cos(theta) - (H/2)*sin(theta) = parentWidth + bottomOffset
    // X_c = parentWidth + bottomOffset + (W/2)*cos(theta) + (H/2)*sin(theta)
    return parentWidth + bottomOffset + (this.cardWidth / 2) * cosT + (this.cardHeight / 2) * sinT;
  }

  private getExpandedX(index: number, parentWidth: number, isPortrait: boolean): number {
    // When hovered, the card slides out to the left to show the card contents.
    // We want the rightmost point of the tilted card (the bottom-right corner) to align close to the screen edge.
    const margin = isPortrait ? 12 : 8;
    const tilt = this.tilts[index]!;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    // Derived from bottom-right corner position:
    // x_bottom_right = X_c + (W/2)*cos(theta) - (H/2)*sin(theta) = parentWidth - margin
    // X_c = parentWidth - margin - (W/2)*cos(theta) + (H/2)*sin(theta)
    return parentWidth - margin - (this.cardWidth / 2) * cosT + (this.cardHeight / 2) * sinT;
  }

  private createCards(): void {
    for (let i = 0; i < 3; i++) {
      const card = new Container();
      card.eventMode = "static";
      card.cursor = "pointer";
      
      // Keep track of positions
      this.currentXPositions.push(0);
      this.targetXPositions.push(0);

      // Card Background with rounded corners
      const bg = new Graphics();
      card.addChild(bg);
      this.cardBgs.push(bg);

      // Mouse/touch events for slide out
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
      // Slide out to the left to show most of the card
      this.targetXPositions[index] = this.getExpandedX(index, parentWidth, isPortrait);
      // Slight scale pop
      this.cards[index]!.scale.set(1.08);
      // Bring card to front
      this.addChild(this.cards[index]!);
    } else {
      // Collapse back to screen edge
      this.targetXPositions[index] = this.getCollapsedX(index, parentWidth, isPortrait);
      this.cards[index]!.scale.set(1.0);
    }
  }

  private updatePositions(_dt: number, _elapsed: number): void {
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]!;
      const targetX = this.targetXPositions[i]!;
      // Smooth interpolation (lerp)
      this.currentXPositions[i] += (targetX - this.currentXPositions[i]!) * 0.15;
      card.x = this.currentXPositions[i]!;
    }
  }

  /** Redraw / refresh the cards with current layout and gallery progress */
  layout(layout: LayoutMetrics): void {
    this.screenWidth = layout.width;
    const prog = this.runtime.getGalleryProgress();
    const currentGirlIdx = prog.completedGirls; // 0, 1, 2...
    const isPortrait = layout.portrait;

    // Calculate vertical layout
    const centerY = layout.height / 2;
    const cardStep = this.cardHeight + this.gap;

    for (let i = 0; i < 3; i++) {
      const card = this.cards[i]!;
      const bg = this.cardBgs[i]!;

      // Position Y
      card.y = centerY + (i - 1) * cardStep;

      // Update target and current X positions based on state
      const collapsedX = this.getCollapsedX(i, layout.width, isPortrait);
      const expandedX = this.getExpandedX(i, layout.width, isPortrait);
      const targetX = this.hoveredStates[i] ? expandedX : collapsedX;
      
      this.targetXPositions[i] = targetX;
      if (this.currentXPositions[i] === 0) {
        this.currentXPositions[i] = targetX;
        card.x = targetX;
      }

      // Slightly tilt the card
      card.rotation = this.tilts[i]!;

      // Clear card container children except the background
      while (card.children.length > 1) {
        const child = card.children[1]!;
        card.removeChild(child);
        child.destroy({ children: true });
      }

      // Redraw background based on state
      bg.clear();
      
      let borderGlowColor = 0x2b3b5e; // Muted grey for locked
      let fillAlpha = 0.88;
      let borderWidth = 2.5;

      const isCompleted = i < currentGirlIdx;
      const isActive = i === currentGirlIdx && !prog.mastered;
      const isLocked = i > currentGirlIdx || (prog.mastered && i >= 3); // Vega completed handles finished state

      if (isCompleted || isActive) {
        borderGlowColor = this.themeColors[i]!;
        fillAlpha = 0.93;
        borderWidth = 3;
      }

      // Shadow glow path
      bg.roundRect(-this.cardWidth / 2 - 2, -this.cardHeight / 2 - 2, this.cardWidth + 4, this.cardHeight + 4, 8)
        .fill({ color: borderGlowColor, alpha: 0.18 });

      // Main Card base
      bg.roundRect(-this.cardWidth / 2, -this.cardHeight / 2, this.cardWidth, this.cardHeight, 6)
        .fill({ color: 0x070c1e, alpha: fillAlpha })
        .stroke({ color: borderGlowColor, width: borderWidth });

      // Inner elegant glass border
      bg.roundRect(-this.cardWidth / 2 + 3, -this.cardHeight / 2 + 3, this.cardWidth - 6, this.cardHeight - 6, 4)
        .stroke({ color: borderGlowColor, width: 1, alpha: 0.25 });

      // Draw names
      const nameStr = i === 0 ? "SAPPHIRE" : i === 1 ? "ROXY" : "VEGA";
      const nameText = new Text({
        text: nameStr,
        style: new TextStyle({
          fill: isLocked ? 0x6e7e9a : 0xffffff,
          fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 1
        })
      });
      nameText.anchor.set(0.5, 0);
      nameText.position.set(0, -this.cardHeight / 2 + 8);
      card.addChild(nameText);

      // Card Artwork / Placeholders
      if (isLocked) {
        // --- LOCKED STATE ---
        const lockIcon = new Graphics();
        // Body of lock
        lockIcon.roundRect(-8, 4, 16, 12, 2).fill(0x3e4e6c);
        // Loop of lock
        lockIcon.arc(0, 4, 6, Math.PI, 0).stroke({ color: 0x3e4e6c, width: 2 });
        lockIcon.y = -10;
        card.addChild(lockIcon);

        const lockText = makeText("LOCKED", 10, 0x5a6a8c, 0, this.cardHeight / 2 - 20, "center");
        card.addChild(lockText);

      } else if (isCompleted) {
        // --- COMPLETED / UNLOCKED STATE ---
        if (i === 0) {
          // Sapphire full art exists!
          const fullTex = getExtraTexture("char_full");
          if (fullTex) {
            const artSprite = new Sprite(fullTex);
            artSprite.anchor.set(0.5);
            // Scale and crop to fit card beautifully
            const scale = Math.min((this.cardWidth - 10) / fullTex.width, (this.cardHeight - 40) / fullTex.height);
            artSprite.scale.set(scale);
            artSprite.y = 5;
            card.addChild(artSprite);
          }
        } else if (i === 1) {
          // Roxy full art exists!
          const fullTex = getExtraTexture("char2_full");
          if (fullTex) {
            const artSprite = new Sprite(fullTex);
            artSprite.anchor.set(0.5);
            // Scale and crop to fit card beautifully
            const scale = Math.min((this.cardWidth - 10) / fullTex.width, (this.cardHeight - 40) / fullTex.height);
            artSprite.scale.set(scale * 1.25);
            artSprite.y = 5;
            card.addChild(artSprite);
          }
        } else {
          // Vega prop placeholder completed art
          const completeIcon = new Graphics();
          completeIcon.circle(0, 0, 16).fill({ color: borderGlowColor, alpha: 0.25 }).stroke({ color: borderGlowColor, width: 1.5 });
          // Checkmark
          completeIcon.moveTo(-6, -1).lineTo(-2, 4).lineTo(7, -5).stroke({ color: borderGlowColor, width: 2.5 });
          completeIcon.y = -4;
          card.addChild(completeIcon);
        }

        const statusText = makeText("UNLOCKED", 10, borderGlowColor, 0, this.cardHeight / 2 - 20, "center");
        card.addChild(statusText);

      } else if (isActive) {
        // --- ACTIVE IN PROGRESS STATE ---
        if (i === 0) {
          // Sapphire interactive progress assembly
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

            // Overlay pieces
            const collectedPieces = prog.pieces;
            for (let p = 1; p <= Math.min(8, collectedPieces); p++) {
              const pieceTex = getExtraTexture(`char_piece_${p}`);
              if (pieceTex) {
                const pieceSprite = new Sprite(pieceTex);
                pieceSprite.anchor.set(0.5);
                assembly.addChild(pieceSprite);
              }
            }

            const scale = Math.min((this.cardWidth - 12) / silTex.width, (this.cardHeight - 44) / silTex.height);
            assembly.scale.set(scale * 1.05);
            assembly.y = 4;
            card.addChild(assembly);
          }
        } else if (i === 1) {
          // Roxy interactive progress assembly
          const assembly = new Container();
          const silTex = getExtraTexture("char2_silhouette");
          if (silTex) {
            const silSprite = new Sprite(silTex);
            silSprite.anchor.set(0.5);
            silSprite.x = 0;
            silSprite.y = 0;
            silSprite.tint = 0x000000;
            silSprite.alpha = 0.8;
            assembly.addChild(silSprite);

            // Overlay pieces
            const collectedPieces = prog.pieces;
            for (let p = 1; p <= Math.min(8, collectedPieces); p++) {
              const pieceTex = getExtraTexture(`char2_piece_${p}`);
              if (pieceTex) {
                const pieceSprite = new Sprite(pieceTex);
                pieceSprite.anchor.set(0.5);
                assembly.addChild(pieceSprite);
              }
            }

            const scale = Math.min((this.cardWidth - 12) / silTex.width, (this.cardHeight - 44) / silTex.height);
            assembly.scale.set(scale * 1.05 * 1.25);
            assembly.y = 4;
            card.addChild(assembly);
          }
        } else {
          // Vega in progress prop placeholders
          const progIcon = new Graphics();
          // Draw a stylized pulsing circle/gear to represent progress
          progIcon.circle(0, 0, 15).stroke({ color: borderGlowColor, width: 2, alpha: 0.5 });
          progIcon.circle(0, 0, 8).fill(borderGlowColor);
          progIcon.y = -6;
          card.addChild(progIcon);
        }

        const progText = makeText(`${prog.pieces} / 8`, 11, 0xffffff, 0, this.cardHeight / 2 - 20, "center");
        card.addChild(progText);
      }
    }
  }

  destroy(options?: any): void {
    ambientTicker.remove(this.updatePositions.bind(this));
    super.destroy(options);
  }
}
