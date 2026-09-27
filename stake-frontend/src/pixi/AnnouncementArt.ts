import { Container, FillGradient, Graphics, TextStyle } from "pixi.js";
import { DISPLAY_FONT } from "../typography";

export function announcementTitleStyle(size: number, tier = 0): TextStyle {
  const lower = [0xffc34d, 0xffb536, 0xff8871, 0xff83bb, 0x72ffe7][tier] ?? 0xffc34d;
  return new TextStyle({
    fontFamily: DISPLAY_FONT, fontWeight: "400", fontSize: size,
    letterSpacing: 1, align: "center", padding: 12,
    fill: new FillGradient({ start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
      { offset: 0, color: 0xffffff }, { offset: .44, color: 0xffffe9 },
      { offset: .48, color: 0xffe8b3 }, { offset: 1, color: lower },
    ] }),
    stroke: { color: 0x322037, width: 5, join: "round" },
    dropShadow: { color: 0xad3761, alpha: 1, blur: 0, distance: 7, angle: Math.PI / 2 },
  });
}

/** Shared, resolution-independent title treatment. Geometry stays inside the board. */
export class AnnouncementArt extends Container {
  private readonly halo = new Graphics();
  private readonly shards = new Graphics();
  private readonly face = new Graphics();
  private readonly flare = new Graphics();
  private readonly glints = new Graphics();
  constructor(private readonly w: number, private readonly h: number, tier = 0) {
    super();
    this.addChild(this.halo, this.shards, this.face, this.flare, this.glints);
    this.flare.alpha = 0;
    this.setTier(tier);
  }

  setTier(tier: number): void {
    const w = this.w, h = this.h;
    const accent = [0xffcc79, 0xffce70, 0xff876c, 0xf780b2, 0x7aeee7][tier] ?? 0xffcc79;
    this.halo.clear();
    const glow = new FillGradient({ type: "radial", center: { x: .5, y: .5 }, innerRadius: 0,
      outerCenter: { x: .5, y: .5 }, outerRadius: .5,
      colorStops: [{ offset: 0, color: "rgba(255,205,139,0.48)" },
        { offset: .44, color: "rgba(255,107,150,0.23)" },
        { offset: .7, color: "rgba(81,222,237,0.14)" }, { offset: 1, color: "rgba(81,222,237,0)" }] });
    this.halo.ellipse(0, 0, w*.48, h*.95).fill(glow);
    this.shards.clear();
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3 + tier; i++) {
        const y = (i - (2 + tier) / 2) * h * 0.105;
        const x = side * w * (0.32 + (i % 2) * 0.025);
        this.shards.poly([x, y, side * w * 0.49, y - h * 0.08, side * w * 0.43, y + h * 0.015])
          .fill({ color: i % 2 ? 0x77fff3 : accent, alpha: 0.8 - i * 0.055 });
      }
    }
    this.face.clear();
    // Open silhouette: typography is the hero, with no card or central emblem.
    for (const side of [-1, 1]) {
      this.face.poly([side*w*.23,-h*.04,side*w*.48,-h*.16,side*w*.41,-h*.10])
        .fill({ color: 0xffe4a3, alpha: .95 });
      this.face.poly([side*w*.25,h*.20,side*w*.45,h*.13,side*w*.37,h*.20])
        .fill({ color: 0x9afff3, alpha: .9 });
      for (let col = 0; col < 5; col++) {
        this.face.circle(side*w*(.34+col*.018), h*.07, 1.6-col*.2)
          .fill({ color: accent, alpha: .3-col*.04 });
      }
    }
    // Neon-painted light sweeps frame the type, with no solid plaque behind it.
    for (const [color, y, sign] of [[0x80fff1, -.38, 1], [0xffc56c, .43, -1]]) {
      for (const [width, alpha] of [[12, .12], [5, .25], [1.8, .95]]) {
        this.face.moveTo(-w*.43, h*y).bezierCurveTo(-w*.18, h*(y+sign*.16), w*.18, h*(y-sign*.12), w*.43, h*(y-sign*.2))
          .stroke({ color, width, alpha });
      }
    }
    this.flare.clear().ellipse(0, 0, w*.49, h*.62).fill(new FillGradient({
      type: "radial", center: { x: .5, y: .5 }, innerRadius: 0,
      outerCenter: { x: .5, y: .5 }, outerRadius: .5,
      colorStops: [{ offset: 0, color: "rgba(255,253,217,.6)" }, { offset: .45, color: "rgba(255,195,105,.28)" }, { offset: 1, color: "rgba(255,195,105,0)" }],
    }));
    this.glints.clear();
    for (let i=0; i<4+tier; i++) {
      const side = i%2 ? 1 : -1;
      const x=side*w*(.29+(i%3)*.063), y=h*((i%3)-1)*.29;
      const radius=3+(i%2)*2;
      this.glints.poly([x-radius*2,y,x-radius*.28,y-radius*.28,x,y-radius*2,x+radius*.28,y-radius*.28,x+radius*2,y,x+radius*.28,y+radius*.28,x,y+radius*2,x-radius*.28,y+radius*.28])
        .fill({ color: i%2 ? 0xf0fff8 : 0xffefb7, alpha: .95 });
    }

  }

  pose(progress: number): void {
    this.shards.scale.x = .76 + .24 * progress;
    this.shards.alpha = progress;
    this.halo.alpha = progress;
    this.glints.alpha = Math.min(1, progress);
  }

  impact(progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    this.flare.alpha = (1-p) ** 2;
    this.glints.scale.set(.75 + p*.25);
  }
}
