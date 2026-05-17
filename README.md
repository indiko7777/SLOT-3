# Heat Chase: Grand Escape

Stake Engine slot prototype implementing the selected concept as a deterministic event-driven 5x4 cluster/tumble game with Heat transformations and a Hold & Spin bonus.

## Commands

```bash
npm install
npm run generate:publish
npm run test
npm run build
npm run dev
```

## What Is Implemented

- 5x4 cluster/tumble presentation with Heat Meter progression.
- Heat 3 `Bust the Stash`, Heat 4 2x2 car wild, Heat 5 global multiplier playback.
- `The Getaway` Hold & Spin bonus with Safe values and Master Key cracking.
- Deterministic TypeScript event schema and sample event books for base, ante, buy, and super buy.
- Publish generator for lookup CSV, `.jsonl.zst` books, and `index.json`.
- Screenshot-matched composition: left buy stack, vertical meter rail, central grid, right art panel, bottom controls.

## Publish Paths

Math publish files are generated under:

```txt
games/heat-chase-grand-escape/library/publish_files/
```

Frontend production build outputs to:

```txt
dist/
```
