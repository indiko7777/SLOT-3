import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";

/** A camera travelling with the truck: only the surrounding city passes it. */
export class MiamiStreet extends Container {
  private readonly skyline: Sprite;
  private readonly city = new Container();
  private readonly near = new Container();
  private readonly reflections = new Graphics();
  private readonly buildings: Sprite[] = [];
  private readonly palms: Sprite[] = [];
  private distance = 0;
  private readonly filterViewport = new Rectangle();
  private readonly cityBlur = new BlurFilter({ strengthX: 1.5, strengthY: 0, quality: 1 });
  private readonly nearBlur = new BlurFilter({ strengthX: 3, strengthY: .3, quality: 1 });

  constructor(texture: Texture, private readonly w: number, private readonly h: number,
    palm?: Texture | null, building?: Texture | null) {
    super();
    this.skyline = new Sprite(texture);
    this.skyline.anchor.set(.5, .4);
    this.skyline.scale.set(Math.max(w / texture.width, h / texture.height) * 1.06);
    this.skyline.position.set(w / 2, h * .4);
    this.addChild(this.skyline, this.city, this.near, this.reflections);
    // Small fixed, single-pass horizontal softness on passing scenery only.
    this.city.filters = [this.cityBlur];
    this.near.filters = [this.nearBlur];
    this.city.filterArea = this.near.filterArea = this.filterViewport;
    if (building) for (let i = 0; i < 8; i++) {
      const sprite = new Sprite(building);
      sprite.anchor.set(.5, 1);
      sprite.tint = i % 3 === 0 ? 0xb5c6e4 : 0xd3d5ed;
      this.buildings.push(sprite);
      this.city.addChild(sprite);
    }
    if (palm) for (let i = 0; i < 10; i++) {
      const sprite = new Sprite(palm);
      sprite.anchor.set(.5, 1);
      sprite.tint = 0x718dac;
      this.palms.push(sprite);
      this.near.addChild(sprite);
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return;
    this.city.filters = this.near.filters = null;
    this.cityBlur.destroy();
    this.nearBlur.destroy();
    super.destroy(options);
  }

  update(dt: number, elapsed: number, speed: number, heat: number): void {
    // Near sprites grow beyond the edges: never allocate filters for their
    // offscreen bounds. Filter areas are in renderer screen coordinates.
    this.filterViewport.width = window.innerWidth;
    this.filterViewport.height = window.innerHeight;
    this.distance = (this.distance + Math.min(dt, .06) * speed) % 1000;
    const w = this.w, h = this.h;
    const sceneryHeight = Math.min(h, w * .85);
    const drift = Math.sin(elapsed * .53) * w * .003;
    const cx = w / 2 + drift;
    this.skyline.x = w / 2 + drift * .18;

    const pass = (sprites: Sprite[], rate: number, isPalm: boolean) => {
      const count = sprites.length / 2;
      sprites.forEach((sprite, i) => {
        const side = i % 2 ? 1 : -1;
        const phase = (Math.floor(i / 2) / count + this.distance * rate + (side > 0 ? .117 : 0)) % 1;
        // Perspective from constant forward travel. Reset is offscreen, never
        // a visible shrink or reverse zoom. Truck occludes the distant spawn.
        const depth = 1 / (1.18 - phase) - .7;
        const size = sceneryHeight * depth * (isPalm ? .94 : .69);
        const scale = size / sprite.texture.height;
        sprite.scale.set(scale * -side, scale);
        sprite.position.set(cx + side * w * (.12 + depth * (isPalm ? .42 : .40)), h * .43 + sceneryHeight * depth * .43);
        sprite.alpha = Math.min(1, phase * 12) * (isPalm ? .92 : .85);
        sprite.visible = phase > .005;
        sprite.zIndex = Math.round(depth * 1000);
      });
    };
    pass(this.buildings, .45, false);
    pass(this.palms, .8, true);
    this.city.sortChildren();
    this.near.sortChildren();

    // Understated red/blue light reflected in the passing margins. No road
    // markings, poles or spotlight geometry competing with the truck.
    this.reflections.clear();
    for (const side of [-1, 1]) {
      const pulse = Math.max(0, Math.sin(elapsed * 7 + side * 1.8));
      for (let i = 0; i < 4; i++) {
        const phase = (this.distance * 1.4 + i / 4 + (side > 0 ? .13 : 0)) % 1;
        const x = cx + side * w * (.24 + phase * .6);
        const y = h * (.64 + phase * .34);
        this.reflections.moveTo(x, y).lineTo(x + side * w * (.025 + speed * .025), y + h * .012)
          .stroke({ color: side < 0 ? 0xff3f65 : 0x4b9cff, width: 2 + phase * 3,
            alpha: pulse * .12 * Math.sin(phase * Math.PI) * (1 + heat * .1) });
      }
    }
  }
}
