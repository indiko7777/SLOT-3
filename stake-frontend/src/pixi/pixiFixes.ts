import { AbstractText, Graphics, type GraphicsContext, type TextStyle } from "pixi.js";

/**
 * Pixi 8.18 frees a Graphics' OWN drawing context only when it is destroyed
 * with no options. `destroy({ children: true })` — the form this game uses
 * everywhere — leaves that context registered with the renderer's GPU garbage
 * collector, still listening to the dead Graphics, so both (plus geometry
 * buffers, bounds, matrices) stay alive until Pixi's 60 s idle sweep. On an
 * emulated iPhone 12 that was ~145 Graphics per spin and the JS heap climbing
 * ~2 MB per spin. Destroy the owned context too, whatever the options.
 *
 * Only the Graphics' own context is touched (never one passed in or shared),
 * and textures are left alone: fills such as the shared gradients
 * (gradients.ts) and symbol textures must outlive any one Graphics.
 *
 * Text has the same shape of leak: a destroyed Text never unsubscribes from
 * its TextStyle, so a style shared across HUD redraws kept every old Text alive
 * (~4 per spin). Unsubscribe before destroying.
 */
let applied = false;

export function applyPixiFixes(): void {
  if (applied) return;
  applied = true;
  const destroyGraphics = Graphics.prototype.destroy;
  Graphics.prototype.destroy = function (this: Graphics, options?: Parameters<Graphics["destroy"]>[0]): void {
    const owned = (this as unknown as { _ownedContext: GraphicsContext | null })._ownedContext;
    destroyGraphics.call(this, options);
    if (owned && !owned.destroyed) owned.destroy(false);
  };

  const destroyText = AbstractText.prototype.destroy;
  AbstractText.prototype.destroy = function (this: AbstractText<never, never>, options?: Parameters<AbstractText<never, never>["destroy"]>[0]): void {
    const self = this as unknown as { _style: TextStyle | null; onViewUpdate: () => void };
    self._style?.off("update", self.onViewUpdate, this);
    destroyText.call(this, options);
  };
}

applyPixiFixes();
