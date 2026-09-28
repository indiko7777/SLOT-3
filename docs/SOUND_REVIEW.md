# Sound review — 28 September 2026

## Revised review (v2)

The current page replaces the overwhelming 147-item inventory with a Remaining queue and a separate Confirmed view. The initial main queue has 10 remaining decisions. Music, voices and other effects are separate sections. Each symbol has exactly one review entry and two complete, materially different sound options. Forty original WAV designs were rendered by `tools/sound-review/render-designs.mjs`; descriptions identify their actual sequence, material and duration instead of generic style labels.

All 25 prior decisions are preserved in `tools/sound-review/decisions-backup.json` and migrated into the v2 project state. The old synthesis module is frozen so previously approved A/B/C options keep their exact sound. The earlier pistol casing/tink approval is archived, not discarded, and is no longer a separate symbol decision. The user's requested pistol edit becomes the single pistol selection.

The supplied pistol recording was cut from 0.145 to 0.435 seconds, with a short ending fade and attenuation to avoid retaining the source's excessive peaks. Result: **0.290 seconds, one shot**, before the second shot begins. Original source retained in `tools/sound-review/uploads/pistol-original.mp3`; edited file is `pistol-single-shot.wav`. The approved combination and dud recordings were also copied into project storage.

Approvals and new uploads now save automatically to the local project through a development-only Vite endpoint. The page explicitly distinguishes confirmed review choices from production integration. No production sound routing was changed in this revision.

Validation: 25 original choices compared unchanged, nine symbol entries, all 40 generated WAVs distinct/non-silent/below clipping, edited pistol contains one attack group. Current production build passes. This checks file integrity and workflow; final sound preference remains the user's decision.

Open http://127.0.0.1:5176/sound-review.html while `npm run dev:local` runs in stake-frontend. This is a development-only audition page, excluded from Vite's normal index.html production build. No production audio code was changed for this review.

## Start with a small batch

1. Winning combination: compare A/B/C and choose the overall character of the sound.
2. Cascade progression, symbol removal, replacement settle, first Wanted star.
3. Symbol identities: cash, ammo, pistol, knife, duffel, diamond, brass, bike. Review their quieter detail cues after the main reward motif.
4. Getaway: entry, reels, bars, dynamite landing, fuse, explosion, each doubled value, respins and result.
5. Win banners and counters, collection voices, interface, then music.

For every remaining cue: read its purpose, play the two designs or its current sound, then approve one, choose silence, or upload a personal file. Approval advances to the next remaining sound. Decisions and uploads persist in the project; the agent can read `tools/sound-review/decisions.json` on the next turn. Approved sounds are hidden from Remaining and available in Confirmed. Export is an optional backup. Approvals do not automatically change live game audio.

After a batch is approved: refine the selected sound, wire it to the visual contact frame, audition it against music, compare normal/turbo playback, and validate it again in the game. Use distinct volume controls for music, effects and voices in the eventual mixer. Stop loops and scheduled effects on dismissal, skip, mute and tab hiding. Avoid solving quiet feedback by increasing every sound's volume.

## Confirmed gaps and proposals

| Moment | Source finding | Proposed sound |
| --- | --- | --- |
| Winning combination | `audio.ts` leaves `cluster_win` empty. `PixiGameScene.playCombinationAnimation` only creates visual links. | One clear short cluster reward motif, with symbol texture underneath. |
| Consecutive cascades | No dedicated cascade-index motif. | Related pitched variations across actual successive winning cascades, reset per round. |
| Tumble refill | No `tumble_drop` route. Individual animation textures may still occur. | Soft falling air and one settle accent. |
| First earned Wanted star | `heat_advance` only sounds at `to >= 2`. | Short star-lock ping; higher levels can use variations. |
| Getaway dynamite landing | View emits `dynamite`; callback ignores it. | Heavy but short mechanical landing. |
| Fuse | View emits `fuse`; callback ignores it. | Duration-controlled sizzling loop, cancelled at blast. |
| Each ×2 value | View emits `double`; callback ignores it. | Short confirmation per doubled bar, ordered pitch variation. |
| Respins held | View emits `held`; callback ignores it. | A compact meter-confirmation sound. |
| Respin spent | View emits `spent`; callback ignores it. Empty-spin sound exists through another callback. | Optional quiet decrement tick; avoid layering an extra dramatic losing cue. |
| Dud explosive | View emits `dud`; callback ignores it. | Neutral mechanical click. |
| Bonus reel start / stop | `spin_start` and `column_stop` are emitted but ignored by this sound callback. | Short mechanical starts/stops, leaving space for gold landings. |
| Individual scatter | Per-scatter tease audio is intentionally omitted. | Optional identity cue only if approved; not a confirmed bug. |
| Rejected UI action | New proposal; precise trigger not audited. | Optional quiet error click. |

