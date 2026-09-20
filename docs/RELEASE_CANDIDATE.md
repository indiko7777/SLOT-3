# Release candidate: Heat Chase

20 September 2026. Local candidate for Stake review; not a published or rated game.

## Intended product

- Bright, saturated daytime coastal illustration for regular spins, coordinated with the existing symbol colors.
- Sunset sports-car illustration retained for loading and introduction.
- Original colorful gold / magenta / cyan feature buttons and confirmation presentation retained.
- User-approved collection flow retained: pieces reveal the silhouette; completed character grants a gold star; later base spins use the corresponding published mode. Stake will assess eligibility, not a silent redesign.

## Reproduce the release

1. In `stake-math`: `npm test` and `npm run verify` (does not regenerate books).
2. In `stake-frontend`: `npm run dev:local`, then `npm run qa:rgs`.
3. `npm run package:release` runs frontend tests, creates a production build, checks packaged CSS asset paths and writes the two upload archives plus a SHA-256 manifest.
4. `release/LATEST.txt` identifies the newest package directory. The `frontend` folder has `index.html` at its root; the `math` folder has the published `index.json`, zstd books and lookup tables.

## Production preview

`npm run preview:release` serves the compiled frontend at `http://127.0.0.1:5177/candidate/`.

Local mock launch:
`http://127.0.0.1:5177/candidate/?sessionID=local-release-review-20260920&rgs_url=127.0.0.1:8787`

Known sessionless bonus replay:
`http://127.0.0.1:5177/candidate/?replay=true&game=heat-chase&version=1&mode=getaway&event=1860&amount=1&currency=USD&rgs_url=127.0.0.1:8787`

The compiled build deliberately requires casino launch parameters. Opening it without those parameters must show a recovery message, not generate a pretend session.

## Acceptance evidence

- 53 frontend tests, six math tests, production TypeScript/build checks.
- Getaway grid: one opaque aperture surface and common clip mask, uniform matte edge trim, with the frame/reels/doors/effects moving together. Active resize preserves their coordinate system. Blast flashes/particles no longer obscure adjacent values.
- Getaway payout completely replaced with an accessible gold result card, separate currency/multiplier, reveal/continue button and responsive layout. It has a dedicated synthesized entrance, progress-driven counting notes and final chord under 0.6 seconds. All voices cancel on skip/dismissal; base-win sounds are separate. The exit covers the old scene, restores the entire base scene, then reveals it. Fixed key-up/resize being able to leave the base HUD hidden.
- Earlier production replay checks: normal 103.5x completion; portrait Space skip to exactly 103.5 USD; portrait 5,000x cap with a 100 USD base amount displays 500,000 USD within the viewport. Pointer skip and repeated taps dismiss correctly, and the result overlay is removed. No console errors. Audio scheduling verified with Web Audio node tests; physical speaker/headphone listening remains a device QA task.
- Seven published modes verify at 96.0000% RTP, zero cross-mode spread. Books/distributions unchanged.
- 19 local replay scenarios plus all seven wallet/settlement mode checks. Machine-readable details: LOCAL_RGS_QA.json.
- Rapid HUD rebuild regression exercises 100 scheduler restarts without multiplying animation loops. Spin filters now release GPU resources.
- Timeout includes response body; failed launch imports/parsing show a recovery UI. Modal keyboard focus and Escape cancellation supported.
- Audio routes through a shared master output and compressor, including voices; OFF mutes every channel and backgrounded tabs silence/suspend audio.
- Final compiled files tested from `/candidate/` to exercise CDN subpath loading, bundled fonts and texture URLs. Ten extra-turbo mock spins completed with no browser errors.
- Portrait sessionless Getaway replay 1860 completed at 103.5x. A separately interrupted local Getaway settled through Skip to Result at 1,754.9x. Missing production launch parameters show a recovery screen.
- Portrait collection access uses a compact progress strip above the reels, eliminating card-stack overlap. Full gallery and desktop card behavior remain available.
- ZIP root entries verified, and every packaged file matched its SHA-256 manifest.

## External release gates

Stake's review and hosted integration acceptance are still required. Preserve the exact earned-star design for that review (STAKE_REVIEW_NOTES.md). Physical iOS/Safari and Android performance/audio checks remain unperformed here. Existing asset rights must be backed by the owner's source records (ASSET_PROVENANCE.md). Three stars is Stake's editorial rating, not an outcome this local test suite can certify.
