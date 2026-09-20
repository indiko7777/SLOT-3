# Heat Chase: three-star readiness audit

Reviewed 20 September 2026. Development assessment, not an awarded Stake rating.

## Official bar

Stake's [quality rankings](https://stake-engine.com/docs/approval-guidelines/game-quality-rankings) require studio-quality execution, originality and attention to detail for three stars. Coherent art, animation, sound, device performance and efficient loading all count. Replacing one image cannot establish that rating.

[General requirements](https://stake-engine.com/docs/approval-guidelines) require independent bets. Separate math modes and equal RTP do not alone resolve whether eligibility earned from earlier paid outcomes is allowed.

[Frontend requirements](https://stake-engine.com/docs/approval-guidelines/front-end-communication) include phone and mini-player layouts, local assets, accurate rules, RGS bet levels and balances, audio controls and autoplay confirmation. [Replay requirements](https://stake-engine.com/docs/approval-guidelines/game-replay-requirements) require session-free replay with supplied identifiers and disabled wagering.

## Implemented

- Original coastal sunset loading art retained for loading/intro. Regular spins now use a separate bright daytime illustration (`miami_daylight_gameplay_v2.webp`, 449,358 bytes), matching the existing symbol colors. The user rejected the dusk-marina variant. Original colorful feature buttons and confirmation styling restored.
- Bundled Barlow Semi Condensed UI fonts and their SIL OFL license; no external font requests. Per-load asset cache busting removed. Keyboard intro entry, reduced-motion splash and loader cleanup fallback.
- Portrait collection access uses a compact strip above the reels, preventing the card stack from overlapping symbols. Phone controls separated into usable rows. Uniform logical scene scaling for landscape phones and mini-player; bounded board dimensions.
- Preserved piece reveal -> completed character -> gold star -> next eligible star-mode spin. Fixed prestige reset erasing the third star. Locked the displayed head-start to the actual selected mode during a round. Ante and replay use their correct mode.
- Cosmetic rewards now visibly change HUD frame palettes. They are separate from gold-star mode rewards.
- Persisted per-round collection receipts prevent awarding the same revealed pieces again during interrupted-round playback. Skip-to-result counts only newly arriving wilds. Public replays never award collection progress. This is local-browser recovery, not cross-device server persistence.
- Session-free replay uses supplied game/version/mode/event and social settings, encodes path segments, rejects failed HTTP responses and empty events.
- Network requests have a timeout. Failed play/settlement stops autoplay and requires reauthentication instead of risking another spin while a round may remain active. Boot failures expose a retry action.
- Shared rules accurately describe five starting bonus spins, the 5x4 grid, empty-spin decrement, gold-star modes and cosmetic frame rewards.
- HUD rebuilds destroy owned children; transient star animations retain their own container. Fixed CardPeek ticker removal, duplicate ambient animation scheduling and spin-blur disposal. A regression test exercises 100 scheduler restarts.
- Local launcher waits for mock RGS readiness before opening Vite and reuses already-running services.

## Gold-star approval question

All three star modes already have separate published math books at 96% RTP. The unresolved question is whether a player may unlock access through previous paid results. Calling the reward a bonus does not, by itself, remove that dependency. Do not describe this as definitely approved or definitely rejected without Stake's assessment of the exact implementation.

Preserve the user's intended flow. A review-ready explanation and alternatives are in [STAKE_REVIEW_NOTES.md](STAKE_REVIEW_NOTES.md). No math distribution or published book was changed.

## Verification

- 53 frontend tests pass; TypeScript and production build pass. Six math tests pass. Audio now has a shared master output, compression, full-channel mute and background-tab suspension. Failed launch imports/parsing show a recovery screen; modal focus and Escape behavior work.
- Getaway now uses a new gold result card with dedicated progress-driven synthesized audio and a bounded final chord. Its covered exit restores all base layers before revealing them, including key-up/resize during the transition. The grid and doors move together over one uniformly colored, clipped aperture. Held bars retain their nodes and landing effects are awaited. Production phone replay checks cover Space skip, pointer skip, repeated taps and the 500,000 USD cap display. See RELEASE_CANDIDATE.md for scope and physical-audio limitations.
- Six math tests passed; all seven published mode lookup tables verify at 96.0000% RTP.
- Local RGS scenario runner checked 19 published replay samples across seven modes, including wins, available losses, bonuses and 5,000x cap outcomes. Wallet debit, settlement, repeated settlement and active-round reconnect checks pass. Evidence: [LOCAL_RGS_QA.json](LOCAL_RGS_QA.json). Run `npm run qa:rgs` with the mock online.
- Browser inspection: 1440x900 desktop, 390x844 portrait, 844x390 landscape and 320x240 mini-player. Loading, intro, local spin and sessionless replay inspected. Known Getaway event 1860 renders its 103.5x locked-grid result on portrait mobile. Base replay event 34076 reaches a zero-win result; invalid event 0 displays an error.
- Eight layout dimensions have automated bounds checks. These are not physical-device performance tests.
- Production artwork paths are relative and external Google Fonts are absent. Packaged frontend is approximately 16 MB uncompressed after excluding unused legacy/rejected images; main chunk about 621 kB minified / 191 kB gzip. The chunk-size warning remains visible. Frontend/math ZIPs and a per-file SHA-256 manifest are generated under `release/`; `release/LATEST.txt` identifies the candidate.

## Remaining release gates

1. Stake's decision on outcome-earned eligibility for separate star modes.
2. Real iOS/Safari and Android device performance/audio checks, plus extended-session memory profiling. Desktop emulation cannot certify these.
3. Stake's final visual/animation assessment. The final local presentation has separate coordinated loading/gameplay scenes and the user-preferred colorful controls. A three-star editorial rating cannot be inferred from passing tests.
4. Stake-hosted integration/replay validation with real launch parameters and final approved mode configuration. Local mock checks cannot substitute for the hosted environment.
5. Asset/license inventory and final reviewer evaluation. No rating, submission, publication or real-money wagering has been performed.

## Local preview

Run `npm run dev:local` inside `stake-frontend`. Open http://127.0.0.1:5176/ for the playable local game.

http://127.0.0.1:5176/?preview=loading intentionally holds the loading art for review; it is dev-only and does not advance.

Generation prompt: [LOADING_ART_PROMPT.md](LOADING_ART_PROMPT.md).

## Final candidate evidence

See [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md) for build commands, nested-path production preview, acceptance results and the remaining external review gates. Asset records are in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md); the final bright-background prompt is in [GAMEPLAY_ART_PROMPT.md](GAMEPLAY_ART_PROMPT.md).