Evidence: `stake-frontend/src/audio.ts` route; `src/main.ts` SceneRuntime callback wiring; `src/pixi/PixiGameScene.ts`; `src/pixi/BonusView.ts`; `src/audio/SymbolFoley.ts`.

## Existing sound is not the same as an existing file

- Base reel stops **do** sound: `PixiGameScene.onReelImpact` plays `new_reel_stop`. The separate `audioBus.reelStop` method only stops the loop, which initially obscured the active path.
- Symbol animation foley already exists and is deliberately quiet. The source describes it as texture underneath win/tumble sounds, but the explicit cluster reward layer is absent. Detail cues are also dropped in turbo and duplicates are suppressed.
- `good_win_combo` is loaded but has no current playback call found in the inspected source. It is included in the track library as an audition candidate.
- Gold bar landing, explosion, truck doors/drive-off, anticipation, empty-spin feedback, collection sounds, banners, counters and Getaway results already have playback paths. They need taste/mix review, not wholesale classification as missing.
- `GetawaySound.ts` defines a fuller sample-based cue system, and 29 recordings exist in `assets/audio/getaway`. The current game does not instantiate that class. Those recordings are included as additional audition material.
- `mega_win`, `bonus_trigger`, `vault_lock`, `heat_rise` and `siren` do not have their named MP3 files. Synth or alternate-track fallbacks exist; a missing file does not necessarily mean silence. The reviewer previews those fallbacks through the current bus.
- Transform sound is called by the event route, the scene event, and the board hook. Check for duplicate triggering during the later integration pass.
- Existing raw-file previews are not the final mix. In particular, the money-counter ending is trimmed to 0.28 seconds in game, and the bonus intro plays at 1.25× speed.

## Sound sourcing

The current workshop uses individually authored procedural effects rendered to mono 48 kHz WAVs: paper snaps/riffles, metal collisions, blade swipes, engine revs, and other specific sequences. They are original DSP sound designs, not field recordings, realistic voices, or outputs from an AI sound service. Already approved legacy sketches retain the previous engine. Voices and music use existing or user-supplied recordings.

- ElevenLabs: https://elevenlabs.io/docs/eleven-creative/playground/sound-effects — text-to-SFX with MP3/WAV downloads. Use the row brief. No ElevenLabs generation connector is available in this session.
- Freesound: https://freesound.org/help/faq/ — search materials such as `metal latch`, `coin clink`, `banknote shuffle`, `short engine rev`, `fuse burning`, `glass ping`. Select an appropriate license for commercial use and retain the asset's license/source.
- ZapSplat: https://www.zapsplat.com/license-type/standard-license/ — recorded effect library; check attribution requirements for the downloaded asset and your account terms.

Choose source material for its timbre first, then edit attack, duration, layers and level to fit gameplay. Do not download a competing game's recognizable sounds as replacements.

## Maintenance

Regenerate the file inventory after asset changes:

```powershell
cd stake-frontend
node tools/sound-review/catalog.mjs
```

Curated gameplay findings and the old inventory are in `tools/sound-review/catalog.mjs`; source changes require rechecking them. The v2 queue is prepared by `prepare-review.mjs`. The original 147 entries include track aliases and unused recordings and are not the current user-facing queue. Run `node tools/sound-review/verify-review.mjs` to verify approval preservation and rendered audio. Do not overwrite `decisions-backup.json` or modify the frozen `synthesis.js` while approved legacy sounds depend on them.
