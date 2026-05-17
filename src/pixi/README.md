# PIXI Rendering Layer

This folder is the serious slot frontend surface. The DOM only hosts the canvas.

- `PixiGameScene` consumes deterministic RGS/book events.
- `BoardView` owns reel/grid symbols, win highlights, tumbles, transforms, and mega-wild placement.
- `BonusView` owns Hold & Spin safes, keys, respins, and crack feedback.
- `HudView` owns the reference-layout shell, buy panels, heat rail, right art panel, and bottom controls.
- `EffectsLayer` owns event-driven particles, banners, siren sweeps, key beams, and cash sprays.
- `assets.ts` is the image drop-in contract. Add final PNG/WebP assets under `public/assets/` using the listed paths, then replace placeholder graphics with sprites without changing RGS/playback mechanics.

No PIXI renderer method may invent payout-affecting state. Every visible outcome must come from a `GameEvent`.
