import { BlurFilter, Container, Graphics, PerspectiveMesh, Rectangle, Sprite, Texture } from "pixi.js";
import { chaseCamera, chaseProject, CHASE_BUILDING_LINE, CHASE_CURB_HEIGHT, CHASE_ROAD_EDGE } from "./chaseProjection";

const ARCHITECTURE = [{ height: 12, length: 24 }, { height: 8, length: 25 }, { height: 21, length: 24 }] as const;
const BLOCK_SPACING = 24, BLOCK_COUNT = 8, CITY_LENGTH = BLOCK_SPACING * BLOCK_COUNT;

/** Vertical facades pass a camera travelling behind the original truck. */
export class MiamiStreet extends Container {
  private readonly skyline: Sprite;
  private readonly ground = new Graphics();
  private readonly city = new Container();
  private readonly reflections = new Graphics();
  private readonly buildings: PerspectiveMesh[] = [];
  private readonly palms: Sprite[] = [];
  private readonly buildingVariants: number[] = [];
  private distance = 0;
  private readonly filterViewport = new Rectangle();
  private readonly cityBlur = new BlurFilter({ strengthX: 1.2, strengthY: 0, quality: 1 });

  constructor(texture: Texture, private readonly w: number, private readonly h: number,
    palm?: Texture | null, private readonly buildingTextures: readonly Texture[] = []) {
    super();
    this.skyline = new Sprite(texture);
    // The plate contains only distant skyline: no stationary foreground.
    this.skyline.width = w * 1.04;
    this.skyline.height = h * .445;
    this.skyline.position.set(-w * .02, 0);
    this.addChild(this.skyline, this.ground, this.city, this.reflections);
    this.city.filters = [this.cityBlur];
    // Pixi transforms filterArea from LOCAL coordinates. CSS viewport pixels
    // here clipped the right-hand city when the game scaled down on phones.
    this.filterViewport.width = w;
    this.filterViewport.height = h;
    this.city.filterArea = this.filterViewport;
    if (buildingTextures.length) for (let i = 0; i < BLOCK_COUNT * 2; i++) {
      const variant = i % buildingTextures.length;
      const mesh = new PerspectiveMesh({ texture: buildingTextures[variant], verticesX: 5, verticesY: 5 });
      mesh.tint = 0xbac4e4;
      this.buildings.push(mesh);
      this.buildingVariants.push(variant);
      this.city.addChild(mesh);
    }
    if (palm) for (let i = 0; i < 16; i++) {
      const sprite = new Sprite(palm);
      sprite.anchor.set(.5, 1);
      this.palms.push(sprite);
      this.city.addChild(sprite);
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return;
    this.city.filters = null;
    this.cityBlur.destroy();
    super.destroy(options);
  }

  update(dt: number, elapsed: number, speed: number, heat: number): void {
    this.distance += Math.min(dt, .06) * speed * 32;
    const w = this.w, h = this.h;
    const drift = Math.sin(elapsed * .53) * w * .003;
    const camera = chaseCamera(w, h, drift);
    const project = (x: number, y: number, z: number) => chaseProject(camera, x, y, z);
    this.skyline.x = -w * .02 + drift * .18;

    // Facade bottoms and palm roots sit on the SAME raised pavement.
    const ground = this.ground.clear();
    ground.rect(0, camera.horizon, w, h - camera.horizon).fill(0x111626);
    for (const side of [-1, 1]) {
      const a = project(side * CHASE_ROAD_EDGE, CHASE_CURB_HEIGHT, .75);
      const b = project(side * CHASE_ROAD_EDGE, CHASE_CURB_HEIGHT, 240);
      const c = project(side * 38, CHASE_CURB_HEIGHT, 240);
      const d = project(side * 38, CHASE_CURB_HEIGHT, .75);
      ground.poly([a.x,a.y,b.x,b.y,c.x,c.y,d.x,d.y]).fill(side < 0 ? 0x323044 : 0x282f43);
      ground.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({ color: side < 0 ? 0xbc7888 : 0x6792a5, width: 2, alpha: .45 });
    }

    this.buildings.forEach((mesh, i) => {
      const side = i % 2 ? 1 : -1;
      const travel = this.distance + Math.floor(i / 2) * BLOCK_SPACING + (side > 0 ? 13 : 0);
      const far = CITY_LENGTH - travel % CITY_LENGTH;
      const variant = (Math.floor(travel / CITY_LENGTH) + Math.floor(i / 2) * 2 + (side > 0 ? 1 : 0)) % this.buildingTextures.length;
      if (this.buildingVariants[i] !== variant) {
        mesh.texture = this.buildingTextures[variant];
        this.buildingVariants[i] = variant;
      }
      const shape = ARCHITECTURE[variant % ARCHITECTURE.length];
      // Recycle after the FAR end has passed the camera. Recycling at the
      // near end removed a still-visible facade and opened gaps every block.
      const z = far - shape.length;
      const footNear = project(side * CHASE_BUILDING_LINE, CHASE_CURB_HEIGHT, z);
      const footFar = project(side * CHASE_BUILDING_LINE, CHASE_CURB_HEIGHT, far);
      const topNear = project(side * CHASE_BUILDING_LINE, shape.height + CHASE_CURB_HEIGHT, z);
      const topFar = project(side * CHASE_BUILDING_LINE, shape.height + CHASE_CURB_HEIGHT, far);
      mesh.visible = side < 0 ? footFar.x > -w * .1 : footFar.x < w * 1.1;
      if (!mesh.visible) return;
      // Each wall runs along the sidewalk in depth, never across the roadway.
      if (side < 0) mesh.setCorners(topNear.x,topNear.y,topFar.x,topFar.y,footFar.x,footFar.y,footNear.x,footNear.y);
      else mesh.setCorners(topFar.x,topFar.y,topNear.x,topNear.y,footNear.x,footNear.y,footFar.x,footFar.y);
      mesh.alpha = Math.min(1, (CITY_LENGTH - far) / 16);
      mesh.zIndex = -z;
    });
    this.palms.forEach((sprite, i) => {
      const side = i % 2 ? 1 : -1;
      const z = 144 - (this.distance + Math.floor(i / 2) * 18 + (side > 0 ? 8 : 0)) % 144;
      const root = project(side * 8.8, CHASE_CURB_HEIGHT, z);
      const height = 10.5 + (i % 3) * .85;
      const scale = root.scale * height / sprite.texture.height;
      sprite.scale.set(scale * -side, scale);
      sprite.position.set(root.x, root.y);
      sprite.alpha = Math.min(1, (144 - z) / 12);
      sprite.visible = z > 2 && root.x > -w && root.x < w * 2;
      sprite.zIndex = -z;
    });
    // Depth-sort trees WITH the walls: distant crowns disappear behind nearer
    // buildings instead of being pasted over everything in a foreground layer.
    this.city.sortChildren();

    this.reflections.clear();
    for (const side of [-1, 1]) {
      const pulse = Math.max(0, Math.sin(elapsed * 7 + side * 1.8));
      for (let i = 0; i < 4; i++) {
        const z = 58 - (this.distance + i * 14.5 + (side > 0 ? 7 : 0)) % 58;
        const a = project(side * 7.1, 0, z), b = project(side * 7.1, 0, z + 3);
        this.reflections.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({
          color: side < 0 ? 0xff3f65 : 0x4b9cff, width: Math.min(5, a.scale * .06),
          alpha: pulse * .12 * Math.min(1, z / 6) * (1 + heat * .1),
        });
      }
    }
  }
}
