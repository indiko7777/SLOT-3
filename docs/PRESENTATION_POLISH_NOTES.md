# Presentation pass — verification notes

## Current presentation

Shared announcements use bundled Anton display type, warm white/gold faces with coral/cyan accents, luminous illustrated sweeps, glints and a short impact flare. The longer feature announcements use two lines so they read strongly at reel scale. A translucent full-screen midnight veil separates them from the game. Tier colors/intensity and fast-play read time remain distinct. Banner contacts and existing tier sounds are fired by the visual callbacks.

CASH is one original unbound wad in the idle pose. Win now feeds four notes in one brief upper-right stream, like a money gun. Sheets start flat against the wad, then turn in the air with different velocities, drag and flutter. The wad has restrained recoil. Removal is a short downward drift/fade of the remaining wad: no second note release or paper-shot sound. Winning cash cells have a bounded 72 ms stagger (30 ms in turbo). A runtime regression test plays win → hold → destroy and confirms paper never reappears during removal and the riffle fires once.

Cash art, rig and pivots are unchanged by this correction. Durations: idle 2.4 s, win 1.6 s, hold 1 s, land 0.47 s, destroy 0.4 s. The generator in `tools/skel-pipeline/symbol_motion.py`, generated preview/source bundle and shipped cash JSON were updated. Cash validation: five animations, eight parts, zero warnings; shipped bundle 195 KB. Paper foley remains frame-authored and throttled globally.

Getaway uses a night Miami backdrop, separate passing Art Deco buildings and palms. Original truck geometry, scale, doors, grid and animation are retained. Perspective scenery recycles offscreen; road dashes and repeated full-screen zoom/crossfade are removed. Filter bounds are restricted to the viewport and portrait scenery width is constrained.

## Runtime corrections

Overlapping GPU win filters remove only their own instance, preventing a completed pulse from restoring an already destroyed sibling. Four regression tests cover both completion orders, the empty chain and target destruction.

Replay/recovery choice dialogs no longer repeat their description in a fixed footer. A compact height-based layout keeps the cost rows available in the mini-player. The dialog palette uses the game's midnight/coral language.

Running announcements now re-anchor to the board and resize their full-screen veil during orientation changes, without restarting the counter. Verified with a held max win from portrait to landscape.

The large-win counter keeps a consistent decimal precision through the roll: two places for cent payouts and four when the payout needs sub-cent precision. Two regression cases cover ordinary amounts, fractional wagers and floating-point noise. Passing-city blur filters are explicitly released when the bonus scene is destroyed.

Replay now permits audio/settings/rules controls while wagering stays disabled. A mute button remains available during the chase and replay, with a portrait offset that leaves the collection header clear. Turning sound back on restores the last audible radio station. Keyboard activation of this control cannot also skip a counter. The radio station label is now the original “Coastal Heat”.

The main-screen logo fits within the left control column instead of extending to 1.6 times its width. Getaway and Super Getaway confirmation cards compose the existing game city, rear-facing truck and loot assets; the rejected generated chase scene is not used. Both cards explain starting spins, sticky gold, dynamite, ending conditions, configured cost, RTP and the base-amount maximum win. Button CSS was extracted verbatim and compared against the original; labels and handlers are preserved. Desktop, portrait and mini-player layouts were inspected, including the compact scroll area.

## Verification and remaining checks

Super Getaway now has its own night-pursuit confirmation presentation: the existing bonus city backdrop, a large gold/coral SUPER title, staggered five-star entrance, brief light streaks, soft red/blue reflections and a fuller gold cargo composition. Regular Getaway retains its daylight card. The Super variant states “Highest Gold Bar Values”; costs, spins, RTP, max win and all button styles/labels/handlers are preserved. Checked at desktop, 390×844 portrait, 844×390 landscape and 320×240 mini-player. Short layouts keep cost/actions fixed and rules scrollable; reduced-motion settings suppress the entrance effects.

Frontend: 153 tests, TypeScript and production build pass after the current cash/banner/popup revisions. Math: six tests pass; all seven published mode books verify at 96.0000% RTP with no math or RGS book changes. Existing Vite large-chunk advisory remains. Local RGS QA passes 19 scenarios across seven modes; results are recorded in LOCAL_RGS_QA.json. Selected presentation replays are in PRESENTATION_REPLAY_CASES.json.

The production sessionless cascade/WILD/heat replay (base 22005) completed at 3 USD with no console errors, including a repeat at 844×390. Small-win replay (base 22003) completed at 3.8 USD in portrait. Mini-player loss replay (base 34076) completed at 0 USD. Getaway 1860 completed at 103.5 USD; its published sequence includes dead spins and dynamite. Muted Getaway 1 completed at the 5,000× cap / 500,000 USD on a 100 USD base amount in portrait. Prior developer Getaway checks covered truck-door opening, gold locking, live/dud dynamite, dead spins and result. Desktop/portrait screenshots and cash preview poses have been inspected during the revisions.

Super Getaway 2247 completed at 1,933× / 1,933 USD in landscape. A muted repeat at a fixed 320×240 completed with the centered Grand Escape amount, multiplier and Collect action fully visible. A transient screenshot taken during viewport resizing initially appeared undersized; the fixed-size result confirmed the CSS layout was correct. No console warnings or errors were reported in the cascade and Super Getaway runs.

Local release archives and SHA-256 file manifest: `release/2026-09-27T17-21-08Z/`. Frontend payload: 20,210,090 bytes. Includes the single-stream cash correction and distinct Super Getaway confirmation. No submission or hosted deployment was performed.

Physical device/audio audition and an uninterrupted watch of every scenario in both audio states remain incomplete. Audio callback routing and throttling are covered by tests; these are not a substitute for listening. This document does not claim Stake certification, a three-star rating or hosted integration approval.
